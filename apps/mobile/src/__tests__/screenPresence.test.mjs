import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..');

const REQUIRED_FILES = [
  'screens/kitchen/PrePrepScreen.tsx',
  'screens/kitchen/ClosingStockScreen.tsx',
  'screens/production/ProductionScreen.tsx',
  'screens/approvals/ApprovalsScreen.tsx',
  'screens/dashboard/ManagerDashboardScreen.tsx',
  'screens/inventory/StockOverviewScreen.tsx',
  'components/production/RecipeSearchPicker.tsx',
  'api/prePrepApi.ts',
  'api/approvalsApi.ts',
  'api/dashboardApi.ts',
  'api/endpoints.ts',
  'features/production/productionStore.ts',
  'features/waste/wasteStore.ts',
];

describe('parity screen/module presence', () => {
  for (const rel of REQUIRED_FILES) {
    it(`exists: ${rel}`, () => {
      assert.ok(existsSync(join(src, rel)), `missing ${rel}`);
    });
  }
});
