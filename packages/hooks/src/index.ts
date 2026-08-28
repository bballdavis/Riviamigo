export { api, setApiBaseUrl, resolveApiBaseUrl } from './api';
export { authClient, vehicleClient, tripClient, chargingClient, telemetryClient, analyticsClient, systemClient } from './api';
export { queryKeys } from './queryKeys';
export type { ChargingSchedule, ChargingScheduleInput, DepartureSchedule, DepartureScheduleInput, DepartureOccurrence, DepartureComfortSettings, LiveSession, BackfillStatus } from './api';
export { useAuth } from './useAuth';
export { useAuthReady, useResolvedVehicleSelection } from './useAuthState';
export { useDashboardChartFavorites, useUpdateDashboardChartFavorite } from './useDashboardChartFavorites';
export {
  useChartManager,
  useEffectiveCharts,
  useChartSources,
  useCreateChart,
  useUpdateChart,
  useCloneChart,
  useDeleteChart,
  useResetChart,
  useSetChartEnabled,
  useSetChartPlacements,
  useAdminUpdateChart,
  useAdminSetChartLock,
  useAdminRestoreChart,
} from './useCharts';
export type { ChartRecordInput, ChartUpdateInput, ChartPlacementUpdate, ChartEnabledUpdate } from './useCharts';
export { CHART_SOURCE_ADAPTERS, useChartDatasets } from './chartSources';
export type { ChartRuntimeContext, ChartSourceAdapter, ChartSourceQueryArgs } from './chartSources';
export { useMe } from './useMe';
export {
	useVehicleStatus,
	useLiveStatusStore,
	useCurrentVehicleStatus,
	notifyVehicleCredentialsRefreshed,
	VEHICLE_CREDENTIALS_REFRESHED_EVENT,
} from './useVehicleStatus';
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
	useTirePressureTimeline,
	useTripTags,
	useCreateTripTag,
	useUpdateTripTag,
	useDeleteTripTag,
	useUpdateTripTagAssignments,
} from './useTrips';
export { invalidateChargingData, useChargeSessions, useChargeSession, useSavedPlaces, useUpdateChargeSessionLocation, useUpdateChargeSession, useChargingNetworkPreferences, useUpdateChargingNetworkPreference, useChargeCurve, useChargeCurveAnalysis, useChargingSummary, useChargingChartSeries, useChargingSchedule, useUpdateChargingSchedule, useDepartureSchedules, useCreateDepartureSchedule, useUpdateDepartureSchedule, useDeleteDepartureSchedule, useLiveSession } from './useCharging';
export { useEfficiencySummary, useEfficiencyByMode, useEfficiencyTrend, useEfficiencyVsTemp, useEfficiencyByTag } from './useEfficiency';
export type { TripTagFilters } from './useTrips';
export { useSummaryStats } from './useStats';
export { useMetricCatalog, useMetricValue, useMetricSeries, useMetricBatch } from './useMetrics';
export { useVehicles, useDefaultVehicleId } from './useVehicles';
export { useVehicleHealth } from './useHealth';
export { useTelemetryLanes } from './useTelemetryLanes';
export { BASEMAP_CONFIG_QUERY_KEY, useBasemapConfig } from './useBasemapConfig';
export type { BasemapConfigPayload } from './useBasemapConfig';
export { useDocumentTheme } from './useDocumentTheme';
export { AuthenticatedVehicleArtwork, useVehicleArtwork } from './useVehicleArtwork';
export { getVehicleArtworkFallback, normalizeVehicleArtworkModel, resolveVehicleArtwork } from './vehicleArtworkFallback';
export type { ResolvedVehicleArtwork, VehicleArtworkFallbackModel, VehicleArtworkUsage } from './vehicleArtworkFallback';
