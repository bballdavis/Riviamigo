import { rootRoute } from './routes/__root';
import { indexRoute } from './routes/index';
import { batteryRoute } from './routes/battery';
import { tripsRoute } from './routes/trips';
import { tripDetailRoute } from './routes/trips.$tripId';
import { chargingRoute } from './routes/charging';
import { chargingDetailRoute } from './routes/charging.$sessionId';
import { efficiencyRoute } from './routes/efficiency';
import { settingsRoute } from './routes/settings';
import { connectRoute } from './routes/connect';
import { connectOtpRoute } from './routes/connect.otp';
import { loginRoute } from './routes/login';
export const routeTree = rootRoute.addChildren([
    indexRoute,
    batteryRoute,
    tripsRoute,
    tripDetailRoute,
    chargingRoute,
    chargingDetailRoute,
    efficiencyRoute,
    settingsRoute,
    connectRoute,
    connectOtpRoute,
    loginRoute,
]);
