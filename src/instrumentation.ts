export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeContainer } = await import("./backend/container");
    initializeContainer();
    const { sessionService, workflowRunService, houseKeepingService } =
      await import("./backend/container");
    sessionService.recoverCrashedSessions();
    await workflowRunService.recoverCrashedWorkflowRuns();
    houseKeepingService.startPeriodicHouseKeeping();
  }
}
