# Mobile full web POS + closing parity

## POS (matches web NewOrderPanel)
- Bootstrap `availability[]` merge
- maxPortions sellable (no default 1)
- Normalize component lines (snake_case / option_items)
- FIXED + INVENTORY auto-selections
- Multi-option CHOICE bottom sheet picker
- Validate selections before checkout
- Order payload includes `selections[]`
- Cart shows selected finished goods
- Menu rows show "N left"

## Closing stock
- Kitchen submit; zero valid; blank uncounted

## Tests (8 passed)
```bash
cd apps/mobile && npm test
# node --test src/features/pos/posParityCore.test.mjs
```
