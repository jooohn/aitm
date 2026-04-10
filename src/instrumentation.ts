export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeContainer } = await import("./backend/container");
    initializeContainer();
    const {
      sessionService,
      workflowRunService,
      chatService,
      houseKeepingService,
    } = await import("./backend/container");
    sessionService.recoverCrashedSessions();
    await workflowRunService.recoverCrashedWorkflowRuns();
    chatService.recoverCrashedChats();
    houseKeepingService.startPeriodicHouseKeeping();
  }
}
