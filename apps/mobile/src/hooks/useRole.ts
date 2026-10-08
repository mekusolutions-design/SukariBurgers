// apps/mobile/src/hooks/useRole.ts
import { useAuthStore } from '../features/auth/authStore';
import { ROLES } from '../lib/constants';
import type { UserRole } from '../features/auth/authStore';

export const useRole = () => {
  const { user } = useAuthStore();
  const role = user?.role as UserRole | undefined;

  const isAdmin = role === ROLES.ADMIN;
  const isManager = role === ROLES.MANAGER;
  const isKitchen = role === ROLES.KITCHEN;
  const isPos = role === ROLES.POS;

  /** KITCHEN never uses POS */
  const canUsePos = isAdmin || isManager || isPos;

  /** Only ADMIN mutates menu */
  const canEditMenu = isAdmin;

  /** Only ADMIN changes user roles */
  const canChangeUserRole = isAdmin;

  return {
    isAdmin,
    isManager,
    isKitchen,
    isPos,
    canUsePos,
    canEditMenu,
    canChangeUserRole,
    role,
    hasRole: (requiredRole: string) => role === requiredRole,
    canAccess: (allowedRoles: string[]) =>
      allowedRoles.includes(role || ''),
  };
};
