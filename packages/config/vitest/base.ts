import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest settings for every workspace package. Merge package-specific
 * settings on top with `mergeConfig(sharedVitestConfig, defineConfig({ ... }))`.
 */
export const sharedVitestConfig = defineConfig({
  test: {
    // Node 25+ defines a built-in `localStorage` global that is `undefined`
    // unless `--localstorage-file` is set. Vitest's jsdom environment will not
    // replace an existing global, so tests would see `undefined` instead of
    // jsdom's in-memory Storage. Browsers are unaffected.
    execArgv: ['--no-webstorage'],
  },
});

export default sharedVitestConfig;
