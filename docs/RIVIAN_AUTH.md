# Rivian Auth Reference

Rivian does not publish a supported public owner API. Riviamigo follows the same
cloud API shape used by the unofficial Home Assistant Rivian integration and the
`rivian-python-client` package.

## Upstream References

- Home Assistant integration: `https://github.com/bretterer/home-assistant-rivian`
- Client library pinned by that integration: `rivian-python-client[ble]==2.0.0`
- Source file to compare when auth breaks: `rivian/rivian.py`

## Current Endpoints

- GraphQL gateway: `https://rivian.com/api/gql/gateway/graphql`
- Charging GraphQL: `https://rivian.com/api/gql/chrg/user/graphql`
- Vehicle state WebSocket: `wss://api.rivian.com/gql-consumer-subscriptions/graphql`

## Required Headers

Base GraphQL requests should include:

- `User-Agent: RivianApp/707 CFNetwork/1237 Darwin/20.4.0`
- `Accept: application/json`
- `Content-Type: application/json`
- `Apollographql-Client-Name: com.rivian.ios.consumer-apollo-ios`
- `dc-cid: m-ios-<uuid>`

After creating a CSRF session, login and OTP requests also include:

- `Csrf-Token: <csrfToken>`
- `A-Sess: <appSessionToken>`

Authenticated GraphQL requests generally use:

- `A-Sess: <appSessionToken>`
- `U-Sess: <userSessionToken>`

The GraphQL WebSocket uses the `graphql-transport-ws` subprotocol and sends
`u-sess` in the `connection_init` payload.

## Login Flow

1. Call `CreateCSRFToken`.
2. Save `csrfToken` and `appSessionToken`.
3. Call `Login` with email/password and the CSRF/app-session headers.
4. If Rivian returns `MobileMFALoginResponse`, save `otpToken` plus the CSRF
   session and ask the user for the MFA code.
5. Call `LoginWithOTP` with email, `otpCode`, and `otpToken`.
6. Save `accessToken`, `refreshToken`, `userSessionToken`, `appSessionToken`,
   `csrfToken`, and the creation timestamp.

## Local Riviamigo Auth Gotcha

`/v1/vehicles/connect` is protected by Riviamigo's own JWT. A browser-side
`401 Unauthorized` on that route can mean the local 15-minute Riviamigo access
token expired before Rivian was contacted. The web API client retries protected
requests once after calling `/v1/auth/refresh`.
