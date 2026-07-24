use std::fmt;

use tracing::{Event, Subscriber};
use tracing_subscriber::{
    fmt::{format::FormatEvent, FmtContext, FormatFields},
    layer::SubscriberExt,
    registry::LookupSpan,
    util::SubscriberInitExt,
    EnvFilter,
};

struct RiviamigoLogFormat;

impl<S, N> FormatEvent<S, N> for RiviamigoLogFormat
where
    S: Subscriber + for<'span> LookupSpan<'span>,
    N: for<'writer> tracing_subscriber::fmt::format::FormatFields<'writer> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: tracing_subscriber::fmt::format::Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        write!(writer, "[riviamigo][{}] ", event.metadata().level())?;
        ctx.format_fields(writer.by_ref(), event)?;
        writeln!(writer)
    }
}

pub fn init() {
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "riviamigo_api=debug,tower_http=info".into()),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .event_format(RiviamigoLogFormat)
                .with_ansi(false)
                .with_writer(std::io::stdout),
        )
        .init();
}
