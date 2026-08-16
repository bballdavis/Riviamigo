/**
 * Backward-compatible API facade. New code can import a domain client or query
 * key directly; existing callers retain the stable `api` object.
 */
export { resolveApiBaseUrl, setApiBaseUrl } from './api/transport';
export type {
  ChargingSchedule,
  ChargingScheduleInput,
  DepartureSchedule,
  DepartureScheduleInput,
  DepartureOccurrence,
  DepartureComfortSettings,
  LiveSession,
  BackfillStatus,
} from './api/transport';
export {
  analyticsClient,
  authClient,
  chargingClient,
  systemClient,
  telemetryClient,
  tripClient,
  vehicleClient,
} from './api/clients';
export { transport as api } from './api/transport';
