import { describe, expect, it } from "vitest";
import { DomainError, NotFoundError, ValidationError } from "./errors";
import {
  type DomainResult,
  err,
  flatMapResult,
  flatMapResultAsync,
  mapResult,
  ok,
  unwrap,
} from "./result";

describe("ok", () => {
  it("creates a success result", () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });
});

describe("err", () => {
  it("creates a failure result", () => {
    const error = new NotFoundError("Session", "123");
    const result = err(error);
    expect(result).toEqual({ ok: false, error });
  });
});

describe("mapResult", () => {
  it("transforms the value of an ok result", () => {
    const result = ok(5);
    const mapped = mapResult(result, (v) => v * 2);
    expect(mapped).toEqual({ ok: true, value: 10 });
  });

  it("passes through an err result unchanged", () => {
    const error = new NotFoundError("Session");
    const result = err(error) as DomainResult<number, NotFoundError>;
    const mapped = mapResult(result, (v) => v * 2);
    expect(mapped).toEqual({ ok: false, error });
  });
});

describe("flatMapResult", () => {
  it("chains ok results", () => {
    const result = ok(10);
    const chained = flatMapResult(result, (v) =>
      v > 0 ? ok(v.toString()) : err(new ValidationError("Must be positive")),
    );
    expect(chained).toEqual({ ok: true, value: "10" });
  });

  it("chains to err when the function returns err", () => {
    const result = ok(-1);
    const chained = flatMapResult(result, (v) =>
      v > 0 ? ok(v.toString()) : err(new ValidationError("Must be positive")),
    );
    expect(chained.ok).toBe(false);
    if (!chained.ok) {
      expect(chained.error).toBeInstanceOf(ValidationError);
    }
  });

  it("passes through an err result without calling the function", () => {
    const error = new NotFoundError("Session");
    const result = err(error) as DomainResult<number, DomainError>;
    const fn = (v: number): DomainResult<string, DomainError> =>
      ok(v.toString());
    const chained = flatMapResult(result, fn);
    expect(chained).toEqual({ ok: false, error });
  });
});

describe("flatMapResultAsync", () => {
  it("chains ok results asynchronously", async () => {
    const result = ok(10);
    const chained = await flatMapResultAsync(result, async (v) => ok(v * 3));
    expect(chained).toEqual({ ok: true, value: 30 });
  });

  it("chains to err when the async function returns err", async () => {
    const result = ok(-1);
    const chained = await flatMapResultAsync(result, async (v) =>
      v > 0 ? ok(v) : err(new ValidationError("Negative")),
    );
    expect(chained.ok).toBe(false);
  });

  it("passes through an err result without calling the function", async () => {
    const error = new NotFoundError("Session");
    const result = err(error) as DomainResult<number, DomainError>;
    const chained = await flatMapResultAsync(result, async (v) => ok(v * 3));
    expect(chained).toEqual({ ok: false, error });
  });
});

describe("unwrap", () => {
  it("returns the value from an ok result", () => {
    const result = ok(42);
    expect(unwrap(result)).toBe(42);
  });

  it("throws the error from an err result", () => {
    const error = new NotFoundError("Session", "123");
    const result = err(error) as DomainResult<number, NotFoundError>;
    expect(() => unwrap(result)).toThrow(error);
  });
});
