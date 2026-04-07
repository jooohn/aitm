export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeConfig } = await import("./backend/infra/config");
    await initializeConfig();
    const { sessionService, workflowRunService, houseKeepingService } =
      await import("./backend/container");
    sessionService.recoverCrashedSessions();
    await workflowRunService.recoverCrashedWorkflowRuns();
    houseKeepingService.startPeriodicHouseKeeping();
  }
}
