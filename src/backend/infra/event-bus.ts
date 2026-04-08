import type { TransitionDecision } from "@/backend/domain/agent";
import type { SessionStatus } from "@/backend/domain/sessions";
import type {
  StepExecutionStatus,
  WorkflowRunStatus,
} from "@/backend/domain/workflow-runs";
import { logger } from "@/backend/infra/logger";

export type SessionStatusChangedEvent =
  | {
      sessionId: string;
      status: "running" | "awaiting_input";
    }
  | {
      sessionId: string;
      status: "failure";
      decision: null;
    }
  | {
      sessionId: string;
      status: "success";
      decision: TransitionDecision;
    };

export interface EventMap {
  "agent-session.completed": {
    sessionId: string;
    decision: TransitionDecision | null;
  };
  "house-keeping.sync-status-changed": {
    syncing: boolean;
  };
  "session.status-changed": SessionStatusChangedEvent;
  "step-execution.status-changed": {
    stepExecutionId: string;
    workflowRunId: string;
    status: StepExecutionStatus;
  };
  "workflow-run.status-changed": {
    workflowRunId: string;
    status: WorkflowRunStatus;
  };
}

type Listener<K extends keyof EventMap> = (payload: EventMap[K]) => void;

export class EventBus {
  private listeners = new Map<keyof EventMap, Listener<never>[]>();
  private latestHouseKeepingSyncStatus:
    | EventMap["house-keeping.sync-status-changed"]
    | null = null;

  on<K extends keyof EventMap>(eventName: K, listener: Listener<K>): void {
    const list = this.listeners.get(eventName) ?? [];
    list.push(listener as Listener<never>);
    this.listeners.set(eventName, list);
  }

  off<K extends keyof EventMap>(eventName: K, listener: Listener<K>): void {
    const list = this.listeners.get(eventName);
    if (!list) return;
    const index = list.indexOf(listener as Listener<never>);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
    this.latestHouseKeepingSyncStatus = null;
  }

  getLatestHouseKeepingSyncStatus():
    | EventMap["house-keeping.sync-status-changed"]
    | null {
    return this.latestHouseKeepingSyncStatus;
  }

  emit<K extends keyof EventMap>(eventName: K, payload: EventMap[K]): void {
    if (eventName === "house-keeping.sync-status-changed") {
      this.latestHouseKeepingSyncStatus = payload;
    }
    const list = this.listeners.get(eventName);
    if (!list) return;
    for (const listener of list) {
      try {
        (listener as Listener<K>)(payload);
      } catch (err) {
        logger.error({ err, eventName }, "Event listener error");
      }
    }
  }
}

export const eventBus = new EventBus();
