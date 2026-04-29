import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { PageLayout } from '@riviamigo/ui/primitives';
import { useDashboards } from '@riviamigo/dashboards';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { Lock, Unlock, Edit2, ExternalLink } from 'lucide-react';
import { useAuth } from '@riviamigo/hooks';
import { useMutation, useQueryClient } from '@tanstack/react-query';
export const adminDashboardsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/dashboards',
    component: AdminDashboardsWrapper,
});
function AdminDashboardsWrapper() {
    return _jsx(AuthGuard, { children: _jsx(AdminDashboardsPage, {}) });
}
function AdminDashboardsPage() {
    const navigate = useNavigate();
    const { data: dashboards, isLoading } = useDashboards();
    const { accessToken } = useAuth();
    const qc = useQueryClient();
    const toggleLock = useMutation({
        mutationFn: async ({ id, locked }) => {
            const res = await fetch(`/v1/admin/dashboards/${id}/lock`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                },
                body: JSON.stringify({ locked }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
            }
            return res.json();
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
    });
    const defaults = dashboards?.filter((d) => d.isDefault) ?? [];
    const userDashboards = dashboards?.filter((d) => !d.isDefault) ?? [];
    function DashRow({ d }) {
        return (_jsxs("div", { className: "flex items-center gap-3 py-3 px-4 border-b border-border last:border-0", children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("p", { className: "text-sm font-medium text-fg truncate", children: d.name }), _jsxs("p", { className: "text-xs text-fg-tertiary", children: [d.slug, " \u00B7 ", d.widgets.length, " widgets"] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => navigate({ to: '/d/$slug', params: { slug: d.slug } }), className: "p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg", title: "View", children: _jsx(ExternalLink, { className: "h-3.5 w-3.5" }) }), d.isDefault && (_jsxs(_Fragment, { children: [_jsx("button", { onClick: () => navigate({ to: '/d/$slug', params: { slug: d.slug }, search: { edit: '1' } }), className: "p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg", title: "Edit (admin)", children: _jsx(Edit2, { className: "h-3.5 w-3.5" }) }), _jsx("button", { onClick: () => toggleLock.mutate({ id: d.id, locked: !d.isLocked }), className: "p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg", title: d.isLocked ? 'Unlock' : 'Lock', children: d.isLocked
                                        ? _jsx(Lock, { className: "h-3.5 w-3.5" })
                                        : _jsx(Unlock, { className: "h-3.5 w-3.5" }) })] }))] })] }));
    }
    return (_jsx(AppLayout, { activeKey: "settings", children: _jsx(PageLayout, { title: "Admin: Dashboards", children: isLoading ? (_jsx("div", { className: "text-xs text-fg-tertiary p-4", children: "Loading\u2026" })) : (_jsxs("div", { className: "space-y-6", children: [_jsxs("section", { children: [_jsx("h2", { className: "text-xs font-medium text-fg-tertiary uppercase tracking-wider mb-2", children: "System Defaults" }), _jsx("div", { className: "rounded-xl border border-border bg-bg divide-y divide-border overflow-hidden", children: defaults.length === 0 ? (_jsx("p", { className: "text-xs text-fg-tertiary p-4", children: "No system defaults found." })) : (defaults.map((d) => _jsx(DashRow, { d: d }, d.id))) })] }), _jsxs("section", { children: [_jsx("h2", { className: "text-xs font-medium text-fg-tertiary uppercase tracking-wider mb-2", children: "User Dashboards" }), _jsx("div", { className: "rounded-xl border border-border bg-bg overflow-hidden", children: userDashboards.length === 0 ? (_jsx("p", { className: "text-xs text-fg-tertiary p-4", children: "No user dashboards yet." })) : (userDashboards.map((d) => _jsx(DashRow, { d: d }, d.id))) })] })] })) }) }));
}
