# Mobile parity unit tests

Run (Node 18+):

```bash
node --test apps/mobile/src/__tests__/parityHelpers.test.mjs
```

These tests cover pure business rules for P1–P3 without React Native:

- Recipe normalize/filter (searchable picker)
- Start production requires `recipe_id`
- Pre-prep loss reason rules
- Closing stock role gate
- Waste path `/waste/record`
- Approval mapping
