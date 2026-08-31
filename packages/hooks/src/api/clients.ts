import { transport } from './transport';

type MethodName = {
  [Key in keyof typeof transport]: typeof transport[Key] extends (...args: never[]) => unknown
    ? Key
    : never;
}[keyof typeof transport];

function client<const Keys extends readonly MethodName[]>(...keys: Keys) {
  return Object.fromEntries(
    keys.map((key) => [key, transport[key].bind(transport)]),
  ) as Pick<typeof transport, Keys[number]>;
}

/** Domain-oriented client views. They share the authenticated transport and never own request logic. */
export const authClient = client(
  'login', 'register', 'logout', 'changePassword', 'refresh', 'setup',
  'previewAccountInvitation', 'acceptAccountInvitation', 'resumeSession', 'me',
  'getUnitPreferences', 'updateUnitPreferences', 'updateThemePreferences', 'getThemePreferences', 'getDashboardChartFavorites',
  'updateDashboardChartFavorite', 'getAppTimezone', 'updateAppTimezone',
);

export const vehicleClient = client(
  'listVehicles', 'vehicleStatus', 'vehicleImages', 'refreshVehicleArtwork',
  'purgeVehicleArtworkCache', 'addVehicle', 'createDemoVehicle', 'refreshDemoVehicle',
  'deleteVehicle', 'refreshVehicleCredentials', 'connectRivian', 'connectRivianOtp',
  'updateVehicleBatteryConfig', 'updateVehicleSettings', 'updateVehicleName',
  'setDefaultVehicle', 'listVehicleMembers', 'addVehicleMember', 'updateVehicleMember',
  'removeVehicleMember', 'listVehicleInvites', 'createVehicleInvite', 'revokeVehicleInvite',
  'acceptVehicleInvite', 'previewVehicleInvite', 'getVehicleHealth',
);

export const tripClient = client(
  'listTrips', 'getTripMap', 'getTrip', 'getTripDetailData', 'getTripTrack',
  'getSpeedProfile', 'getElevationProfile', 'getTripPowerProfile', 'getTripDetailSeries',
  'listTripTags', 'createTripTag', 'updateTripTag', 'deleteTripTag', 'updateTripTagAssignments',
);

export const chargingClient = client(
  'listChargeSessions', 'getChargeSession', 'updateChargeSession', 'listChargingNetworkPreferences',
  'updateChargingNetworkPreference', 'getChargeCurve', 'getChargeCurveAnalysis',
  'getChargingSummary', 'getChargingChartSeries', 'getChargingSchedule',
  'putChargingSchedule', 'listDepartureSchedules', 'createDepartureSchedule',
  'updateDepartureSchedule', 'deleteDepartureSchedule', 'getLiveSession',
  'getBackfillStatus', 'triggerBackfill',
);

export const telemetryClient = client(
  'getSoc', 'getRange', 'getPhantomDrain', 'getIdleDrainPeriods', 'getParkedEnergy',
  'getDegradation', 'getBatteryHealth', 'getBatteryMileage', 'getMetricCatalog',
  'getMetricValue', 'getMetricSeries', 'getMetricBatch', 'getRawTelemetry',
  'getTelemetryLanes', 'getRawEvents', 'getRawEvent', 'getRivianStewardship',
);

export const analyticsClient = client(
  'getStats', 'getEfficiencySummary', 'getEfficiencyByMode', 'getEfficiencyTrend',
  'getEfficiencyVsTemp', 'getEfficiencyByTag',
);

export const systemClient = client(
  'listUsers', 'listAdminVehicleOptions', 'listAccountInvitations',
  'createAccountInvitation', 'revokeAccountInvitation', 'updateUser', 'deleteUser',
  'listUserVehicleMemberships', 'getUserDetail', 'listUserInvites', 'revokeUserInvite',
  'grantUserVehicleMembership', 'updateUserVehicleMembership', 'removeUserVehicleMembership',
  'listApiKeys', 'createApiKey', 'revokeApiKey', 'listPlaces', 'searchPlaceAddresses',
  'createPlace', 'updatePlace', 'deletePlace', 'getApiCatalog', 'getBackupOverview',
  'getExternalConnections', 'updateExternalConnection', 'testExternalConnection',
  'purgeExternalConnectionCache', 'disableOptionalExternalConnections',
  'updateBackupSettings', 'runBackupNow', 'testBackupS3', 'requestBackupRestore',
  'uploadBackupArtifact', 'deleteUploadedBackup', 'preflightBackupRestore',
  'startBackupRestore', 'getRestoreJob', 'downloadBackupArtifact',
);
