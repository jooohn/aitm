import { describe, expect, it } from "vitest";
import { extractPullRequestUrl } from "./extractPullRequestUrl";

describe("extractPullRequestUrl", () => {
  it("returns the URL when metadata contains presets__pull_request_url", () => {
    const metadata = JSON.stringify({
      presets__pull_request_url: "https://github.com/org/repo/pull/42",
    });
    expect(extractPullRequestUrl(metadata)).toBe(
      "https://github.com/org/repo/pull/42",
    );
  });

  it("returns null when metadata is null", () => {
    expect(extractPullRequestUrl(null)).toBeNull();
  });

  it("returns null when metadata is invalid JSON", () => {
    expect(extractPullRequestUrl("not json")).toBeNull();
  });

  it("returns null when metadata does not contain the key", () => {
    const metadata = JSON.stringify({ other_key: "value" });
    expect(extractPullRequestUrl(metadata)).toBeNull();
  });

  it("returns null when the value is not a string", () => {
    const metadata = JSON.stringify({ presets__pull_request_url: 123 });
    expect(extractPullRequestUrl(metadata)).toBeNull();
  });

  it("returns null when the URL uses a javascript: protocol", () => {
    const metadata = JSON.stringify({
      presets__pull_request_url: "javascript:alert(1)",
    });
    expect(extractPullRequestUrl(metadata)).toBeNull();
  });

  it("returns null when the URL uses a data: protocol", () => {
    const metadata = JSON.stringify({
      presets__pull_request_url: "data:text/html,<script>alert(1)</script>",
    });
    expect(extractPullRequestUrl(metadata)).toBeNull();
  });

  it("returns the URL when it uses http://", () => {
    const metadata = JSON.stringify({
      presets__pull_request_url: "http://github.com/org/repo/pull/1",
    });
    expect(extractPullRequestUrl(metadata)).toBe(
      "http://github.com/org/repo/pull/1",
    );
  });
});
