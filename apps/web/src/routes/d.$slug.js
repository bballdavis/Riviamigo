import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root';
import { useAuth } from '@riviamigo/hooks';
import { PageLayout, DateRangePicker } from '@riviamigo/ui/primitives';
import { DashboardRenderer, useDashboardBySlug, useUpdateDashboard, useCloneDashboard, downloadDashboardYaml, importDashboardYaml, } from '@riviamigo/dashboards';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { presetToRange, rangeToIso, DEFAULT_PRESET } from '../lib/dates';
import { Edit2, Lock, Copy, Check, X, Download, Upload } from 'lucide-react';
const searchSchema = z.object({ edit: z.string().optional() });
export const userDashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/d/$slug',
    validateSearch: searchSchema,
    component: UserDashboardPageWrapper,
});
function UserDashboardPageWrapper() {
    return _jsx(AuthGuard, { children: _jsx(UserDashboardPage, {}) });
}
function UserDashboardPage() {
    const { slug } = useParams({ from: '/d/$slug' });
    const search = useSearch({ from: '/d/$slug' });
    const navigate = useNavigate();
    const { defaultVehicleId } = useAuth();
    const isEditMode = search.edit === '1';
    const [preset, setPreset] = useState(DEFAULT_PRESET);
    const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
    const { from, to } = rangeToIso(range);
    const { data: config, isLoading } = useDashboardBySlug(slug);
    const [localConfig, setLocalConfig] = useState(null);
    const updateDashboard = useUpdateDashboard();
    const cloneDashboard = useCloneDashboard();
    const activeConfig = localConfig ?? config;
    const ctx = { vehicleId: defaultVehicleId, from, to };
    function enterEdit() {
        if (config?.isLocked) {
            handleClone();
            return;
        }
        navigate({ to: '/d/$slug', params: { slug }, search: { edit: '1' } });
    }
    function exitEdit() {
        navigate({ to: '/d/$slug', params: { slug }, search: {} });
        setLocalConfig(null);
    }
    async function handleSave() {
        if (!localConfig)
            return;
        await updateDashboard.mutateAsync(localConfig);
        exitEdit();
    }
    async function handleClone() {
        if (!config)
            return;
        const cloned = await cloneDashboard.mutateAsync(config.id);
        navigate({ to: '/d/$slug', params: { slug: cloned.slug }, search: { edit: '1' } });
    }
    function handleExport() {
        if (activeConfig)
            downloadDashboardYaml(activeConfig);
    }
    async function handleImport(e) {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const text = await file.text();
        try {
            const imported = importDashboardYaml(text);
            setLocalConfig(imported);
        }
        catch (err) {
            alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        e.target.value = '';
    }
    const isLocked = activeConfig?.isLocked ?? false;
    return (_jsx(AppLayout, { activeKey: "dashboard", children: _jsx(PageLayout, { title: activeConfig?.name ?? slug, actions: _jsxs("div", { className: "flex items-center gap-2", children: [activeConfig?.controls?.dateRange && !isEditMode && (_jsx(DateRangePicker, { value: range, preset: preset, onChange: (r, p) => { setRange(r); if (p)
                            setPreset(p); } })), isEditMode ? (_jsxs(_Fragment, { children: [_jsxs("button", { onClick: handleSave, disabled: !localConfig || updateDashboard.isPending, className: "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-accent text-white disabled:opacity-40 hover:bg-accent/90 transition-colors", children: [_jsx(Check, { className: "h-3.5 w-3.5" }), "Save"] }), _jsxs("button", { onClick: exitEdit, className: "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors", children: [_jsx(X, { className: "h-3.5 w-3.5" }), "Cancel"] })] })) : (_jsxs(_Fragment, { children: [isLocked ? (_jsxs(_Fragment, { children: [_jsxs("button", { onClick: handleClone, className: "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors", children: [_jsx(Copy, { className: "h-3.5 w-3.5" }), "Customize"] }), _jsx(Lock, { className: "h-3.5 w-3.5 text-fg-tertiary" })] })) : (_jsxs("button", { onClick: enterEdit, className: "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors", children: [_jsx(Edit2, { className: "h-3.5 w-3.5" }), "Edit"] })), _jsx("button", { onClick: handleExport, title: "Export as YAML", className: "p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg", children: _jsx(Download, { className: "h-3.5 w-3.5" }) }), _jsxs("label", { title: "Import from YAML", className: "cursor-pointer p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg", children: [_jsx(Upload, { className: "h-3.5 w-3.5" }), _jsx("input", { type: "file", accept: ".yaml,.yml", className: "sr-only", onChange: handleImport })] })] }))] }), children: !defaultVehicleId ? (_jsx(NoVehicleState, {})) : isLoading && !activeConfig ? (_jsx("div", { className: "text-xs text-fg-tertiary p-4", children: "Loading\u2026" })) : activeConfig ? (_jsx(DashboardRenderer, { config: activeConfig, ctx: ctx, mode: isEditMode ? 'edit' : 'view', onConfigChange: setLocalConfig })) : null }) }));
}
