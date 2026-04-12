// @vitest-environment jsdom
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import StatusDot from "./StatusDot";

describe("StatusDot", () => {
  it("renders the idle variant without error", () => {
    const { container } = render(<StatusDot variant="idle" />);
    const dot = container.querySelector("span");
    expect(dot).toBeInTheDocument();
  });

  it("does not apply animation style for idle variant", () => {
    const { container } = render(<StatusDot variant="idle" />);
    const dot = container.querySelector("span");
    expect(dot?.style.animationDelay).toBe("");
  });
});
