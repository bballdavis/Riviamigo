import { rootRoute } from './routes/__root';
import { indexRoute } from './routes/index';
import { batteryRoute } from './routes/battery';
import { batteryPhantomDrainRoute } from './routes/battery.phantom-drain';
import { tripsRoute } from './routes/trips';
import { tripDetailRoute } from './routes/trips.$tripId';
import { chargingRoute } from './routes/charging';
import { chargingDetailRoute } from './routes/charging.$sessionId';
import { efficiencyRoute } from './routes/efficiency';
import { healthRoute } from './routes/health';
import { settingsRoute } from './routes/settings';
import { connectRoute } from './routes/connect';
import { connectOtpRoute } from './routes/connect.otp';
import { loginRoute } from './routes/login';
import { activateRoute } from './routes/activate';
import { userDashboardRoute } from './routes/d.$slug';
import { adminDashboardsRoute } from './routes/admin.dashboards';
import { usersRoute } from './routes/users';

export const routeTree = rootRoute.addChildren([
  indexRoute,
  batteryRoute,
  batteryPhantomDrainRoute,
  tripsRoute,
  tripDetailRoute,
  chargingRoute,
  chargingDetailRoute,
  efficiencyRoute,
  healthRoute,
  settingsRoute,
  connectRoute,
  connectOtpRoute,
  loginRoute,
  activateRoute,
  userDashboardRoute,
  adminDashboardsRoute,
  usersRoute,
]);
