import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import tailwindConfig from '../../tailwind.config.js';

/**
 * The auth screen is ported from a Tailwind v4 design export. Frieday runs
 * Tailwind v3 with a CUSTOM spacing scale (design_system.md §7: a 4px base
 * with an allowlist of steps), so every v4 spacing class in the port means a
 * DIFFERENT size here — `h-16` is 16px, not 4rem.
 *
 * This test locks the port against that trap: any class in the auth screen
 * that the Frieday spacing scale overrides must be written as an explicit
 * arbitrary value, so its size is visible in the source and independent of
 * the scale.
 */

/** The steps Frieday's Tailwind config overrides (design_system.md §7). */
const OVERRIDDEN_STEPS = new Set(Object.keys(tailwindConfig.theme.extend.spacing).map((k) => Number(k)));

/** Utilities whose numeric suffix comes from the spacing scale. */
const SPACING_UTILITIES =
  /^(?:-?(?:m|p|gap|gap-x|gap-y|space-x|space-y|w|h|size|min-w|min-h|max-w|max-h|top|bottom|left|right|inset|inset-x|inset-y|translate-x|translate-y)-)(-?)([0-9]+(?:[.][0-9]+)?)$/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(jsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

const AUTH_DIR = join(import.meta.dirname, '..', 'components', 'auth');

describe('auth screen — Tailwind spacing scale compatibility', () => {
  const files = walk(AUTH_DIR);

  it('finds the ported auth files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(AUTH_DIR, f), f]))(
    '%s uses no spacing class that Frieday overrides',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      const offenders = new Set();
      // Only inspect class strings, not prose that happens to contain a dash.
      for (const match of source.matchAll(/class(?:Name)?="([^"]*)"/g)) {
        for (const token of match[1].split(/\s+/)) {
          const util = token.replace(/^[a-z-]+:/, ''); // strip variant prefix
          if (util.includes('[')) continue; // arbitrary value — explicit
          const m = SPACING_UTILITIES.exec(util);
          if (!m) continue;
          if (OVERRIDDEN_STEPS.has(Number(m[2]))) offenders.add(token);
        }
      }
      expect(
        [...offenders],
        `${relative(AUTH_DIR, file)} uses spacing classes that Frieday's Tailwind scale overrides ` +
          `(${[...OVERRIDDEN_STEPS].sort((a, b) => a - b).join(', ')}). ` +
          `Write them as arbitrary values, e.g. h-[64px] instead of h-16.`
      ).toEqual([]);
    }
  );
});
