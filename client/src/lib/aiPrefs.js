/**
 * AI explanations preference (T6.2). Client-side UI preference only — no
 * secret material (rules.md §10 bans tokens in storage, not preferences;
 * architecture.md §5 defines no settings-preference API, so the smallest
 * compliant solution is a local non-secret flag; deterministic insights and
 * all synced data are unaffected by it).
 */

const STORAGE_KEY = 'frieday.aiExplanations';

/** @returns {boolean} default enabled; invalid/absent values fall open. */
export function aiExplanationsEnabled() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw !== 'false';
  } catch {
    return true;
  }
}

/**
 * Persist the preference and notify open listeners on this page.
 * @param {boolean} enabled
 */
export function setAiExplanationsEnabled(enabled) {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Storage unavailable (private mode): preference is session-only.
  }
  window.dispatchEvent(new window.Event('frieday:ai-preference-changed'));
}
