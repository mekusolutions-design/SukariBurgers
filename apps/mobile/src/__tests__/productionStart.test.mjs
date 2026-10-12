import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStartProduction,
  buildStartProductionBody,
} from './parityHelpers.mjs';

describe('production start mobile payload', () => {
  it('builds Nest-compatible body with recipe_id', () => {
    const body = buildStartProductionBody({
      recipe_id: 'rec-1',
      item_id: 'buns',
      item_name: 'Buns',
      planned_quantity: 10,
      notes: ' am ',
    });
    assert.deepEqual(
      { ...body, notes: body.notes },
      {
        recipe_id: 'rec-1',
        item_id: 'buns',
        item_name: 'Buns',
        planned_quantity: 10,
        notes: 'am',
      },
    );
  });

  it('validation fails without recipe', () => {
    assert.ok(validateStartProduction({ item_id: 'x', item_name: 'x', planned_quantity: 1 }));
  });
});
