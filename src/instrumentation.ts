export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { sessionService, workflowRunService, houseKeepingService } =
      await import("./backend/container");
    sessionService.recoverCrashedSessions();
    workflowRunService.recoverCrashedWorkflowRuns();
    houseKeepingService.startPeriodicHouseKeeping();
  }
}
