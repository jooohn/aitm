import { type ChildProcess, spawn } from "child_process";
import { randomUUID } from "crypto";
import type { ConfigRepositoryCommand } from "@/backend/infra/config";
import type { EventBus } from "@/backend/infra/event-bus";
import { logger } from "@/backend/infra/logger";

export type ProcessStatus = "running" | "stopped" | "crashed";

export interface ProcessInfo {
  id: string;
  worktree_branch: string;
  command_id: string;
  command_label: string;
  command: string;
  status: ProcessStatus;
  pid: number | null;
  exit_code: number | null;
  created_at: string;
  stopped_at: string | null;
}

interface ManagedProcess {
  info: ProcessInfo;
  child: ChildProcess;
  output: string[];
  worktreePath: string;
  repositoryOrganization: string;
  repositoryName: string;
}

export interface ProcessServiceOptions {
  maxOutputLines?: number;
}

const DEFAULT_MAX_OUTPUT_LINES = 5000;

export class ProcessService {
  private processes = new Map<string, ManagedProcess>();
  private worktreeIndex = new Map<string, Set<string>>();
  private maxOutputLines: number;

  constructor(
    private eventBus: EventBus,
    options?: ProcessServiceOptions,
  ) {
    this.maxOutputLines = options?.maxOutputLines ?? DEFAULT_MAX_OUTPUT_LINES;
  }

  startProcess(
    worktreePath: string,
    worktreeBranch: string,
    command: ConfigRepositoryCommand,
    repositoryOrganization?: string,
    repositoryName?: string,
  ): ProcessInfo {
    const id = randomUUID();
    const child = spawn("sh", ["-c", command.command], {
      cwd: worktreePath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const info: ProcessInfo = {
      id,
      worktree_branch: worktreeBranch,
      command_id: command.id,
      command_label: command.label,
      command: command.command,
      status: "running",
      pid: child.pid ?? null,
      exit_code: null,
      created_at: new Date().toISOString(),
      stopped_at: null,
    };

    const managed: ManagedProcess = {
      info,
      child,
      output: [],
      worktreePath,
      repositoryOrganization: repositoryOrganization ?? "",
      repositoryName: repositoryName ?? "",
    };

    this.processes.set(id, managed);

    const indexKey = this.indexKey(worktreePath, worktreeBranch);
    if (!this.worktreeIndex.has(indexKey)) {
      this.worktreeIndex.set(indexKey, new Set());
    }
    this.worktreeIndex.get(indexKey)!.add(id);

    const appendOutput = (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        managed.output.push(line);
        if (managed.output.length > this.maxOutputLines) {
          managed.output.shift();
        }
      }
    };

    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);

    child.on("close", (code) => {
      if (info.status === "running") {
        info.exit_code = code;
        info.stopped_at = new Date().toISOString();
        if (code === 0) {
          info.status = "stopped";
        } else {
          info.status = "crashed";
        }
        this.eventBus.emit("process.status-changed", {
          processId: id,
          worktreeBranch,
          worktreePath,
          status: info.status,
          repositoryOrganization: managed.repositoryOrganization,
          repositoryName: managed.repositoryName,
        });
      }
    });

    child.on("error", (err) => {
      logger.error({ err, processId: id }, "Process error");
      if (info.status === "running") {
        info.status = "crashed";
        info.stopped_at = new Date().toISOString();
        this.eventBus.emit("process.status-changed", {
          processId: id,
          worktreeBranch,
          worktreePath,
          status: "crashed",
          repositoryOrganization: managed.repositoryOrganization,
          repositoryName: managed.repositoryName,
        });
      }
    });

    this.eventBus.emit("process.status-changed", {
      processId: id,
      worktreeBranch,
      worktreePath,
      status: "running",
      repositoryOrganization: managed.repositoryOrganization,
      repositoryName: managed.repositoryName,
    });

    return { ...info };
  }

  async stopProcess(id: string): Promise<ProcessInfo> {
    const managed = this.processes.get(id);
    if (!managed) {
      throw new Error(`Process ${id} not found`);
    }

    if (managed.info.status !== "running") {
      return { ...managed.info };
    }

    managed.info.status = "stopped";
    managed.info.stopped_at = new Date().toISOString();

    const emitStopped = () => {
      this.eventBus.emit("process.status-changed", {
        processId: id,
        worktreeBranch: managed.info.worktree_branch,
        worktreePath: managed.worktreePath,
        status: "stopped",
        repositoryOrganization: managed.repositoryOrganization,
        repositoryName: managed.repositoryName,
      });
    };

    // If child already exited (or never started), no need to kill
    if (
      managed.child.exitCode !== null ||
      managed.child.killed ||
      !managed.child.pid
    ) {
      managed.info.exit_code = managed.child.exitCode;
      emitStopped();
      return { ...managed.info };
    }

    return new Promise((resolve) => {
      managed.child.on("close", (code) => {
        managed.info.exit_code = code;
        emitStopped();
        resolve({ ...managed.info });
      });

      managed.child.kill("SIGTERM");

      // Force kill after 5 seconds
      setTimeout(() => {
        if (managed.child.exitCode === null && !managed.child.killed) {
          managed.child.kill("SIGKILL");
        }
      }, 5000);
    });
  }

  getProcess(id: string): ProcessInfo | undefined {
    const managed = this.processes.get(id);
    return managed ? { ...managed.info } : undefined;
  }

  listProcesses(worktreePath: string, worktreeBranch: string): ProcessInfo[] {
    const indexKey = this.indexKey(worktreePath, worktreeBranch);
    const ids = this.worktreeIndex.get(indexKey);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.processes.get(id))
      .filter((p): p is ManagedProcess => p !== undefined)
      .map((p) => ({ ...p.info }));
  }

  getOutput(id: string): string[] {
    const managed = this.processes.get(id);
    if (!managed) {
      throw new Error(`Process ${id} not found`);
    }
    return [...managed.output];
  }

  async stopAllForWorktree(
    worktreePath: string,
    worktreeBranch: string,
  ): Promise<void> {
    const indexKey = this.indexKey(worktreePath, worktreeBranch);
    const ids = this.worktreeIndex.get(indexKey);
    if (!ids) return;
    await Promise.all(
      [...ids].map((id) => {
        const managed = this.processes.get(id);
        if (managed && managed.info.status === "running") {
          return this.stopProcess(id);
        }
        return Promise.resolve();
      }),
    );
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.processes.keys()].map((id) => {
        const managed = this.processes.get(id);
        if (managed && managed.info.status === "running") {
          return this.stopProcess(id);
        }
        return Promise.resolve();
      }),
    );
  }

  private indexKey(worktreePath: string, worktreeBranch: string): string {
    return `${worktreePath}::${worktreeBranch}`;
  }
}
