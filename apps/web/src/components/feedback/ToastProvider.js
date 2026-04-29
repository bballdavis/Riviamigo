import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    useEffect(() => {
        function handleToast(event) {
            const detail = event.detail;
            if (!detail?.message)
                return;
            const id = Date.now();
            setToasts((current) => [...current.slice(-2), { ...detail, id }]);
            window.setTimeout(() => {
                setToasts((current) => current.filter((toast) => toast.id !== id));
            }, 7000);
        }
        window.addEventListener('riviamigo:toast', handleToast);
        return () => window.removeEventListener('riviamigo:toast', handleToast);
    }, []);
    return (_jsxs(_Fragment, { children: [children, _jsx("div", { "aria-live": "polite", "aria-atomic": "true", className: "fixed right-4 top-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3", children: toasts.map((toast) => (_jsx("div", { className: "rounded-xl border border-[#F87171]/30 bg-[#7F1D1D]/30 px-4 py-3 text-sm text-fg shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md", children: _jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "font-medium text-[#FCA5A5]", children: toast.title }), toast.code && (_jsx("p", { className: "mt-0.5 font-mono text-[10px] uppercase tracking-widest text-[#FCA5A5]/70", children: toast.code })), _jsx("p", { className: "mt-1 break-words text-xs leading-5 text-fg-secondary", children: toast.message })] }), _jsx("button", { type: "button", "aria-label": "Dismiss notification", className: "rounded-md px-2 py-1 text-xs text-fg-tertiary hover:bg-bg-elevated hover:text-fg", onClick: () => setToasts((current) => current.filter((item) => item.id !== toast.id)), children: "Close" })] }) }, toast.id))) })] }));
}
