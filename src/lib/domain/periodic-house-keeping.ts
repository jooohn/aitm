import { getConfigRepositories } from "../infra/config";
import { runHouseKeeping } from "./house-keeping";

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes

export function startPeriodicHouseKeeping(): void {
  const intervalMs =
    Number(process.env.AITM_HOUSE_KEEPING_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  const run = () => {
    const repos = getConfigRepositories();
    for (const repo of repos) {
      runHouseKeeping(repo.path).catch((err) => {
        console.error(
          `[house-keeping] Unexpected error for ${repo.path}:`,
          err,
        );
      });
    }
  };

  run();
  setInterval(run, intervalMs);
}
