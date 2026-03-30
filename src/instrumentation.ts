export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverCrashedSessions } = await import("./lib/sessions");
    const { recoverCrashedWorkflowRuns } = await import("./lib/workflow-runs");
    recoverCrashedSessions();
    recoverCrashedWorkflowRuns();
  }
}
