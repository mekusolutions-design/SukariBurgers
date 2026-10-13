import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

describe('mobile gaps vs web — adjust fields', () => {
  const src = read('screens/menu/MenuListScreen.tsx');
  it('tracks menu_code, category, and tax_rate in adjust state', () => {
    assert.match(src, /editMenuCode/);
    assert.match(src, /editCategory/);
    assert.match(src, /editTaxRate/);
  });
  it('sends menu_code, category, tax_rate on PATCH adjust', () => {
    assert.match(src, /menu_code:\s*editMenuCode/);
    assert.match(src, /category:\s*editCategory/);
    assert.match(src, /tax_rate:\s*Number\(editTaxRate\)/);
  });
  it('validates tax rate 0–100', () => {
    assert.match(src, /tax < 0 \|\| tax > 100/);
  });
  it('renders Menu code, POS category, Tax rate labels', () => {
    assert.match(src, /Menu code/);
    assert.match(src, /POS category/);
    assert.match(src, /Tax rate \(%\)/);
  });
});

describe('mobile gaps vs web — receive SKU + name suggest', () => {
  const src = read('screens/inventory/ReceiveGoodsScreen.tsx');
  it('builds suggest query from name or SKU', () => {
    assert.match(src, /const nameQ = form\.item_name\.trim\(\)/);
    assert.match(src, /const skuQ = form\.item_id\.trim\(\)/);
  });
  it('re-runs suggest when item_id changes', () => {
    assert.match(src, /\[form\.item_name, form\.item_id, selectedExistingItem\]/);
  });
  it('shows SKU-oriented suggestion panel under item id', () => {
    assert.match(src, /Type SKU or name/);
  });
  it('still calls INVENTORY_SUGGEST endpoint', () => {
    assert.match(src, /API_ENDPOINTS\.INVENTORY_SUGGEST/);
  });
});

describe('mobile gaps vs web — canEditRecipe ADMIN only', () => {
  const role = read('hooks/useRole.ts');
  const list = read('screens/recipe/RecipeListScreen.tsx');
  const create = read('screens/recipe/CreateRecipeScreen.tsx');
  const detail = read('screens/recipe/RecipeDetailScreen.tsx');
  it('exposes canEditRecipe = isAdmin only', () => {
    assert.match(role, /const canEditRecipe = isAdmin/);
  });
  it('RecipeList create uses canEditRecipe', () => {
    assert.match(list, /canEditRecipe/);
  });
  it('CreateRecipe blocks non-admin', () => {
    assert.match(create, /Only ADMIN can create or edit recipes/);
  });
  it('RecipeDetail gates edit/delete on canEditRecipe', () => {
    assert.match(detail, /canEditRecipe/);
  });
});
