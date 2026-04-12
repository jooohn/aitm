import { describe, expect, it } from "vitest";
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/backend/domain/errors";
import { err, ok } from "@/backend/domain/result";
import { domainResultToResponse, errorResponse } from "./error-response";

describe("errorResponse", () => {
  it("maps NotFoundError to 404", async () => {
    const res = errorResponse(new NotFoundError("Chat", "abc"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Chat not found: abc" });
  });

  it("maps ConflictError to 409", async () => {
    const res = errorResponse(new ConflictError("Chat abc is already running"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Chat abc is already running" });
  });

  it("maps ValidationError to 422", async () => {
    const res = errorResponse(
      new ValidationError("Missing required input: name"),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Missing required input: name" });
  });

  it("maps ServiceUnavailableError to 503", async () => {
    const res = errorResponse(new ServiceUnavailableError("service down"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "service down" });
  });

  it("maps unknown Error to 500 with generic message", async () => {
    const res = errorResponse(new Error("unexpected internal detail"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });

  it("maps non-Error values to 500 with generic message", async () => {
    const res = errorResponse("some string");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});

describe("domainResultToResponse", () => {
  it("converts an ok DomainResult to a 200 JSON response", async () => {
    const response = domainResultToResponse(ok({ name: "test" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "test" });
  });

  it("converts a NotFoundError to a 404 response", async () => {
    const error = new NotFoundError("Session", "abc");
    const response = domainResultToResponse(err(error));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Session not found: abc" });
  });

  it("converts a ValidationError to a 422 response", async () => {
    const error = new ValidationError("Invalid input");
    const response = domainResultToResponse(err(error));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Invalid input" });
  });
});
