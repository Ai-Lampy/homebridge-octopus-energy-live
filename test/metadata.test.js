const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(root, 'config.schema.json'), 'utf8'));
const platformSource = fs.readFileSync(path.join(root, 'src', 'platform.ts'), 'utf8');
const eveSource = fs.readFileSync(path.join(root, 'src', 'eve.ts'), 'utf8');
const electricityAccessorySource = fs.readFileSync(path.join(root, 'src', 'accessory.ts'), 'utf8');
const gasAccessorySource = fs.readFileSync(path.join(root, 'src', 'gasAccessory.ts'), 'utf8');
const octopusApiSource = fs.readFileSync(path.join(root, 'src', 'octopusApi.ts'), 'utf8');
const dependabotSource = fs.readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8');
const settings = require('../dist/settings');

test('keeps npm and Homebridge identifiers aligned', () => {
  assert.equal(packageJson.name, 'homebridge-octopus-energy-live');
  assert.equal(packageJson.displayName, 'Octopus Energy Live');
  assert.equal(settings.PLUGIN_NAME, packageJson.name);
  assert.equal(settings.PLATFORM_NAME, 'OctopusEnergyLive');
  assert.equal(schema.pluginAlias, settings.PLATFORM_NAME);
  assert.equal(packageJson.homebridge.platforms[0].platform, settings.PLATFORM_NAME);
});

test('declares the transports and supported Node.js versions', () => {
  assert(packageJson.keywords.includes('homebridge-plugin'));
  assert(packageJson.keywords.includes('supports-hap'));
  assert(packageJson.keywords.includes('supports-matter'));
  assert.equal(packageJson.engines.node, '^22.10.0 || ^24.0.0 || ^26.0.0');
});

test('declares Homebridge only as a development dependency', () => {
  assert.equal(packageJson.devDependencies.homebridge, '^2.4.0');
  assert.equal(packageJson.dependencies?.homebridge, undefined);
  assert.equal(packageJson.optionalDependencies?.homebridge, undefined);
  assert.equal(packageJson.peerDependencies?.homebridge, undefined);
  assert(!packageJson.bundledDependencies?.includes('homebridge'));
});

test('keeps stable release and lockfile metadata aligned', () => {
  assert.equal(packageJson.version, '0.6.1');
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.equal(packageLock.packages[''].devDependencies.homebridge, packageJson.devDependencies.homebridge);
  assert.equal(packageLock.packages[''].devDependencies['@types/node'], packageJson.devDependencies['@types/node']);
});

