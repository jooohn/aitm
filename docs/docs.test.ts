import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { beforeAll, describe, expect, it } from "vitest";

const docsDir = join(__dirname);
const rootDir = join(__dirname, "..");

function readDoc(relativePath: string): string {
  const fullPath = join(rootDir, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Document not found: ${fullPath}`);
  }
  return readFileSync(fullPath, "utf-8");
}

describe("README.md", () => {
  let content: string;
  beforeAll(() => {
    content = readDoc("README.md");
  });

  it("mentions multi-step workflows", () => {
    expect(content).toMatch(/multi-step workflow/i);
  });

  it("mentions manual approval gates", () => {
    expect(content).toMatch(/manual approval/i);
  });

  it("mentions workflow inputs", () => {
    expect(content).toMatch(/workflow inputs/i);
  });

  it("mentions kanban board view", () => {
    expect(content).toMatch(/kanban/i);
  });

  it("mentions multiple agent runtimes including Claude SDK", () => {
    expect(content).toMatch(/Claude SDK/i);
  });

  it("mentions re-run capabilities", () => {
    expect(content).toMatch(/re-run|rerun/i);
  });

  it("has a Key Features section", () => {
    expect(content).toMatch(/## Key Features/);
  });

  it("has an updated Tech Stack section mentioning Agent SDK and SQLite", () => {
    expect(content).toMatch(/Agent SDK/);
    expect(content).toMatch(/SQLite/i);
  });

  it("mentions multi-repository support", () => {
    expect(content).toMatch(/multi-repository/i);
  });
});

describe("docs/spec/aitm-config.md", () => {
  let content: string;
  beforeAll(() => {
    content = readDoc("docs/spec/aitm-config.md");
  });

  describe("workflow inputs", () => {
    it("documents the inputs block", () => {
      expect(content).toMatch(/inputs/);
    });

    it("documents input field types (text, multiline-text)", () => {
      expect(content).toMatch(/multiline-text/);
    });

    it("documents input field properties (label, description, required)", () => {
      expect(content).toMatch(/label/);
      expect(content).toMatch(/required/);
    });
  });

  describe("manual approval step type", () => {
    it("documents manual-approval type", () => {
      expect(content).toMatch(/manual-approval/);
    });

    it("describes manual approval as a step type", () => {
      expect(content).toMatch(/type:\s*manual-approval/);
    });
  });

  describe("command-based steps", () => {
    it("documents command field", () => {
      expect(content).toMatch(/command/);
    });
  });

  describe("permission mode", () => {
    it("documents permission_mode field", () => {
      expect(content).toMatch(/permission_mode/);
    });

    it("documents the three modes: plan, edit, full", () => {
      expect(content).toMatch(/plan/);
      expect(content).toMatch(/edit/);
      expect(content).toMatch(/full/);
    });
  });

  describe("output configuration", () => {
    it("documents output.presets", () => {
      expect(content).toMatch(/output\.presets|output.*presets/);
    });

    it("documents output.metadata", () => {
      expect(content).toMatch(/output\.metadata|output.*metadata/);
    });
  });

  it("removes human-in-the-loop from out of scope", () => {
    const outOfScope = content.match(
      /## Out of scope\n([\s\S]*?)(?=\n##|\n$|$)/,
    );
    if (outOfScope) {
      expect(outOfScope[1]).not.toMatch(/Human-in-the-loop/);
    }
  });
});

describe("docs/spec/workflow-run.md", () => {
  let content: string;
  beforeAll(() => {
    content = readDoc("docs/spec/workflow-run.md");
  });

  describe("data model updates", () => {
    it("documents inputs field on workflow_runs", () => {
      expect(content).toMatch(/`inputs`.*JSON|inputs.*\|.*JSON/i);
    });

    it("documents metadata field on workflow_runs", () => {
      expect(content).toMatch(/`metadata`.*JSON|metadata.*\|.*JSON/i);
    });

    it("documents step_type on step_executions", () => {
      expect(content).toMatch(/step_type/);
    });

    it("documents command_output on step_executions", () => {
      expect(content).toMatch(/command_output/);
    });
  });

  describe("awaiting status", () => {
    it("includes awaiting in status values", () => {
      expect(content).toMatch(/awaiting/);
    });

    it("explains when awaiting status is used", () => {
      expect(content).toMatch(/manual approval|awaiting.*input/i);
    });
  });

  describe("new operations", () => {
    it("documents stop workflow run operation", () => {
      expect(content).toMatch(/stop/i);
    });

    it("documents re-run workflow operation", () => {
      expect(content).toMatch(/re-run|rerun/i);
    });

    it("documents re-run from failed state", () => {
      expect(content).toMatch(/re-run from failed|rerun.*failed/i);
    });

    it("documents resolve manual approval operation", () => {
      expect(content).toMatch(/resolve/i);
    });
  });

  describe("API surface", () => {
    it("includes stop endpoint", () => {
      expect(content).toMatch(/\/stop/);
    });

    it("includes rerun endpoint", () => {
      expect(content).toMatch(/\/rerun/);
    });

    it("includes resolve endpoint", () => {
      expect(content).toMatch(/\/resolve/);
    });
  });

  describe("crash recovery", () => {
    it("documents crash recovery behavior", () => {
      expect(content).toMatch(/crash recovery/i);
    });

    it("mentions recoverCrashedWorkflowRuns", () => {
      expect(content).toMatch(/recoverCrashedWorkflowRuns/);
    });
  });

  it("removes human-in-the-loop from out of scope", () => {
    const outOfScope = content.match(
      /## Out of scope\n([\s\S]*?)(?=\n##|\n$|$)/,
    );
    if (outOfScope) {
      expect(outOfScope[1]).not.toMatch(/Human-in-the-loop/);
    }
  });
});

describe("docs/spec/session-management.md", () => {
  let content: string;
  beforeAll(() => {
    content = readDoc("docs/spec/session-management.md");
  });

  describe("data model updates", () => {
    it("documents agent_config column", () => {
      expect(content).toMatch(/agent_config/);
    });

    it("documents metadata_fields column", () => {
      expect(content).toMatch(/metadata_fields/);
    });
  });

  describe("agent runtime", () => {
    it("clarifies Claude SDK as primary runtime", () => {
      expect(content).toMatch(/Claude SDK/);
    });
  });

  it("removes 'Frontend UI for the reply flow' from out of scope", () => {
    const outOfScope = content.match(
      /## Out of scope\n([\s\S]*?)(?=\n##|\n$|$)/,
    );
    if (outOfScope) {
      expect(outOfScope[1]).not.toMatch(/Frontend UI for the reply flow/);
    }
  });
});

describe("ADRs", () => {
  describe("Claude SDK runtime switch ADR", () => {
    it("exists", () => {
      const files = readdirSync(join(docsDir, "adr"));
      const match = files.find((f: string) => f.includes("claude-sdk"));
      expect(match).toBeDefined();
    });

    it("has required ADR sections", () => {
      const files = readdirSync(join(docsDir, "adr"));
      const match = files.find((f: string) => f.includes("claude-sdk"));
      const content = readFileSync(join(docsDir, "adr", match!), "utf-8");
      expect(content).toMatch(/## Context/);
      expect(content).toMatch(/## Decision/);
      expect(content).toMatch(/## Consequences/);
      expect(content).toMatch(/Status:.*accepted/);
    });
  });

  describe("Manual approval step type ADR", () => {
    it("exists", () => {
      const files = readdirSync(join(docsDir, "adr"));
      const match = files.find((f: string) => f.includes("manual-approval"));
      expect(match).toBeDefined();
    });

    it("has required ADR sections", () => {
      const files = readdirSync(join(docsDir, "adr"));
      const match = files.find((f: string) => f.includes("manual-approval"));
      const content = readFileSync(join(docsDir, "adr", match!), "utf-8");
      expect(content).toMatch(/## Context/);
      expect(content).toMatch(/## Decision/);
      expect(content).toMatch(/## Consequences/);
      expect(content).toMatch(/Status:.*accepted/);
    });
  });

  describe("Event bus ADR", () => {
    it("exists", () => {
      const files = readdirSync(join(docsDir, "adr"));
      const match = files.find((f: string) => f.includes("event-bus"));
      expect(match).toBeDefined();
    });

    it("has required ADR sections", () => {
      const files = readdirSync(join(docsDir, "adr"));
      const match = files.find((f: string) => f.includes("event-bus"));
      const content = readFileSync(join(docsDir, "adr", match!), "utf-8");
      expect(content).toMatch(/## Context/);
      expect(content).toMatch(/## Decision/);
      expect(content).toMatch(/## Consequences/);
      expect(content).toMatch(/Status:.*accepted/);
    });
  });
});
