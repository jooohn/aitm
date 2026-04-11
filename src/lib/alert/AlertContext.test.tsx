// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertProvider, useAlert } from "./AlertContext";

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function PushAlertButton({
  title,
  message,
}: {
  title?: string;
  message: string;
}) {
  const { pushAlert } = useAlert();
  return (
    <button type="button" onClick={() => pushAlert({ title, message })}>
      {`push-${message}`}
    </button>
  );
}

describe("AlertProvider", () => {
  it("displays a pushed alert", async () => {
    render(
      <AlertProvider>
        <PushAlertButton message="Something went wrong" />
      </AlertProvider>,
    );

    await user.click(screen.getByText("push-Something went wrong"));

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("displays alert with title", async () => {
    render(
      <AlertProvider>
        <PushAlertButton title="Error" message="Something went wrong" />
      </AlertProvider>,
    );

    await user.click(screen.getByText("push-Something went wrong"));

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("auto-dismisses after 3 seconds", async () => {
    render(
      <AlertProvider>
        <PushAlertButton message="Temporary error" />
      </AlertProvider>,
    );

    await user.click(screen.getByText("push-Temporary error"));
    expect(screen.getByText("Temporary error")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(screen.queryByText("Temporary error")).not.toBeInTheDocument();
    });
  });

  it("can be manually dismissed", async () => {
    render(
      <AlertProvider>
        <PushAlertButton message="Closable error" />
      </AlertProvider>,
    );

    await user.click(screen.getByText("push-Closable error"));
    expect(screen.getByText("Closable error")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    await waitFor(() => {
      expect(screen.queryByText("Closable error")).not.toBeInTheDocument();
    });
  });

  it("shows alerts sequentially from queue", async () => {
    function MultiPusher() {
      const { pushAlert } = useAlert();
      return (
        <button
          type="button"
          onClick={() => {
            pushAlert({ message: "First error" });
            pushAlert({ message: "Second error" });
          }}
        >
          push-both
        </button>
      );
    }

    render(
      <AlertProvider>
        <MultiPusher />
      </AlertProvider>,
    );

    await user.click(screen.getByText("push-both"));

    // First alert should be visible
    expect(screen.getByText("First error")).toBeInTheDocument();
    expect(screen.queryByText("Second error")).not.toBeInTheDocument();

    // Dismiss first alert via timeout
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Second alert should now be visible
    await waitFor(() => {
      expect(screen.queryByText("First error")).not.toBeInTheDocument();
      expect(screen.getByText("Second error")).toBeInTheDocument();
    });
  });

  it("shows next alert after manual dismiss", async () => {
    function MultiPusher() {
      const { pushAlert } = useAlert();
      return (
        <button
          type="button"
          onClick={() => {
            pushAlert({ message: "Alert A" });
            pushAlert({ message: "Alert B" });
          }}
        >
          push-both
        </button>
      );
    }

    render(
      <AlertProvider>
        <MultiPusher />
      </AlertProvider>,
    );

    await user.click(screen.getByText("push-both"));

    expect(screen.getByText("Alert A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    await waitFor(() => {
      expect(screen.getByText("Alert B")).toBeInTheDocument();
    });
  });
});
