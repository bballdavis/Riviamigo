import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Iconify schedules DOM updates for remote icon data. In jsdom those timers
// can outlive a test environment and call React after `window` is torn down.
vi.mock('@iconify/react', () => ({
  Icon: () => null,
  InlineIcon: () => null,
}));

// Stub canvas context so uPlot doesn't throw in jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
HTMLCanvasElement.prototype.getContext = (() => ({
  clearRect: () => {},
  fillRect: () => {},
  strokeRect: () => {},
  beginPath: () => {},
  closePath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  fill: () => {},
  arc: () => {},
  clip: () => {},
  save: () => {},
  restore: () => {},
  translate: () => {},
  scale: () => {},
  rotate: () => {},
  setTransform: () => {},
  transform: () => {},
  drawImage: () => {},
  fillText: () => {},
  strokeText: () => {},
  measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
  createLinearGradient: () => ({ addColorStop: () => {} }),
  createRadialGradient: () => ({ addColorStop: () => {} }),
  createPattern: () => null,
  getImageData: () => ({ data: new Uint8ClampedArray(), width: 0, height: 0 }),
  putImageData: () => {},
  canvas: { width: 0, height: 0 },
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textAlign: 'left' as CanvasTextAlign,
  textBaseline: 'alphabetic' as CanvasTextBaseline,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
  lineCap: 'butt' as CanvasLineCap,
  lineJoin: 'miter' as CanvasLineJoin,
  miterLimit: 10,
  shadowBlur: 0,
  shadowColor: '',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  setLineDash: () => {},
  getLineDash: () => [],
  lineDashOffset: 0,
  direction: 'ltr' as CanvasDirection,
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// Stub Path2D so uPlot's async draw microtasks don't throw in jsdom
if (!globalThis.Path2D) {
  (globalThis as unknown as Record<string, unknown>).Path2D = class Path2D {
    moveTo() {}
    lineTo() {}
    arc() {}
    rect() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    closePath() {}
    addPath() {}
  };
}

// Stub ResizeObserver (Recharts needs it in jsdom)
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Stub matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
