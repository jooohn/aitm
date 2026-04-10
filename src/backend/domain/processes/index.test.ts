import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/backend/infra/event-bus";
import { ProcessService } from "./index";

describe("ProcessService", () => {
  let eventBus: EventBus;
  let service: ProcessService;

  beforeEach(() => {
    eventBus = new EventBus();
    service = new ProcessService(eventBus);
  });

  afterEach(async () => {
    await service.stopAll();
  });

  describe("startProcess", () => {
    it("starts a process and returns its info with running status", async () => {
      const process = service.startProcess(
        "/tmp",
        "feature/test",
        'echo "hello"',
      );

      expect(process.id).toBeDefined();
      expect(process.worktree_branch).toBe("feature/test");
      expect(process.command).toBe('echo "hello"');
      expect(process.status).toBe("running");
      expect(process.pid).toBeGreaterThan(0);
      expect(process.created_at).toBeDefined();
      expect(process.stopped_at).toBeNull();
      expect(process.exit_code).toBeNull();
    });

    it("emits process.status-changed event on start with repository context", () => {
      const listener = vi.fn();
      eventBus.on("process.status-changed", listener);

      service.startProcess(
        "/tmp",
        "feature/test",
        "echo hello",
        "my-org",
        "my-repo",
      );

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "running",
          worktreeBranch: "feature/test",
          repositoryOrganization: "my-org",
          repositoryName: "my-repo",
        }),
      );
    });

    it("uses worktree path as cwd for the spawned process", async () => {
      const proc = service.startProcess("/tmp", "feature/test", "pwd");
      expect(proc.status).toBe("running");

      // Wait for output
      let output: string[] = [];
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        output = service.getOutput(proc.id);
        if (output.length > 0) break;
      }
      // macOS resolves /tmp to /private/tmp
      expect(
        output.some(
          (line) => line.includes("/tmp") || line.includes("/private/tmp"),
        ),
      ).toBe(true);
    });
  });

  describe("stopProcess", () => {
    it("stops a running process", async () => {
      const proc = service.startProcess("/tmp", "feature/test", "sleep 60");

      const stopped = await service.stopProcess(proc.id);

      expect(stopped.status).toBe("stopped");
      expect(stopped.stopped_at).toBeDefined();
    });

    it("emits process.status-changed event on stop", async () => {
      const proc = service.startProcess("/tmp", "feature/test", "sleep 60");

      const listener = vi.fn();
      eventBus.on("process.status-changed", listener);

      await service.stopProcess(proc.id);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          processId: proc.id,
          status: "stopped",
        }),
      );
    });

    it("throws when process is not found", async () => {
      await expect(service.stopProcess("nonexistent")).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("getProcess", () => {
    it("returns process by id", () => {
      const proc = service.startProcess("/tmp", "feature/test", "sleep 60");

      const result = service.getProcess(proc.id);

      expect(result).toBeDefined();
      expect(result!.id).toBe(proc.id);
    });

    it("returns undefined for non-existent process", () => {
      expect(service.getProcess("nonexistent")).toBeUndefined();
    });
  });

  describe("listProcesses", () => {
    it("returns all processes for a given worktree path", () => {
      service.startProcess("/tmp", "feature/a", "sleep 60");
      service.startProcess("/tmp", "feature/a", "sleep 120");
      service.startProcess("/tmp", "feature/b", "sleep 60");

      const processes = service.listProcesses("/tmp", "feature/a");

      expect(processes).toHaveLength(2);
    });

    it("returns empty array when no processes exist for worktree", () => {
      const processes = service.listProcesses("/tmp", "feature/a");
      expect(processes).toEqual([]);
    });
  });

  describe("getOutput", () => {
    it("returns buffered output lines for a process", async () => {
      const proc = service.startProcess(
        "/tmp",
        "feature/test",
        "echo line1 && echo line2",
      );

      // Wait for process to complete and output to be captured
      // Poll until we see output or timeout
      let output: string[] = [];
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        output = service.getOutput(proc.id);
        if (output.length > 0) break;
      }

      expect(output.length).toBeGreaterThan(0);
      expect(output.some((line) => line.includes("line1"))).toBe(true);
    });

    it("throws for non-existent process", () => {
      expect(() => service.getOutput("nonexistent")).toThrow("not found");
    });
  });

  describe("output ring buffer", () => {
    it("limits output to the configured max lines", async () => {
      // Create a service with a small buffer
      const smallBufferService = new ProcessService(eventBus, {
        maxOutputLines: 5,
      });

      const proc = smallBufferService.startProcess(
        "/tmp",
        "feature/test",
        'for i in $(seq 1 20); do echo "line $i"; done',
      );

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const output = smallBufferService.getOutput(proc.id);
      expect(output.length).toBeLessThanOrEqual(5);

      await smallBufferService.stopAll();
    });
  });

  describe("crashed process detection", () => {
    it("marks process as crashed when it exits with non-zero code", async () => {
      const proc = service.startProcess("/tmp", "feature/test", "exit 1");

      // Poll until status changes
      let result = service.getProcess(proc.id);
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        result = service.getProcess(proc.id);
        if (result!.status !== "running") break;
      }

      expect(result!.status).toBe("crashed");
      expect(result!.exit_code).toBe(1);
    });

    it("emits process.status-changed event when process crashes", async () => {
      const listener = vi.fn();
      eventBus.on("process.status-changed", listener);

      service.startProcess("/tmp", "feature/test", "exit 1");

      // Poll until crashed event fires
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (listener.mock.calls.some((c) => c[0]?.status === "crashed")) break;
      }

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "crashed",
        }),
      );
    });
  });

  describe("stopAllForWorktree", () => {
    it("stops all processes for a specific worktree", async () => {
      service.startProcess("/tmp", "feature/a", "sleep 60");
      service.startProcess("/tmp", "feature/a", "sleep 120");
      service.startProcess("/tmp", "feature/b", "sleep 60");

      await service.stopAllForWorktree("/tmp", "feature/a");

      const remaining = service.listProcesses("/tmp", "feature/a");
      expect(remaining.every((p) => p.status === "stopped")).toBe(true);

      const otherProcesses = service.listProcesses("/tmp", "feature/b");
      expect(otherProcesses.some((p) => p.status === "running")).toBe(true);
    });
  });

  describe("stopAll", () => {
    it("stops all managed processes", async () => {
      service.startProcess("/tmp", "feature/a", "sleep 60");
      service.startProcess("/tmp", "feature/b", "sleep 60");

      await service.stopAll();

      const a = service.listProcesses("/tmp", "feature/a");
      const b = service.listProcesses("/tmp", "feature/b");
      expect(a.every((p) => p.status !== "running")).toBe(true);
      expect(b.every((p) => p.status !== "running")).toBe(true);
    });
  });
});
