//! SDK transport enforcement, including each retry and literal-IP endpoints.
use crate::{config::Config, errors::AppError, services::outbound};
use aws_smithy_runtime_api::client::{
    dns::{DnsFuture, ResolveDns, ResolveDnsError},
    http::{
        HttpClient, HttpConnector, HttpConnectorFuture, HttpConnectorSettings, SharedHttpConnector,
    },
    orchestrator::HttpRequest,
    result::ConnectorError,
    runtime_components::RuntimeComponents,
};
use ipnet::IpNet;
use std::{
    net::{IpAddr, SocketAddr},
    time::Duration,
};
use url::Url;

#[derive(Debug, Clone, Default)]
pub struct S3Policy {
    pub allowlist: Vec<IpNet>,
    pub allow_private_http: bool,
    /// Operator-owned development origin only; never restored from a package.
    pub development_origin: Option<Url>,
}
impl S3Policy {
    pub async fn validate_endpoint(&self, endpoint: &str) -> Result<(), AppError> {
        if endpoint.trim().is_empty() {
            return Ok(());
        }
        let url = Url::parse(endpoint.trim())
            .map_err(|_| AppError::Validation("Invalid S3 endpoint".into()))?;
        let host = url
            .host_str()
            .ok_or_else(|| AppError::Validation("S3 endpoint needs a host".into()))?
            .trim_start_matches('[')
            .trim_end_matches(']');
        let port = url
            .port_or_known_default()
            .ok_or_else(|| AppError::Validation("Invalid S3 endpoint scheme".into()))?;
        let addresses: Vec<_> = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::net::lookup_host((host, port)),
        )
        .await
        .map_err(|_| AppError::Validation("S3 endpoint DNS lookup timed out".into()))?
        .map_err(|_| AppError::Validation("S3 endpoint DNS lookup failed".into()))?
        .collect();
        self.validate(&url, &addresses)
    }
    pub fn from_config(config: &Config) -> Result<Self, AppError> {
        Ok(Self {
            allowlist: outbound::operator_allowlist(&config.security.s3_private_network_allowlist)?,
            allow_private_http: config.security.s3_allow_insecure_private_http,
            development_origin: if !config.is_production()
                && config.security.s3_allow_development_garage
            {
                config
                    .s3_endpoint
                    .as_deref()
                    .map(Url::parse)
                    .transpose()
                    .map_err(|_| {
                        AppError::Validation("Invalid development Garage endpoint".into())
                    })?
            } else {
                None
            },
        })
    }
    pub fn validate(&self, url: &Url, addresses: &[SocketAddr]) -> Result<(), AppError> {
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err(AppError::Validation("Invalid S3 endpoint".into()));
        }
        if self
            .development_origin
            .as_ref()
            .is_some_and(|base| base.origin() == url.origin())
        {
            if !addresses.is_empty()
                && addresses.iter().all(|a| {
                    a.ip().is_loopback()
                        || (outbound::is_private_ip(a.ip()) && !outbound::is_forbidden_ip(a.ip()))
                })
            {
                return Ok(());
            }
            return Err(AppError::Validation(
                "Development Garage must resolve to a local/private address".into(),
            ));
        }
        let private = outbound::validate_addresses(addresses, &self.allowlist)?;
        if url.scheme() != "https"
            && !(private && self.allow_private_http && !self.allowlist.is_empty())
        {
            return Err(AppError::Validation("S3 requires HTTPS; trusted-LAN HTTP requires an operator exception and CIDR allowlist".into()));
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct PinnedDns {
    host: String,
    addresses: Vec<IpAddr>,
}
impl ResolveDns for PinnedDns {
    fn resolve_dns<'a>(&'a self, name: &'a str) -> DnsFuture<'a> {
        DnsFuture::new(async move {
            if name.eq_ignore_ascii_case(&self.host) {
                Ok(self.addresses.clone())
            } else {
                Err(ResolveDnsError::new(std::io::Error::other(
                    "Unexpected S3 transport hostname",
                )))
            }
        })
    }
}

#[derive(Debug, Clone)]
pub struct S3HttpClient(pub S3Policy);
impl HttpClient for S3HttpClient {
    fn http_connector(
        &self,
        settings: &HttpConnectorSettings,
        components: &RuntimeComponents,
    ) -> SharedHttpConnector {
        SharedHttpConnector::new(S3Connector {
            policy: self.0.clone(),
            settings: settings.clone(),
            components: components.clone(),
        })
    }
}
#[derive(Debug, Clone)]
struct S3Connector {
    policy: S3Policy,
    settings: HttpConnectorSettings,
    components: RuntimeComponents,
}
impl HttpConnector for S3Connector {
    fn call(&self, request: HttpRequest) -> HttpConnectorFuture {
        let this = self.clone();
        HttpConnectorFuture::new(async move {
            let approved = async {
                let url = Url::parse(request.uri())
                    .map_err(|_| AppError::Validation("Invalid S3 request URL".into()))?;
                let host = url
                    .host_str()
                    .ok_or_else(|| AppError::Validation("S3 host required".into()))?
                    .trim_start_matches('[')
                    .trim_end_matches(']')
                    .to_owned();
                let port = url
                    .port_or_known_default()
                    .ok_or_else(|| AppError::Validation("S3 port required".into()))?;
                let addresses: Vec<SocketAddr> = tokio::time::timeout(
                    Duration::from_secs(5),
                    tokio::net::lookup_host((host.as_str(), port)),
                )
                .await
                .map_err(|_| AppError::DependencyUnavailable("S3 DNS timed out".into()))?
                .map_err(|_| AppError::DependencyUnavailable("S3 DNS failed".into()))?
                .collect();
                this.policy.validate(&url, &addresses)?;
                Ok::<_, AppError>(PinnedDns {
                    host,
                    addresses: addresses.into_iter().map(|a| a.ip()).collect(),
                })
            }
            .await
            .map_err(|error| ConnectorError::other(Box::new(error), None))?;
            // A request-specific connector pins these exact addresses while
            // retaining the hostname for signing and TLS/SNI. Smithy's default
            // proxy policy is disabled, so environment proxies cannot bypass it.
            let client = aws_smithy_http_client::Builder::new()
                .tls_provider(aws_smithy_http_client::tls::Provider::Rustls(
                    aws_smithy_http_client::tls::rustls_provider::CryptoMode::AwsLc,
                ))
                .build_with_resolver(approved);
            client
                .http_connector(&this.settings, &this.components)
                .call(request)
                .await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn address(ip: &str) -> SocketAddr {
        SocketAddr::new(ip.parse().unwrap(), 443)
    }
    #[test]
    fn defaults_require_public_https_and_reject_mixed_dns_or_metadata() {
        let policy = S3Policy::default();
        assert!(policy
            .validate(
                &Url::parse("https://s3.example.test").unwrap(),
                &[address("1.1.1.1")]
            )
            .is_ok());
        for (url, ips) in [
            ("http://s3.example.test", vec![address("1.1.1.1")]),
            ("https://s3.example.test", vec![address("10.0.0.1")]),
            (
                "https://s3.example.test",
                vec![address("1.1.1.1"), address("10.0.0.1")],
            ),
            (
                "https://s3.example.test",
                vec![address("::ffff:169.254.169.254")],
            ),
        ] {
            assert!(policy.validate(&Url::parse(url).unwrap(), &ips).is_err());
        }
    }
    #[test]
    fn private_http_requires_both_exception_and_cidr_and_garage_is_exact_origin() {
        let url = Url::parse("http://s3.lan.test:3900").unwrap();
        let mut policy = S3Policy {
            allowlist: vec!["10.0.0.0/24".parse().unwrap()],
            ..Default::default()
        };
        assert!(policy.validate(&url, &[address("10.0.0.2")]).is_err());
        policy.allow_private_http = true;
        assert!(policy.validate(&url, &[address("10.0.0.2")]).is_ok());
        assert!(policy.validate(&url, &[address("10.0.1.2")]).is_err());
        policy = S3Policy {
            development_origin: Some(Url::parse("http://127.0.0.1:3900").unwrap()),
            ..Default::default()
        };
        assert!(policy
            .validate(
                &Url::parse("http://127.0.0.1:3900/bucket").unwrap(),
                &[address("127.0.0.1")]
            )
            .is_ok());
        assert!(policy
            .validate(
                &Url::parse("http://127.0.0.1:3901/bucket").unwrap(),
                &[address("127.0.0.1")]
            )
            .is_err());
        assert!(policy
            .validate(
                &Url::parse("http://127.0.0.1:3900").unwrap(),
                &[address("1.1.1.1")]
            )
            .is_err());
    }
}
