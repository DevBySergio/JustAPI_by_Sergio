type Listener = (...args: unknown[]) => void;

const listeners = new Map<string, Listener[]>();

export function on(event: string, fn: Listener) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event)!.push(fn);
  return () => {
    const arr = listeners.get(event);
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    }
  };
}

export function emit(event: string, ...args: unknown[]) {
  for (const fn of listeners.get(event) || []) {
    fn(...args);
  }
}
