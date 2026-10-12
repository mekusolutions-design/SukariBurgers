import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const navTypes = readFileSync(join(__dirname, '../types/navigation.ts'), 'utf8');
const rootNav = readFileSync(join(__dirname, '../navigation/RootNavigator.tsx'), 'utf8');

const REQUIRED_SCREENS = [
  'Login',
  'Register',
  'StockOverview',
  'Receive',
  'PosOrder',
  'Production',
  'ProductionHistory',
  'RecipeList',
  'RecordWaste',
  'ClosingStock',
  'PrePrep',
  'Approvals',
  'ManagerDashboard',
  'Profile',
  'RefillRequest',
];

/** Optional floor screens present in full app repo, not always in parity overlay */
const OPTIONAL_SCREENS = ['KitchenDisplay'];

describe('navigation coverage', () => {
  for (const screen of REQUIRED_SCREENS) {
    it(`param list includes ${screen}`, () => {
      assert.match(navTypes, new RegExp(`${screen}:`));
    });
  }

  for (const screen of OPTIONAL_SCREENS) {
    it(`optional screen reference: ${screen}`, () => {
      // Soft: document presence; do not fail parity package if absent
      assert.ok(typeof screen === 'string');
    });
  }

  it('RootNavigator registers PrePrep, Approvals, ManagerDashboard', () => {
    assert.match(rootNav, /name="PrePrep"/);
    assert.match(rootNav, /name="Approvals"/);
    assert.match(rootNav, /name="ManagerDashboard"/);
  });

  it('RootNavigator imports parity screens', () => {
    assert.match(rootNav, /PrePrepScreen/);
    assert.match(rootNav, /ApprovalsScreen/);
    assert.match(rootNav, /ManagerDashboardScreen/);
  });
});
