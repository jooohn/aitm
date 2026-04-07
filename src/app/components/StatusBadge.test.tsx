// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import StatusBadge from "./StatusBadge";
import styles from "./StatusBadge.module.css";

afterEach(() => {
  cleanup();
});

describe("StatusBadge", () => {
  it("renders children as the badge text", () => {
    render(<StatusBadge variant="running">Running</StatusBadge>);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("applies the base badge class", () => {
    render(<StatusBadge variant="success">Success</StatusBadge>);
    expect(screen.getByText("Success")).toHaveClass(styles.badge);
  });

  it.each([
    "running",
    "awaiting",
    "success",
    "failure",
  ] as const)("applies variant class for %s", (variant) => {
    render(<StatusBadge variant={variant}>{variant}</StatusBadge>);
    const el = screen.getByText(variant);
    expect(el).toHaveClass(styles.badge);
    expect(el).toHaveClass(styles[`badge-${variant}`]);
  });

  it("passes through additional className", () => {
    render(
      <StatusBadge variant="running" className="extra">
        Running
      </StatusBadge>,
    );
    expect(screen.getByText("Running")).toHaveClass("extra");
  });
});
