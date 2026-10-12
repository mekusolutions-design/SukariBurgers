import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** Mirror kitchen order status transitions */
const STATUSES = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];

function nextStatus(current, action) {
  const map = {
    start: { pending: 'preparing' },
    ready: { preparing: 'ready' },
    complete: { ready: 'completed' },
    cancel: { pending: 'cancelled', preparing: 'cancelled' },
  };
  return map[action]?.[current] ?? current;
}

function upsertOrder(orders, order) {
  const idx = orders.findIndex((o) => o.orderId === order.orderId);
  if (idx < 0) return [order, ...orders];
  const next = [...orders];
  next[idx] = { ...next[idx], ...order };
  return next;
}

describe('kitchen order store logic', () => {
  it('progresses pending → preparing → ready → completed', () => {
    let s = 'pending';
    s = nextStatus(s, 'start');
    assert.equal(s, 'preparing');
    s = nextStatus(s, 'ready');
    assert.equal(s, 'ready');
    s = nextStatus(s, 'complete');
    assert.equal(s, 'completed');
  });

  it('upserts by orderId', () => {
    let orders = [{ orderId: '1', status: 'pending' }];
    orders = upsertOrder(orders, { orderId: '1', status: 'preparing' });
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, 'preparing');
    orders = upsertOrder(orders, { orderId: '2', status: 'pending' });
    assert.equal(orders.length, 2);
  });

  it('knows valid status set', () => {
    assert.ok(STATUSES.includes('preparing'));
  });
});
