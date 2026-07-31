# Octopus Energy Live for Homebridge

Homebridge platform plugin that publishes Octopus Energy electricity import and optional export as native Matter electrical sensors. On iOS 27, Apple Home can display the current power and cumulative energy reported by these sensors. Eve-compatible characteristics remain available through classic HomeKit for Eve, Home+, and similar apps.

## Data sources

- With an Octopus Home Mini and `accountNumber`, the plugin discovers the electricity meter's device ID and calls Octopus's authenticated GraphQL `smartMeterTelemetry` query. Current demand normally updates every 10 seconds at source; this plugin polls every 30 seconds by default to stay within Octopus's API limits.
- Without a Home Mini device ID, or whenever live telemetry is temporarily unavailable, the plugin falls back to Octopus's REST consumption endpoint. That endpoint contains half-hour intervals and is not truly live.
- A Home Mini (or another compatible CAD connected to the meter's Home Area Network) is therefore required for true near-real-time data.

## Requirements

- Node.js 22 or 24
- Homebridge 2.2.1 or newer for Apple Home energy data
- Matter enabled for the main bridge or this plugin's child bridge
- iOS 27 and a Matter-capable Apple home hub
- Octopus API key, MPAN, and meter serial
- Octopus Home Mini plus the electricity meter's EUI64 device ID for live readings

Homebridge 1.x remains compatible with the classic Outlet and Eve characteristics, but cannot publish the Matter electrical measurement clusters used by Apple Home.

## Installation

Install `homebridge-octopus-energy-live` from Homebridge UI, enable Matter in Homebridge settings (a child bridge is recommended), and restart Homebridge. Pair the Matter bridge with Apple Home using the Matter QR code shown by Homebridge.

## Configuration

```json
{
  "platform": "OctopusEnergyLive",
  "name": "Octopus Energy Live",
  "apiKey": "sk_live_your_key",
  "accountNumber": "A-12345678",
  "pollSeconds": 30,
  "import": {
    "name": "Octopus Import",
    "mpan": "YOUR_IMPORT_MPAN",
    "meterSerial": "IMPORT_SERIAL"
  },
  "export": {
    "name": "Octopus Export",
    "mpan": "YOUR_EXPORT_MPAN",
    "meterSerial": "EXPORT_SERIAL"
  }
}
```

Import is required and export is optional. The plugin normally discovers the Home Mini meter device ID from `accountNumber`, MPAN, and meter serial. If discovery does not work, `homeMiniDeviceId` can be set manually to the EUI64 of the physical electricity meter connected to the Home Mini. It is not the MPAN, printed meter serial, or Home Mini serial, and is usually formatted as eight hexadecimal byte pairs separated by hyphens.

Treat the API key as a password. The plugin exchanges it for a short-lived Kraken token in memory and never logs either credential.

## Apple Home and Matter

When Matter is enabled, each configured meter is registered as a Matter `ElectricalSensor` with:

- `ElectricalPowerMeasurement.activePower` in milliwatts
- `ElectricalEnergyMeasurement.cumulativeEnergyImported` for import
- `ElectricalEnergyMeasurement.cumulativeEnergyExported` for export

The plugin also keeps the existing read-only HomeKit Outlet with Eve instantaneous-power and total-consumption characteristics. Apple Home uses the Matter sensor; third-party HomeKit apps can continue using the Eve values.

## Limitations

- This is cloud polling, not a direct local connection to the Home Mini.
- Octopus live telemetry can be unavailable or rate-limited. The last value remains visible while the plugin retries and uses interval data where possible.
- Some smart meter models do not provide live export. In that case export power can remain at zero even though delayed export energy is available.
- Homebridge's Matter bridge is community software and is not a certified Matter product, so Apple Home may show an uncertified-accessory warning.

## Development and GitHub builds

```bash
npm ci
npm run lint
npm test
npm pack --dry-run
```

`npm test` compiles TypeScript into `dist/` before running the unit tests. The GitHub Actions workflow runs this sequence on Node.js 22 and 24 for every pull request and every push to `main`. Publishing to npm is intentionally not automated; a repository maintainer should review and publish a release explicitly.

## Links

- [Octopus Energy API documentation](https://developer.octopus.energy/)
- [Homebridge Matter documentation](https://github.com/homebridge-plugins/homebridge-matter/wiki)
- [GitHub repository](https://github.com/Ai-Lampy/homebridge-octopus-energy-live)

## Project status and attribution

Octopus Energy Live is an independent community project maintained by `lxmitch`. It is not affiliated with or endorsed by Octopus Energy, Apple, or the Homebridge project.

This project began from the MIT-licensed `icebondx/homebridge-octopus-energy` codebase and retains attribution to its original contributor. The live telemetry, Matter electrical sensor integration, tests, current configuration interface, and release infrastructure are maintained in this independent project.

## License

MIT
