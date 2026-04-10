export function parseJson<T>(value: string | null, fallback: T): T;
export function parseJson(value: string | null): unknown;
export function parseJson<T>(value: string | null, fallback?: T): T | unknown {
  if (value === null) return fallback ?? null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback ?? null;
  }
}
