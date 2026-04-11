// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommandOutputDrawer from "./CommandOutputDrawer";

const mockReplace = vi.fn();

let mockPathname =
  "/repositories/acme/app/workflow-runs/run-1/command-outputs/lint.log";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace }),
}));

describe("CommandOutputDrawer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReplace.mockReset();
    mockPathname =
      "/repositories/acme/app/workflow-runs/run-1/command-outputs/lint.log";
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("closes by replacing to the parent workflow-run route", async () => {
    render(
      <CommandOutputDrawer
        filename="lint.log"
        content={"stdout line\nstderr line"}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Close command output drawer" }),
    );

    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(mockReplace).toHaveBeenCalledWith(
      "/repositories/acme/app/workflow-runs/run-1",
    );
  });
});
