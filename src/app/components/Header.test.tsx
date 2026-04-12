// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Header from "./Header";
import styles from "./Header.module.css";

const { useAwaitingInputCountMock } = vi.hoisted(() => ({
  useAwaitingInputCountMock: vi.fn().mockReturnValue({ count: 0 }),
}));
const mockUseHouseKeepingSyncing = vi.fn().mockReturnValue(false);
const mockRunHouseKeeping = vi.fn().mockResolvedValue(undefined);
const mockPushAlert = vi.fn();

vi.mock("@/lib/hooks/useAwaitingInputCount", () => ({
  useAwaitingInputCount: useAwaitingInputCountMock,
}));

vi.mock("@/lib/hooks/useHouseKeepingSyncing", () => ({
  useHouseKeepingSyncing: () => mockUseHouseKeepingSyncing(),
}));

vi.mock("@/lib/utils/api", () => ({
  runHouseKeeping: (...args: unknown[]) => mockRunHouseKeeping(...args),
}));

vi.mock("@/lib/alert/AlertContext", () => ({
  useAlert: () => ({
    pushAlert: mockPushAlert,
  }),
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

beforeEach(() => {
  mockUseHouseKeepingSyncing.mockReturnValue(false);
  mockRunHouseKeeping.mockResolvedValue(undefined);
  mockPushAlert.mockReset();
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

  it("renders a global house-keeping sync button in the header actions", () => {
    render(<Header />);

    expect(
      screen.getByRole("button", { name: "Run house-keeping sync" }),
    ).toBeEnabled();
  });

  it("disables the house-keeping sync button while syncing is active", () => {
    mockUseHouseKeepingSyncing.mockReturnValue(true);

    render(<Header />);

    expect(
      screen.getByRole("button", { name: "Run house-keeping sync" }),
    ).toBeDisabled();
  });

  it("triggers a manual house-keeping run from the header", async () => {
    const user = userEvent.setup();
    render(<Header />);

    await user.click(
      screen.getByRole("button", { name: "Run house-keeping sync" }),
    );

    await waitFor(() => {
      expect(mockRunHouseKeeping).toHaveBeenCalledOnce();
    });
  });

  it("shows an alert if the manual house-keeping request fails", async () => {
    const user = userEvent.setup();
    mockRunHouseKeeping.mockRejectedValueOnce(new Error("request failed"));

    render(<Header />);

    await user.click(
      screen.getByRole("button", { name: "Run house-keeping sync" }),
    );

    await waitFor(() => {
      expect(mockPushAlert).toHaveBeenCalledWith({
        title: "Sync failed",
        message: "Failed to run house-keeping sync.",
      });
    });
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
