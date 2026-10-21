import { useEffect, useId, useRef, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';
import { computeRobotLayout, isStacked } from './robot/layout.js';
import { BranchIcon, LinesIcon, NodesIcon, SparkleIcon } from './icons.jsx';

/**
 * OrbitalSystem — the restrained orbital rings, drifting particles and
 * callout chips that surround the robot.
 *
 * Pure SVG with SMIL animation (no canvas, no WebGL), so it stays crisp and
 * costs almost nothing. Ported from the supplied "Frieday GitHub Authentication
 * Design" export.
 */

/**
 * @typedef {{ rx: number, ry: number, rot: number, opacity: number, dash?: string, spin?: number, particle?: number }} Orbit
 */

/** Orbit radii are multiples of the head height. */
const ORBITS = [
  { rx: 0.72, ry: 0.62, rot: -12, opacity: 0.5, particle: 22 },
  { rx: 0.95, ry: 0.8, rot: -8, opacity: 0.34, particle: 34 },
  { rx: 1.28, ry: 1.0, rot: -20, opacity: 0.22, dash: '1.5 7', spin: 180 },
];

const CALLOUTS = [
  { lines: ['Understand', 'Your Codebase'], icon: SparkleIcon, orbit: 1, angle: -118, anchor: 'br' },
  { lines: ['Extract', 'Key Themes'], icon: LinesIcon, orbit: 0, angle: 186, anchor: 'r' },
  { lines: ['Turn Commits', 'into Insights'], icon: NodesIcon, orbit: 1, angle: 150, anchor: 'tr' },
  { lines: ['See the', 'Bigger Picture'], icon: BranchIcon, orbit: 0, angle: 30, anchor: 'l' },
];

const BOX_W = 178;
const BOX_H = 58;
const EDGE = 10;

/**
 * A point on an orbit, rotated by the orbit's own tilt.
 * @param {Orbit} o
 * @param {number} size head height in pixels
 * @param {number} angleDeg
 */
function pointOnOrbit(o, size, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const r = (o.rot * Math.PI) / 180;
  const x = o.rx * size * Math.cos(a);
  const y = o.ry * size * Math.sin(a);
  return {
    x: x * Math.cos(r) - y * Math.sin(r),
    y: x * Math.sin(r) + y * Math.cos(r),
  };
}

function ellipsePath(rx, ry) {
  return `M ${-rx} 0 A ${rx} ${ry} 0 1 0 ${rx} 0 A ${rx} ${ry} 0 1 0 ${-rx} 0`;
}

export default function OrbitalSystem({ stageRef }) {
  const [box, setBox] = useState(null);
  const svgRef = useRef(null);
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, '');

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      // Callouts may bleed into the page gutter, but never toward the auth panel.
      setBox({
        w: r.width,
        h: r.height,
        stacked: isStacked(),
        bleedL: Math.max(0, r.left),
        bleedR: Math.min(24, Math.max(0, vw - r.right)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageRef]);

  // SMIL animations ignore CSS play-state; pause them explicitly when the tab
  // is hidden. The SVG animation clock is driven by the browser's compositor,
  // which a hidden tab throttles on its own, but pausing explicitly keeps the
  // phase from advancing while the tab is in the background.
  useEffect(() => {
    const sync = () => {
      const svg = svgRef.current;
      // Safari < 12 and jsdom do not implement the SMIL animation controls.
      if (!svg || typeof svg.pauseAnimations !== 'function') return;
      if (document.visibilityState === 'visible') svg.unpauseAnimations();
      else svg.pauseAnimations();
    };
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  if (!box) return null;
  const { cx, cy, size } = computeRobotLayout(box.w, box.h, box.stacked);

  const callouts = CALLOUTS.map((c, i) => {
    const p = pointOnOrbit(ORBITS[c.orbit], size, c.angle);
    const nx = cx + p.x;
    const ny = cy + p.y;
    const left = c.anchor === 'l' ? nx : nx - BOX_W;
    const top = c.anchor === 'br' ? ny - BOX_H : c.anchor === 'tr' ? ny : ny - BOX_H / 2;
    const minX = EDGE - box.bleedL;
    const maxX = box.w + box.bleedR - EDGE - BOX_W;
    const cl = Math.min(Math.max(left, minX), maxX);
    const ct = Math.min(Math.max(top, EDGE), box.h - EDGE - BOX_H);
    const shift = Math.abs(cl - left) + Math.abs(ct - top);
    // Never let a callout cover the helmet.
    const hx0 = cx - size * 0.44;
    const hx1 = cx + size * 0.5;
    const hy0 = cy - size * 0.56;
    const hy1 = cy + size * 0.5;
    const overlapsHead = cl < hx1 && cl + BOX_W > hx0 && ct < hy1 && ct + BOX_H > hy0;
    const fits = maxX >= minX && shift <= 72 && !overlapsHead;
    // Closest point of the box to the orbit node, for the connector line.
    const jx = Math.min(Math.max(nx, cl), cl + BOX_W);
    const jy = Math.min(Math.max(ny, ct), ct + BOX_H);
    return { ...c, nx, ny, left: cl, top: ct, jx, jy, fits, i };
  });

  return (
    <div className="fd-auth-decor pointer-events-none absolute inset-0" aria-hidden>
      <svg ref={svgRef} width={box.w} height={box.h} className="absolute inset-0 overflow-visible">
        <defs>
          <radialGradient id={`${uid}-node`}>
            <stop offset="0" stopColor="#FFD3A1" />
            <stop offset=".35" stopColor="#FF8A3D" stopOpacity=".9" />
            <stop offset="1" stopColor="#FF6A2A" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${uid}-stroke`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FF9B45" stopOpacity=".9" />
            <stop offset=".5" stopColor="#FF6A2A" stopOpacity=".35" />
            <stop offset="1" stopColor="#FF9B45" stopOpacity=".8" />
          </linearGradient>
          {/* Hide the orbit segments that pass behind the helmet. */}
          <radialGradient id={`${uid}-hole`}>
            <stop offset=".78" stopColor="#000" />
            <stop offset="1" stopColor="#fff" />
          </radialGradient>
          <mask
            id={`${uid}-mask`}
            maskUnits="userSpaceOnUse"
            x={-box.w}
            y={-box.h}
            width={box.w * 3}
            height={box.h * 3}
          >
            <rect x={-box.w} y={-box.h} width={box.w * 3} height={box.h * 3} fill="#fff" />
            <ellipse
              cx={cx + size * 0.04}
              cy={cy - size * 0.02}
              rx={size * 0.5}
              ry={size * 0.6}
              fill={`url(#${uid}-hole)`}
            />
          </mask>
        </defs>

        <g mask={`url(#${uid}-mask)`}>
          {ORBITS.map((o, i) => {
            const rx = o.rx * size;
            const ry = o.ry * size;
            return (
              <g key={i} transform={`translate(${cx} ${cy}) rotate(${o.rot})`}>
                <g>
                  {o.spin && !reduced && (
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0"
                      to="360"
                      dur={`${o.spin}s`}
                      repeatCount="indefinite"
                    />
                  )}
                  <ellipse
                    rx={rx}
                    ry={ry}
                    fill="none"
                    stroke={`url(#${uid}-stroke)`}
                    strokeOpacity={o.opacity}
                    strokeWidth={o.dash ? 1.2 : 1}
                    strokeDasharray={o.dash}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
                {o.particle && !reduced && (
                  <circle r={5} fill={`url(#${uid}-node)`}>
                    <animateMotion
                      dur={`${o.particle}s`}
                      repeatCount="indefinite"
                      path={ellipsePath(rx, ry)}
                    />
                  </circle>
                )}
              </g>
            );
          })}

          {/* Sparse static nodes on the orbits */}
          {[
            [0, -60],
            [1, -30],
            [2, -150],
            [2, 40],
            [1, 100],
          ].map(([oi, a], k) => {
            const p = pointOnOrbit(ORBITS[oi], size, a);
            return <circle key={k} cx={cx + p.x} cy={cy + p.y} r={2} fill="#FF9B45" opacity={0.7} />;
          })}
        </g>

        {callouts
          .filter((c) => c.fits)
          .map((c) => (
            <g key={c.i}>
              {Math.hypot(c.jx - c.nx, c.jy - c.ny) > 4 && (
                <line
                  x1={c.nx}
                  y1={c.ny}
                  x2={c.jx}
                  y2={c.jy}
                  stroke="#FF9B45"
                  strokeOpacity={0.45}
                  strokeWidth={1}
                />
              )}
              <circle cx={c.nx} cy={c.ny} r={9} fill={`url(#${uid}-node)`}>
                {!reduced && (
                  <animate
                    attributeName="opacity"
                    values=".55;1;.55"
                    dur={`${4 + c.i * 0.7}s`}
                    repeatCount="indefinite"
                  />
                )}
              </circle>
              <circle cx={c.nx} cy={c.ny} r={2.2} fill="#FFE2C2" />
            </g>
          ))}
      </svg>

      {callouts
        .filter((c) => c.fits)
        .map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.i}
              data-callout
              className="fd-auth-rise absolute"
              style={{
                left: c.left,
                top: c.top,
                width: BOX_W,
                height: BOX_H,
                animationDelay: `${520 + c.i * 110}ms`,
              }}
            >
              <div
                className="fd-auth-chip flex h-full items-center gap-3 rounded-[11px] px-3.5"
                style={{ transform: `rotate(${c.anchor === 'l' ? -4 : -3}deg)` }}
              >
                <Icon className="size-[22px] shrink-0 text-[#ff9b45] drop-shadow-[0_0_6px_rgb(255_106_42/0.6)]" />
                <span className="text-[13px] leading-[1.25] text-[#f5f5f5]">
                  {c.lines[0]}
                  <br />
                  {c.lines[1]}
                </span>
              </div>
            </div>
          );
        })}
    </div>
  );
}
