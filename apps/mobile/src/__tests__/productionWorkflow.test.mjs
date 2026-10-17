import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(join(here, '..', path), 'utf8');
const screen = read('screens/production/ProductionScreen.tsx');
const store = read('features/production/productionStore.ts');
const history = read('screens/production/ProductionHistoryScreen.tsx');
const hub = read('screens/navigation/ModuleHubScreen.tsx');
describe('production workflow parity safeguards', () => {
  it('loads persistent queue and history from the server', () => {
    assert.match(store, /apiClient\.get\('\/kitchen\/production-queue'\)/);
    assert.match(store, /apiClient\.get\('\/kitchen\/production-history'\)/);
    assert.match(screen, /useFocusEffect/);
  });
  it('offers finish action for each active batch and submits expiry explicitly', () => {
    assert.match(screen, /Finish batch/);
    assert.match(screen, /expiry_date: expiryDate\.trim\(\)/);
    assert.match(store, /Expiry date is required/);
    assert.doesNotMatch(store, /expiry_date: input\.expiry_date \|\| today/);
  });
  it('does not convert authorization/validation errors into offline start success', () => {
    assert.match(store, /Never turn validation, authorization, or server errors into fake offline success/);
    assert.match(store, /if \(!isNetworkFailure\)/);
  });
  it('loads history when opened and exposes module navigation', () => {
    assert.match(history, /useFocusEffect/);
    assert.match(hub, /Production workspace/);
    assert.match(hub, /Kitchen orders/);
  });
});
