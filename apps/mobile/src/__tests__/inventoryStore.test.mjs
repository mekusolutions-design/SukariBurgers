import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function patchStockItem(stock, partial) {
  return stock.map((item) =>
    item.id === partial.id
      ? {
          ...item,
          available_stock:
            partial.available_stock ?? item.available_stock,
          total_value: partial.total_value ?? item.total_value,
          days_to_expiry_min:
            partial.days_to_expiry_min !== undefined
              ? partial.days_to_expiry_min
              : item.days_to_expiry_min,
          name: partial.name || item.name,
        }
      : item,
  );
}

function stockStatus(item) {
  if (item.available_stock <= 0) return 'out_of_stock';
  if (item.available_stock <= (item.reorder_point ?? 0)) return 'low_stock';
  return 'in_stock';
}

describe('inventory store logic', () => {
  it('patchStockItem updates matching id only', () => {
    const stock = [
      { id: '1', name: 'Oil', available_stock: 10, total_value: 100, days_to_expiry_min: 5 },
      { id: '2', name: 'Salt', available_stock: 20, total_value: 50, days_to_expiry_min: null },
    ];
    const next = patchStockItem(stock, {
      id: '1',
      available_stock: 7,
      total_value: 70,
    });
    assert.equal(next[0].available_stock, 7);
    assert.equal(next[1].available_stock, 20);
  });

  it('stockStatus thresholds', () => {
    assert.equal(stockStatus({ available_stock: 0, reorder_point: 5 }), 'out_of_stock');
    assert.equal(stockStatus({ available_stock: 3, reorder_point: 5 }), 'low_stock');
    assert.equal(stockStatus({ available_stock: 10, reorder_point: 5 }), 'in_stock');
  });
});
