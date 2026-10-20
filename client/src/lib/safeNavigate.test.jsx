/**
 * Safe navigation regression tests (Item 3, Phase 9).
 *
 * Verifies that the safeNavigate utility blocks open-redirect patterns
 * relevant to GHSA-wrjc-x8rr-h8h6 (CVE-2025-68470) while allowing all
 * legitimate Frieday internal navigation targets.
 */
import { describe, it, expect } from 'vitest';
import { isSafeNavigateTarget, safeNavigate } from './safeNavigate.js';

describe('safeNavigate: allowed internal targets (Item 3)', () => {
  const allowed = [
    '/login',
    '/dashboard',
    '/timeline',
    '/repositories',
    '/repositories/abc123',
    '/insights',
    '/settings',
    '/',
    '/dashboard?range=30d',
    '/repositories?sort=activity',
    '/api/auth/github',
  ];

  for (const target of allowed) {
    it(`allows ${target}`, () => {
      expect(isSafeNavigateTarget(target)).toBe(true);
    });
  }
});

describe('safeNavigate: blocked open-redirect patterns (Item 3)', () => {
  const blocked = [
    // Protocol-relative URLs (//evil.com)
    '//evil.com',
    '//evil.com/login',
    '//attacker.example.com/@@example.com',

    // Absolute URLs with scheme
    'https://evil.com',
    'http://evil.com',
    'HTTPS://EVIL.COM',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ftp://evil.com',

    // Backslash UNC / open redirect (CVE-2025-68470)
    '\\\\evil.com',
    '\\evil.com',
    '\\\\evil.com@safe.com',
    '\\safe.com',
    '/\\\\evil.com',

    // Empty / invalid
    '',
    null,
    undefined,
    123,
    {},

    // Non-relative paths that could resolve externally
    'evil.com',
    'C:\\Windows\\System32',
  ];

  for (const target of blocked) {
    it(`blocks ${JSON.stringify(target)}`, () => {
      expect(isSafeNavigateTarget(target)).toBe(false);
    });
  }
});

describe('safeNavigate: preserves valid repository IDs and query params (Item 3)', () => {
  it('allows repository IDs with alphanumeric characters', () => {
    expect(isSafeNavigateTarget('/repositories/64b64b64b64b64b64b64b64b')).toBe(true);
  });

  it('allows repository IDs with hyphens', () => {
    expect(isSafeNavigateTarget('/repositories/repo-name-123')).toBe(true);
  });

  it('allows range query params', () => {
    expect(isSafeNavigateTarget('/dashboard?range=90d')).toBe(true);
    expect(isSafeNavigateTarget('/dashboard?range=12m')).toBe(true);
  });

  it('allows sort query params', () => {
    expect(isSafeNavigateTarget('/repositories?sort=activity')).toBe(true);
  });
});

describe('safeNavigate function behavior (Item 3)', () => {
  it('allows safe navigation through to the wrapped navigate', () => {
    let calledTo = null;
    let calledOpts = null;
    const navigate = (to, options) => {
      calledTo = to;
      calledOpts = options;
    };

    const result = safeNavigate(navigate, '/dashboard', { replace: true });

    expect(result).toBe(true);
    expect(calledTo).toBe('/dashboard');
    expect(calledOpts).toEqual({ replace: true });
  });

  it('blocks unsafe navigation and falls back to /', () => {
    let calledTo = null;
    let calledOpts = null;
    const navigate = (to, options) => {
      calledTo = to;
      calledOpts = options;
    };

    const result = safeNavigate(navigate, '//evil.com', { replace: true });

    expect(result).toBe(false);
    expect(calledTo).toBe('/');
    expect(calledOpts).toEqual({ replace: true });
  });

  it('blocks backslash open redirect and falls back to /', () => {
    let calledTo = null;
    const navigate = (to) => {
      calledTo = to;
    };

    const result = safeNavigate(navigate, '\\\\evil.com');

    expect(result).toBe(false);
    expect(calledTo).toBe('/');
  });
});
