//! Process-wide log output.
//!
//! Every runtime component writes one line per event in the shape
//!
//! ```text
//! [riviamigo][LEVEL] module::path:span{span fields}: message key=value key=value
//! ```
//!
//! The level semantics, field names, and message style are defined in
//! `docs/architecture/logging.md`; change that document together with this
//! module.

use std::fmt;

use tracing::{Event, Subscriber};
use tracing_subscriber::{
    fmt::{
        format::{FormatEvent, FormatFields},
        FmtContext, FormattedFields,
    },
    layer::SubscriberExt,
    registry::LookupSpan,
    util::SubscriberInitExt,
    EnvFilter,
};

/// Filter used when `RUST_LOG` is unset or invalid: `INFO` for first-party
/// code, `WARN` for HTTP framework chatter. Use `RUST_LOG` to opt in to
/// `debug` or `trace`.
pub const DEFAULT_FILTER: &str =
    "riviamigo_api=info,riviamigo_restore_agent=info,tower_http=warn,warn";

const FIRST_PARTY_PREFIX: &str = "riviamigo_api::";

struct RiviamigoLogFormat;

impl<S, N> FormatEvent<S, N> for RiviamigoLogFormat
where
    S: Subscriber + for<'span> LookupSpan<'span>,
    N: for<'writer> FormatFields<'writer> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: tracing_subscriber::fmt::format::Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        let metadata = event.metadata();
        let target = metadata
            .target()
            .strip_prefix(FIRST_PARTY_PREFIX)
            .unwrap_or_else(|| metadata.target());
        write!(writer, "[riviamigo][{}] {target}", metadata.level())?;

        // Outermost span first, so request/job context reads left to right.
        if let Some(scope) = ctx.event_scope() {
            for span in scope.from_root() {
                write!(writer, ":{}", span.metadata().name())?;
                let extensions = span.extensions();
                if let Some(fields) = extensions.get::<FormattedFields<N>>() {
                    if !fields.is_empty() {
                        write!(writer, "{{{fields}}}")?;
                    }
                }
            }
        }

        write!(writer, ": ")?;
        ctx.format_fields(writer.by_ref(), event)?;
        writeln!(writer)
    }
}

pub fn init() {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| DEFAULT_FILTER.into()))
        .with(
            tracing_subscriber::fmt::layer()
                .event_format(RiviamigoLogFormat)
                .with_ansi(false)
                .with_writer(std::io::stdout),
        )
        .init();
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tracing_subscriber::fmt::MakeWriter;

    use super::*;

    #[derive(Clone, Default)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for Buffer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> MakeWriter<'a> for Buffer {
        type Writer = Buffer;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    fn capture(filter: &str, emit: impl FnOnce()) -> String {
        let buffer = Buffer::default();
        let subscriber = tracing_subscriber::registry()
            .with(EnvFilter::new(filter))
            .with(
                tracing_subscriber::fmt::layer()
                    .event_format(RiviamigoLogFormat)
                    .with_ansi(false)
                    .with_writer(buffer.clone()),
            );
        tracing::subscriber::with_default(subscriber, emit);
        let bytes = buffer.0.lock().unwrap().clone();
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn line_has_prefix_level_target_message_and_fields() {
        let output = capture("trace", || {
            tracing::info!(vehicle_id = 7, "worker started");
        });
        assert!(
            output.starts_with("[riviamigo][INFO] "),
            "unexpected prefix: {output}"
        );
        assert!(output.contains(": worker started vehicle_id=7"), "{output}");
        assert!(output.ends_with('\n'));
    }

    #[test]
    fn enclosing_span_fields_are_included() {
        let output = capture("trace", || {
            let span = tracing::info_span!("http", request_id = "abc");
            let _entered = span.enter();
            tracing::debug!("handling");
        });
        assert!(output.contains(":http{request_id=\"abc\"}: "), "{output}");
        assert!(output.contains("handling"), "{output}");
    }

    #[test]
    fn default_filter_hides_debug_and_trace() {
        let output = capture(DEFAULT_FILTER, || {
            tracing::debug!("detail");
            tracing::trace!("firehose");
        });
        assert!(output.is_empty(), "{output}");
    }

    #[test]
    fn default_filter_parses() {
        assert!(EnvFilter::try_new(DEFAULT_FILTER).is_ok());
    }
}
