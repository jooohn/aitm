import { describe, expect, it } from "vitest";
import { DomainError, NotFoundError, ValidationError } from "./errors";
import { type DomainResult, err, ok } from "./result";

describe("ok", () => {
  it("creates a success result", () => {
    const result = ok(42);
    expect(result.unwrap()).toBe(42);
  });
});

describe("err", () => {
  it("creates a failure result", () => {
    const error = new NotFoundError("Session", "123");
    const result = err(error);
    expect(() => result.unwrap()).toThrow(error);
  });
});

describe("map", () => {
  it("transforms the value of an ok result", () => {
    const result = ok(5);
    const mapped = result.map((v) => v * 2);
    expect(mapped.unwrap()).toBe(10);
  });

  it("passes through an err result unchanged", () => {
    const error = new NotFoundError("Session");
    const result = err(error) as DomainResult<number, NotFoundError>;
    const mapped = result.map((v) => v * 2);
    expect(() => mapped.unwrap()).toThrow(error);
  });
});

describe("flatMap", () => {
  it("chains ok results", () => {
    const result = ok(10);
    const chained = result.flatMap((v) =>
      v > 0 ? ok(v.toString()) : err(new ValidationError("Must be positive")),
    );
    expect(chained.unwrap()).toBe("10");
  });

  it("chains to err when the function returns err", () => {
    const result = ok(-1);
    const chained = result.flatMap((v) =>
      v > 0 ? ok(v.toString()) : err(new ValidationError("Must be positive")),
    );
    expect(() => chained.unwrap()).toThrow(ValidationError);
  });

  it("passes through an err result without calling the function", () => {
    const error = new NotFoundError("Session");
    const result = err(error) as DomainResult<number, DomainError>;
    const chained = result.flatMap((v) => ok(v.toString()));
    expect(() => chained.unwrap()).toThrow(error);
  });
});

describe("flatMapAsync", () => {
  it("chains ok results asynchronously", async () => {
    const result = ok(10);
    const chained = await result.flatMapAsync(async (v) => ok(v * 3));
    expect(chained.unwrap()).toBe(30);
  });

  it("chains to err when the async function returns err", async () => {
    const result = ok(-1);
    const chained = await result.flatMapAsync(async (v) =>
      v > 0 ? ok(v) : err(new ValidationError("Negative")),
    );
    expect(() => chained.unwrap()).toThrow(ValidationError);
  });

  it("passes through an err result without calling the function", async () => {
    const error = new NotFoundError("Session");
    const result = err(error) as DomainResult<number, DomainError>;
    const chained = await result.flatMapAsync(async (v) => ok(v * 3));
    expect(() => chained.unwrap()).toThrow(error);
  });
});

describe("match", () => {
  it("calls ok handler for success results", () => {
    const result = ok(42);
    const value = result.match({
      ok: (v) => `value: ${v}`,
      err: (e) => `error: ${e}`,
    });
    expect(value).toBe("value: 42");
  });

  it("calls err handler for error results", () => {
    const error = new NotFoundError("Session", "123");
    const result = err(error) as DomainResult<number, NotFoundError>;
    const value = result.match({
      ok: (v) => `value: ${v}`,
      err: (e) => e.message,
    });
    expect(value).toBe("Session not found: 123");
  });
});

describe("unwrap", () => {
  it("returns the value from an ok result", () => {
    expect(ok(42).unwrap()).toBe(42);
  });

  it("throws the error from an err result", () => {
    const error = new NotFoundError("Session", "123");
    const result = err(error) as DomainResult<number, NotFoundError>;
    expect(() => result.unwrap()).toThrow(error);
  });
});
