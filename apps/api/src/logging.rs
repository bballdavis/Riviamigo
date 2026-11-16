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

use std::{borrow::Cow, fmt, fmt::Write as _, future::Future, process::ExitCode};

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

/// Filter used when `RUST_LOG` is unset or invalid: `INFO` everywhere except
/// HTTP framework chatter, which stays at `WARN`. Applying `INFO` to every
/// target keeps the maintenance binaries (their targets are not under
/// `riviamigo_api`) as visible as the API. Use `RUST_LOG` to opt in to `debug`
/// or `trace`.
pub const DEFAULT_FILTER: &str = "info,tower_http=warn";

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

        // Render to a buffer first so every line passes through the same
        // safety net: secrets are masked and the line cannot be split.
        let mut line = String::new();
        write!(line, "[riviamigo][{}] {target}", metadata.level())?;

        // Outermost span first, so request/job context reads left to right.
        if let Some(scope) = ctx.event_scope() {
            for span in scope.from_root() {
                write!(line, ":{}", span.metadata().name())?;
                let extensions = span.extensions();
                if let Some(fields) = extensions.get::<FormattedFields<N>>() {
                    if !fields.is_empty() {
                        write!(line, "{{{fields}}}")?;
                    }
                }
            }
        }

        write!(line, ": ")?;
        ctx.format_fields(
            tracing_subscriber::fmt::format::Writer::new(&mut line),
            event,
        )?;
        writeln!(writer, "{}", single_line(&redact(&line)))
    }
}

const MASK: &str = "***";

/// Mask credentials that must never reach a log line, whichever call site
/// produced the text (an error chain, a child process's stderr, a SQL
/// statement echoed by a driver).
///
/// Covers URL userinfo (`scheme://user:secret@host`), `password`/`passwd`/
/// `secret` assignments (`password=x`, `PASSWORD 'x'`, `"password":"x"`), and
/// `Bearer` tokens. This is a backstop: call sites still must not log secrets.
pub fn redact(input: &str) -> Cow<'_, str> {
    let lower = input.to_ascii_lowercase();
    let suspicious = input.contains("://")
        || lower.contains("password")
        || lower.contains("passwd")
        || lower.contains("secret")
        || lower.contains("bearer ");
    if !suspicious {
        return Cow::Borrowed(input);
    }
    Cow::Owned(redact_keyed(&redact_url_credentials(input)))
}

fn redact_url_credentials(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(position) = rest.find("://") {
        let (head, tail) = rest.split_at(position + 3);
        out.push_str(head);
        let end = tail
            .find(|c: char| matches!(c, '/' | '?' | '#' | '"' | '\'' | ')') || c.is_whitespace())
            .unwrap_or(tail.len());
        let (authority, after) = tail.split_at(end);
        match authority.rfind('@') {
            Some(at) => match authority[..at].find(':') {
                Some(colon) => {
                    out.push_str(&authority[..=colon]);
                    out.push_str(MASK);
                    out.push_str(&authority[at..]);
                }
                None => out.push_str(authority),
            },
            None => out.push_str(authority),
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

fn is_value_end(c: char) -> bool {
    c.is_whitespace() || matches!(c, ',' | '&' | ';' | ')' | '"' | '\'')
}

fn redact_keyed(input: &str) -> String {
    const KEYS: [&str; 3] = ["password", "passwd", "secret"];
    let lower = input.to_ascii_lowercase();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        let mut matched = None;
        if lower[i..].starts_with("bearer ") {
            matched = bearer_value(input, i + "bearer ".len());
        } else {
            for key in KEYS {
                if lower[i..].starts_with(key) {
                    matched = assigned_value(input, i + key.len());
                    break;
                }
            }
        }
        match matched {
            Some((value_start, value_end)) => {
                out.push_str(&input[i..value_start]);
                out.push_str(MASK);
                i = value_end;
            }
            None => {
                let ch = input[i..].chars().next().expect("index is on a boundary");
                out.push(ch);
                i += ch.len_utf8();
            }
        }
    }
    out
}

fn bearer_value(input: &str, start: usize) -> Option<(usize, usize)> {
    let token = &input[start..];
    let len = token.find(is_value_end).unwrap_or(token.len());
    (len > 0).then_some((start, start + len))
}

/// The value span after `key`, if `key` is followed by an assignment
/// (`=`, `:`) or a quoted literal.
fn assigned_value(input: &str, after_key: usize) -> Option<(usize, usize)> {
    let mut j = after_key;
    // A JSON key closes its own quote before the separator.
    if matches!(input[j..].chars().next(), Some('"' | '\'')) {
        j += 1;
    }
    let spaced_from = j;
    j += input[j..].len() - input[j..].trim_start().len();
    let had_space = j > spaced_from;
    let separator = input[j..].chars().next()?;
    if matches!(separator, '=' | ':') {
        j += 1;
        j += input[j..].len() - input[j..].trim_start().len();
    } else if !(had_space && matches!(separator, '"' | '\'')) {
        return None;
    }
    let first = input[j..].chars().next()?;
    if matches!(first, '"' | '\'') {
        let inner = j + 1;
        let close = input[inner..]
            .find(first)
            .map_or(input.len(), |p| inner + p);
        return (close > inner).then_some((inner, close));
    }
    let len = input[j..].find(is_value_end).unwrap_or(input.len() - j);
    (len > 0).then_some((j, j + len))
}

/// Keep one event on one line. Multi-line text (an `anyhow` debug chain, a
/// child process's stderr) is joined with ` | `, and any other control
/// character is dropped, so no logged value can forge a second log line.
fn single_line(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut pending_break = false;
    for ch in line.chars() {
        if ch == '\n' || ch == '\r' {
            pending_break = true;
        } else if (ch.is_control() && ch != '\t') || (pending_break && ch.is_whitespace()) {
            continue;
        } else {
            if pending_break {
                if !out.ends_with(' ') {
                    out.push(' ');
                }
                out.push_str("| ");
                pending_break = false;
            }
            out.push(ch);
        }
    }
    out
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
    install_panic_hook();
}

/// A panic is a process-level failure; route it through the same format as
/// every other event instead of the runtime's raw stderr text.
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_default();
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|message| (*message).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "non-string panic payload".to_string());
        tracing::error!(location, %message, "thread panicked");
    }));
}

