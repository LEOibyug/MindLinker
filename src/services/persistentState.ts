import { useState } from "react";

type StateUpdater<T> = T | ((value: T) => T);

type PersistentStateOptions<T> = {
  normalize?: (value: T) => T;
};

export const readStoredValue = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const writeStoredValue = <T,>(key: string, value: T) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[MindLinker] 无法写入本地存储 ${key}`, error);
  }
};

export const usePersistentState = <T,>(
  key: string,
  fallback: T,
  options: PersistentStateOptions<T> = {}
) => {
  const [state, setState] = useState<T>(() => {
    const storedValue = readStoredValue(key, fallback);
    return options.normalize ? options.normalize(storedValue) : storedValue;
  });

  const setPersistentState = (updater: StateUpdater<T>) => {
    setState((currentValue) => {
      const nextValue = typeof updater === "function" ? (updater as (value: T) => T)(currentValue) : updater;
      const normalizedValue = options.normalize ? options.normalize(nextValue) : nextValue;
      writeStoredValue(key, normalizedValue);
      return normalizedValue;
    });
  };

  const setTransientState = (updater: StateUpdater<T>) => {
    setState((currentValue) => {
      const nextValue = typeof updater === "function" ? (updater as (value: T) => T)(currentValue) : updater;
      return options.normalize ? options.normalize(nextValue) : nextValue;
    });
  };

  return [state, setPersistentState, setTransientState] as const;
};
