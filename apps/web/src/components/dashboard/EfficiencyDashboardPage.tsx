import React from 'react';
import { TripTagPicker, type WidgetCtx } from '@riviamigo/dashboards';
import type { DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

type TripTagFilter = NonNullable<WidgetCtx['tripTagFilter']>;

export function EfficiencyDashboardPage({
  navKey,
  slug,
  title,
  widgetCtx,
}: DashboardPageProps & { widgetCtx?: Pick<WidgetCtx, 'tripTagFilter' | 'canManageTripTags'> }) {
  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      showEfficiencyDisplayToggle
      {...(widgetCtx ? { widgetCtx } : {})}
      renderBeforeDashboard={(state) => widgetCtx?.tripTagFilter?.setFilter ? (
        <EfficiencyTagFilterBar
          vehicleId={state.vehicleId}
          filter={widgetCtx.tripTagFilter}
          canManage={Boolean(widgetCtx.canManageTripTags)}
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
  return (
    <section className="mb-3 rounded-xl border border-border bg-bg-elevated/40 p-3" aria-label="Efficiency tag filters">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[13rem] flex-1">
          <TripTagPicker
            vehicleId={vehicleId}
            canManage={canManage}
            selectedIds={filter.tagIds}
            onChange={(tagIds) => filter.setFilter?.({ tagIds, tagMatch: filter.tagMatch, untagged: false })}
            label="Filter efficiency by tags"
          />
        </div>
        <div className="flex min-h-11 items-center rounded-lg border border-border p-1 text-xs" aria-label="Tag match mode">
          {(['all', 'any'] as const).map((match) => (
            <button
              key={match}
              type="button"
              disabled={filter.untagged || filter.tagIds.length === 0}
              onClick={() => filter.setFilter?.({ ...filter, tagMatch: match })}
              className={`min-h-11 rounded-md px-3 font-medium capitalize transition-colors ${filter.tagMatch === match ? 'bg-bg-surface text-fg shadow-sm' : 'text-fg-tertiary hover:text-fg'} disabled:opacity-40`}
            >
              {match}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => filter.setFilter?.({ tagIds: [], tagMatch: 'all', untagged: !filter.untagged })}
          className={`min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors ${filter.untagged ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border text-fg-secondary hover:bg-bg-surface'}`}
          aria-pressed={filter.untagged}
        >
          Untagged
        </button>
        {(filter.tagIds.length > 0 || filter.untagged) ? (
          <button type="button" className="min-h-11 px-2 text-sm font-medium text-accent hover:underline" onClick={clear}>
            Clear filters
          </button>
        ) : null}
      </div>
    </section>
  );
}
