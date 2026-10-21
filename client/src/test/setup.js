import { vi } from 'vitest';

// jsdom lacks ResizeObserver; Recharts ResponsiveContainer requires it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub;

// jsdom lacks matchMedia. The login screen reads it for the reduced-motion
// query and for the stacked/desktop composition breakpoint, so a stub that
// reports "no match" is required for those components to render.
if (!globalThis.window.matchMedia) {
  globalThis.window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
}

// jsdom lacks IntersectionObserver (the WebGL robot canvas uses it to pause
// rendering when the canvas scrolls out of view).
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

// jsdom lacks scrollTo
globalThis.scrollTo = globalThis.scrollTo || vi.fn();

// Mirror the real document context from client/index.html so axe rules
// (document-title, html-has-lang) validate the app's actual context.
document.documentElement.lang = 'en';
document.title = 'Frieday';
