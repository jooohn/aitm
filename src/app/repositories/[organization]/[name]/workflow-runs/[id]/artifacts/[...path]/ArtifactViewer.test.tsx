// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import ArtifactViewer from "./ArtifactViewer";

afterEach(() => {
  cleanup();
});

describe("ArtifactViewer", () => {
  describe("markdown rendering", () => {
    it("renders markdown content in a formatted container for .md files", () => {
      render(
        <ArtifactViewer
          path="plan.md"
          content={"# Hello\n\nSome **bold** text"}
        />,
      );

      const viewer = screen.getByTestId("artifact-viewer");
      expect(viewer).toHaveAttribute("data-type", "markdown");
      expect(viewer).toHaveTextContent("Hello");
      expect(viewer).toHaveTextContent("Some bold text");
    });

    it("renders HTML elements from markdown", () => {
      render(
        <ArtifactViewer
          path="notes.md"
          content={"# Title\n\n- item 1\n- item 2"}
        />,
      );

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Title",
      );
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
  });

  describe("JSON rendering", () => {
    it("renders formatted JSON for .json files", () => {
      const json = '{"key":"value","nested":{"a":1}}';
      render(<ArtifactViewer path="data.json" content={json} />);

      const viewer = screen.getByTestId("artifact-viewer");
      expect(viewer).toHaveAttribute("data-type", "json");
      // Should contain pretty-printed JSON
      expect(viewer).toHaveTextContent('"key": "value"');
    });

    it("falls back to raw display for invalid JSON", () => {
      render(<ArtifactViewer path="bad.json" content="not valid json{" />);

      const viewer = screen.getByTestId("artifact-viewer");
      expect(viewer).toHaveAttribute("data-type", "json");
      expect(viewer).toHaveTextContent("not valid json{");
    });
  });

  describe("raw text rendering", () => {
    it("renders plain text in a pre block for .txt files", () => {
      render(<ArtifactViewer path="log.txt" content="line 1\nline 2" />);

      const viewer = screen.getByTestId("artifact-viewer");
      expect(viewer).toHaveAttribute("data-type", "raw");
      expect(viewer.querySelector("pre")).not.toBeNull();
      expect(viewer).toHaveTextContent("line 1");
    });

    it("renders .yaml files as raw text", () => {
      render(<ArtifactViewer path="config.yaml" content="key: value" />);

      const viewer = screen.getByTestId("artifact-viewer");
      expect(viewer).toHaveAttribute("data-type", "raw");
    });

    it("renders .yml files as raw text", () => {
      render(<ArtifactViewer path="config.yml" content="key: value" />);

      const viewer = screen.getByTestId("artifact-viewer");
      expect(viewer).toHaveAttribute("data-type", "raw");
    });

    it("renders .log files as raw text", () => {
      render(<ArtifactViewer path="output.log" content="log entry" />);

      const viewer = screen.getByTestId("artifact-viewer");
      expect(viewer).toHaveAttribute("data-type", "raw");
    });

    it("renders unknown extensions as raw text", () => {
      render(<ArtifactViewer path="data.csv" content="a,b,c" />);

      const viewer = screen.getByTestId("artifact-viewer");
      expect(viewer).toHaveAttribute("data-type", "raw");
    });
  });
});
