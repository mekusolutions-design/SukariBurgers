import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => readFileSync(join(here, relativePath), 'utf8');

function extractFlatCategoryArray(source, declaration) {
  const match = source.match(declaration);
  assert.ok(match, 'canonical category declaration must exist');
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
}

describe('canonical inventory category parity', () => {
  const mobile = read('../lib/ingredientCategories.ts');
  const web = read('../../../../apps/web/src/lib/catalog/ingredient-categories.ts');
  const api = read('../../../../apps/api/src/common/constants/ingredient-categories.ts');

  const webCategories = extractFlatCategoryArray(
    web,
    /export const INGREDIENT_CATEGORIES = \[([\s\S]*?)\] as const;/,
  );
  const apiCategories = extractFlatCategoryArray(
    api,
    /export const INGREDIENT_CATEGORIES = \[([\s\S]*?)\] as const;/,
  );
  const mobileCategories = extractFlatCategoryArray(
    mobile,
    /export const INGREDIENT_CATEGORIES: string\[\] = \[([\s\S]*?)\];/,
  );
  const mobileGroups = [...mobile.matchAll(/items:\s*\[([\s\S]*?)\]/g)];
  const mobileGroupCategories = mobileGroups.flatMap((group) =>
    [...group[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]),
  );

  it('uses the same category labels and order as web and Nest API', () => {
    assert.deepEqual(mobileCategories, webCategories);
    assert.deepEqual(apiCategories, webCategories);
    assert.deepEqual([...new Set(mobileGroupCategories)].sort(), [...new Set(webCategories)].sort());
    assert.equal(webCategories.length, 15);
  });

  it('defaults to the same category as the web receiving form', () => {
    assert.match(mobile, /DEFAULT_INGREDIENT_CATEGORY = 'Packaging & Consumables'/);
    assert.match(web, /DEFAULT_CATEGORY: IngredientCategory = "Packaging & Consumables"/);
  });
});
