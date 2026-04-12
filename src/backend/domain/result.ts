import type { DomainError } from "./errors";

interface Ok<T> {
  readonly ok: true;
  readonly value: T;
  readonly error?: undefined;
}

interface Err<E> {
  readonly ok: false;
  readonly value?: undefined;
  readonly error: E;
}

type ResultState<T, E> = Ok<T> | Err<E>;

export class DomainResult<T, E = DomainError> {
  readonly ok: boolean;
  readonly value: T | undefined;
  readonly error: E | undefined;

  private constructor(state: ResultState<T, E>) {
    this.ok = state.ok;
    this.value = state.ok ? state.value : undefined;
    this.error = state.ok ? undefined : state.error;
  }

  static ok<T>(value: T): DomainResult<T, never> {
    return new DomainResult<T, never>({ ok: true, value });
  }

  static err<E>(error: E): DomainResult<never, E> {
    return new DomainResult<never, E>({ ok: false, error });
  }

  map<U>(f: (v: T) => U): DomainResult<U, E> {
    if (this.ok) return DomainResult.ok(f(this.value as T));
    return DomainResult.err(this.error as E);
  }

  flatMap<U>(f: (v: T) => DomainResult<U, E>): DomainResult<U, E> {
    if (this.ok) return f(this.value as T);
    return DomainResult.err(this.error as E);
  }

  async flatMapAsync<U>(
    f: (v: T) => Promise<DomainResult<U, E>>,
  ): Promise<DomainResult<U, E>> {
    if (this.ok) return f(this.value as T);
    return DomainResult.err(this.error as E);
  }

  fold<U>(handlers: { ok: (v: T) => U; err: (e: E) => U }): U {
    if (this.ok) return handlers.ok(this.value as T);
    return handlers.err(this.error as E);
  }
}

export function ok<T>(value: T): DomainResult<T, never> {
  return DomainResult.ok(value);
}

export function err<E>(error: E): DomainResult<never, E> {
  return DomainResult.err(error);
}
