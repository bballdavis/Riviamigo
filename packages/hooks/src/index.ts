export { api, setApiBaseUrl, resolveApiBaseUrl } from './api';
export { authClient, vehicleClient, tripClient, chargingClient, telemetryClient, analyticsClient, systemClient } from './api';
export { queryKeys } from './queryKeys';
export type { ChargingSchedule, ChargingScheduleInput, DepartureSchedule, DepartureScheduleInput, DepartureOccurrence, DepartureComfortSettings, LiveSession, BackfillStatus } from './api';
export { useAuth } from './useAuth';
export { useAuthReady, useResolvedVehicleSelection } from './useAuthState';
export { useMe } from './useMe';
export { useVehicleStatus, useLiveStatusStore, useCurrentVehicleStatus } from './useVehicleStatus';
export { useSocHistory, useRangeHistory, usePhantomDrain, usePhantomDrainPeriods, useParkedEnergy, useDegradation, useBatteryHealth, useBatteryMileage } from './useBattery';
export {
	useTrips,
	useTripMapRoutes,
	useTrip,
	useTripDetailData,
	useTripTrack,
	useSpeedProfile,
	useElevationProfile,
	useTripPowerProfile,
	useTripDetailSeries,
	useTripTags,
	useCreateTripTag,
	useUpdateTripTag,
	useDeleteTripTag,
	useUpdateTripTagAssignments,
} from './useTrips';
export { invalidateChargingData, useChargeSessions, useChargeSession, useSavedPlaces, useUpdateChargeSessionLocation, useUpdateChargeSession, useChargingNetworkPreferences, useUpdateChargingNetworkPreference, useChargeCurve, useChargeCurveAnalysis, useChargingSummary, useChargingChartSeries, useChargingSchedule, useUpdateChargingSchedule, useDepartureSchedules, useCreateDepartureSchedule, useUpdateDepartureSchedule, useDeleteDepartureSchedule, useLiveSession } from './useCharging';
export { useEfficiencySummary, useEfficiencyByMode, useEfficiencyTrend, useEfficiencyVsTemp } from './useEfficiency';
export { useSummaryStats } from './useStats';
export { useMetricCatalog, useMetricValue, useMetricSeries, useMetricBatch } from './useMetrics';
export { useVehicles, useDefaultVehicleId } from './useVehicles';
export { useVehicleHealth } from './useHealth';
export { useBasemapConfig } from './useBasemapConfig';
export type { BasemapConfigPayload } from './useBasemapConfig';
export { useDocumentTheme } from './useDocumentTheme';
export { AuthenticatedVehicleArtwork, useVehicleArtwork } from './useVehicleArtwork';
export { getVehicleArtworkFallback, normalizeVehicleArtworkModel, resolveVehicleArtwork } from './vehicleArtworkFallback';
export type { ResolvedVehicleArtwork, VehicleArtworkFallbackModel, VehicleArtworkUsage } from './vehicleArtworkFallback';
