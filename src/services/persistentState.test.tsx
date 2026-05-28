import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStoredValue, usePersistentState, writeStoredValue } from "./persistentState";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("persistentState", () => {
  it("reads JSON values and falls back when storage is unavailable or invalid", () => {
    window.localStorage.setItem("mindlinker.test", JSON.stringify({ value: 3 }));

    expect(readStoredValue("mindlinker.test", { value: 0 })).toEqual({ value: 3 });
    expect(readStoredValue("mindlinker.missing", { value: 1 })).toEqual({ value: 1 });

    window.localStorage.setItem("mindlinker.invalid", "{");
    expect(readStoredValue("mindlinker.invalid", { value: 2 })).toEqual({ value: 2 });
  });

  it("writes JSON values and ignores storage write failures", () => {
    writeStoredValue("mindlinker.write", ["a"]);
    expect(window.localStorage.getItem("mindlinker.write")).toBe(JSON.stringify(["a"]));

    vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeStoredValue("mindlinker.write", ["b"])).not.toThrow();
  });

  it("keeps state and localStorage in sync for direct and functional updates", () => {
    window.localStorage.setItem("mindlinker.count", JSON.stringify(1));

    const { result } = renderHook(() => usePersistentState("mindlinker.count", 0));
    expect(result.current[0]).toBe(1);

    act(() => {
      result.current[1](2);
    });
    expect(result.current[0]).toBe(2);
    expect(window.localStorage.getItem("mindlinker.count")).toBe("2");

    act(() => {
      result.current[1]((value) => value + 3);
    });
    expect(result.current[0]).toBe(5);
    expect(window.localStorage.getItem("mindlinker.count")).toBe("5");
  });

  it("normalizes values before storing when a normalize function is provided", () => {
    const { result } = renderHook(() =>
      usePersistentState("mindlinker.names", ["Ada"], {
        normalize: (items) => items.map((item) => item.trim()).filter(Boolean)
      })
    );

    act(() => {
      result.current[1]([" Ada ", "", " Turing "]);
    });

    expect(result.current[0]).toEqual(["Ada", "Turing"]);
    expect(window.localStorage.getItem("mindlinker.names")).toBe(JSON.stringify(["Ada", "Turing"]));
  });

  it("supports transient updates without writing to localStorage", () => {
    const { result } = renderHook(() => usePersistentState("mindlinker.transient", "stored"));

    act(() => {
      result.current[2]("visible only");
    });

    expect(result.current[0]).toBe("visible only");
    expect(window.localStorage.getItem("mindlinker.transient")).toBeNull();

    act(() => {
      result.current[1]((value) => `${value} persisted`);
    });

    expect(result.current[0]).toBe("visible only persisted");
    expect(window.localStorage.getItem("mindlinker.transient")).toBe(JSON.stringify("visible only persisted"));
  });
});
