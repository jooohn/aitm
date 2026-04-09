import { AgentService } from "@/backend/domain/agent";
import { ClaudeSDK } from "@/backend/domain/agent/claude-sdk";
import { CodexSDK } from "@/backend/domain/agent/codex-sdk";
import { BranchNameService } from "@/backend/domain/branch-name";
import { ChatService } from "@/backend/domain/chats";
import { ChatRepository } from "@/backend/domain/chats/chat-repository";
import { HouseKeepingService } from "@/backend/domain/house-keeping";
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

export let config: ConfigSnapshot;
export let workflowRunRepository: WorkflowRunRepository;
export let sessionRepository: SessionRepository;
export let chatRepository: ChatRepository;
export let worktreeService: WorktreeService;
export let repositoryService: RepositoryService;
export let agentService: AgentService;
export let sessionService: SessionService;
export let chatService: ChatService;
export let commandStepExecutor: CommandStepExecutor;
export let workflowRunService: WorkflowRunService;
export let houseKeepingService: HouseKeepingService;

let tablesEnsured = false;

function buildContainer(cfg: ConfigSnapshot): void {
  config = cfg;
  eventBus.removeAllListeners();

  workflowRunRepository = new WorkflowRunRepository(db, eventBus);
  sessionRepository = new SessionRepository(db, eventBus);
  chatRepository = new ChatRepository(db);
  worktreeService = new WorktreeService();
  repositoryService = new RepositoryService(config.repositories);
  const runtimes = {
    claude: new ClaudeSDK(),
    codex: new CodexSDK(),
  };
  agentService = new AgentService(runtimes, sessionRepository, eventBus);
  sessionService = new SessionService(
    sessionRepository,
    agentService,
    worktreeService,
    eventBus,
    config.agent,
  );
  commandStepExecutor = new CommandStepExecutor();
  workflowRunService = new WorkflowRunService(
    workflowRunRepository,
    sessionService,
    worktreeService,
    commandStepExecutor,
    eventBus,
    config.workflows,
    config.agent,
  );
  chatService = new ChatService(
    chatRepository,
    runtimes,
    worktreeService,
    workflowRunService,
    new BranchNameService(),
    config.agent,
    config.workflows,
  );
  houseKeepingService = new HouseKeepingService(
    sessionService,
    worktreeService,
    config.repositories,
    eventBus,
  );

  if (!tablesEnsured) {
    workflowRunRepository.ensureTables();
    sessionRepository.ensureTables();
    chatRepository.ensureTables();
    tablesEnsured = true;
  }
}

export function initializeContainer(): void {
  buildContainer(loadConfig());
}

buildContainer(
  shouldUseDefaultConfigOnBootstrap() ? DEFAULT_CONFIG : loadConfig(),
);
