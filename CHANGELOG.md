# Changelog

All notable changes to Octopus Energy Live are documented here.

The project follows [Semantic Versioning](https://semver.org/).

## [0.4.1] - 2026-08-03

### Fixed

- Restored cached custom electricity and gas meter services by UUID instead of treating their UUID as a display name, preventing duplicate-service failures after the first v0.4.0 restart.

## [0.4.0] - 2026-08-03

### Added

- Added an opt-in **Experimental Matter Outlet** setting for gas. It is disabled by default because Matter and Homebridge do not currently expose a native gas-meter device type.
- Added normal-level gas refresh messages showing the latest interval, today's total, and the locally tracked cumulative total.

### Changed

- Track gas energy monotonically across newly published half-hour intervals before sending it to Matter, instead of using a daily total that resets at midnight.
- Moved electricity and gas compatibility characteristics onto dedicated custom HomeKit meter services.
- Documented that one setup code commissions the complete Matter child bridge and that Apple Home's Energy Summary is not populated automatically from arbitrary Matter measurement clusters.

### Fixed

- Removed Homebridge warnings caused by adding custom electricity and gas characteristics directly to an Outlet service.
- Removed a duplicated classic HomeKit accessory registration call.
- Stopped presenting the experimental gas outlet as native gas support.

## [0.3.2] - 2026-08-01

### Fixed

- Re-registered cached Matter outlets on every Homebridge startup instead of attempting to update endpoints that were not registered in the current session.
- Submitted all meter outlets in one Matter registration batch, preventing concurrent parts-list notifications from competing for the same Matter state lock.

## [0.3.1] - 2026-08-01

### Fixed

- Registered electricity import, electricity export, and gas as Matter outlets so Apple Home presents them consistently.
- Migrated electricity meters to new Matter outlet identities instead of retaining the cached electrical-sensor device type.
- Allowed the gas outlet to register when Octopus unit auto-detection fails, using SMETS2 cubic metres as a documented fallback.

## [0.3.0] - 2026-08-01

### Added

- Published the optional gas meter to Matter as an outlet with cumulative energy usage for Apple Home.

### Changed

- Gas consumption is now exposed in kWh. Native cubic-metre readings are converted using the standard UK volume correction and calorific-value formula.

### Fixed

- Included `CHANGELOG.md` in the published npm package so Homebridge can display release notes.

## [0.2.0] - 2026-07-31

### Added

- Optional gas meter support using the official MPRN and meter serial REST endpoint.
- Automatic gas unit detection from authenticated Octopus account data, with a manual unit override.
- Latest half-hour gas consumption and the current day's total through classic HomeKit custom characteristics.

### Changed

- Renamed the Import Meter settings section to Electricity Meter without changing its internal config key or cached accessory identity.
- Gas polling is fixed at 30 minutes to match the source data interval.

### Fixed

- Prevented Matter validation failures when REST fallback data is delayed and its latest interval predates the current daily total period.

## [0.1.0] - 2026-07-31

### Added

- Live electricity demand from compatible Octopus Home Mini telemetry.
- Automatic Home Mini electricity meter discovery through the Octopus GraphQL API.
- Matter electrical power and cumulative energy sensors for Apple Home.
- Import and optional export meter support.
- Half-hourly REST consumption fallback when live telemetry is unavailable.
- Eve power and total-consumption characteristics for classic HomeKit apps.
- Homebridge Settings GUI configuration schema.
- Node.js 22 and 24 continuous integration and unit tests.

[0.1.0]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/releases/tag/v0.1.0
[0.2.0]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.1.0...v0.2.0
[0.3.0]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.2.0...v0.3.0
[0.3.1]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.3.0...v0.3.1
[0.3.2]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.3.1...v0.3.2
[0.4.0]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.3.2...v0.4.0
[0.4.1]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.4.0...v0.4.1
