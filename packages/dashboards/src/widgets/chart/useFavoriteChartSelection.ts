import React from 'react';
import { useDashboardChartFavorites, useUpdateDashboardChartFavorite } from '@riviamigo/hooks';

interface FavoriteChartSelectionOptions {
  /** Per-user favorite key for this widget on this dashboard config. */
  storageKey: string;
  /** Chart IDs this widget can currently show. */
  chartIds: readonly string[];
  /** Shown only when the user has no usable favorite for this widget. */
  fallbackChartId: string;
}

interface FavoriteChartSelection {
  /** The chart to show: this session's pick, else the favorite, else the fallback. */
  chartId: string;
  /** The chart marked as this widget's default. */
  defaultChartId: string;
  /** False until the favorites request has answered, so no fallback flashes in first. */
  ready: boolean;
  selectChart: (chartId: string) => void;
  setDefault: (chartId: string) => void;
}

/**
 * Chart selection for a dashboard chart widget.
 *
 * The shown chart is derived on every render rather than copied into state
 * once, so a favorite that arrives after the chart catalog (or after a failed
 * refetch recovers) still takes effect. Only an explicit pick in this session
 * overrides the favorite.
 */
export function useFavoriteChartSelection({
  storageKey,
  chartIds,
  fallbackChartId,
}: FavoriteChartSelectionOptions): FavoriteChartSelection {
  const favorites = useDashboardChartFavorites();
  const updateFavorite = useUpdateDashboardChartFavorite();
  const [selection, setSelection] = React.useState<{ key: string; chartId: string } | null>(null);
  const [pendingDefault, setPendingDefault] = React.useState<{
    key: string;
    chartId: string;
  } | null>(null);

  // A failed background refetch keeps the last answer in `data`, so read the
  // favorite from there rather than gating on `isSuccess`.
  const savedFavorite = favorites.data?.chart_favorites?.[storageKey];
  const ready = favorites.data !== undefined || !favorites.isLoading;
  const favoriteChartId = pendingDefault?.key === storageKey ? pendingDefault.chartId : savedFavorite;
  const defaultChartId =
    typeof favoriteChartId === 'string' && chartIds.includes(favoriteChartId)
      ? favoriteChartId
      : fallbackChartId;
  const selectedChartId =
    selection?.key === storageKey && chartIds.includes(selection.chartId)
      ? selection.chartId
      : null;
  const chartId = selectedChartId ?? defaultChartId;

  const selectChart = React.useCallback(
    (next: string) => setSelection({ key: storageKey, chartId: next }),
    [storageKey]
  );

  const setDefault = (next: string) => {
    // Marking a default does not switch the chart being looked at.
    setSelection({ key: storageKey, chartId });
    setPendingDefault({ key: storageKey, chartId: next });
    updateFavorite.mutate(
      { key: storageKey, chartId: next },
      { onSettled: () => setPendingDefault(null) }
    );
  };

  return { chartId, defaultChartId, ready, selectChart, setDefault };
}
