# Sukari Burgers Mobile Parity Implementation Notes

## Implemented in this pass

- Replaced the transient production socket-only list with a persistent queue fetched from `GET /kitchen/production-queue` whenever the production screen is focused, on pull-to-refresh, after start/finish, and on production socket events.
- Added active batch cards with planned quantity, start timestamp, production identifier, and a direct Finish batch action.
- Added a mobile finish-batch workflow that loads recipe details, scales ingredient/output standards to the planned batch size, fetches current ingredient WAC using `/costing/sku-costs` when available, captures actual input/output quantities, batch number, explicit expiry date, waste, reason, and notes, and posts to `/production/finish`.
- Removed automatic substitution of today's date for the required expiry date. The finish form now requires a valid `YYYY-MM-DD` date and a batch number.
- Changed production-start error handling so authorization, validation, and server errors are shown as errors rather than reported as offline success. Network-only failures are saved to the production store's persistent pending list.
- Prevented new production-start requests from being written to both the local production pending list and the shared offline queue, which could replay a batch twice. Added an online retry path for persisted production starts and refreshes after synchronization.
- Corrected production history loading to use the kitchen history endpoint used by the web application, normalize camelCase/snake_case fields, show server finish timestamps, expiry, and available stock where returned, and fetch on screen focus.
- Added a role-aware Module Hub, accessible from the authenticated header, to improve access to existing mobile modules.
- Added mobile Consumption & Alerts, Variance Review, Traceability, and Team Management screens using existing API endpoints and backend authorization. Variance supports viewing batch details, flagging/unflagging, and submitting a reason code. Team role changes are admin-only and require confirmation.
- Updated the mobile theme's primary accent from blue to Sukari's orange while retaining the existing palette structure and business logic.

## Validation performed

- Ran all mobile source-contract tests with `node --test apps/mobile/src/__tests__/*.test.mjs`: **99 tests passed**.
- Ran TypeScript transpilation/syntax checks on the changed TS/TSX files: **all checked files passed syntax transpilation**.
- Attempted dependency installation to run the full Expo TypeScript check, but `npm install` timed out in this environment. A full `tsc --noEmit`, Expo doctor, device build, and runtime/API integration test have therefore **not** been verified here.

## Remaining parity work

This is a substantial first implementation pass, not a certification that every web feature is complete. The following still require a dedicated screen-by-screen comparison and device/API verification:

- Consumption product and menu-item drill-down detail screens and date-range controls.
- Waste event detail/history parity and any manager-only expired-stock write-off actions present on web.
- Full POS order history/order-detail/payment lifecycle parity.
- Dashboard KPI drill-downs, alert destinations, and the remaining web analytics interactions.
- Exact recipe multi-output edge cases, yield-weight calculations, and production costing/variance behavior against the live API using a safe test environment.
- Visual verification on small Android phones and tablets, including keyboard behavior, accessibility, and navigation density.

No database schema, migration, or production deployment was performed as part of this source update.

## Web-to-mobile coverage snapshot

| Web area | Mobile state after this pass | Remaining verification / work |
|---|---|---|
| Dashboard | Existing manager dashboard | Compare all web KPIs, alert links, and drill-downs |
| Inventory / receiving | Existing screens | Full filter/detail/action parity and device checks |
| Finished goods | Existing screen | Compare all web details and adjustments |
| Kitchen orders | Existing kitchen display and order detail | Verify every web status transition and order detail field |
| Production queue/start/finish/history | Persistent queue, finish form, server history added | Safe-environment API test for multi-output recipes, costing, yield variance, and idempotency |
| Recipes | Existing list/detail/create | Verify all web editing, ingredient/output, and validation paths |
| Menu/catalog | Existing list/create and adjustment support | Verify all category/catalog/availability workflows |
| POS/order/payment | Existing POS and payment screens | Web order-history/detail parity and full payment lifecycle still need audit |
| Waste | Existing waste recording | Web event history/detail and expired-stock write-off parity still needs work |
| Consumption | Summary, top products/menu items, alerts added | Date-range controls and product/menu-item drill-down screens remain |
| Variance | Batch list/detail, flag/unflag, reason-code action added | Verify all detail fields and role-specific flows against web |
| Traceability | Item/SKU/batch search and event timeline added | Verify search variations and complete timeline details against web |
| Team | Admin user list and role changes added | Verify search, user detail, and server permission matrix |
| Approvals | Existing mobile screen | Verify all web approval types and edge cases |
| Refills | Existing request/approval screens | Verify detail and issue/approval parity |
| Pre-prep / closing stock | Existing mobile screens | Verify role gating, loss rules, and all web fields |
| Notifications / profile | Existing mobile screens | Compare remaining web preferences and actions |
