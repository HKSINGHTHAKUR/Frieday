/**
 * CSS atmosphere under the WebGL canvas — also the fallback when WebGL is
 * unavailable, so the page keeps its look either way.
 * Ported from the supplied "Frieday GitHub Authentication Design" export.
 */

export function BackdropBase() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        background: [
          'radial-gradient(38% 48% at 34% 46%, rgb(255 106 42 / 0.22), transparent 70%)',
          'radial-gradient(40% 60% at 0% 70%, rgb(120 24 10 / 0.35), transparent 70%)',
          'linear-gradient(180deg, #0a0b0d, #08090b 60%, #0b0907)',
        ].join(','),
      }}
    />
  );
}

/** Additive warm light above the canvas, below the UI. */
export function BackdropGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 mix-blend-screen">
      <div
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(38% 42% at 100% 100%, rgb(255 106 42 / 0.26), transparent 70%)',
            'radial-gradient(30% 40% at 80% 46%, rgb(255 130 60 / 0.06), transparent 70%)',
          ].join(','),
        }}
      />
      {/* Vignette */}
      <div
        className="absolute inset-0 mix-blend-normal"
        style={{ background: 'radial-gradient(120% 90% at 40% 45%, transparent 55%, rgb(0 0 0 / 0.55))' }}
      />
    </div>
  );
}
