/**
 * Design-token contrast contract (design_system.md §4).
 *
 * `client/src/styles/index.css` declares: "All text/background pairs meet
 * WCAG AA (≥4.5:1)". That claim was not true — the `danger` token measured
 * 4.23:1 on `danger-bg`, and axe reported a `color-contrast` violation on the
 * "Stalled" health badge in the real rendered UI.
 *
 * These tests read the ACTUAL token values from the stylesheet and assert
 * the documented ratio, so the contract is enforced rather than asserted in
 * a comment. A token change that breaks contrast fails here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CSS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.css');
const CSS = readFileSync(CSS_PATH, 'utf8');

/** Read a `--token` value from the `:root` block. */
function token(name) {
  const match = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!match) throw new Error(`token --${name} not found in index.css`);
  return match[1];
}

/** Parse #rgb / #rrggbb into [r, g, b]. */
function rgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG relative luminance. */
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours. */
function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('design tokens — WCAG AA contrast (design_system.md §4)', () => {
  // Every text/background pair the stylesheet declares as AA-compliant.
  const PAIRS = [
    ['text', 'bg', 'body text on the page background'],
    ['text', 'surface', 'body text on a card'],
    ['text', 'surface-2', 'body text on a raised surface'],
    ['text-2', 'surface', 'secondary text on a card'],
    ['text-2', 'bg', 'secondary text on the page background'],
    ['text-3', 'surface', 'muted text on a card'],
    ['text-3', 'bg', 'muted text on the page background'],
    ['text-3', 'surface-2', 'muted text on a raised surface'],
    ['accent', 'surface', 'primary link on a card'],
    ['accent', 'bg', 'primary link on the page background'],
    ['success', 'success-bg', 'success badge text on its background'],
    ['warning', 'warning-bg', 'warning badge text on its background'],
    ['danger', 'danger-bg', 'danger badge text on its background'],
    ['danger', 'surface', 'danger text on a card'],
    ['danger', 'surface-2', 'danger text on a raised surface'],
  ];

  for (const [fg, bg, label] of PAIRS) {
    it(`${label} (--${fg} on --${bg}) is at least 4.5:1`, () => {
      const ratio = contrast(token(fg), token(bg));
      expect(
        ratio,
        `--${fg} (${token(fg)}) on --${bg} (${token(bg)}) is ${ratio.toFixed(2)}:1 — WCAG AA needs 4.5:1`
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('white text on the solid danger background is at least 4.5:1', () => {
    // The destructive Button renders white on --danger.
    const ratio = contrast('#ffffff', token('danger'));
    expect(
      ratio,
      `white on --danger (${token('danger')}) is ${ratio.toFixed(2)}:1 — WCAG AA needs 4.5:1`
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('the stylesheet still declares the AA guarantee', () => {
    // The contract above is only meaningful if the stylesheet keeps claiming
    // it — a future edit must not quietly drop the promise.
    expect(CSS).toMatch(/WCAG AA \(≥4\.5:1\)/);
  });
});
