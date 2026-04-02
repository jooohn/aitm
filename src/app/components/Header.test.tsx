// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import Header from "./Header";
import styles from "./Header.module.css";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("./RunWorkflowModal", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div>
      <p>Run workflow modal</p>
      <button type="button" onClick={onClose}>
        Close modal
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("Header", () => {
  it("renders the shared sticky header treatment", () => {
    render(<Header />);

    expect(styles.stickyHeader).toBeTruthy();
    expect(styles.backdropHeader).toBeTruthy();

    const header = screen.getByRole("banner");
    expect(header).toHaveClass(styles.header);
    expect(header).toHaveClass(styles.stickyHeader);
    expect(header).toHaveClass(styles.backdropHeader);
  });

  it("opens the workflow modal from the header action", () => {
    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "Run Workflow" }));

    expect(screen.getByText("Run workflow modal")).toBeInTheDocument();
  });

  it("renders a todo shortcut in the header actions", () => {
    render(<Header />);

    expect(screen.getByRole("link", { name: "Open todos" })).toHaveAttribute(
      "href",
      "/todos",
    );
  });
});
