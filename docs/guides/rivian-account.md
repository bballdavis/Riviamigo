# Rivian account setup

After you create your Riviamigo owner account, open **Settings → Vehicles** and choose **Add Vehicle**.

1. Enter the email address and password for your Rivian account.
2. Complete the one-time passcode (OTP) Rivian sends through its normal authentication flow.
3. Riviamigo encrypts the credentials at rest and begins collecting data for the selected vehicle.

The first update can take a little while, especially if the vehicle is asleep. Riviamigo uses Rivian's unofficial API and WebSocket behavior, so upstream changes can occasionally require a project update.

## Troubleshooting

- Watch the API logs with `docker compose --env-file .env -f compose/docker-compose.prod.yml logs -f api`.
- If authentication expires, remove the vehicle in Settings and add it again.
- If an OTP does not arrive, confirm the phone number on the Rivian account and retry from Settings.

Rivian requests carry the information necessary to authenticate and collect vehicle data. See [privacy](../privacy.md) for the wider data-flow picture.
