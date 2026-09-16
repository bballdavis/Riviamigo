# Frontend Error Observability

Riviamigo reports actionable browser failures through one local diagnostic seam.
The browser does not send product analytics or diagnostic payloads to a remote
service.

## Diagnostic contract

`@riviamigo/ui/lib/clientDiagnostics` owns `reportClientError()` and the global
browser handlers. Records use stable event names and include only safe context:
area, operation, HTTP status/code, provider, style, resource kind, and request
ID when available. Authorization headers, response bodies, query strings,
vehicle identifiers, and map tile coordinates are redacted.

Repeated reports for the same error are deduplicated for a short interval so a
MapLibre tile failure, transport failure, and React Query failure do not flood
the console. Existing feature-level error states and toasts remain responsible
for user-facing recovery guidance.

## Coverage

- `QueryCache` and `MutationCache` report failures after their normal retry
  policy completes.
- The API transport reports normal request failures, network failures, and
  first-party proxy responses that are not successful.
- `TripMapChart` reports MapLibre style and resource errors, including the
  sanitized resource class and provider context.
- The app bootstrap reports uncaught errors, unhandled promise rejections,
  resource-load failures, and CSP violations. The app error boundary records
  render failures and provides a reload action.
- Direct catches are either reported with an operation context or documented as
  expected control flow, such as aborts, logout cleanup, restore restarts,
  optional browser capabilities, and storage fallback.

## Map failure interpretation

`Map configuration unavailable` means the authenticated basemap configuration
request failed. `Map tiles unavailable` means MapLibre received a non-aborted
style or resource error after configuration was available. Expected request
aborts while MapLibre replaces a style do not create an error state. The two paths have separate
retry behavior and separate diagnostic events.

Server-side OpenFreeMap logs use the propagated request ID and record the
provider failure class, upstream status, resource class, cache state, and
duration without logging credentials, response bodies, or tile coordinates.
