//! Resolve and pin approved socket addresses for every outbound request.
use crate::{errors::AppError, services::external_connections::ConnectionSettingsRow};
use ipnet::IpNet;
use std::{
    net::{IpAddr, SocketAddr},
    str::FromStr,
    time::Duration,
};
use url::Url;
pub async fn read_response_limited(
    mut response: reqwest::Response,
    limit: usize,
    label: &str,
) -> Result<Vec<u8>, AppError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(AppError::DependencyUnavailable(format!(
            "{label} response exceeded the limit"
        )));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::DependencyUnavailable(format!("{label} response failed")))?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(AppError::DependencyUnavailable(format!(
                "{label} response exceeded the limit"
            )));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub fn parse_private_network_allowlist(values: &[String]) -> Result<Vec<IpNet>, AppError> {
    let mut parsed = values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| {
            value.parse::<IpNet>().map_err(|_| {
                AppError::Validation(format!("invalid private-network CIDR `{value}`"))
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    parsed.sort_by_key(ToString::to_string);
    parsed.dedup();
    for network in &parsed {
        if !is_private_ip(network.network()) || !is_private_ip(network.broadcast()) {
            return Err(AppError::Validation(format!(
                "private-network CIDR `{network}` must be contained entirely in RFC1918 or IPv6 ULA space"
            )));
        }
    }
    Ok(parsed)
}

pub fn configured_private_network_allowlist(
    settings: &ConnectionSettingsRow,
) -> Result<Vec<IpNet>, AppError> {
    if settings.private_network_policy_state == "migration_required" {
        return Err(AppError::Validation(
            "private-network access is disabled until an administrator confirms explicit CIDR allowlists".into(),
        ));
    }
    parse_private_network_allowlist(&settings.private_network_allowlist)
}

pub fn endpoint_is_private(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    IpAddr::from_str(host)
        .map(|ip| match ip {
            IpAddr::V4(ip) => ip.is_private() || ip.is_loopback(),
            IpAddr::V6(ip) => ip.is_loopback() || is_ipv6_unique_local(ip),
        })
        .unwrap_or(false)
}

pub fn is_link_local_or_metadata(host: &str) -> bool {
    if host.eq_ignore_ascii_case("metadata.google.internal") {
        return true;
    }
    IpAddr::from_str(host).map(is_forbidden_ip).unwrap_or(false)
}

pub fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_multicast()
                || ip.is_broadcast()
                || octets[0] == 0
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || octets == [169, 254, 169, 254]
                || octets[..3] == [192, 0, 0]
                || octets[..3] == [192, 0, 2]
                || octets[..3] == [192, 88, 99]
                || octets[..3] == [192, 175, 48]
                || (octets[0] == 198 && matches!(octets[1], 18 | 19))
                || octets[..3] == [198, 51, 100]
                || octets[..3] == [203, 0, 113]
                || octets[0] >= 240
        }
        IpAddr::V6(ip) => {
            let segments = ip.segments();
            ip.is_unspecified()
                || (!is_ipv6_unique_local(ip)
                    && ip.to_ipv4_mapped().is_none()
                    && (segments[0] & 0xe000) != 0x2000)
                || ip.is_loopback()
                || ip.is_multicast()
                || is_ipv6_unicast_link_local(ip)
                || (segments[0] & 0xffc0) == 0xfec0
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
                || (segments[0] == 0x2001 && (segments[1] & 0xfe00) == 0)
                || segments[0] == 0x2002
                || segments[0] == 0x3fff
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_forbidden_ip(IpAddr::V4(mapped)))
        }
    }
}

pub fn is_private_ip(ip: IpAddr) -> bool {
    let ip = canonical_ip(ip);
    match ip {
        IpAddr::V4(ip) => ip.is_private(),
        IpAddr::V6(ip) => is_ipv6_unique_local(ip),
    }
}

pub fn canonical_ip(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(ip)),
        other => other,
    }
}

pub fn operator_security() -> Result<crate::config::SecurityConfig, AppError> {
    envy::from_env()
        .map_err(|_| AppError::Validation("Invalid operator outbound configuration".into()))
}

pub fn operator_allowlist(value: &str) -> Result<Vec<IpNet>, AppError> {
    parse_private_network_allowlist(&value.split(',').map(str::to_owned).collect::<Vec<_>>())
}

