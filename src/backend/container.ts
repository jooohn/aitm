import { AgentService } from "@/backend/domain/agent";
import { ClaudeSDK } from "@/backend/domain/agent/claude-sdk";
import { CodexSDK } from "@/backend/domain/agent/codex-sdk";
import { BranchNameService } from "@/backend/domain/branch-name";
import { ChatService } from "@/backend/domain/chats";
import { ChatRepository } from "@/backend/domain/chats/chat-repository";
import { HouseKeepingService } from "@/backend/domain/house-keeping";
import { ProcessService } from "@/backend/domain/processes";
import { RepositoryService } from "@/backend/domain/repositories";
import { SessionService } from "@/backend/domain/sessions";
import { SessionRepository } from "@/backend/domain/sessions/session-repository";
import { WorkflowRunService } from "@/backend/domain/workflow-runs";
import { CommandStepExecutor } from "@/backend/domain/workflow-runs/command-step-executor";
import { WorkflowRunRepository } from "@/backend/domain/workflow-runs/workflow-run-repository";
import { WorktreeService } from "@/backend/domain/worktrees";
import { type ConfigSnapshot, loadConfig } from "@/backend/infra/config";
import { db } from "@/backend/infra/db";
import { eventBus } from "@/backend/infra/event-bus";

const DEFAULT_CONFIG: ConfigSnapshot = {
  agent: { provider: "claude" },
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
  sessionRepository: SessionRepository;
  chatRepository: ChatRepository;
  worktreeService: WorktreeService;
  repositoryService: RepositoryService;
  agentService: AgentService;
  sessionService: SessionService;
  chatService: ChatService;
  commandStepExecutor: CommandStepExecutor;
  workflowRunService: WorkflowRunService;
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
  const sessionRepository = new SessionRepository(db, eventBus);
  const chatRepository = new ChatRepository(db);
  const worktreeService = new WorktreeService();
  const repositoryService = new RepositoryService(cfg.repositories);
  const runtimes = {
    claude: new ClaudeSDK(),
    codex: new CodexSDK(),
  };
  const agentService = new AgentService(runtimes, sessionRepository, eventBus);
  const sessionService = new SessionService(
    sessionRepository,
    agentService,
    worktreeService,
    eventBus,
    cfg.agent,
  );
  const commandStepExecutor = new CommandStepExecutor();
  const workflowRunService = new WorkflowRunService(
    workflowRunRepository,
    sessionService,
    worktreeService,
    commandStepExecutor,
    eventBus,
    cfg.workflows,
    cfg.agent,
  );
  const chatService = new ChatService(
    chatRepository,
    runtimes,
    worktreeService,
    workflowRunService,
    new BranchNameService(),
    cfg.agent,
    cfg.workflows,
  );
  const houseKeepingService = new HouseKeepingService(
    sessionService,
    worktreeService,
    cfg.repositories,
    eventBus,
  );

  if (!tablesEnsured) {
    workflowRunRepository.ensureTables();
    sessionRepository.ensureTables();
    chatRepository.ensureTables();
    tablesEnsured = true;
  }

  return {
    config: cfg,
    workflowRunRepository,
    sessionRepository,
    chatRepository,
    worktreeService,
    repositoryService,
    agentService,
    sessionService,
    chatService,
    commandStepExecutor,
    workflowRunService,
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