test('builds GitHub release notes from the current changelog section', () => {
  const notes = execFileSync(
    process.execPath,
    [path.join(root, 'scripts', 'extract-release-notes.mjs')],
    { encoding: 'utf8' },
  );
  assert(notes.includes(`## [${packageJson.version}]`));
  assert.match(notes, /### (Added|Changed|Fixed|Documentation|Notes)/);
  assert(!notes.includes('## [0.4.1]'));
  assert(!notes.includes('## [0.5.0]'));
  assert(!notes.includes('## [0.5.0-beta.7]'));
  assert(!notes.includes('## [0.5.1]'));
  assert(!notes.includes('## [0.6.0-beta.1]'));
  assert(!notes.includes('## [0.6.0-beta.2]'));
});

test('blocks incompatible automated toolchain major upgrades', () => {
  for (const dependency of [
    'typescript',
    'eslint',
    '@typescript-eslint/eslint-plugin',
    '@typescript-eslint/parser',
  ]) {
    assert(dependabotSource.includes(`dependency-name: ${dependency}`)
      || dependabotSource.includes(`dependency-name: "${dependency}"`));
  }
  assert.equal(
    dependabotSource.match(/version-update:semver-major/g)?.length,
    4,
  );
});

test('includes release notes in the published package', () => {
  assert(packageJson.files.includes('CHANGELOG.md'));
  assert(fs.existsSync(path.join(root, 'CHANGELOG.md')));
});

test('includes a branded Octopus-pink configuration header', () => {
  assert.match(schema.headerDisplay, /^!\[Octopus Energy Live\]\(https:\/\/raw\.githubusercontent\.com\//);
  assert(packageJson.files.includes('assets/config-header.svg'));
  assert(packageJson.files.includes('assets/plugin-icon.png'));
  const header = fs.readFileSync(path.join(root, 'assets', 'config-header.svg'), 'utf8');
  assert(header.includes('#f050f8'));
  assert(header.includes('plugin-icon.png'));
  assert(header.includes('Octopus Energy Live'));
});

test('declares the Homebridge donation link as PayPal funding metadata', () => {
  assert.deepEqual(packageJson.funding, {
    type: 'paypal',
    url: 'https://paypal.me/lxmitch',
  });
});

test('labels electricity accurately and provides optional gas settings', () => {
  assert.equal(schema.schema.properties.import.title, 'Electricity Meter');
  assert.equal(schema.schema.properties.gas.title, 'Gas Meter (Optional)');
  assert(schema.schema.properties.gas.properties.mprn);
  assert(schema.schema.properties.gas.properties.meterSerial);
  assert.equal(schema.schema.properties.gas.properties.exposeToMatter.default, false);
  assert.equal(schema.schema.properties.gas.properties.exposeDailyUsageToMatter.default, false);
  assert.equal(schema.schema.properties.gas.properties.exposeDailyUsageAccessory.default, false);
  assert.equal(schema.schema.properties.gas.properties.pollMinutes.default, 5);
  assert.equal(schema.schema.properties.gas.properties.useLiveTelemetry.default, false);
  assert(schema.schema.properties.gas.properties.homeMiniDeviceId);
  assert(!schema.schema.required.includes('gas'));
});

test('organises settings into account, electricity, and gas tabs without changing config keys', () => {
  assert.equal(schema.layout.length, 1);
  assert.equal(schema.layout[0].type, 'tabs');

  const tabs = schema.layout[0].tabs;
  assert.deepEqual(tabs.map((tab) => tab.title), ['Account Info', 'Electricity', 'Gas']);

  const collectLayoutKeys = (items) => items.flatMap((item) => {
    if (typeof item === 'string') {
      return [item];
    }
    return [item.key, ...collectLayoutKeys(item.items ?? [])].filter(Boolean);
  });
  const keysByTab = Object.fromEntries(tabs.map((tab) => [tab.title, collectLayoutKeys(tab.items)]));
  assert.deepEqual(keysByTab['Account Info'], ['name', 'apiKey', 'accountNumber']);
  assert.deepEqual(keysByTab.Electricity, [
    'import.name',
    'import.mpan',
    'import.meterSerial',
    'homeMiniDeviceId',
    'pollSeconds',
    'export.name',
    'export.mpan',
    'export.meterSerial',
  ]);
  assert.deepEqual(keysByTab.Gas, [
    'gas.name',
    'gas.mprn',
    'gas.meterSerial',
    'gas.unit',
    'gas.pollMinutes',
    'gas.useLiveTelemetry',
    'gas.homeMiniDeviceId',
    'gas.exposeToMatter',
    'gas.exposeDailyUsageToMatter',
    'gas.exposeDailyUsageAccessory',
  ]);

  const layoutKeys = Object.values(keysByTab).flat();
  assert.equal(layoutKeys.length, new Set(layoutKeys).size);
});

test('binds the tabbed UI to existing configuration paths without migration', () => {
  const existingConfig = {
    name: 'Octopus Energy Live',
    apiKey: 'existing-api-key',
    accountNumber: 'A-12345678',
    pollSeconds: 60,
    homeMiniDeviceId: '11-22-33-44-55-66-77-88',
    import: {
      name: 'Existing Electricity Meter',
      mpan: '1234567890123',
      meterSerial: 'ELECTRIC-SERIAL',
    },
    gas: {
      name: 'Existing Gas Meter',
      mprn: '1234567890',
      meterSerial: 'GAS-SERIAL',
      unit: 'm3',
      exposeToMatter: true,
      exposeDailyUsageToMatter: true,
      exposeDailyUsageAccessory: true,
      pollMinutes: 5,
      useLiveTelemetry: true,
      homeMiniDeviceId: '88-77-66-55-44-33-22-11',
    },
    export: {
      name: 'Existing Export Meter',
      mpan: '9876543210987',
      meterSerial: 'EXPORT-SERIAL',
    },
  };
  const readPath = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
  const tabs = schema.layout[0].tabs;
  const collectLayoutKeys = (items) => items.flatMap((item) => {
    if (typeof item === 'string') {
      return [item];
    }
    return [item.key, ...collectLayoutKeys(item.items ?? [])].filter(Boolean);
  });
  const layoutKeys = tabs.flatMap((tab) => collectLayoutKeys(tab.items));

  for (const key of layoutKeys) {
    assert.notEqual(readPath(existingConfig, key), undefined, `${key} is not bound to existing config`);
  }
  assert.equal(readPath(existingConfig, 'import.mpan'), '1234567890123');
  assert.equal(readPath(existingConfig, 'gas.mprn'), '1234567890');
  assert.equal(readPath(existingConfig, 'gas.meterSerial'), 'GAS-SERIAL');
});

test('registers electricity as an outlet and makes the gas workaround opt-in', () => {
  assert(platformSource.includes('matter.deviceTypes.OnOffOutlet'));
  assert(!platformSource.includes('matter.deviceTypes.ElectricalSensor'));
  assert(platformSource.includes('meter.exposeToMatter === true'));
  assert(platformSource.includes('matter-outlet-gas-'));
  assert(platformSource.includes('periodicEnergyImported'));
  assert(platformSource.includes('matter-gas-daily-usage-'));
  assert(platformSource.includes("const displayName = 'Gas Used Today'"));
  assert(platformSource.includes('wattsToMatterMilliwatts(todayKWh * 1000)'));
  assert(platformSource.includes('electricalPowerMeasurement: { activePower: null }'));
  assert(platformSource.includes("includesLivePower ? 'telemetry-' : ''"));
  assert(platformSource.includes('matter-outlet-${side}-'));
  assert(platformSource.includes('this.pendingMatterRegistrations'));
  assert(platformSource.includes('const accessories = [...this.pendingMatterRegistrations]'));
  assert(!platformSource.includes('matter.updatePlatformAccessories'));
  assert(platformSource.includes('On/Off Plug-in Unit (0x010A) + Electrical Sensor (0x0510)'));
  assert(platformSource.includes('PowerTopology (0x009C, TreeTopology)'));
});

test('places compatibility characteristics on custom meter services', () => {
  assert(eveSource.includes("new Service(displayName, energyMeterServiceUUID)"));
  assert(eveSource.includes("new Service(displayName, gasMeterServiceUUID)"));
  assert(electricityAccessorySource.includes('service.UUID === this.platform.Eve.EnergyMeterServiceUUID'));
  assert(gasAccessorySource.includes('service.UUID === this.platform.Eve.GasMeterServiceUUID'));
});

test('bounds Octopus network requests and logs the polling lifecycle', () => {
  assert(octopusApiSource.includes('OCTOPUS_REQUEST_TIMEOUT_MS = 20_000'));
  assert(octopusApiSource.includes('new AbortController()'));
  assert(octopusApiSource.includes('private tokenPromise?: Promise<string>'));
  assert(platformSource.includes('Starting polling for'));
  assert(gasAccessorySource.includes('Home Mini daily usage refreshes every 30 minutes'));
  assert(electricityAccessorySource.includes('Skipping overlapping refresh'));
  assert(gasAccessorySource.includes('Skipping overlapping refresh'));
  assert(platformSource.includes('Matter accessory registration failed; HAP accessories and polling will continue'));
  assert(electricityAccessorySource.includes('Matter update failed; HAP data will continue'));
  assert(gasAccessorySource.includes('Matter update failed; HAP data will continue'));
});
