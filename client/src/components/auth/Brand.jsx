import { useId } from 'react';

/**
 * Frieday "F" mark — the same silhouette as the emblem on the robot visor.
 * Ported from the supplied "Frieday GitHub Authentication Design" export.
 */
export function FMark({ size = 28, className = '' }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden focusable={false}>
      <defs>
        <linearGradient id={`${id}-g`} x1="8" y1="3" x2="20" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFB067" />
          <stop offset=".45" stopColor="#FF8A3D" />
          <stop offset="1" stopColor="#FF6A2A" />
        </linearGradient>
      </defs>
      <path
        d="M9 4H30L27.6 10H13.4L12.5 12.6H23L20.6 18.6H10.5L7.4 28H1L9 4Z"
        fill={`url(#${id}-g)`}
        stroke={`url(#${id}-g)`}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ size = 'md' }) {
  const s = {
    sm: { mark: 24, text: 'text-[20px]' },
    md: { mark: 30, text: 'text-[24px]' },
    lg: { mark: 38, text: 'text-[34px]' },
  }[size];
  return (
    <span className="inline-flex items-center gap-2.5">
      <FMark size={s.mark} />
      <span className={`${s.text} font-semibold leading-none tracking-[-0.035em] text-[#f5f5f5]`}>
        Frieday
      </span>
    </span>
  );
}
