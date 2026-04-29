import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useChargeSessions } from '@riviamigo/hooks';
import { DataTable, chargingColumns, type ChargeSessionRow } from '@riviamigo/ui/tables';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';
import type { Row } from '@tanstack/react-table';

function ChargingTableWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useChargeSessions(ctx.vehicleId, ctx.from, ctx.to, page);
  const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;

  function handleRowClick(row: Row<ChargeSessionRow>) {
    navigate({ to: '/charging/$sessionId', params: { sessionId: row.original.id } });
  }

  return (
    <div className="flex flex-col h-full">
      <DataTable
        data={(data?.items ?? []) as unknown as ChargeSessionRow[]}
        columns={chargingColumns}
        loading={isLoading}
        onRowClick={handleRowClick}
        emptyTitle="No charging sessions"
        emptyDescription="Sessions will appear here after your vehicle has charged."
      />
      {data && data.total > data.per_page && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <p className="text-xs text-fg-tertiary">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

registerWidget({
  id: 'table.charge_sessions',
  category: 'table',
  title: 'Charging Sessions',
  defaultSize: { w: 12, h: 5 },
  minSize: { w: 6, h: 3 },
  component: ChargingTableWidget,
});
