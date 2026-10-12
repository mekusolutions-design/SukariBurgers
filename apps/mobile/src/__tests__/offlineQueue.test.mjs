import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function addAction(queue, action) {
  return [...queue, { ...action, id: `q-${queue.length + 1}`, status: 'pending' }];
}

function markSynced(queue, id) {
  return queue.map((a) => (a.id === id ? { ...a, status: 'synced' } : a));
}

function pendingOnly(queue) {
  return queue.filter((a) => a.status === 'pending');
}

describe('offline queue', () => {
  it('queues waste and production actions', () => {
    let q = [];
    q = addAction(q, { module: 'waste', endpoint: '/waste/record', method: 'POST' });
    q = addAction(q, { module: 'production', endpoint: '/production/start', method: 'POST' });
    assert.equal(q.length, 2);
    assert.equal(pendingOnly(q).length, 2);
  });

  it('marks synced and filters pending', () => {
    let q = addAction([], { module: 'waste', endpoint: '/waste/record', method: 'POST' });
    q = markSynced(q, 'q-1');
    assert.equal(pendingOnly(q).length, 0);
  });
});
