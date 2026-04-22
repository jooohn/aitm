import { AgentService } from "@/backend/domain/agent";
import { ClaudeSDK } from "@/backend/domain/agent/claude-sdk";
import { CodexSDK } from "@/backend/domain/agent/codex-sdk";
import { BranchNameService } from "@/backend/domain/branch-name";
import { ChatService } from "@/backend/domain/chats";
import { ChatRepository } from "@/backend/domain/chats/chat-repository";
import { GitHubBranchService } from "@/backend/domain/github";
import { HouseKeepingService } from "@/backend/domain/house-keeping";
import { ProcessService } from "@/backend/domain/processes";
import { RepositoryService } from "@/backend/domain/repositories";
import { SessionService } from "@/backend/domain/sessions";
import { SessionRepository } from "@/backend/domain/sessions/session-repository";
import { WorkflowRunService } from "@/backend/domain/workflow-runs";
import { CommandExecutionRepository } from "@/backend/domain/workflow-runs/command-execution-repository";
import { CommandStepExecutor } from "@/backend/domain/workflow-runs/command-step-executor";
import { WorkflowRunRepository } from "@/backend/domain/workflow-runs/workflow-run-repository";
import { WorktreeService } from "@/backend/domain/worktrees";
import { type ConfigSnapshot, loadConfig } from "@/backend/infra/config";
import { db } from "@/backend/infra/db";
import { eventBus } from "@/backend/infra/event-bus";
import { spawnAsync } from "@/backend/utils/process";

const DEFAULT_CONFIG: ConfigSnapshot = {
  agents: { default: { provider: "claude" } },
  default_agent: "default",
  repositories: [],
  workflows: {},
};

function shouldUseDefaultConfigOnBootstrap(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.NEXT_PHASE === "phase-production-build"
  );
}

export type Container = {
  config: ConfigSnapshot;
  workflowRunRepository: WorkflowRunRepository;
  commandExecutionRepository: CommandExecutionRepository;
  sessionRepository: SessionRepository;
  chatRepository: ChatRepository;
  worktreeService: WorktreeService;
  repositoryService: RepositoryService;
  agentService: AgentService;
  sessionService: SessionService;
  chatService: ChatService;
  commandStepExecutor: CommandStepExecutor;
  workflowRunService: WorkflowRunService;
  gitHubBranchService: GitHubBranchService;
  houseKeepingService: HouseKeepingService;
};

// ProcessService is a module-level singleton that survives container rebuilds,
// since it holds live child process references that would be orphaned otherwise.
export const processService = new ProcessService(eventBus);

let tablesEnsured = false;

function createContainer(cfg: ConfigSnapshot): Container {
  // Clean up listeners from any previous container's services to avoid
  // duplicate handlers when the container is rebuilt (e.g. in tests).
  eventBus.removeAllListeners();

  const workflowRunRepository = new WorkflowRunRepository(db, eventBus);
  const commandExecutionRepository = new CommandExecutionRepository(db);
  const sessionRepository = new SessionRepository(db, eventBus);
  const chatRepository = new ChatRepository(db, eventBus);
  const worktreeService = new WorktreeService();
  const repositoryService = new RepositoryService(cfg.repositories);
  const runtimes = {
    claude: new ClaudeSDK(),
    codex: new CodexSDK(),
  };
  const defaultAgentConfig = cfg.agents[cfg.default_agent];
  const agentService = new AgentService(runtimes, sessionRepository, eventBus);
  const sessionService = new SessionService(
    sessionRepository,
    agentService,
    worktreeService,
    eventBus,
    defaultAgentConfig,
  );
  const gitHubBranchService = new GitHubBranchService(spawnAsync);
  const commandStepExecutor = new CommandStepExecutor();
  const workflowRunService = new WorkflowRunService(
    workflowRunRepository,
    commandExecutionRepository,
    sessionService,
    worktreeService,
    commandStepExecutor,
    eventBus,
    cfg.workflows,
    cfg.agents,
    cfg.default_agent,
  );
  const chatService = new ChatService(
    chatRepository,
    runtimes,
    worktreeService,
    workflowRunService,
    new BranchNameService(),
    defaultAgentConfig,
    cfg.workflows,
  );
  const houseKeepingService = new HouseKeepingService(
    sessionService,
    worktreeService,
    workflowRunService,
    cfg.repositories,
    eventBus,
  );

  if (!tablesEnsured) {
    workflowRunRepository.ensureTables();
    commandExecutionRepository.ensureTables();
    sessionRepository.ensureTables();
    chatRepository.ensureTables();
    tablesEnsured = true;
  }

  return {
    config: cfg,
    workflowRunRepository,
    commandExecutionRepository,
    sessionRepository,
    chatRepository,
    worktreeService,
    repositoryService,
    agentService,
    sessionService,
    chatService,
    commandStepExecutor,
    workflowRunService,
    gitHubBranchService,
    houseKeepingService,
  };
}

let currentContainer: Container | null = null;

export function getContainer(): Container {
  if (!currentContainer) {
    const cfg = shouldUseDefaultConfigOnBootstrap()
      ? DEFAULT_CONFIG
      : loadConfig();
    currentContainer = createContainer(cfg);
  }
  return currentContainer;
}

export function initializeContainer(): void {
  currentContainer = createContainer(loadConfig());
}
