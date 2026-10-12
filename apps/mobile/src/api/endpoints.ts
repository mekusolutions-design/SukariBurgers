// apps/mobile/src/api/endpoints.ts — keep in sync with apps/web/src/lib/api/endpoints.ts
export const API_ENDPOINTS = {
  LOGIN: '/auth/login',
  REGISTER: '/auth/register',

  RECEIVE_GOODS: '/received',
  GET_STOCK: '/inventory',

  KITCHEN_CLOSING_STOCK: '/kitchen/closing-stock',
  KITCHEN_ACTIVE_ORDERS: '/kitchen/active-orders',
  KITCHEN_ORDER_STATUS: (orderId: string) =>
    `/kitchen/orders/${orderId}/status`,
  KITCHEN_PRE_PREP: '/kitchen/pre-prep',
  KITCHEN_PRODUCTION_QUEUE: '/kitchen/production-queue',
  KITCHEN_PRODUCTION_HISTORY: '/kitchen/production-history',

  POS_CREATE_ORDER: '/pos/order',
  POS_ORDERS: '/pos/orders',
  POS_BOOTSTRAP: '/pos/bootstrap',
  POS_MENU_AVAILABILITY: '/pos/menu-availability',
  POS_SEND_KITCHEN: (orderId: string) =>
    `/pos/orders/${orderId}/send-to-kitchen`,
  POS_PAYMENT: (orderId: string) => `/pos/orders/${orderId}/payment`,
  CREATE_ORDER: '/pos/orders',

  MENU_LIST: '/menu',
  MENU_COMBOS: '/menu/combos',

  RECIPE_LIST: '/recipe',
  RECIPE_BY_ITEM: (itemId: string) =>
    `/recipe/item/${encodeURIComponent(itemId)}`,
  RECIPE_DETAIL: (recipeId: string) =>
    `/recipe/${encodeURIComponent(recipeId)}`,

  PRODUCTION_START: '/production/start',
  PRODUCTION_FINISH: '/production/finish',
  PRODUCTION_HISTORY: '/production/history',
  PRODUCTION_QUEUE: '/kitchen/production-queue',
  PRODUCTION_PRE_PREP: '/production/pre-prep',

  WASTE_RECORD: '/waste/record',
  LOG_WASTE: '/waste/record',

  APPROVALS_PENDING: '/approvals/pending',
  APPROVALS_APPROVE: (id: string) =>
    `/approvals/${encodeURIComponent(id)}/approve`,
  APPROVALS_REJECT: (id: string) =>
    `/approvals/${encodeURIComponent(id)}/reject`,

  DASHBOARD_SUMMARY: '/dashboard/summary',
  DASHBOARD_KPIS: '/dashboard/kpis',
  DASHBOARD_ALERTS: '/dashboard/alerts',

  GET_NOTIFICATIONS: '/notifications',
  UPDATE_NOTIFICATION_SETTINGS: '/notifications/settings',
} as const;
