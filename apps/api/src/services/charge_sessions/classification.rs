//! Pure charge-session classification: source and confidence labels, charger
//! type and network inference, grouping keys, and external alias parsing.

use chrono::{DateTime, Utc};

use super::{
    ChargeSessionSummaryPayload, CHARGE_SESSION_CONFIDENCE_API_ONLY,
    CHARGE_SESSION_CONFIDENCE_TELEMETRY, CHARGE_SESSION_CONFIDENCE_TELEMETRY_ENRICHED,
    CHARGE_SESSION_SOURCE_RIVIAN_API, CHARGE_SESSION_SOURCE_TELEMETRY,
    CHARGE_SESSION_SOURCE_TELEMETRY_AND_API,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalAliasKind {
    Cdrs,
    Txn,
    Vtxn,
    NetworkSession,
    Legacy,
    Unknown,
}

impl ExternalAliasKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ExternalAliasKind::Cdrs => "cdrs",
            ExternalAliasKind::Txn => "txn",
            ExternalAliasKind::Vtxn => "vtxn",
            ExternalAliasKind::NetworkSession => "network_session",
            ExternalAliasKind::Legacy => "legacy",
            ExternalAliasKind::Unknown => "unknown",
        }
    }

    pub(super) fn rank(self) -> i32 {
        match self {
            ExternalAliasKind::Cdrs => 0,
            ExternalAliasKind::Txn => 1,
            ExternalAliasKind::NetworkSession => 2,
            ExternalAliasKind::Vtxn => 3,
            ExternalAliasKind::Legacy => 4,
            ExternalAliasKind::Unknown => 5,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChargeSessionExternalAlias {
    pub external_id: String,
    pub alias_kind: ExternalAliasKind,
    pub transaction_id_grouping_key: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub enum UnmatchedInsertPolicy {
    Never,
    Always,
    RecentOnly {
        now: DateTime<Utc>,
        lookback_days: i64,
    },
}

pub(super) fn summarize_source(existing: Option<&str>, has_api: bool) -> &'static str {
    if !has_api {
        return CHARGE_SESSION_SOURCE_TELEMETRY;
    }

    match existing {
        Some(CHARGE_SESSION_SOURCE_RIVIAN_API) => CHARGE_SESSION_SOURCE_RIVIAN_API,
        Some(CHARGE_SESSION_SOURCE_TELEMETRY_AND_API) => CHARGE_SESSION_SOURCE_TELEMETRY_AND_API,
        Some(CHARGE_SESSION_SOURCE_TELEMETRY) => CHARGE_SESSION_SOURCE_TELEMETRY_AND_API,
        Some(_) => CHARGE_SESSION_SOURCE_TELEMETRY_AND_API,
        None => CHARGE_SESSION_SOURCE_TELEMETRY_AND_API,
    }
}

pub fn confidence_for_source(source: &str) -> &'static str {
    match source {
        CHARGE_SESSION_SOURCE_RIVIAN_API => CHARGE_SESSION_CONFIDENCE_API_ONLY,
        CHARGE_SESSION_SOURCE_TELEMETRY_AND_API => CHARGE_SESSION_CONFIDENCE_TELEMETRY_ENRICHED,
        _ => CHARGE_SESSION_CONFIDENCE_TELEMETRY,
    }
}

pub fn infer_is_rivian_network(vendor: Option<&str>) -> Option<bool> {
    let vendor = vendor?.trim();
    if vendor.is_empty() {
        return None;
    }

    let normalized = vendor.to_ascii_lowercase();
    let known_network = matches!(
        normalized.as_str(),
        "rivian" | "electrify america" | "evgo" | "chargepoint" | "tesla"
    );
    Some(known_network)
}

pub fn normalize_api_charger_type(value: Option<&str>) -> Option<&'static str> {
    match value?.trim().to_ascii_lowercase().as_str() {
        "wallbox" | "ac" | "level1" | "level2" | "j1772" => Some("ac"),
        "dc" | "dcfc" | "ran15_dispenser" | "supercharger" => Some("dc"),
        _ => None,
    }
}

