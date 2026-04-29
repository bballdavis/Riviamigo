import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@riviamigo/hooks';
import { PageLayout, DateRangePicker } from '@riviamigo/ui/primitives';
import { DashboardRenderer, useDashboardBySlug, useUpdateDashboard, useCloneDashboard, getDefaultBySlug, downloadDashboardYaml, importDashboardYaml, } from '@riviamigo/dashboards';
import { AppLayout } from '../layout/AppLayout';
import { AuthGuard } from '../layout/AuthGuard';
import { NoVehicleState } from '../layout/NoVehicleState';
import { presetToRange, rangeToIso, DEFAULT_PRESET } from '../../lib/dates';
import { Edit2, Lock, Copy, Download, Upload } from 'lucide-react';
export function DashboardPage({ navKey, slug, title }) {
    return (_jsx(AuthGuard, { children: _jsx(DashboardPageContent, { navKey: navKey, slug: slug, title: title }) }));
}
function DashboardPageContent({ navKey, slug, title }) {
    const { defaultVehicleId } = useAuth();
    const navigate = useNavigate();
    const [preset, setPreset] = useState(DEFAULT_PRESET);
    const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
    const { from, to } = rangeToIso(range);
    // Try API first; fall back to bundled defaults if API unavailable / loading
    const { data: apiConfig, isLoading } = useDashboardBySlug(slug);
    const localDefault = getDefaultBySlug(slug);
    const config = apiConfig ?? localDefault;
    const updateDashboard = useUpdateDashboard();
    const cloneDashboard = useCloneDashboard();
    const ctx = { vehicleId: defaultVehicleId, from, to };
    async function handleClone() {
        if (!config)
            return;
        const cloned = await cloneDashboard.mutateAsync(config.id);
        navigate({ to: '/d/$slug', params: { slug: cloned.slug }, search: { edit: '1' } });
    }
    function handleExport() {
        if (config)
            downloadDashboardYaml(config);
    }
    async function handleImport(e) {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const text = await file.text();
        try {
            const imported = importDashboardYaml(text);
            await updateDashboard.mutateAsync(imported);
        }
        catch (err) {
            alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        e.target.value = '';
    }
    const canEdit = config && !config.isLocked;
    const isLocked = config?.isLocked;
    return (_jsx(AppLayout, { activeKey: navKey, children: _jsx(PageLayout, { title: title ?? config?.name ?? slug, actions: _jsxs("div", { className: "flex items-center gap-2", children: [config?.controls?.dateRange && (_jsx(DateRangePicker, { value: range, preset: preset, onChange: (r, p) => { setRange(r); if (p)
                            setPreset(p); } })), isLocked && (_jsxs("button", { onClick: handleClone, title: "Customize (creates your own copy)", className: "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors", children: [_jsx(Copy, { className: "h-3.5 w-3.5" }), "Customize"] })), canEdit && (_jsxs("button", { onClick: () => navigate({ to: '/d/$slug', params: { slug: config.slug }, search: { edit: '1' } }), className: "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors", children: [_jsx(Edit2, { className: "h-3.5 w-3.5" }), "Edit"] })), isLocked && (_jsx(Lock, { className: "h-3.5 w-3.5 text-fg-tertiary", "aria-label": "Default dashboard (locked)" })), _jsx("button", { onClick: handleExport, title: "Export as YAML", className: "p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg", children: _jsx(Download, { className: "h-3.5 w-3.5" }) }), _jsxs("label", { title: "Import from YAML", className: "cursor-pointer p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg", children: [_jsx(Upload, { className: "h-3.5 w-3.5" }), _jsx("input", { type: "file", accept: ".yaml,.yml", className: "sr-only", onChange: handleImport })] })] }), children: !defaultVehicleId ? (_jsx(NoVehicleState, {})) : isLoading && !config ? (_jsx("div", { className: "text-xs text-fg-tertiary p-4", children: "Loading\u2026" })) : config ? (_jsx(DashboardRenderer, { config: config, ctx: ctx, mode: "view" })) : null }) }));
}
