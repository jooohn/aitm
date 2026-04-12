import type { DomainResult } from "./result";

export function unwrapForTest<T, E>(result: DomainResult<T, E>): T {
  return result.fold({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
}
