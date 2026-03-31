export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverCrashedSessions } = await import("./lib/domain/sessions");
    const { recoverCrashedWorkflowRuns } = await import(
      "./lib/domain/workflow-runs"
    );
    recoverCrashedSessions();
    recoverCrashedWorkflowRuns();
    const { startPeriodicHouseKeeping } = await import(
      "./lib/domain/periodic-house-keeping"
    );
    startPeriodicHouseKeeping();
  }
}
