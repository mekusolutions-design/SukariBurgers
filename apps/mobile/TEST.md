# Mobile tests

## Runnable without Expo/Jest install

```bash
# From apps/mobile
node --test src/__tests__/*.test.mjs

# From repo root (parity package)
node --test \
  apps/mobile/src/__tests__/*.test.mjs \
  apps/api/test/mobile-parity.contract.test.mjs \
  apps/api/test/mobile-parity.integration.test.mjs
```

## Not included (needs device / jest-expo)

- Full React Native component render tests
- E2E on iOS/Android emulator
- Live API + SecureStore

Add later with: `npx jest-expo` + `@testing-library/react-native`.
