import React from 'react';
import { Filter, Tag } from 'lucide-react';
import { TripTagPicker, type WidgetCtx } from '@riviamigo/dashboards';
import { Tooltip } from '@riviamigo/ui/primitives';
import type { DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

type TripTagFilter = NonNullable<WidgetCtx['tripTagFilter']>;

export function EfficiencyDashboardPage({
  navKey,
  slug,
  title,
  widgetCtx,
}: DashboardPageProps & { widgetCtx?: Pick<WidgetCtx, 'tripTagFilter' | 'canManageTripTags'> }) {
  const filter = widgetCtx?.tripTagFilter;
  const hasActiveFilter = Boolean(filter?.tagIds.length || filter?.untagged);
  const [showTagFilters, setShowTagFilters] = React.useState(hasActiveFilter);

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      showEfficiencyDisplayToggle
      renderLeadingActions={() => filter?.setFilter ? (
        <Tooltip content={showTagFilters ? 'Hide efficiency filters' : 'Show efficiency filters'}>
          <button
            type="button"
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${showTagFilters || hasActiveFilter ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-bg-elevated text-fg-secondary hover:border-border-strong hover:text-fg'}`}
            onClick={() => setShowTagFilters((value) => !value)}
            aria-label={showTagFilters ? 'Hide efficiency filters' : 'Show efficiency filters'}
            aria-expanded={showTagFilters}
            aria-controls="efficiency-tag-filters"
            title={showTagFilters ? 'Hide efficiency filters' : 'Show efficiency filters'}
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
      {...(widgetCtx ? { widgetCtx } : {})}
      renderBeforeDashboard={(state) => filter?.setFilter && showTagFilters ? (
        <EfficiencyTagFilterBar
          vehicleId={state.vehicleId}
          filter={filter}
          canManage={Boolean(widgetCtx?.canManageTripTags)}
        />
      ) : null}
    />
  );
}

function EfficiencyTagFilterBar({
  vehicleId,
  filter,
  canManage,
}: {
  vehicleId: string | null;
  filter: TripTagFilter;
  canManage: boolean;
}) {
  const clear = () => filter.setFilter?.({ tagIds: [], tagMatch: 'all', untagged: false });
  const filterSummary = filter.untagged
    ? 'Untagged trips'
    : filter.tagIds.length
      ? `${filter.tagIds.length} tag${filter.tagIds.length === 1 ? '' : 's'} selected`
      : 'All trips';

  return (
    <section id="efficiency-tag-filters" className="mb-4 rounded-xl border border-border bg-bg-elevated/40 p-3" aria-label="Efficiency tag filters">
      <div className="mb-2 flex items-center gap-2">
        <Tag className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <span className="text-sm font-semibold text-fg">Trip tags</span>
        <span className="text-xs text-fg-tertiary">{filterSummary}</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <TripTagPicker
            vehicleId={vehicleId}
            canManage={canManage}
            selectedIds={filter.tagIds}
            onChange={(tagIds) => filter.setFilter?.({ tagIds, tagMatch: filter.tagMatch, untagged: false })}
            label="Filter efficiency by tags"
            mode="inline"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-11 items-center rounded-lg border border-border p-1 text-xs" aria-label="Tag match mode">
          {(['all', 'any'] as const).map((match) => (
            <button
              key={match}
              type="button"
              disabled={filter.untagged || filter.tagIds.length === 0}
              onClick={() => filter.setFilter?.({ ...filter, tagMatch: match })}
              className={`h-9 rounded-md px-3 font-medium capitalize transition-colors ${filter.tagMatch === match ? 'bg-bg-surface text-fg shadow-sm' : 'text-fg-tertiary hover:text-fg'} disabled:opacity-40`}
            >
              {match}
            </button>
          ))}
          </div>
          <button
            type="button"
            onClick={() => filter.setFilter?.({ tagIds: [], tagMatch: 'all', untagged: !filter.untagged })}
            className={`h-11 rounded-lg border px-3 text-sm font-medium transition-colors ${filter.untagged ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border text-fg-secondary hover:bg-bg-surface'}`}
            aria-pressed={filter.untagged}
          >
            Untagged
          </button>
          {(filter.tagIds.length > 0 || filter.untagged) ? (
            <button type="button" className="h-11 px-2 text-sm font-medium text-accent hover:underline" onClick={clear}>
              Clear filters
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
