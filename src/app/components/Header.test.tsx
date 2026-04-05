// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import Header from "./Header";
import styles from "./Header.module.css";

const { useAwaitingInputCountMock } = vi.hoisted(() => ({
  useAwaitingInputCountMock: vi.fn().mockReturnValue({ count: 0 }),
}));

vi.mock("@/lib/hooks/useAwaitingInputCount", () => ({
  useAwaitingInputCount: useAwaitingInputCountMock,
}));

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

  it("renders a todo shortcut in the header actions", () => {
    render(<Header />);

    expect(screen.getByRole("link", { name: "Open todos" })).toHaveAttribute(
      "href",
      "/todos",
    );
  });

  it("does not show notification badge when count is 0", () => {
    useAwaitingInputCountMock.mockReturnValue({ count: 0 });
    render(<Header />);

    expect(screen.queryByTestId("todos-badge")).not.toBeInTheDocument();
  });

  it("shows notification badge when count is greater than 0", () => {
    useAwaitingInputCountMock.mockReturnValue({ count: 3 });
    render(<Header />);

    expect(screen.getByTestId("todos-badge")).toBeInTheDocument();
  });
});
