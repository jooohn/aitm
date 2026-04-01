export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverCrashedSessions } = await import("./lib/domain/sessions");
    const { workflowRunService } = await import("./lib/container");
    recoverCrashedSessions();
    workflowRunService.recoverCrashedWorkflowRuns();
    const { startPeriodicHouseKeeping } = await import(
      "./lib/domain/periodic-house-keeping"
    );
    startPeriodicHouseKeeping();
  }
}
