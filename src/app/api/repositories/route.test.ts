import { mkdirSync } from "fs";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET, POST } from "./route";

function makeFakeGitRepo(): string {
	const dir = join(
		tmpdir(),
		`aitm-test-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(join(dir, ".git"), { recursive: true });
	return dir;
}

function postRequest(body: unknown): NextRequest {
	return new NextRequest("http://localhost/api/repositories", {
		method: "POST",
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
	});
}

beforeEach(() => {
	db.prepare("DELETE FROM repositories").run();
});

describe("POST /api/repositories", () => {
	it("returns 201 with the created repo on success", async () => {
		const path = makeFakeGitRepo();
		const res = await POST(postRequest({ path }));
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.path).toBe(path);
	});

	it("returns 409 for a duplicate path", async () => {
		const path = makeFakeGitRepo();
		await POST(postRequest({ path }));
		const res = await POST(postRequest({ path }));
		expect(res.status).toBe(409);
	});

	it("returns 422 for a non-existent path", async () => {
		const res = await POST(postRequest({ path: "/no/such/path" }));
		expect(res.status).toBe(422);
	});

	it("returns 422 for a path that is not a git repo", async () => {
		const dir = join(
			tmpdir(),
			`aitm-test-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(dir, { recursive: true });
		const res = await POST(postRequest({ path: dir }));
		expect(res.status).toBe(422);
	});
});

describe("GET /api/repositories", () => {
	it("returns 200 with an empty array initially", async () => {
		const res = await GET();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	it("returns registered repos", async () => {
		const path = makeFakeGitRepo();
		await POST(postRequest({ path }));
		const res = await GET();
		const body = await res.json();
		expect(body).toHaveLength(1);
		expect(body[0].path).toBe(path);
	});
});
