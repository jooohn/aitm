import { describe, expect, it } from "vitest";
import { BranchNameService } from ".";

describe("BranchNameService", () => {
  const service = new BranchNameService();

  describe("generate", () => {
    it("slugifies the first input value into a branch name with suffix", () => {
      const result = service.generate("development-flow", {
        "feature-description": "Add dark mode support",
      });
      expect(result).toMatch(/^feat\/add-dark-mode-support-[a-z0-9]+$/);
    });

    it("uses feat/ prefix for development-flow", () => {
      const result = service.generate("development-flow", {
        description: "Implement login page",
      });
      expect(result).toMatch(/^feat\/implement-login-page-[a-z0-9]+$/);
    });

    it("uses fix/ prefix for bugfix-flow", () => {
      const result = service.generate("bugfix-flow", {
        description: "Fix null pointer in parser",
      });
      expect(result).toMatch(/^fix\/fix-null-pointer-in-parser-[a-z0-9]+$/);
    });

    it("uses refactor/ prefix for refactor-flow", () => {
      const result = service.generate("refactor-flow", {
        description: "Extract helper module",
      });
      expect(result).toMatch(/^refactor\/extract-helper-module-[a-z0-9]+$/);
    });

    it("uses task/ prefix for unknown workflow names", () => {
      const result = service.generate("custom-workflow", {
        description: "Do something",
      });
      expect(result).toMatch(/^task\/do-something-[a-z0-9]+$/);
    });

    it("truncates long branch names to ~50 chars", () => {
      const result = service.generate("development-flow", {
        description:
          "Add a very long feature description that exceeds the maximum allowed length for branch names",
      });
      expect(result.length).toBeLessThanOrEqual(50);
      expect(result).toMatch(/^feat\//);
      expect(result).not.toMatch(/-$/);
    });

    it("removes special characters", () => {
      const result = service.generate("development-flow", {
        description: "Fix bug #123: handle @mentions & <tags>",
      });
      expect(result).toMatch(
        /^feat\/fix-bug-123-handle-mentions-tags-[a-z0-9]+$/,
      );
    });

    it("collapses consecutive hyphens", () => {
      const result = service.generate("development-flow", {
        description: "Fix   multiple   spaces",
      });
      expect(result).toMatch(/^feat\/fix-multiple-spaces-[a-z0-9]+$/);
    });

    it("falls back to timestamp when no inputs provided", () => {
      const result = service.generate("development-flow", {});
      expect(result).toMatch(/^feat\/\d+-[a-z0-9]+$/);
    });

    it("falls back to timestamp when inputs are empty strings", () => {
      const result = service.generate("development-flow", {
        description: "   ",
      });
      expect(result).toMatch(/^feat\/\d+-[a-z0-9]+$/);
    });

    it("uses the first input value when multiple inputs exist", () => {
      const result = service.generate("development-flow", {
        title: "Add search feature",
        details: "Should support fuzzy matching",
      });
      expect(result).toMatch(/^feat\/add-search-feature-[a-z0-9]+$/);
    });

    it("appends a unique suffix to avoid branch name collisions", () => {
      const result1 = service.generate("development-flow", {
        description: "Add dark mode support",
      });
      const result2 = service.generate("development-flow", {
        description: "Add dark mode support",
      });
      expect(result1).not.toBe(result2);
    });

    it("includes a unique suffix even for timestamp fallback names", () => {
      const result1 = service.generate("development-flow", {});
      const result2 = service.generate("development-flow", {});
      expect(result1).not.toBe(result2);
    });

    it("keeps total length within 50 chars including the suffix", () => {
      const result = service.generate("development-flow", {
        description:
          "Add a very long feature description that exceeds the maximum allowed length for branch names",
      });
      expect(result.length).toBeLessThanOrEqual(50);
    });
  });
});
