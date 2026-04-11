import type { DomainError } from "./errors";

export type DomainResult<T, E = DomainError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): DomainResult<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): DomainResult<never, E> {
  return { ok: false, error };
}

export function mapResult<T, U, E>(
  result: DomainResult<T, E>,
  f: (v: T) => U,
): DomainResult<U, E> {
  if (result.ok) return ok(f(result.value));
  return result;
}

export function flatMapResult<T, U, E>(
  result: DomainResult<T, E>,
  f: (v: T) => DomainResult<U, E>,
): DomainResult<U, E> {
  if (result.ok) return f(result.value);
  return result;
}

export function unwrap<T>(result: DomainResult<T, unknown>): T {
  if (result.ok) return result.value;
  throw result.error;
}

export async function flatMapResultAsync<T, U, E>(
  result: DomainResult<T, E>,
  f: (v: T) => Promise<DomainResult<U, E>>,
): Promise<DomainResult<U, E>> {
  if (result.ok) return f(result.value);
  return result;
}
