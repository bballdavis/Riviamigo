//! Adaptive polling based on vehicle powerState.

use crate::models::telemetry::PowerState;
use std::time::Duration;

pub fn poll_interval(power_state: Option<&PowerState>) -> Duration {
    match power_state {
        Some(PowerState::Drive | PowerState::Go) => Duration::from_secs(3600), // WS-only when driving
        Some(PowerState::Charging)               => Duration::from_secs(30),
        Some(PowerState::Ready)                  => Duration::from_secs(300),
        Some(PowerState::Sleep) | None           => Duration::from_secs(1800),
        Some(PowerState::Unknown)                => Duration::from_secs(1800),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn charging_is_30s() {
        assert_eq!(poll_interval(Some(&PowerState::Charging)), Duration::from_secs(30));
    }

    #[test]
    fn sleep_is_30min() {
        assert_eq!(poll_interval(Some(&PowerState::Sleep)), Duration::from_secs(1800));
    }
}
