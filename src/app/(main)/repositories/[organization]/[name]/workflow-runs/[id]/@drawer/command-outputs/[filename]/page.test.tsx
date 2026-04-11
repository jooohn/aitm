// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockNotFound = vi.fn(() => {
  throw new Error("notFound");
});

vi.mock("next/navigation", () => ({
  notFound: () => mockNotFound(),
}));

vi.mock("@/backend/domain/workflow-runs/command-output", () => ({
  getWorkflowRunCommandOutput: vi.fn(),
}));

vi.mock(
  "@/app/(main)/repositories/[organization]/[name]/workflow-runs/[id]/CommandOutputDrawer",
  () => ({
    default: ({ filename, content }: { filename: string; content: string }) => (
      <div>
        <h1>{filename}</h1>
        <pre>{content}</pre>
      </div>
    ),
  }),
);

import CommandOutputDrawerPage from "./page";

afterEach(() => {
  cleanup();
  mockNotFound.mockClear();
});

describe("CommandOutputDrawerPage", () => {
  it("renders the command output drawer for a matching filename", async () => {
    const { getWorkflowRunCommandOutput } = await import(
      "@/backend/domain/workflow-runs/command-output"
    );
    vi.mocked(getWorkflowRunCommandOutput).mockResolvedValue({
      filename: "lint.log",
      content: "stdout line\nstderr line",
    });

    const result = await CommandOutputDrawerPage({
      params: Promise.resolve({
        id: "run-1",
        filename: "lint.log",
      }),
    });

    render(result);

    expect(screen.getByRole("heading", { name: "lint.log" })).toBeVisible();
    expect(screen.getByText(/stdout line/)).toBeVisible();
    expect(screen.getByText(/stderr line/)).toBeVisible();
  });

  it("calls notFound when the output cannot be resolved", async () => {
    const { getWorkflowRunCommandOutput } = await import(
      "@/backend/domain/workflow-runs/command-output"
    );
    vi.mocked(getWorkflowRunCommandOutput).mockResolvedValue(null);

    await expect(() =>
      CommandOutputDrawerPage({
        params: Promise.resolve({
          id: "run-1",
          filename: "missing.log",
        }),
      }),
    ).rejects.toThrow("notFound");
  });
});
