// Split out from device-id.ts so src/proxy.ts (edge middleware) can import
// just these constants without pulling in next/headers — that module's
// cookies()/headers() are for Server Components/Actions/Route Handlers,
// not Middleware, which reads/writes cookies via NextRequest/NextResponse
// directly instead.
export const DEVICE_ID_COOKIE = "yk3-device";
export const DEVICE_ID_HEADER = "x-device-id";
export const DEVICE_ID_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
