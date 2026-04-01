export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { sessionService, workflowRunService, houseKeepingService } =
      await import("./lib/container");
    sessionService.recoverCrashedSessions();
    workflowRunService.recoverCrashedWorkflowRuns();
    houseKeepingService.startPeriodicHouseKeeping();
  }
}
