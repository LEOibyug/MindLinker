import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    const entry = {
      target,
      contentRect: {
        x: 0,
        y: 0,
        width: 140,
        height: 58,
        top: 0,
        right: 140,
        bottom: 58,
        left: 0,
        toJSON: () => ({})
      }
    } as ResizeObserverEntry;
    this.callback([entry], this);
  }

  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverMock;
