import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const PageLayout = ({ children, title, subtitle, actions }) => (_jsxs("div", { "data-testid": "page-layout", children: [_jsx("h1", { children: title }), subtitle && _jsx("p", { children: subtitle }), actions, children] }));
export const StatCardGrid = ({ children }) => (_jsx("div", { "data-testid": "stat-card-grid", children: children }));
export const StatCard = ({ label, value, unit }) => (_jsxs("div", { "data-testid": `stat-${label.toLowerCase().replace(/\s+/g, '-')}`, children: [_jsx("span", { children: label }), _jsx("span", { children: value }), unit && _jsx("span", { children: unit })] }));
export const StatCardSkeleton = () => _jsx("div", { "data-testid": "stat-skeleton" });
export const ChartSection = ({ children, title, subtitle }) => (_jsxs("div", { "data-testid": `chart-${title.toLowerCase().replace(/\s+/g, '-')}`, children: [_jsx("span", { children: title }), subtitle && _jsx("span", { children: subtitle }), children] }));
export const MetricTabs = ({ tabs, active, onChange, title, subtitle, children, dropdownThreshold = 5, actions, }) => {
    const useDropdown = tabs.length > dropdownThreshold;
    return (_jsxs("div", { "data-testid": "metric-tabs", children: [title && _jsx("span", { children: title }), subtitle && _jsx("span", { children: subtitle }), useDropdown ? (_jsx("select", { value: active, onChange: (e) => onChange(e.target.value), "aria-label": "metric selector", children: tabs.map((t) => _jsx("option", { value: t.key, children: t.label }, t.key)) })) : (_jsx("div", { children: tabs.map((t) => (_jsx("button", { onClick: () => onChange(t.key), className: t.key === active ? 'bg-accent' : '', children: t.label }, t.key))) })), actions, children] }));
};
export const DateRangePicker = ({ onChange }) => _jsx("div", { "data-testid": "date-range-picker" });
export function presetToRange(_preset) {
    return { from: new Date('2024-01-01T00:00:00Z'), to: new Date('2024-01-31T23:59:59Z') };
}
export const EmptyState = ({ title, description, action, icon }) => (_jsxs("div", { "data-testid": "empty-state", children: [_jsx("p", { children: title }), description && _jsx("p", { children: description }), action && _jsx("button", { onClick: action.onClick, children: action.label })] }));
export const Card = ({ children, ...p }) => _jsx("div", { "data-testid": "card", ...p, children: children });
export const CardHeader = ({ children }) => _jsx("div", { "data-testid": "card-header", children: children });
export const CardTitle = ({ children }) => _jsx("h3", { children: children });
export const CardContent = ({ children }) => _jsx("div", { children: children });
export const Button = ({ children, onClick, iconLeft, ...p }) => (_jsxs("button", { onClick: onClick, type: p.type ?? 'button', children: [iconLeft, children] }));
export const Badge = ({ children, dot }) => _jsx("span", { "data-testid": "badge", children: children });
export const ThemeToggle = () => _jsx("button", { "data-testid": "theme-toggle", children: "Toggle theme" });
export const Input = ({ label, placeholder, type, value, onChange, required }) => (_jsxs("div", { children: [label && _jsx("label", { children: label }), _jsx("input", { type: type, placeholder: placeholder, value: value, onChange: onChange, required: required })] }));
export const Skeleton = ({ className }) => _jsx("div", { className: className });
export const ChartSkeleton = ({ className }) => _jsx("div", { className: className });
