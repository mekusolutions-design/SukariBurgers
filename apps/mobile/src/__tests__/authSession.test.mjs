import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function isAuthenticated(state) {
  return Boolean(state.token && state.user?.id);
}

function canEnterApp(state) {
  return isAuthenticated(state) && Boolean(state.user?.role);
}

describe('auth session', () => {
  it('requires token and user', () => {
    assert.equal(isAuthenticated({ token: null, user: null }), false);
    assert.equal(
      isAuthenticated({ token: 'jwt', user: { id: '1', role: 'MANAGER' } }),
      true,
    );
  });

  it('app entry requires role', () => {
    assert.equal(canEnterApp({ token: 'jwt', user: { id: '1' } }), false);
    assert.equal(
      canEnterApp({ token: 'jwt', user: { id: '1', role: 'POS' } }),
      true,
    );
  });
});
