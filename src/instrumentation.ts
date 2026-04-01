export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { sessionService, workflowRunService } = await import(
      "./lib/container"
    );
    sessionService.recoverCrashedSessions();
    workflowRunService.recoverCrashedWorkflowRuns();
    const { startPeriodicHouseKeeping } = await import(
      "./lib/domain/periodic-house-keeping"
    );
    startPeriodicHouseKeeping();
  }
}
