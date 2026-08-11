const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(root, 'config.schema.json'), 'utf8'));
const platformSource = fs.readFileSync(path.join(root, 'src', 'platform.ts'), 'utf8');
const eveSource = fs.readFileSync(path.join(root, 'src', 'eve.ts'), 'utf8');
const electricityAccessorySource = fs.readFileSync(path.join(root, 'src', 'accessory.ts'), 'utf8');
const gasAccessorySource = fs.readFileSync(path.join(root, 'src', 'gasAccessory.ts'), 'utf8');
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
  assert.equal(packageJson.devDependencies.homebridge, '^2.3.0');
  assert.equal(packageJson.dependencies?.homebridge, undefined);
  assert.equal(packageJson.optionalDependencies?.homebridge, undefined);
  assert.equal(packageJson.peerDependencies?.homebridge, undefined);
  assert(!packageJson.bundledDependencies?.includes('homebridge'));
});

test('builds GitHub release notes from the current changelog section', () => {
  const notes = execFileSync(
    process.execPath,
    [path.join(root, 'scripts', 'extract-release-notes.mjs')],
    { encoding: 'utf8' },
  );
  assert(notes.includes(`## [${packageJson.version}]`));
  assert(notes.includes('### Added'));
  assert(!notes.includes('## [0.4.1]'));
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
  assert(!schema.schema.required.includes('gas'));
});

test('registers electricity as an outlet and makes the gas workaround opt-in', () => {
  assert(platformSource.includes('matter.deviceTypes.OnOffOutlet'));
  assert(!platformSource.includes('matter.deviceTypes.ElectricalSensor'));
  assert(platformSource.includes('meter.exposeToMatter === true'));
  assert(platformSource.includes('matter-outlet-gas-'));
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
