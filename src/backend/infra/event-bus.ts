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
      status: "RUNNING" | "AWAITING_INPUT";
    }
  | {
      sessionId: string;
      status: "FAILED";
      decision: null;
    }
  | {
      sessionId: string;
      status: "SUCCEEDED";
      decision: TransitionDecision;
    };

export interface EventMap {
  "agent-session.completed": {
    sessionId: string;
    decision: TransitionDecision | null;
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

  emit<K extends keyof EventMap>(eventName: K, payload: EventMap[K]): void {
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
