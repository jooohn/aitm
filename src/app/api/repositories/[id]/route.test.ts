import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { registerRepository } from "@/lib/repositories";
import { DELETE } from "./route";

function makeFakeGitRepo(): string {
  const dir = join(tmpdir(), `aitm-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function deleteRequest(id: number): [NextRequest, { params: Promise<{ id: string }> }] {
  const req = new NextRequest(`http://localhost/api/repositories/${id}`, { method: "DELETE" });
  const params = Promise.resolve({ id: String(id) });
  return [req, { params }];
}

beforeEach(() => {
  db.prepare("DELETE FROM repositories").run();
});

describe("DELETE /api/repositories/:id", () => {
  it("returns 200 on successful removal", async () => {
    const { id } = registerRepository({ path: makeFakeGitRepo() });
    const res = await DELETE(...deleteRequest(id));
    expect(res.status).toBe(200);
  });

  it("returns 404 for a non-existent id", async () => {
    const res = await DELETE(...deleteRequest(9999));
    expect(res.status).toBe(404);
  });
});
