import { describe, expect, it } from "vitest";
import {
  ConflictError,
  DomainError,
  isDomainError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "./errors";

describe("DomainError", () => {
  it("stores message and statusCode", () => {
    const err = new DomainError("something broke", 418);
    expect(err.message).toBe("something broke");
    expect(err.statusCode).toBe(418);
    expect(err.name).toBe("DomainError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("NotFoundError", () => {
  it("formats message with entity and id", () => {
    const err = new NotFoundError("Workflow", "my-flow");
    expect(err.message).toBe("Workflow not found: my-flow");
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe("NotFoundError");
  });

  it("formats message with entity only", () => {
    const err = new NotFoundError("Workflow run");
    expect(err.message).toBe("Workflow run not found");
    expect(err.statusCode).toBe(404);
  });

  it("is an instance of DomainError and Error", () => {
    const err = new NotFoundError("Chat", "abc");
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("ConflictError", () => {
  it("returns 409 with the given message", () => {
    const err = new ConflictError("Chat abc is already running");
    expect(err.message).toBe("Chat abc is already running");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("ConflictError");
  });
});

describe("ValidationError", () => {
  it("returns 422 with the given message", () => {
    const err = new ValidationError("Missing required input: name");
    expect(err.message).toBe("Missing required input: name");
    expect(err.statusCode).toBe(422);
    expect(err.name).toBe("ValidationError");
  });
});

describe("ServiceUnavailableError", () => {
  it("returns 503 with the given message", () => {
    const err = new ServiceUnavailableError(
      "git-worktree-runner is not installed",
    );
    expect(err.message).toBe("git-worktree-runner is not installed");
    expect(err.statusCode).toBe(503);
    expect(err.name).toBe("ServiceUnavailableError");
  });
});

describe("isDomainError", () => {
  it("returns true for DomainError instances", () => {
    expect(isDomainError(new NotFoundError("X"))).toBe(true);
    expect(isDomainError(new ConflictError("X"))).toBe(true);
    expect(isDomainError(new ValidationError("X"))).toBe(true);
    expect(isDomainError(new ServiceUnavailableError("X"))).toBe(true);
  });

  it("returns false for plain Error", () => {
    expect(isDomainError(new Error("oops"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isDomainError("string")).toBe(false);
    expect(isDomainError(null)).toBe(false);
    expect(isDomainError(undefined)).toBe(false);
  });
});
