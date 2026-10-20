/**
 * Safe navigation wrapper (Item 3, Phase 9).
 *
 * Defense-in-depth against React Router open-redirect advisories
 * (GHSA-wrjc-x8rr-h8h6 / CVE-2025-68470: open redirect via backslash in
 * `<Link>` and `useNavigate`). All Frieday navigation targets are hardcoded
 * relative paths, so the advisory is not exploitable in the current
 * application. This utility adds a runtime guard so any future navigation
 * target cannot redirect users to an arbitrary external URL.
 *
 * Rules:
 *   - Only relative paths starting with `/` are allowed.
 *   - Protocol-relative URLs (`//evil.com`), backslash UNC paths
 *   (`\\evil.com`), and absolute URLs (`https://evil.com`) are rejected.
 *   - Unknown schemes (`javascript:`, `data:`, `vbscript:`) are rejected.
 *
 * @param {string} to the navigation target
 * @returns {boolean} true if the target is a safe relative path
 */
function isSafeNavigateTarget(to) {
  if (typeof to !== 'string' || to.length === 0) return false;

  // Reject backslash-based open redirect (CVE-2025-68470): a leading
  // backslash or double backslash can be interpreted as a UNC path.
  if (to.startsWith('\\') || to.includes('\\')) return false;

  // Reject protocol-relative URLs: //evil.com
  if (to.startsWith('//')) return false;

  // Reject absolute URLs with a scheme: https://evil.com, javascript:..., data:...
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(to)) return false;

  // Must start with '/' to be a same-origin relative path.
  if (!to.startsWith('/')) return false;

  return true;
}

/**
 * Wraps React Router's navigate with a safety guard. Rejects unsafe targets
 * by navigating to / instead (fail-safe) and returns false so callers can
 * detect the rejection.
 *
 * @param {Function} navigate the React Router useNavigate() function
 * @param {string} to the navigation target
 * @param {object} [options] React Router navigate options
 * @returns {boolean} true if navigation was allowed, false if blocked
 */
function safeNavigate(navigate, to, options) {
  if (!isSafeNavigateTarget(to)) {
    navigate('/', { replace: true });
    return false;
  }
  navigate(to, options);
  return true;
}

export { isSafeNavigateTarget, safeNavigate };
