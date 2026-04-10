// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { Session } from "@/lib/utils/api";
import { SWRTestProvider } from "@/test-swr-provider";
import SessionDetail from "./SessionDetail";

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener = vi.fn();
  close = vi.fn();

  constructor(_url: string) {
    MockEventSource.instances.push(this);
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-session-id",
    organization: "acme",
    name: "app",
    worktree_branch: "main",
    goal: "Implement a feature",
    transitions: [],
    transition_decision: null,
    step_name: null,
    workflow_name: null,
    workflow_run_id: null,
    step_execution_id: null,
    status: "running",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    terminal_attach_command: null,
    log_file_path: "/tmp/session.log",
    claude_session_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SessionDetail – goal section", () => {
  it("renders goal text in the Goal section", () => {
    const session = makeSession({ goal: "Build the feature" });
    render(<SessionDetail session={session} />);
    expect(screen.getByText("Build the feature")).toBeInTheDocument();
  });

  it("renders goal text in the goal section", () => {
    const session = makeSession({
      goal: "The full goal text",
      step_name: "Implementing",
    });
    render(<SessionDetail session={session} />);
    expect(screen.getByText("The full goal text")).toBeInTheDocument();
  });
});

describe("SessionDetail – mark as failed removal", () => {
  it("does not render a 'Mark as failed' button for running sessions", () => {
    const session = makeSession({ status: "running" });
    render(<SessionDetail session={session} />);
    expect(screen.queryByText("Mark as failed")).not.toBeInTheDocument();
  });

  it("does not render a 'Mark as failed' button for awaiting input sessions", () => {
    const session = makeSession({ status: "awaiting_input" });
    render(<SessionDetail session={session} />);
    expect(screen.queryByText("Mark as failed")).not.toBeInTheDocument();
  });
});

