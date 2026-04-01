import { describe, expect, it } from "vitest";
import { parseWorkflowRunInputs } from "./parseWorkflowRunInputs";

describe("parseWorkflowRunInputs", () => {
  it("returns entries for valid string-valued input objects", () => {
    expect(
      parseWorkflowRunInputs(
        JSON.stringify({
          title: "Add run inputs to detail page",
          notes: "Line one\nLine two",
        }),
      ),
    ).toEqual([
      { key: "title", value: "Add run inputs to detail page" },
      { key: "notes", value: "Line one\nLine two" },
    ]);
  });

  it("returns an empty array for null, invalid, or non-object JSON", () => {
    expect(parseWorkflowRunInputs(null)).toEqual([]);
    expect(parseWorkflowRunInputs("{")).toEqual([]);
    expect(parseWorkflowRunInputs(JSON.stringify([]))).toEqual([]);
    expect(parseWorkflowRunInputs(JSON.stringify("value"))).toEqual([]);
  });

  it("ignores non-string values", () => {
    expect(
      parseWorkflowRunInputs(
        JSON.stringify({
          title: "Keep me",
          count: 2,
          enabled: true,
          nested: { nope: "nope" },
          empty: "",
        }),
      ),
    ).toEqual([
      { key: "title", value: "Keep me" },
      { key: "empty", value: "" },
    ]);
  });
});
