import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** Mirror of useRole + ROLES without React */
const ROLES = { ADMIN: 'ADMIN', MANAGER: 'MANAGER', KITCHEN: 'KITCHEN', POS: 'POS' };

function useRole(role) {
  const isAdmin = role === ROLES.ADMIN;
  const isManager = role === ROLES.MANAGER;
  const isKitchen = role === ROLES.KITCHEN;
  const isPos = role === ROLES.POS;
  return {
    isAdmin,
    isManager,
    isKitchen,
    isPos,
    canUsePos: isAdmin || isManager || isPos,
    canEditMenu: isAdmin,
    canSubmitClosingStock: isAdmin || isManager,
    canAccessApprovals: isAdmin || isManager,
    canAccessManagerDashboard: isAdmin || isManager,
    canPrePrep: isAdmin || isManager || isKitchen,
    canStartProduction: isAdmin || isManager || isKitchen,
  };
}

describe('role matrix (mobile)', () => {
  it('KITCHEN cannot submit closing stock or approvals', () => {
    const r = useRole('KITCHEN');
    assert.equal(r.canSubmitClosingStock, false);
    assert.equal(r.canAccessApprovals, false);
    assert.equal(r.canPrePrep, true);
    assert.equal(r.canUsePos, false);
  });

  it('MANAGER can approvals, closing stock, POS', () => {
    const r = useRole('MANAGER');
    assert.equal(r.canSubmitClosingStock, true);
    assert.equal(r.canAccessApprovals, true);
    assert.equal(r.canUsePos, true);
  });

  it('POS cannot kitchen production tools', () => {
    const r = useRole('POS');
    assert.equal(r.canStartProduction, false);
    assert.equal(r.canPrePrep, false);
    assert.equal(r.canUsePos, true);
  });

  it('ADMIN has full ops flags', () => {
    const r = useRole('ADMIN');
    assert.equal(r.canEditMenu, true);
    assert.equal(r.canAccessManagerDashboard, true);
    assert.equal(r.canSubmitClosingStock, true);
  });
});
