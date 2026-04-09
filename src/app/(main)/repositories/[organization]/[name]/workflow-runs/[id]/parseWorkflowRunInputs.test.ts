import { describe, expect, it } from "vitest";
import { parseWorkflowRunInputs } from "./parseWorkflowRunInputs";

describe("parseWorkflowRunInputs", () => {
  it("returns entries for valid input objects", () => {
    expect(
      parseWorkflowRunInputs({
        title: "Add run inputs to detail page",
        notes: "Line one\nLine two",
      }),
    ).toEqual([
      { key: "title", value: "Add run inputs to detail page" },
      { key: "notes", value: "Line one\nLine two" },
    ]);
  });

  it("returns an empty array for null input", () => {
    expect(parseWorkflowRunInputs(null)).toEqual([]);
  });

  it("preserves empty-string values", () => {
    expect(
      parseWorkflowRunInputs({
        title: "Keep me",
        empty: "",
      }),
    ).toEqual([
      { key: "title", value: "Keep me" },
      { key: "empty", value: "" },
    ]);
  });

  it("drops non-string values from unexpected input objects", () => {
    expect(
      parseWorkflowRunInputs({
        title: "Keep me",
        nested: { bad: true },
        count: 1,
      } as unknown as Record<string, string>),
    ).toEqual([{ key: "title", value: "Keep me" }]);
  });
});
