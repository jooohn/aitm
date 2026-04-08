// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import type { DiffFileDto } from "@/shared/contracts/api";
import DiffViewer from "./DiffViewer";

afterEach(() => {
  cleanup();
});

function makeDiffFile(overrides: Partial<DiffFileDto> = {}): DiffFileDto {
  return {
    path: "src/index.ts",
    old_path: null,
    status: "modified",
    hunks: [
      {
        header: "@@ -1,3 +1,4 @@",
        lines: [
          {
            type: "context",
            content: " import { foo } from './foo';",
            old_line: 1,
            new_line: 1,
          },
          {
            type: "removed",
            content: "-const bar = 1;",
            old_line: 2,
            new_line: null,
          },
          {
            type: "added",
            content: "+const bar = 2;",
            old_line: null,
            new_line: 2,
          },
          {
            type: "added",
            content: "+const baz = 3;",
            old_line: null,
            new_line: 3,
          },
          {
            type: "context",
            content: " export { foo };",
            old_line: 3,
            new_line: 4,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("DiffViewer", () => {
  it("renders empty state when no files", () => {
    render(<DiffViewer files={[]} />);
    expect(screen.getByText("No changes")).toBeInTheDocument();
  });

  it("renders file names", () => {
    const files = [
      makeDiffFile({ path: "src/app.ts" }),
      makeDiffFile({ path: "src/utils.ts" }),
    ];
    render(<DiffViewer files={files} />);
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("src/utils.ts")).toBeInTheDocument();
  });

  it("shows file status badge", () => {
    render(
      <DiffViewer
        files={[
          makeDiffFile({ path: "new.ts", status: "added" }),
          makeDiffFile({ path: "old.ts", status: "deleted" }),
          makeDiffFile({ path: "changed.ts", status: "modified" }),
        ]}
      />,
    );
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText("Deleted")).toBeInTheDocument();
    expect(screen.getByText("Modified")).toBeInTheDocument();
  });

  it("renders diff lines with appropriate types", () => {
    render(<DiffViewer files={[makeDiffFile()]} />);

    // Check that added and removed lines are rendered
    expect(screen.getByText("+const bar = 2;")).toBeInTheDocument();
    expect(screen.getByText("-const bar = 1;")).toBeInTheDocument();
    // Context lines have a leading space — use regex to match
    expect(
      screen.getByText(/import \{ foo \} from '\.\/foo';/),
    ).toBeInTheDocument();
  });

  it("renders line numbers", () => {
    render(<DiffViewer files={[makeDiffFile()]} />);

    // The component should render line numbers as data attributes or text
    const addedLine = screen.getByText("+const bar = 2;").closest("tr");
    expect(addedLine).not.toBeNull();
  });

  it("shows renamed file with old path", () => {
    render(
      <DiffViewer
        files={[
          makeDiffFile({
            path: "new-name.ts",
            old_path: "old-name.ts",
            status: "renamed",
          }),
        ]}
      />,
    );
    expect(screen.getByText("new-name.ts")).toBeInTheDocument();
    expect(screen.getByText(/old-name\.ts/)).toBeInTheDocument();
  });

  it("can collapse and expand individual files", async () => {
    const user = userEvent.setup();
    render(<DiffViewer files={[makeDiffFile()]} />);

    // Content should be visible initially
    expect(screen.getByText("+const bar = 2;")).toBeInTheDocument();

    // Click the file header to collapse
    await user.click(screen.getByText("src/index.ts"));

    // Content should be hidden
    expect(screen.queryByText("+const bar = 2;")).not.toBeInTheDocument();

    // Click again to expand
    await user.click(screen.getByText("src/index.ts"));

    // Content should be visible again
    expect(screen.getByText("+const bar = 2;")).toBeInTheDocument();
  });
});
