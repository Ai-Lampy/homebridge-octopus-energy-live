# Changelog

All notable changes to Octopus Energy Live are documented here.

The project follows [Semantic Versioning](https://semver.org/).

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
