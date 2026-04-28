import { jsx as _jsx } from "react/jsx-runtime";
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
export const rootRoute = createRootRouteWithContext()({
    component: Root,
});
function Root() {
    return _jsx(Outlet, {});
}
