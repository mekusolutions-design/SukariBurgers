import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, '../../../../apps/api/src/main.ts'), 'utf8');
const appModule = readFileSync(join(here, '../../../../apps/api/src/app.module.ts'), 'utf8');

describe('API deployment and throttler contracts', () => {
  it('configures Express proxy trust before serving requests', () => {
    assert.match(main, /set\('trust proxy',\s*trustProxyHops\)/);
    assert.match(main, /TRUST_PROXY_HOPS/);
  });

  it('keeps the raised general limit and the stricter auth limit', () => {
    assert.match(appModule, /ttl:\s*60_000,[\s\S]{0,80}limit:\s*600/);
    assert.match(appModule, /ttl:\s*60_000,[\s\S]{0,80}limit:\s*10/);
  });
});
