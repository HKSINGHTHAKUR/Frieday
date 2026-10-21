/**
 * Auth-screen icons, ported from the supplied "Frieday GitHub Authentication
 * Design" export. Each is a self-contained SVG that inherits `currentColor`.
 */

/**
 * Shared attribute set: 24x24 stroke icon unless overridden.
 * @param {object} props
 */
function base(props) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    ...props,
  };
}

export function GitHubMark(props) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      focusable={false}
      {...props}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function ChevronRight(props) {
  return (
    <svg {...base(props)} strokeWidth={2}>
      <path d="M9.5 6l6 6-6 6" />
    </svg>
  );
}

export function Spinner(props) {
  return (
    <svg {...base(props)} strokeWidth={2.2} className={`fd-auth-spin ${props.className || ''}`}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

export function AnalysisIcon(props) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="5" cy="6" r="1.7" />
      <circle cx="19" cy="6.5" r="1.7" />
      <circle cx="17.5" cy="18.5" r="1.7" />
      <circle cx="5.5" cy="17.5" r="1.7" />
      <path d="M6.5 7.1l3.4 3M17.6 7.6l-3.5 2.9M16.3 17.3l-2.6-3.3M7 16.4l3-2.6" opacity=".75" />
    </svg>
  );
}

export function ThemesIcon(props) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5l8.5 4.3L12 12 3.5 7.8 12 3.5z" fill="currentColor" fillOpacity=".22" />
      <path d="M3.5 12.2L12 16.4l8.5-4.2" />
      <path d="M3.5 16.4L12 20.6l8.5-4.2" opacity=".65" />
    </svg>
  );
}

export function InsightsIcon(props) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 20.5h17" opacity=".5" />
      <path d="M4.5 16l4.5-4.5 3.5 3 7-7.5" />
      <path d="M15.5 7h4v4" />
      <circle cx="9" cy="11.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="14.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SparkleIcon(props) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
      <path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z" opacity=".6" />
    </svg>
  );
}

export function LinesIcon(props) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h16M4 12h11M4 18h7" />
    </svg>
  );
}

export function NodesIcon(props) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="6.5" r="2.2" />
      <circle cx="17.5" cy="9" r="2.2" />
      <circle cx="10" cy="17.5" r="2.2" />
      <path d="M7.9 7.7l7.8.8M7.3 8.4l1.9 7M15.9 10.6l-4.3 5.4" opacity=".7" />
    </svg>
  );
}

export function BranchIcon(props) {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="10" r="2.2" />
      <path d="M7 8.2v7.6M9.2 10.6c3.2.4 5.2-.4 6.6-1.2M9.2 16.6c2.4-.7 4-2.4 5-5" opacity=".75" />
    </svg>
  );
}

export function InfoIcon(props) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.8v.2" strokeWidth={2} />
    </svg>
  );
}

export function AlertIcon(props) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.8l9 15.6H3l9-15.6z" />
      <path d="M12 10v4.2M12 17v.2" strokeWidth={2} />
    </svg>
  );
}
