export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeContainer, getContainer } = await import(
      "./backend/container"
    );
    initializeContainer();
    const {
      sessionService,
      workflowRunService,
      chatService,
      houseKeepingService,
    } = getContainer();
    sessionService.recoverCrashedSessions();
    await workflowRunService.recoverCrashedWorkflowRuns();
    chatService.recoverCrashedChats();
    houseKeepingService.startPeriodicHouseKeeping();
  }
}