describe("SessionDetail – status and updates", () => {
  it("updates the rendered session when the parent provides a different session", () => {
    const { rerender } = render(
      <SessionDetail
        session={makeSession({
          id: "session-1",
          goal: "First goal",
          step_name: "First state",
          status: "awaiting_input",
        })}
      />,
    );

    rerender(
      <SessionDetail
        session={makeSession({
          id: "session-2",
          goal: "Second goal",
          step_name: "Second state",
          status: "failure",
        })}
      />,
    );

    expect(screen.getByText("Second goal")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting input")).not.toBeInTheDocument();
  });

  it("renders replayed user input with distinct styling", async () => {
    render(
      <SessionDetail
        session={makeSession({
          id: "session-1",
          status: "awaiting_input",
        })}
      />,
    );

    await act(async () => {
      MockEventSource.instances[0].simulateMessage({
        type: "user_input",
        message: "Use PostgreSQL",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("You")).toBeInTheDocument();
      expect(screen.getByText("Use PostgreSQL")).toBeInTheDocument();
    });
  });

  it("renders command execution events with a readable summary and output", async () => {
    render(
      <SessionDetail
        session={makeSession({
          id: "session-1",
          status: "running",
        })}
      />,
    );

    await act(async () => {
      MockEventSource.instances[0].simulateMessage({
        type: "event",
        event_type: "command_execution",
        detail: {
          command: "/bin/zsh -lc 'git status --short'",
          aggregated_output: "?? PLAN.md\n",
          exit_code: 0,
          status: "completed",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Check git status")).toBeInTheDocument();
      expect(
        screen.getByText("/bin/zsh -lc 'git status --short'"),
      ).toBeInTheDocument();
    });
  });

  it("groups consecutive command execution events into a processing steps summary", async () => {
    render(
      <SessionDetail
        session={makeSession({
          id: "session-1",
          status: "running",
        })}
      />,
    );

    await act(async () => {
      MockEventSource.instances[0].simulateMessage({
        type: "event",
        event_type: "command_execution",
        detail: {
          command: "/bin/zsh -lc \"sed -n '1,200p' file-a.ts\"",
          aggregated_output: "file a",
          exit_code: 0,
          status: "completed",
        },
      });
      MockEventSource.instances[0].simulateMessage({
        type: "event",
        event_type: "command_execution",
        detail: {
          command: "/bin/zsh -lc \"sed -n '1,200p' file-b.ts\"",
          aggregated_output: "file b",
          exit_code: 0,
          status: "completed",
        },
      });
      MockEventSource.instances[0].simulateMessage({
        type: "event",
        event_type: "command_execution",
        detail: {
          command: "/bin/zsh -lc \"sed -n '1,200p' file-c.ts\"",
          aggregated_output: "file c",
          exit_code: 0,
          status: "completed",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Processing 3 steps/)).toBeInTheDocument();
    });
  });

  it("preserves streamed output when the same session is revalidated", async () => {
    const session = makeSession({
      id: "session-1",
      status: "running",
      updated_at: "2024-01-01T00:00:00Z",
    });

    const { rerender } = render(
      <SWRTestProvider>
        <SessionDetail session={session} />
      </SWRTestProvider>,
    );

    await act(async () => {
      MockEventSource.instances[0].simulateMessage({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Working on it" }],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Working on it")).toBeInTheDocument();
    });

    rerender(
      <SWRTestProvider>
        <SessionDetail
          session={makeSession({
            ...session,
            updated_at: "2024-01-01T00:00:05Z",
          })}
        />
      </SWRTestProvider>,
    );

    expect(screen.getByText("Working on it")).toBeInTheDocument();
  });

  it("renders clarifying_question above the reply box for awaiting-input sessions", () => {
    render(
      <SessionDetail
        session={makeSession({
          status: "awaiting_input",
          transition_decision: {
            reason: "Need clarification",
            handoff_summary: "Waiting for a reply",
            clarifying_question: "Which database should I use?",
          },
        })}
      />,
    );

    expect(
      screen.getByText("Which database should I use?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("falls back to handoff_summary when clarifying_question is missing", () => {
    render(
      <SessionDetail
        session={makeSession({
          status: "awaiting_input",
          transition_decision: {
            reason: "Need clarification",
            handoff_summary: "Please confirm the deployment target.",
          },
        })}
      />,
    );

    expect(
      screen.getByText("Please confirm the deployment target."),
    ).toBeInTheDocument();
  });
});

describe("SessionDetail – processing steps grouping", () => {
  it("collapses consecutive tool_call and command_execution items into a processing steps summary", async () => {
    render(
      <SessionDetail
        session={makeSession({
          id: "session-1",
          status: "running",
        })}
      />,
    );

    await act(async () => {
      MockEventSource.instances[0].simulateMessage({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read" }],
        },
      });
      MockEventSource.instances[0].simulateMessage({
        type: "event",
        event_type: "command_execution",
        detail: {
          command: "/bin/zsh -lc 'git status --short'",
          aggregated_output: "",
          exit_code: 0,
          status: "completed",
        },
      });
      MockEventSource.instances[0].simulateMessage({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Bash" }],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Processing 3 steps/)).toBeInTheDocument();
    });
  });

  it("shows 'Processed N steps' for completed processing groups followed by conversational items", async () => {
    render(
      <SessionDetail
        session={makeSession({
          id: "session-1",
          status: "running",
        })}
      />,
    );

    await act(async () => {
      MockEventSource.instances[0].simulateMessage({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read" }],
        },
      });
      MockEventSource.instances[0].simulateMessage({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Bash" }],
        },
      });
      // Conversational item breaks the group
      MockEventSource.instances[0].simulateMessage({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Here are the results" }],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Processed 2 steps/)).toBeInTheDocument();
      expect(screen.getByText("Here are the results")).toBeInTheDocument();
    });
  });

  it("does not group conversational items into processing steps", async () => {
    render(
      <SessionDetail
        session={makeSession({
          id: "session-1",
          status: "running",
        })}
      />,
    );

    await act(async () => {
      MockEventSource.instances[0].simulateMessage({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Starting work" }],
        },
      });
      MockEventSource.instances[0].simulateMessage({
        type: "user_input",
        message: "Use PostgreSQL",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Starting work")).toBeInTheDocument();
      expect(screen.getByText("Use PostgreSQL")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Processing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Processed/)).not.toBeInTheDocument();
  });

  it("does not render successful result entries", async () => {
    render(
      <SessionDetail
        session={makeSession({
          id: "session-1",
          status: "success",
        })}
      />,
    );

    await act(async () => {
      MockEventSource.instances[0].simulateMessage({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "All done" }],
        },
      });
      MockEventSource.instances[0].simulateMessage({
        type: "result",
        subtype: "success",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("All done")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Goal completed/)).not.toBeInTheDocument();
  });
});
