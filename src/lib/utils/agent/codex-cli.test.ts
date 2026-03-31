import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
const createInterfaceMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("node:readline", () => ({
  createInterface: createInterfaceMock,
}));

describe("codexCLI", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("passes workspace-write via the sandbox flag", async () => {
    const closeHandlers: Array<(code: number | null) => void> = [];

    createInterfaceMock.mockReturnValue({
      close: vi.fn(),
      [Symbol.asyncIterator]: async function* () {},
    });

    spawnMock.mockImplementation(() => ({
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      },
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event: string, handler: (value: number | null) => void) => {
        if (event === "close") {
          closeHandlers.push(handler);
          queueMicrotask(() => handler(0));
        }
        if (event === "error") {
          return;
        }
      }),
      kill: vi.fn(() => {
        for (const handler of closeHandlers) {
          handler(0);
        }
      }),
      killed: false,
    }));

    const { codexCLI } = await import("./codex-cli");

    const iterator = codexCLI.query({
      sessionId: "session-1",
      prompt: "prompt",
      cwd: "/tmp",
      command: "codex",
      permissionMode: "acceptEdits",
      abortController: new AbortController(),
      canUseTool: async () => ({ behavior: "allow", updatedInput: {} }),
      outputFormat: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            transition: { type: "string", enum: ["implement", "failure"] },
          },
          required: ["transition"],
          additionalProperties: false,
        },
      },
    });

    for await (const _message of iterator) {
      // Drain the iterator so the spawn arguments are exercised.
    }

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const args = spawnMock.mock.calls[0][1] as string[];
    const sandboxIndex = args.indexOf("--sandbox");
    expect(sandboxIndex).toBeGreaterThanOrEqual(0);
    expect(args[sandboxIndex + 1]).toBe("workspace-write");
  });
});