pub async fn read_json<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
    limit: usize,
    label: &str,
) -> Result<T, AppError> {
    let bytes = read_response_limited(response, limit, label).await?;
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::DependencyUnavailable(format!("{label} returned invalid JSON")))
}

pub fn is_ipv6_unique_local(ip: std::net::Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xfe00) == 0xfc00
}

pub fn is_ipv6_unicast_link_local(ip: std::net::Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xffc0) == 0xfe80
}

pub async fn outbound_client_for_url(
    url: &Url,
    allowlist: &[IpNet],
) -> Result<reqwest::Client, AppError> {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::Validation(
            "Outbound endpoint must use HTTP(S) without credentials or fragments".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Validation("connection endpoint host is required".into()))?;
    if is_link_local_or_metadata(host) {
        return Err(AppError::Validation(
            "link-local and cloud metadata endpoints are not allowed".into(),
        ));
    }
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let port = url
        .port_or_known_default()
        .ok_or_else(|| AppError::Validation("connection endpoint port is required".into()))?;
    let addresses = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::net::lookup_host((host, port)),
    )
    .await
    .map_err(|_| AppError::DependencyUnavailable("connection endpoint DNS timed out".into()))?
    .map_err(|_| {
        AppError::DependencyUnavailable("connection endpoint could not be resolved".into())
    })?
    .collect::<Vec<SocketAddr>>();
    if addresses.is_empty() {
        return Err(AppError::DependencyUnavailable(
            "connection endpoint could not be resolved".into(),
        ));
    }
    let private = validate_addresses(&addresses, allowlist)?;
    if url.scheme() == "http" && !private {
        return Err(AppError::Validation(
            "HTTP is permitted only for an explicitly allowed private destination".into(),
        ));
    }
    reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|error| AppError::Internal(error.into()))
}

pub fn validate_addresses(addresses: &[SocketAddr], allowlist: &[IpNet]) -> Result<bool, AppError> {
    if addresses.is_empty() {
        return Err(AppError::DependencyUnavailable(
            "No outbound addresses resolved".into(),
        ));
    }
    let mut private = false;
    let mut public = false;
    for address in addresses {
        if is_forbidden_ip(address.ip()) {
            return Err(AppError::Validation(
                "connection endpoint resolved to a forbidden address".into(),
            ));
        }
        if is_private_ip(address.ip()) {
            private = true;
            if !allowlist
                .iter()
                .any(|network| network.contains(&canonical_ip(address.ip())))
            {
                return Err(AppError::Validation(
                    "connection endpoint resolved outside its private CIDR allowlist".into(),
                ));
            }
        } else {
            public = true;
        }
    }
    if private && public {
        return Err(AppError::Validation(
            "connection endpoint DNS returned mixed public and private addresses".into(),
        ));
    }
    Ok(private)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::IntoFuture;
    #[test]
    fn classifies_every_resolved_address_and_mapped_ipv4() {
        let allowlist = vec!["192.168.1.0/24".parse().unwrap()];
        let private = "192.168.1.10:443".parse().unwrap();
        let public = "8.8.8.8:443".parse().unwrap();
        assert!(validate_addresses(&[private], &allowlist).unwrap());
        assert!(validate_addresses(&[private], &[]).is_err());
        assert!(validate_addresses(&[private, public], &allowlist).is_err());
        assert!(
            validate_addresses(&["[::ffff:192.168.1.10]:443".parse().unwrap()], &allowlist)
                .unwrap()
        );
        for address in [
            "127.0.0.1:443",
            "169.254.169.254:443",
            "[::ffff:127.0.0.1]:443",
            "[64:ff9b::a9fe:a9fe]:443",
            "[2002:7f00:1::]:443",
        ] {
            assert!(
                validate_addresses(&[address.parse().unwrap()], &allowlist).is_err(),
                "{address}"
            );
        }
    }
    #[tokio::test]
    async fn counts_chunked_response_bytes_without_content_length() {
        use axum::{
            body::{Body, Bytes},
            routing::get,
            Router,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(
            axum::serve(
                listener,
                Router::new().route(
                    "/",
                    get(|| async {
                        Body::from_stream(futures::stream::iter([
                            Ok::<_, std::io::Error>(Bytes::from_static(b"12345")),
                            Ok(Bytes::from_static(b"67890")),
                        ]))
                    }),
                ),
            )
            .into_future(),
        );
        let response = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{addr}/"))
            .send()
            .await
            .unwrap();
        assert!(read_response_limited(response, 8, "fixture").await.is_err());
        server.abort();
    }
}
