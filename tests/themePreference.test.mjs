import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStoredTheme,
  getStoredThemeMode,
  resolveThemeMode,
  themeStorageKey
} from '../src/utils/themePreference.js';

function withGlobals(globals, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(globals)) {
    previous[key] = globalThis[key];
    globalThis[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete globalThis[key];
      } else {
        globalThis[key] = value;
      }
    }
  }
}

function fakeStorage(saved) {
  return { getItem: (key) => (key === themeStorageKey ? saved : null) };
}

function fakeWindow(prefersLight) {
  return {
    matchMedia: (query) => ({ matches: prefersLight && query === '(prefers-color-scheme: light)' })
  };
}

test('getStoredTheme defaults to dark when localStorage is unavailable', () => {
  assert.equal(getStoredTheme(), 'dark');
});

test('getStoredThemeMode keeps dark, light and system, and rejects unknown values', () => {
  for (const mode of ['dark', 'light', 'system']) {
    withGlobals({ localStorage: fakeStorage(mode) }, () => {
      assert.equal(getStoredThemeMode(), mode);
    });
  }
  withGlobals({ localStorage: fakeStorage('sepia') }, () => {
    assert.equal(getStoredThemeMode(), 'dark');
  });
});

test('resolveThemeMode maps explicit modes and falls back to dark', () => {
  assert.equal(resolveThemeMode('light'), 'light');
  assert.equal(resolveThemeMode('dark'), 'dark');
  assert.equal(resolveThemeMode(undefined), 'dark');
});

test('system mode follows prefers-color-scheme', () => {
  withGlobals({ window: fakeWindow(true), localStorage: fakeStorage('system') }, () => {
    assert.equal(resolveThemeMode('system'), 'light');
    assert.equal(getStoredTheme(), 'light');
  });
  withGlobals({ window: fakeWindow(false) }, () => {
    assert.equal(resolveThemeMode('system'), 'dark');
  });
});
