// apps/mobile/src/api/endpoints.ts — keep in sync with apps/web/src/lib/api/endpoints.ts
export const API_ENDPOINTS = {
  LOGIN: '/auth/login',
  REGISTER: '/auth/register',

  RECEIVE_GOODS: '/received',
  GET_STOCK: '/inventory',
  INVENTORY_SUGGEST: '/inventory/suggest',

  KITCHEN_CLOSING_STOCK: '/kitchen/closing-stock',
  KITCHEN_CLOSING_STOCK_LEDGER: '/kitchen/closing-stock/ledger',
  KITCHEN_CLOSING_STOCK_HISTORY: '/kitchen/closing-stock/history',
  KITCHEN_CLOSING_STOCK_ADJUSTMENTS: '/kitchen/closing-stock/adjustments',
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
  MENU_CATEGORIES: '/menu/categories',

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

  CONSUMPTION_SUMMARY: '/consumption/summary',
  CONSUMPTION_ALERTS: '/consumption/alerts',
  CONSUMPTION_PRODUCT: (id: string) => `/consumption/products/${encodeURIComponent(id)}`,
  CONSUMPTION_MENU_ITEM: (id: string) => `/consumption/menu-items/${encodeURIComponent(id)}`,
  TRACE_SEARCH: '/trace',
  TRACE_ITEM: (id: string) => `/trace/item/${encodeURIComponent(id)}`,
  VARIANCE_BATCHES: '/variance/batches',
  VARIANCE_BATCH: (id: string) => `/variance/batches/${encodeURIComponent(id)}`,
  VARIANCE_REASON: (id: string) => `/variance/batches/${encodeURIComponent(id)}/reason`,
  VARIANCE_FLAG: (id: string) => `/variance/batches/${encodeURIComponent(id)}/flag`,
  USERS_LIST: '/users',
  USER_CHANGE_ROLE: (id: string) => `/users/${encodeURIComponent(id)}/role`,

  GET_NOTIFICATIONS: '/notifications',
  UPDATE_NOTIFICATION_SETTINGS: '/notifications/settings',
} as const;
