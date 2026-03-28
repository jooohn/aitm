import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { registerRepository } from "@/lib/repositories";
import { GET } from "./route";

function makeFakeGitRepo(): string {
  const dir = join(tmpdir(), `aitm-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function validateRequest(id: number): [NextRequest, { params: Promise<{ id: string }> }] {
  const req = new NextRequest(`http://localhost/api/repositories/${id}/validate`);
  const params = Promise.resolve({ id: String(id) });
  return [req, { params }];
}

beforeEach(() => {
  db.prepare("DELETE FROM repositories").run();
});

describe("GET /api/repositories/:id/validate", () => {
  it("returns 200 with valid:true for a healthy repo", async () => {
    const { id } = registerRepository({ path: makeFakeGitRepo() });
    const res = await GET(...validateRequest(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true });
  });

  it("returns 404 for a non-existent id", async () => {
    const res = await GET(...validateRequest(9999));
    expect(res.status).toBe(404);
  });
});
