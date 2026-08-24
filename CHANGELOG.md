# Changelog

All notable changes to Octopus Energy Live are documented here.

The project follows [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-08-24

### Added

- Added optional gas-meter support using an MPRN and meter serial, with automatic SMETS1 kWh or SMETS2 cubic-metre detection and conversion to kWh.
- Added opt-in Home Mini GSME telemetry for gas, including automatic device discovery, REST fallback, and a current UK-day consumption total.
- Added opt-in experimental Matter gas endpoints, standards-based periodic energy for today's gas usage, and a separate **Gas Used Today** display accessory.
- Added configurable REST gas polling, bounded Octopus API requests, shared authentication and telemetry requests, and expanded Node.js 22, 24, and 26 validation.

### Changed

- Renamed the settings section to **Electricity Meter** while retaining the existing `import` configuration key and accessory identities.
- Updated the development baseline to Homebridge 2.3.1 and `@types/node` 26.2.0; Homebridge remains a development-only dependency.
- Updated the continuous-integration and publishing workflows to the current `actions/checkout` and `actions/setup-node` v7 releases.
- Electricity import, optional export, and enabled gas endpoints use bridged Matter outlet profiles with electrical measurement clusters.
- GitHub publishing now uses the stable `latest` npm tag for this release and creates complete GitHub release notes from this changelog section.

### Fixed

- Preserved valid Matter energy timestamps and monotonic cumulative gas energy across delayed intervals and midnight resets.
- Prevented duplicate custom services, stale electricity/export accessories after configuration changes, and overlapping polling requests.
- Isolated Matter registration and state-update failures so HAP accessories and Octopus polling continue operating.
- Correctly includes usage reported in the first Home Mini gas telemetry sample of a UK day, including across daylight-saving changes.
- Cancels delayed polling startup during shutdown and bounds invalid or negative energy values before publishing them.

### Compatibility

- Existing `0.4.x` and `0.5.0-beta.x` configurations, HAP accessory UUIDs, current Matter profile identities, and cached cumulative readings remain compatible. Enabling or disabling an experimental gas profile intentionally replaces only that gas Matter endpoint.
- All gas-to-Matter options remain disabled by default because Matter does not define a native gas-meter device type. Existing users only receive new gas endpoints when they explicitly enable those settings.
- The **Gas Used Today** active-power display remains an explicitly labelled opt-in proxy; it is not instantaneous gas demand and Apple Home may include it in electrical summaries.

## [0.5.0-beta.7] - 2026-08-14

### Fixed

- Include usage reported by the first Home Mini gas telemetry sample of the UK day when calculating **Gas Used Today**. This fixes a `0.000 kWh` total when the first returned sample already contains the day's first gas interval.
- Use UK local midnight consistently for the REST gas-reading period and its Matter daily-energy timestamps, including during British Summer Time.

### Compatibility

- Existing configuration, cached accessories, Matter endpoint identities, and cumulative gas tracking remain unchanged.
- The latest gas interval may still be zero when no gas was used in the most recent five-minute sample; the separate daily total now retains earlier usage correctly.

## [0.5.0-beta.6] - 2026-08-14

### Added

- Added an opt-in separate Matter accessory named **Gas Used Today**. It publishes the current UK-day gas total through Matter periodic energy and updates on each successful gas refresh.
- Added an explicit Apple Home display proxy on that accessory: the daily kWh number is mapped to active kW so `1.62 kWh` appears as `1.62 kW`. The setting warns that this is not instantaneous gas demand and may affect electrical summaries.

### Compatibility

- The new accessory is disabled by default and uses its own stable UUID, so existing electricity and gas endpoints are unchanged.
- Lifetime gas energy remains monotonic; only the standards-based periodic value resets at UK midnight.

## [0.5.0-beta.5] - 2026-08-14

### Fixed

- Abort Octopus GraphQL, authentication, and REST requests after 20 seconds so a stalled network request cannot silently stop gas updates forever.
- Coalesce concurrent Kraken token requests from electricity and gas polling instead of starting duplicate authentication requests.

### Added

- Log when meter polling starts and explicitly report the 30-minute Home Mini gas refresh schedule, making it possible to distinguish a timer problem from a network request problem.

## [0.5.0-beta.4] - 2026-08-13

### Fixed

- Stop presenting a delayed five-minute gas interval as if it were instantaneous power. The gas outlet retains its power-measurement capability for Apple Home classification but reports power as unavailable.

### Changed

- Refresh Home Mini gas telemetry every 30 minutes and publish the current daily consumption through Matter's periodic energy measurement.

### Notes

- Apple Home controls whether it displays Matter periodic energy on an accessory screen. The plugin does not mislabel daily kWh as watts to force it into the outlet subtitle.

## [0.5.0-beta.3] - 2026-08-13

### Changed

- Telemetry-enabled gas outlets now publish `ElectricalPowerMeasurement.activePower` alongside cumulative and periodic energy. This gives Apple Home the complete power-plus-energy outlet profile used by energy-monitoring accessories.
- Give the telemetry-enabled gas profile a new Matter endpoint identity so an existing cached energy-only endpoint cannot prevent Homebridge from installing the power measurement cluster.

### Fixed

- Preserve an already-converted Home Mini daily gas value when restoring Matter state instead of converting it from cubic metres a second time.

### Notes

- Gas used so far today remains published as the standards-based `ElectricalEnergyMeasurement.periodicEnergyImported` value. Apple Home ultimately controls whether and where it displays that value.

## [0.5.0-beta.2] - 2026-08-13

### Added

- Added opt-in Home Mini gas telemetry using the GSME device ID discovered from the Octopus GraphQL account data.
- Added an optional GSME EUI64 override for accounts where automatic gas-device discovery is unavailable.

### Changed

- Calculate today's experimental gas value from the Home Mini's cumulative telemetry register, while retaining the official half-hourly REST API as an automatic fallback.
- Cache live telemetry separately for each physical meter and limit electricity polling to 60 seconds when gas telemetry is enabled, keeping combined requests within Octopus's documented user rate limit.

### Notes

- Home Mini gas telemetry remains opt-in while it is validated across SMETS1 and SMETS2 installations. Existing configurations continue using REST without any behaviour change.

## [0.5.0-beta.1] - 2026-08-13

### Fixed

- Calculate gas used today from UK local midnight rather than UTC midnight, including the first BST hour of the day.
- Refresh the Matter periodic daily gas measurement on every successful gas check, even when Octopus has not changed the latest interval timestamp.

## [0.5.0-beta.0] - 2026-08-13

### Added

- Added an opt-in **Show Today's Usage in Matter (Beta)** gas setting. It publishes today's gas consumption using Matter's standards-based `PeriodicEnergyImported` measurement while retaining the monotonic cumulative reading.
- Added a configurable gas refresh interval from 5 to 30 minutes, defaulting to 5 minutes, so newly published half-hour readings are discovered sooner.

### Changed

- Gas Matter state is updated only when Octopus publishes a newer interval, avoiding duplicate energy events during the more frequent checks.
- Beta package versions are published with npm's `beta` distribution tag and marked as GitHub prereleases, leaving the stable `latest` release untouched.

### Notes

- Apple Home controls how Matter periodic energy is presented and may not surface today's gas value in its interface.
- Enabling the daily Matter option creates a new gas endpoint profile so existing stable endpoints and caches are not mutated in place.

## [0.4.3] - 2026-08-11

### Added

- Added a Matter profile diagnostic at registration showing the outlet and electrical-sensor device types, measurement cluster IDs, and energy direction without logging meter credentials.
- Added the maintainer's PayPal funding metadata so Homebridge can display its donation heart.

### Documentation

- Documented **Disable IPv4 (Matter)** as an optional child bridge stability setting, including when to revert it.
- Clarified that Homebridge assigns bridged endpoint numbers and adds Power Topology (`0x009C`) with Tree Topology during registration.

## [0.4.2] - 2026-08-09

### Added

- Added Node.js 26 to the supported runtime range and continuous-integration test matrix.

### Changed

- Updated the development and test baseline to Homebridge 2.3.0.
- Declared Homebridge only as a development dependency, as required by the Homebridge plugin verification checks.
- GitHub Releases now contain the matching version's complete changelog section, so Homebridge displays the actual release notes during updates.
- Prevented Dependabot from combining incompatible major versions of TypeScript, ESLint, and TypeScript ESLint in automated dependency updates.

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
[0.4.2]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.4.1...v0.4.2
[0.4.3]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.4.2...v0.4.3
[0.5.0]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.4.3...v0.5.0
[0.5.0-beta.0]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.4.3...v0.5.0-beta.0
[0.5.0-beta.1]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.5.0-beta.0...v0.5.0-beta.1
[0.5.0-beta.2]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.5.0-beta.1...v0.5.0-beta.2
[0.5.0-beta.3]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.5.0-beta.2...v0.5.0-beta.3
[0.5.0-beta.4]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.5.0-beta.3...v0.5.0-beta.4
[0.5.0-beta.5]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.5.0-beta.4...v0.5.0-beta.5
[0.5.0-beta.6]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.5.0-beta.5...v0.5.0-beta.6
[0.5.0-beta.7]: https://github.com/Ai-Lampy/homebridge-octopus-energy-live/compare/v0.5.0-beta.6...v0.5.0-beta.7
