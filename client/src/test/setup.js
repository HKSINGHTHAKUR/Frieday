import { vi } from 'vitest';

// jsdom lacks ResizeObserver; Recharts ResponsiveContainer requires it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub;

// jsdom lacks scrollTo
globalThis.scrollTo = globalThis.scrollTo || vi.fn();

// Mirror the real document context from client/index.html so axe rules
// (document-title, html-has-lang) validate the app's actual context.
document.documentElement.lang = 'en';
document.title = 'Frieday';