pub fn infer_api_charger_type(vendor: Option<&str>, is_home: Option<bool>) -> Option<&'static str> {
    if is_home == Some(true) {
        return Some("ac");
    }

    match vendor?.trim().to_ascii_lowercase().as_str() {
        "tesla" | "rivian" | "electrify america" | "evgo" => Some("dc"),
        _ => None,
    }
}

pub fn normalize_grouping_key(raw: Option<&str>) -> Option<String> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }

    let mut pieces = raw
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if pieces.is_empty() {
        return None;
    }
    pieces.sort_unstable();
    pieces.dedup();
    Some(pieces.join(","))
}

fn parse_data_source_alias(data_source: &str) -> Option<(ExternalAliasKind, String)> {
    let mut parts = data_source.splitn(2, ':');
    let prefix = parts.next()?.trim();
    let external_id = parts.next()?.trim();
    if external_id.is_empty() {
        return None;
    }

    let kind = match prefix {
        "CDRS" => ExternalAliasKind::Cdrs,
        "TXN" => ExternalAliasKind::Txn,
        "VTXN" => ExternalAliasKind::Vtxn,
        _ => ExternalAliasKind::Unknown,
    };
    Some((kind, external_id.to_string()))
}

pub(super) fn infer_alias_kind_from_id(external_id: &str) -> ExternalAliasKind {
    if external_id.starts_with("USCPI") {
        ExternalAliasKind::NetworkSession
    } else {
        ExternalAliasKind::Legacy
    }
}

pub fn parse_summary_aliases(
    summary: &ChargeSessionSummaryPayload,
) -> Vec<ChargeSessionExternalAlias> {
    let grouping_key = normalize_grouping_key(
        summary
            .meta
            .as_ref()
            .and_then(|meta| meta.transaction_id_grouping_key.as_deref()),
    );
    let mut aliases = Vec::<ChargeSessionExternalAlias>::new();

    if let Some(data_sources) = summary
        .meta
        .as_ref()
        .and_then(|meta| meta.data_sources.as_ref())
    {
        for data_source in data_sources {
            if let Some((alias_kind, external_id)) = parse_data_source_alias(data_source) {
                aliases.push(ChargeSessionExternalAlias {
                    external_id,
                    alias_kind,
                    transaction_id_grouping_key: grouping_key.clone(),
                });
            }
        }
    }

    if let Some(transaction_id) = summary.transaction_id.as_ref().map(|value| value.trim()) {
        if !transaction_id.is_empty()
            && !aliases
                .iter()
                .any(|alias| alias.external_id == transaction_id)
        {
            aliases.push(ChargeSessionExternalAlias {
                external_id: transaction_id.to_string(),
                alias_kind: infer_alias_kind_from_id(transaction_id),
                transaction_id_grouping_key: grouping_key.clone(),
            });
        }
    }

    aliases.sort_by(|left, right| {
        left.alias_kind
            .rank()
            .cmp(&right.alias_kind.rank())
            .then_with(|| left.external_id.cmp(&right.external_id))
    });
    aliases.dedup_by(|left, right| left.external_id == right.external_id);
    aliases
}

pub fn preferred_external_alias(
    aliases: &[ChargeSessionExternalAlias],
) -> Option<&ChargeSessionExternalAlias> {
    aliases
        .iter()
        .min_by(|left, right| left.alias_kind.rank().cmp(&right.alias_kind.rank()))
}

pub(super) fn should_insert_unmatched_session(
    policy: UnmatchedInsertPolicy,
    started_at: Option<DateTime<Utc>>,
) -> bool {
    match policy {
        UnmatchedInsertPolicy::Never => false,
        UnmatchedInsertPolicy::Always => started_at.is_some(),
        UnmatchedInsertPolicy::RecentOnly { now, lookback_days } => {
            started_at.is_some_and(|start| start >= now - chrono::Duration::days(lookback_days))
        }
    }
}
