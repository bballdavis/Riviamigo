import React from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, RotateCw, X } from 'lucide-react';
import { ChartPicker, type ChartPickerOption } from '@riviamigo/ui/primitives';
import { cn } from '@riviamigo/ui/lib/utils';

interface MobileChartViewerProps {
  chartId: string;
  chartTitle: string;
  chartOptions: ChartPickerOption[];
  onChartChange: (chartId: string) => void;
  onClose: () => void;
  children: (height: number) => React.ReactNode;
}

export function MobileChartViewer({
  chartId,
  chartTitle,
  chartOptions,
  onChartChange,
  onClose,
  children,
}: MobileChartViewerProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const closedRef = React.useRef(false);
  const [isPortrait, setIsPortrait] = React.useState(() => isPortraitViewport());
  const [chartHeight, setChartHeight] = React.useState(() => getChartHeight());

  const close = React.useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (document.fullscreenElement === rootRef.current) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
    try {
      screen.orientation?.unlock?.();
    } catch {
      // Orientation support is optional and should never prevent closing.
    }
    onClose();
  }, [onClose]);

  React.useEffect(() => {
    const updateViewport = () => {
      setIsPortrait(isPortraitViewport());
      setChartHeight(getChartHeight());
    };
    const orientationQuery = window.matchMedia('(orientation: portrait)');
    orientationQuery.addEventListener('change', updateViewport);
    window.addEventListener('resize', updateViewport);
    updateViewport();
    return () => {
      orientationQuery.removeEventListener('change', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, []);

  React.useEffect(() => {
    const scrollY = window.scrollY;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousDocumentOverscroll = document.documentElement.style.overscrollBehavior;
    const previousBodyStyles = {
      overflow: document.body.style.overflow,
      overscrollBehavior: document.body.style.overscrollBehavior,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    const appRoot = document.getElementById('root');
    const previousInert = appRoot?.inert;

    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    if (appRoot) appRoot.inert = true;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onFullscreenChange = () => {
      if (!closedRef.current && document.fullscreenElement == null) close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    const root = rootRef.current;
    if (root?.requestFullscreen) {
      void root.requestFullscreen()
        .then(async () => {
          try {
            await screen.orientation?.lock?.('landscape');
          } catch {
            // iOS and many browser contexts intentionally reject orientation locks.
          }
        })
        .catch(() => undefined);
    }

    return () => {
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.documentElement.style.overscrollBehavior = previousDocumentOverscroll;
      document.body.style.overflow = previousBodyStyles.overflow;
      document.body.style.overscrollBehavior = previousBodyStyles.overscrollBehavior;
      document.body.style.position = previousBodyStyles.position;
      document.body.style.top = previousBodyStyles.top;
      document.body.style.width = previousBodyStyles.width;
      if (appRoot) appRoot.inert = previousInert ?? false;
      if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [close]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${chartTitle} expanded chart`}
      data-mobile-chart-viewer="true"
      className="fixed inset-0 z-[100] isolate h-[100dvh] w-[100dvw] overflow-hidden overscroll-none bg-bg-page touch-none"
    >
      <div className="absolute left-[max(0.75rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-30">
        {chartOptions.length > 1 ? (
          <ChartPicker
            variant="compact"
            value={chartId}
            options={chartOptions}
            onChange={onChartChange}
            searchValue=""
            onSearchChange={() => undefined}
            selectLabel="Choose chart"
          />
        ) : (
          <p className="max-w-[min(16rem,calc(100vw-8rem))] truncate rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm font-semibold text-fg shadow-sm">{chartTitle}</p>
        )}
      </div>
      <button
        ref={closeRef}
        type="button"
        onClick={close}
        className="absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-bg-surface text-fg-tertiary shadow-sm transition-colors hover:border-border-strong hover:text-fg focus:outline-none focus:ring-1 focus:ring-accent"
        aria-label="Close expanded chart"
      >
        <X className="h-5 w-5" />
      </button>

      {isPortrait ? (
        <div className="m-[max(0.75rem,env(safe-area-inset-top))] flex h-[calc(100%-1.5rem)] flex-col items-center justify-center gap-6 rounded-2xl border border-accent bg-accent p-8 text-center text-fg-on-accent shadow-glow-button">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-fg-on-accent/35 bg-fg-on-accent/10 shadow-sm">
            <RotateCw className="h-12 w-12" strokeWidth={2.5} aria-hidden="true" />
            <Maximize2 className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full border border-accent bg-bg-surface p-1 text-accent shadow-sm" aria-hidden="true" />
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight">Rotate for a wider chart</p>
            <p className="mx-auto mt-3 max-w-sm text-base leading-6 text-fg-on-accent/90">Turn your phone sideways to explore {chartTitle} with the full interactive controls.</p>
          </div>
        </div>
      ) : (
        <div className={cn('h-full w-full', chartOptions.length > 1 && 'pt-1')} data-chart-presentation="mobile-viewer">
          {children(chartHeight)}
        </div>
      )}
    </div>,
    document.body,
  );
}

function isPortraitViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches;
}

function getChartHeight() {
  if (typeof window === 'undefined') return 320;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  return Math.max(240, Math.floor(viewportHeight - 16));
}
