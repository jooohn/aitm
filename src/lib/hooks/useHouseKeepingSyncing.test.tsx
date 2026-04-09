// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationEvent } from "@/shared/contracts/api";
import { useHouseKeepingSyncing } from "./useHouseKeepingSyncing";
import { _resetForTesting } from "./useNotificationStream";

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(_url: string) {
    MockEventSource.instances.push(this);
  }

  simulateMessage(data: NotificationEvent) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function TestComponent() {
  const syncing = useHouseKeepingSyncing();
  return <span>{syncing ? "syncing" : "idle"}</span>;
}

beforeEach(() => {
  _resetForTesting();
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  _resetForTesting();
  vi.unstubAllGlobals();
});

describe("useHouseKeepingSyncing", () => {
  it("turns on when housekeeping notifications report syncing", async () => {
    render(<TestComponent />);

    expect(screen.getByText("idle")).toBeInTheDocument();

    MockEventSource.instances[0].simulateMessage({
      type: "house-keeping.sync-status-changed",
      payload: { syncing: true },
    });

    await waitFor(() => {
      expect(screen.getByText("syncing")).toBeInTheDocument();
    });
  });

  it("ignores unrelated notifications", async () => {
    render(<TestComponent />);

    MockEventSource.instances[0].simulateMessage({
      type: "workflow-run.status-changed",
      payload: {
        workflowRunId: "wr1",
        branchName: "feat/test",
        repositoryOrganization: "org",
        repositoryName: "repo",
        status: "running",
      },
    });

    await waitFor(() => {
      expect(screen.getByText("idle")).toBeInTheDocument();
    });
  });
});