/// Render an error and every cause on one line: `outer: inner: root`.
pub fn error_chain(error: &anyhow::Error) -> String {
    format!("{error:#}")
}

/// Entry point for a long-running or one-shot process: install logging,
/// run `body`, and report a failure through the shared format. Startup
/// failures returned from `main` with `?` would otherwise be printed by the
/// Rust runtime in a different shape, outside the log filter.
pub async fn run(body: impl Future<Output = anyhow::Result<()>>) -> ExitCode {
    init();
    match body.await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(error = %error_chain(&error), "process exiting after fatal error");
            ExitCode::FAILURE
        }
    }
}

/// Resolves with the name of the signal that asked the process to stop.
pub async fn shutdown_signal() -> &'static str {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut terminate) => tokio::select! {
                _ = tokio::signal::ctrl_c() => "SIGINT",
                _ = terminate.recv() => "SIGTERM",
            },
            Err(error) => {
                tracing::warn!(error = %error, "SIGTERM handler unavailable; only SIGINT stops gracefully");
                let _ = tokio::signal::ctrl_c().await;
                "SIGINT"
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
        "SIGINT"
    }
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

    #[test]
    fn redacts_url_credentials() {
        assert_eq!(
            redact("connect postgres://riviamigo:hunter2@db:5432/riviamigo failed"),
            "connect postgres://riviamigo:***@db:5432/riviamigo failed"
        );
        assert_eq!(
            redact("redis://:s3cret@redis:6379"),
            "redis://:***@redis:6379"
        );
        assert_eq!(
            redact("https://example.com/a?b=c"),
            "https://example.com/a?b=c"
        );
    }

    #[test]
    fn redacts_password_assignments() {
        assert_eq!(
            redact("CREATE ROLE x LOGIN PASSWORD 'abc123' VALID"),
            "CREATE ROLE x LOGIN PASSWORD '***' VALID"
        );
        assert_eq!(redact("PGPASSWORD=abc123 psql"), "PGPASSWORD=*** psql");
        assert_eq!(
            redact(r#"{"password":"abc123","a":1}"#),
            r#"{"password":"***","a":1}"#
        );
        assert_eq!(
            redact("Authorization: Bearer abc.def"),
            "Authorization: Bearer ***"
        );
    }

    #[test]
    fn leaves_ordinary_text_alone() {
        for text in [
            "password login enabled",
            "ALTER ROLE x NOLOGIN PASSWORD NULL;",
            "password_login_enabled=true",
            "token_present=true",
            "worker started",
        ] {
            assert_eq!(redact(text), text);
        }
    }

    #[test]
    fn single_line_joins_multiline_text() {
        assert_eq!(
            single_line("a\n\nCaused by:\n    0: b"),
            "a | Caused by: | 0: b"
        );
        assert_eq!(
            single_line("fake\r\n[riviamigo][INFO] x"),
            "fake | [riviamigo][INFO] x"
        );
    }

    #[test]
    fn event_output_is_redacted_and_single_line() {
        let output = capture("trace", || {
            tracing::warn!(
                error = "psql failed: password=abc123\nLINE 1",
                "restore step failed"
            );
        });
        assert!(!output.contains("abc123"), "{output}");
        assert_eq!(output.trim_end().lines().count(), 1, "{output}");
    }
}
