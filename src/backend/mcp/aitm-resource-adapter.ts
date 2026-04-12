import { readFile, stat } from "fs/promises";
import { extname, join } from "path";
import {
  toChatDetailDto,
  toChatDto,
  toSessionDto,
  toWorkflowDefinitionDto,
  toWorkflowRunDetailDto,
  toWorkflowRunDto,
} from "@/backend/api/dto";
import type { Container } from "@/backend/container";
import { resolveArtifactBasePath } from "@/backend/domain/worktrees";
import { splitAlias } from "@/lib/utils/inferAlias";

type ResourceContents =
  | { uri: string; mimeType: string; text: string }
  | { uri: string; mimeType: string; blob: string };

export interface AitmMcpResource {
  name: string;
  title: string;
  uri: string;
  description: string;
  mimeType: string;
  read: () => Promise<{ contents: ResourceContents[] }>;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function encodeArtifactPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodePathSegment)
    .join("/");
}

function jsonResource(
  uri: string,
  title: string,
  description: string,
  value: unknown,
): AitmMcpResource {
  return {
    name: uri,
    title,
    uri,
    description,
    mimeType: "application/json",
    async read() {
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(value, null, 2),
          },
        ],
      };
    },
  };
}

function resolveArtifactMimeType(artifactPath: string): string {
  switch (extname(artifactPath).toLowerCase()) {
    case ".json":
      return "application/json";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".txt":
    case ".log":
    case ".yaml":
    case ".yml":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function readArtifactContents(
  uri: string,
  filePath: string,
  mimeType: string,
): Promise<{ contents: ResourceContents[] }> {
  const body = await readFile(filePath);
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return {
      contents: [
        {
          uri,
          mimeType,
          text: body.toString("utf8"),
        },
      ],
    };
  }

  return {
    contents: [
      {
        uri,
        mimeType,
        blob: body.toString("base64"),
      },
    ],
  };
}

export class AitmMcpResourceAdapter {
  constructor(private readonly container: Container) {}

  async listResources(): Promise<AitmMcpResource[]> {
    const container = this.container;
    const resources: AitmMcpResource[] = [];
    const repositories = await container.repositoryService.listRepositories();
    const workflowRuns = container.workflowRunService.listWorkflowRuns({});
    const sessions = container.sessionService.listSessions({});
    const chats = container.chatService.listChats();
    const workflows = Object.entries(container.config.workflows).sort(
      ([left], [right]) => left.localeCompare(right),
    );

    resources.push(
      jsonResource(
        "aitm://config/snapshot",
        "aitm config snapshot",
        "Loaded aitm configuration snapshot. First pass assumes local single-user access and does not add separate MCP auth.",
        container.config,
      ),
      jsonResource(
        "aitm://repositories",
        "Repositories",
        "Configured repositories known to aitm.",
        repositories,
      ),
      jsonResource(
        "aitm://workflows",
        "Workflows",
        "Configured workflow definitions available to aitm.",
        Object.fromEntries(
          workflows.map(([name, workflow]) => [
            name,
            toWorkflowDefinitionDto(workflow),
          ]),
        ),
      ),
      jsonResource(
        "aitm://workflow-runs",
        "Workflow runs",
        "Workflow runs tracked by aitm.",
        workflowRuns.map(toWorkflowRunDto),
      ),
      jsonResource(
        "aitm://sessions",
        "Sessions",
        "Agent sessions tracked by aitm.",
        sessions.map(toSessionDto),
      ),
      jsonResource(
        "aitm://chats",
        "Chats",
        "Planning chats tracked by aitm.",
        chats.map(toChatDto),
      ),
    );

    for (const repository of repositories) {
      const { organization, name } = splitAlias(repository.path);
      const repoUri = `aitm://repositories/${encodePathSegment(organization)}/${encodePathSegment(name)}`;
      const worktreesUri = `${repoUri}/worktrees`;

      resources.push({
        name: repoUri,
        title: `Repository ${organization}/${name}`,
        uri: repoUri,
        description: `Repository detail for ${organization}/${name}.`,
        mimeType: "application/json",
        async read() {
          const githubUrl = await container.repositoryService.getGitHubUrl(
            repository.path,
          );
          return {
            contents: [
              {
                uri: repoUri,
                mimeType: "application/json",
                text: JSON.stringify(
                  {
                    ...repository,
                    github_url: githubUrl,
                    commands: container.repositoryService.getCommandsForAlias(
                      `${organization}/${name}`,
                    ),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        },
      });

      resources.push({
        name: worktreesUri,
        title: `Worktrees for ${organization}/${name}`,
        uri: worktreesUri,
        description: `Git worktrees for repository ${organization}/${name}.`,
        mimeType: "application/json",
        async read() {
          const worktrees = await container.worktreeService.listWorktrees(
            repository.path,
          );
          return {
            contents: [
              {
                uri: worktreesUri,
                mimeType: "application/json",
                text: JSON.stringify(worktrees, null, 2),
              },
            ],
          };
        },
      });
    }

    for (const [workflowName, workflow] of workflows) {
      const workflowUri = `aitm://workflows/${encodePathSegment(workflowName)}`;
      resources.push(
        jsonResource(
          workflowUri,
          `Workflow ${workflowName}`,
          `Workflow definition for ${workflowName}.`,
          toWorkflowDefinitionDto(workflow),
        ),
      );
    }

    for (const run of workflowRuns) {
      const runUri = `aitm://workflow-runs/${encodePathSegment(run.id)}`;
      const artifactsUri = `${runUri}/artifacts`;
      const runDetail = container.workflowRunService.getWorkflowRun(run.id);
      if (!runDetail) {
        continue;
      }
      resources.push(
        jsonResource(
          runUri,
          `Workflow run ${run.id}`,
          `Detailed workflow run state for ${run.id}.`,
          toWorkflowRunDetailDto(runDetail),
        ),
      );

      const artifactResources = await this.listArtifactResources(run.id);
      resources.push(
        jsonResource(
          artifactsUri,
          `Artifacts for workflow run ${run.id}`,
          `Declared artifact snapshot for workflow run ${run.id}.`,
          artifactResources.map(
            ({ path, exists, uri, mimeType, description }) => ({
              path,
              exists,
              uri,
              mimeType,
              ...(description ? { description } : {}),
            }),
          ),
        ),
      );

      resources.push(
        ...artifactResources
          .filter((artifact) => artifact.exists)
          .map((artifact) => ({
            name: artifact.uri,
            title: `Artifact ${artifact.path}`,
            uri: artifact.uri,
            description:
              artifact.description ??
              `Artifact ${artifact.path} for workflow run ${run.id}.`,
            mimeType: artifact.mimeType,
            read: () =>
              readArtifactContents(
                artifact.uri,
                artifact.filePath,
                artifact.mimeType,
              ),
          })),
      );
    }

    for (const session of sessions) {
      const sessionUri = `aitm://sessions/${encodePathSegment(session.id)}`;
      resources.push(
        jsonResource(
          sessionUri,
          `Session ${session.id}`,
          `Detailed session state for ${session.id}.`,
          toSessionDto(session),
        ),
      );
    }

    for (const chat of chats) {
      const chatUri = `aitm://chats/${encodePathSegment(chat.id)}`;
      resources.push({
        name: chatUri,
        title: `Chat ${chat.id}`,
        uri: chatUri,
        description: `Detailed chat state for ${chat.id}.`,
        mimeType: "application/json",
        async read() {
          return {
            contents: [
              {
                uri: chatUri,
                mimeType: "application/json",
                text: JSON.stringify(
                  toChatDetailDto(
                    chat,
                    container.chatService.listProposals(chat.id),
                  ),
                  null,
                  2,
                ),
              },
            ],
          };
        },
      });
    }

    return resources.sort((left, right) => left.uri.localeCompare(right.uri));
  }

  async readResource(uri: string): Promise<{ contents: ResourceContents[] }> {
    const resource = (await this.listResources()).find(
      (candidate) => candidate.uri === uri,
    );
    if (!resource) {
      throw new Error(`Unknown MCP resource: ${uri}`);
    }
    return resource.read();
  }

  private async listArtifactResources(workflowRunId: string): Promise<
    Array<{
      path: string;
      exists: boolean;
      uri: string;
      filePath: string;
      mimeType: string;
      description?: string;
    }>
  > {
    const run = this.container.workflowRunService.getWorkflowRun(workflowRunId);
    if (!run) return [];

    const workflow = this.container.config.workflows[run.workflow_name];
    const declaredArtifacts = workflow?.artifacts ?? [];
    const worktree = await this.container.worktreeService
      .findWorktree(run.repository_path, run.worktree_branch)
      .catch(() => null);

    if (!worktree) {
      return declaredArtifacts.map((artifact) => ({
        path: artifact.path,
        exists: false,
        uri: `aitm://workflow-runs/${encodePathSegment(run.id)}/artifacts/${encodeArtifactPath(artifact.path)}`,
        filePath: "",
        mimeType: resolveArtifactMimeType(artifact.path),
        description: artifact.description,
      }));
    }

    const artifactRoot = resolveArtifactBasePath(worktree, run.id);
    return Promise.all(
      declaredArtifacts.map(async (artifact) => {
        const filePath = join(artifactRoot, artifact.path);
        const exists = await stat(filePath)
          .then((stats: { isFile(): boolean }) => stats.isFile())
          .catch(() => false);

        return {
          path: artifact.path,
          exists,
          uri: `aitm://workflow-runs/${encodePathSegment(run.id)}/artifacts/${encodeArtifactPath(artifact.path)}`,
          filePath,
          mimeType: resolveArtifactMimeType(artifact.path),
          description: artifact.description,
        };
      }),
    );
  }
}
