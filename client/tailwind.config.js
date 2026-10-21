/** Tailwind mapping — authoritative token subset (design_system.md Appendix). */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        border: 'var(--border)',
        borderStrong: 'var(--border-strong)',
        text: 'var(--text)',
        text2: 'var(--text-2)',
        text3: 'var(--text-3)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
        },
        success: 'var(--success)',
        successBg: 'var(--success-bg)',
        warning: 'var(--warning)',
        warningBg: 'var(--warning-bg)',
        danger: 'var(--danger)',
        dangerBg: 'var(--danger-bg)',
        info: 'var(--info)',
        chart1: 'var(--chart-1)',
        chart2: 'var(--chart-2)',
        chart3: 'var(--chart-3)',
        chart4: 'var(--chart-4)',
        chart5: 'var(--chart-5)',
        chart6: 'var(--chart-6)',
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      spacing: {
        // 4px base — allowed steps only (design_system.md §7),
        // plus fixed component heights from §12 (button sm/md/lg).
        4: '4px',
        8: '8px',
        12: '12px',
        16: '16px',
        20: '20px',
        24: '24px',
        28: '28px',
        32: '32px',
        36: '36px',
        40: '40px',
        44: '44px',
        48: '48px',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      width: {
        sidebar: '248px',
        // 64px icon rail (design_system.md §15: "collapses to 64px icon rail
        // <900px").
        rail: '64px',
      },
      maxWidth: {
        content: '1200px',
        narrow: '480px',
      },
      height: {
        topbar: '56px',
      },
    },
    // Breakpoints per design_system.md §8: sm 640, md 900 (sidebar collapses
    // to icons), lg 1200 (full grid). Tailwind defaults (md 768 / lg 1024)
    // are overridden so the CSS matches the documented layout contract.
    //
    // `desktop` (1024) is the auth composition's own breakpoint — the login
    // page switches from the stacked to the side-by-side layout there. It is
    // NOT the app's `lg` (1200). It must stay in sync with
    // `STACKED_BREAKPOINT` in `client/src/robot/layout.js`.
    //
    // `short` / `compact` are height tiers (raw media queries) so the desktop
    // composition can tighten its vertical rhythm instead of scrolling on a
    // short window. `compact` is registered last so it wins over `short`.
    screens: {
      sm: '640px',
      md: '900px',
      desktop: '1024px',
      lg: '1200px',
      xl: '1400px',
      short: { raw: '(min-width: 1024px) and (max-height: 880px)' },
      compact: { raw: '(min-width: 1024px) and (max-height: 780px)' },
    },
  },
  plugins: [],
};
