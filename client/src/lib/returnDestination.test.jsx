import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readReturnDestination,
  sanitizeReturnDestination,
  buildLoginUrl,
  setPendingDestination,
  takePendingDestination,
  PENDING_KEY,
} from './returnDestination.js';

/**
 * The post-login return destination.
 *
 * The destination is attacker-controllable (it arrives in a query parameter),
 * so it must be validated with the same guard used for every other navigation
 * target. These tests pin both halves: a legitimate deep link survives, and
 * every open-redirect shape is rejected.
 */

describe('returnDestination — validation', () => {
  it('accepts a same-origin relative path', () => {
    expect(sanitizeReturnDestination('/insights')).toBe('/insights');
    expect(sanitizeReturnDestination('/repositories/abc123')).toBe('/repositories/abc123');
    expect(sanitizeReturnDestination('/dashboard?range=30d')).toBe('/dashboard?range=30d');
  });

  it('rejects an absolute URL', () => {
    expect(sanitizeReturnDestination('https://evil.example/steal')).toBe('/');
    expect(sanitizeReturnDestination('http://evil.example/steal')).toBe('/');
  });

  it('rejects a protocol-relative URL', () => {
    expect(sanitizeReturnDestination('//evil.example/steal')).toBe('/');
  });

  it('rejects a backslash UNC path', () => {
    expect(sanitizeReturnDestination('\\\\evil.example\\steal')).toBe('/');
    expect(sanitizeReturnDestination('/\\evil.example')).toBe('/');
  });

  it('rejects unknown schemes', () => {
    expect(sanitizeReturnDestination('javascript:alert(1)')).toBe('/');
    expect(sanitizeReturnDestination('data:text/html,<script>alert(1)</script>')).toBe('/');
    expect(sanitizeReturnDestination('vbscript:msgbox(1)')).toBe('/');
  });

  it('never returns the login page as a destination (that would loop)', () => {
    expect(sanitizeReturnDestination('/login')).toBe('/');
    expect(sanitizeReturnDestination('/login?next=/insights')).toBe('/');
  });

  it('falls back to the dashboard for empty or non-string values', () => {
    expect(sanitizeReturnDestination('')).toBe('/');
    expect(sanitizeReturnDestination(null)).toBe('/');
    expect(sanitizeReturnDestination(undefined)).toBe('/');
    expect(sanitizeReturnDestination(42)).toBe('/');
  });
});

describe('returnDestination — query parameter', () => {
  it('reads a valid destination from the query string', () => {
    expect(readReturnDestination('?next=%2Finsights')).toBe('/insights');
  });

  it('falls back to the dashboard when the parameter is absent', () => {
    expect(readReturnDestination('')).toBe('/');
    expect(readReturnDestination('?other=1')).toBe('/');
  });

  it('falls back to the dashboard for a malicious parameter', () => {
    expect(readReturnDestination('?next=https%3A%2F%2Fevil.example%2Fsteal')).toBe('/');
  });
});

describe('returnDestination — login URL', () => {
  it('builds a login URL that carries the destination', () => {
    expect(buildLoginUrl('/insights')).toBe('/login?next=%2Finsights');
  });

  it('omits the parameter for the default destination', () => {
    expect(buildLoginUrl('/')).toBe('/login');
    expect(buildLoginUrl('https://evil.example/steal')).toBe('/login');
  });
});

describe('returnDestination — pending destination across the OAuth round-trip', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('stores and returns a destination', () => {
    setPendingDestination('/insights');
    expect(takePendingDestination()).toBe('/insights');
  });

  it('is consumed once, so a later sign-in does not reuse it', () => {
    setPendingDestination('/insights');
    expect(takePendingDestination()).toBe('/insights');
    expect(takePendingDestination()).toBe('/');
  });

  it('refuses to store a malicious destination', () => {
    setPendingDestination('https://evil.example/steal');
    expect(takePendingDestination()).toBe('/');
  });

  it('stores nothing for the default destination', () => {
    setPendingDestination('/');
    expect(window.sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('never stores a token or credential — only a route', () => {
    setPendingDestination('/insights');
    const stored = window.sessionStorage.getItem(PENDING_KEY);
    expect(stored).toBe('/insights');
    expect(stored).not.toMatch(/token|secret|cookie|jwt/i);
  });
});
