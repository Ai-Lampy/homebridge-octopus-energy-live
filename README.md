# Octopus Energy Live for Homebridge

[![npm version](https://img.shields.io/npm/v/homebridge-octopus-energy-live?style=for-the-badge&logo=npm)](https://www.npmjs.com/package/homebridge-octopus-energy-live) [![npm downloads](https://img.shields.io/npm/dt/homebridge-octopus-energy-live?style=for-the-badge&label=downloads)](https://www.npmjs.com/package/homebridge-octopus-energy-live) [![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=for-the-badge&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

Homebridge platform plugin that publishes live Octopus Energy electricity readings as a Matter energy-monitoring outlet. Optional gas readings are collected every half hour and remain available through classic HomeKit-compatible meter characteristics. An experimental gas-to-Matter outlet can be enabled with the limitations described below.

## Data sources

- With an Octopus Home Mini and `accountNumber`, the plugin discovers the electricity meter's device ID and calls Octopus's authenticated GraphQL `smartMeterTelemetry` query. Current demand normally updates every 10 seconds at source; this plugin polls every 30 seconds by default to stay within Octopus's API limits.
- Without a Home Mini device ID, or whenever live telemetry is temporarily unavailable, the plugin falls back to Octopus's REST consumption endpoint. That endpoint contains half-hour intervals and is not truly live.
- A Home Mini (or another compatible CAD connected to the meter's Home Area Network) is therefore required for true near-real-time data.
- Gas uses Octopus's REST consumption endpoint and refreshes every 30 minutes. It is the latest available half-hour interval, not instantaneous gas flow, and Octopus may publish it after a delay.
- Octopus returns SMETS1 gas consumption in kWh and SMETS2 gas consumption in m³. The plugin detects the source unit and converts cubic metres to kWh using the UK correction-factor and calorific-value formula.

## Requirements

- Node.js 22, 24, or 26
- Homebridge 2.2.1 or newer for Apple Home energy data
- Matter enabled for the main bridge or this plugin's child bridge
- iOS 27 and a Matter-capable Apple home hub
- Octopus API key, electricity MPAN, and electricity meter serial
- Optional gas MPRN and gas meter serial
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
    "name": "Electricity Meter",
    "mpan": "YOUR_IMPORT_MPAN",
    "meterSerial": "IMPORT_SERIAL"
  },
  "gas": {
    "name": "Gas Meter",
    "mprn": "YOUR_GAS_MPRN",
    "meterSerial": "GAS_SERIAL",
    "unit": "auto",
    "exposeToMatter": false
  },
  "export": {
    "name": "Octopus Export",
    "mpan": "YOUR_EXPORT_MPAN",
    "meterSerial": "EXPORT_SERIAL"
  }
}
```

Electricity import is required; gas and electricity export are optional. The settings screen calls the required section **Electricity Meter**, while its JSON key remains `import` so existing installations and cached Apple Home accessories keep working. The plugin normally discovers the Home Mini meter device ID from `accountNumber`, MPAN, and meter serial. If discovery does not work, `homeMiniDeviceId` can be set manually to the EUI64 of the physical electricity meter connected to the Home Mini. It is not the MPAN, printed meter serial, or Home Mini serial, and is usually formatted as eight hexadecimal byte pairs separated by hyphens.

Gas uses an **MPRN** (Meter Point Reference Number), not an MPAN. Leave `unit` set to `auto` when an account number is configured. If Octopus cannot return the meter's `consumptionUnits`, choose `m3` for a SMETS2 meter or `kWh` for a SMETS1 meter.

Treat the API key as a password. The plugin exchanges it for a short-lived Kraken token in memory and never logs either credential.

## Apple Home and Matter

When Matter is enabled, each configured electricity meter is registered as a Matter `OnOffOutlet` with:

- `ElectricalPowerMeasurement.activePower` in milliwatts
- `ElectricalEnergyMeasurement.cumulativeEnergyImported` for import
- `ElectricalEnergyMeasurement.cumulativeEnergyExported` for export

Matter and Homebridge do not currently expose a native gas-meter device type. Gas is therefore not published to Matter by default. If **Experimental Matter Outlet** is enabled, the plugin represents gas as an always-on electrical outlet with `ElectricalEnergyMeasurement.cumulativeEnergyImported`. The reported value is a monotonic total tracked from Octopus half-hour intervals, but Apple Home still presents it as a power socket and may not display its kWh.

One Matter setup code commissions the whole Homebridge child bridge. Electricity, optional export, and an enabled experimental gas outlet are endpoints inside that bridge; individual endpoints do not receive separate setup codes.

The plugin also keeps read-only HomeKit Outlet services with Eve characteristics. Third-party HomeKit apps can use these values even when Matter is disabled.

## Limitations

- This is cloud polling, not a direct local connection to the Home Mini.
- Octopus live telemetry can be unavailable or rate-limited. The last value remains visible while the plugin retries and uses interval data where possible.
- Some smart meter models do not provide live export. In that case export power can remain at zero even though delayed export energy is available.
- Gas readings are half-hourly and can arrive late; they are not Home Mini live telemetry.
- Matter has no native gas meter type in Homebridge's public plugin API. The experimental gas endpoint is therefore presented as an electrical outlet, not a true gas meter.
- SMETS2 gas is converted from m³ using a representative calorific value of 39.2 MJ/m³. The official app or bill can differ slightly because the billing calorific value varies by region and day.
- Apple Home can show current watts supplied by a Matter outlet, but its Energy Summary does not automatically list every accessory that exposes Matter electrical-measurement clusters. Apple's documented unified Energy experience uses entitled EnergyKit apps, which a Homebridge plugin cannot provide.
- Homebridge's Matter bridge is community software and is not a certified Matter product, so Apple Home may show an uncertified-accessory warning.

## Development and GitHub builds

```bash
npm ci
npm run lint
npm test
npm pack --dry-run
```

`npm test` compiles TypeScript into `dist/` before running the unit tests. The GitHub Actions workflow runs this sequence on Node.js 22, 24, and 26 for every pull request and every push to `main`. Publishing to npm is intentionally not automated; a repository maintainer should review and publish a release explicitly.

Running the manual **Publish to npm** workflow publishes the package version and then creates a matching `vX.Y.Z` GitHub Release. The release body is taken from that version's section in `CHANGELOG.md`, followed by a direct link to the published npm package. Re-running the workflow is safe when npm publication succeeded but release creation did not; it also repairs the notes on an existing matching GitHub Release.

## Links

- [Octopus Energy API documentation](https://developer.octopus.energy/)
- [Apple EnergyKit documentation](https://developer.apple.com/documentation/EnergyKit)
- [Homebridge Matter documentation](https://github.com/homebridge-plugins/homebridge-matter/wiki)
- [GitHub repository](https://github.com/Ai-Lampy/homebridge-octopus-energy-live)

## Project status and attribution

Octopus Energy Live is an independent community project maintained by `lxmitch`. It is not affiliated with or endorsed by Octopus Energy, Apple, or the Homebridge project.

This project began from the MIT-licensed `icebondx/homebridge-octopus-energy` codebase and retains attribution to its original contributor. The live telemetry, Matter electrical sensor integration, tests, current configuration interface, and release infrastructure are maintained in this independent project.

## License

MIT
