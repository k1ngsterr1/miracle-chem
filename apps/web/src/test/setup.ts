import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([
      {
        target,
        contentRect: { x: 0, y: 0, width: 800, height: 320, top: 0, right: 800, bottom: 320, left: 0, toJSON: () => ({}) },
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      },
    ], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;
