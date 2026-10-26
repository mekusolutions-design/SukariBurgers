import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(join(here, '..', path), 'utf8');

const stock = read('screens/inventory/StockOverviewScreen.tsx');
const kitchen = read('screens/kitchen/KitchenDisplayScreen.tsx');
const menu = read('screens/menu/MenuListScreen.tsx');
const pos = read('screens/pos/PosOrderScreen.tsx');
const receive = read('screens/inventory/ReceiveGoodsScreen.tsx');
const navigator = read('navigation/RootNavigator.tsx');
const inventoryController = readFileSync(join(here, '../../../../apps/api/src/modules/inventory/inventory.controller.ts'), 'utf8');

describe('mobile/web parity implementation contracts', () => {
  it('exposes Start batch from stock overview and kitchen display', () => {
    assert.match(stock, /navigate\('Production'\)/);
    assert.match(kitchen, /Start batch/);
    assert.match(kitchen, /navigate\('Production'\)/);
  });

  it('registers Kitchen Display in the mobile navigator', () => {
    assert.match(navigator, /name="KitchenDisplay"/);
    assert.match(navigator, /KitchenDisplayScreen/);
  });

  it('provides ADMIN-only menu adjustment through the canonical API', () => {
    assert.match(menu, /isAdmin && item\.menu_id/);
    assert.match(menu, /\/menu\/\$\{encodeURIComponent\(editItem\.menu_id\)\}\/adjust/);
    assert.match(menu, /expected_updated_at/);
  });

  it('searches items and combos and supports combo group selections in POS', () => {
    assert.match(pos, /Search menu items and combos/);
    assert.match(pos, /API_ENDPOINTS\.MENU_COMBOS/);
    assert.match(pos, /combo_selections/);
    assert.match(pos, /No menu item or combo found/);
  });

  it('uses the web-compatible inventory list for receiving and exposes the scoped SKU picker route', () => {
    assert.match(receive, /API_ENDPOINTS\.GET_STOCK/);
    assert.match(receive, /applyInventorySuggestion/);
    assert.match(inventoryController, /@Get\('suggest'\)/);
    assert.match(inventoryController, /this\.inventoryService\.suggest/);
  });
});
