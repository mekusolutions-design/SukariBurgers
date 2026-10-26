import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const read = (path) => readFileSync(join(repo, path), 'utf8');

describe('Sukari Burgers branding', () => {
  it('sets the installed Expo display name and keeps production identifiers stable', () => {
    const config = JSON.parse(read('apps/mobile/app.json')).expo;
    assert.equal(config.name, 'Sukari Burgers');
    assert.equal(config.slug, 'sukari-burgers');
    assert.equal(config.ios.bundleIdentifier, 'com.sukariburgers.app');
    assert.equal(config.android.package, 'com.sukariburgers.app');
  });

  it('uses the interface orange for splash and Android adaptive icon background', () => {
    const config = JSON.parse(read('apps/mobile/app.json')).expo;
    assert.equal(config.splash.backgroundColor.toUpperCase(), '#F28C28');
    assert.equal(config.android.adaptiveIcon.backgroundColor.toUpperCase(), '#F28C28');
    assert.equal(read('apps/mobile/src/lib/theme.ts').includes("primary: '#F28C28'"), true);
  });

  it('includes the configured mobile branding assets', () => {
    const config = JSON.parse(read('apps/mobile/app.json')).expo;
    for (const asset of [config.icon, config.splash.image, config.android.adaptiveIcon.foregroundImage,
      config.android.adaptiveIcon.backgroundImage, config.android.adaptiveIcon.monochromeImage,
      config.web.favicon]) {
      assert.ok(existsSync(join(repo, 'apps/mobile', asset.replace(/^\.\//, ''))), `missing asset ${asset}`);
    }
    const icon = readFileSync(join(repo, 'apps/mobile/assets/icon.png'));
    assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('uses Sukari Burgers for web identity and metadata', () => {
    assert.match(read('apps/web/src/lib/constants/config.ts'), /APP_NAME = "Sukari Burgers"/);
    assert.match(read('apps/web/src/app/layout.tsx'), /Sukari Burgers operations console/);
    assert.match(read('apps/web/src/app/layout.tsx'), /template: `%s \| \$\{APP_NAME\}`/);
    assert.match(read('apps/web/public/logo.svg'), /#F28C28/);
    assert.match(read('apps/web/public/logo.svg'), />SB</);
  });

  it('uses Sukari Burgers on mobile and web authentication interfaces', () => {
    assert.match(read('apps/mobile/src/screens/auth/LoginScreen.tsx'), /Sukari Burgers Login/);
    assert.match(read('apps/mobile/src/screens/auth/RegisterScreen.tsx'), /Join Sukari Burgers/);
    assert.match(read('apps/web/src/features/auth/components/LoginForm.tsx'), /placeholder="you@example\.com"/);
  });
});
