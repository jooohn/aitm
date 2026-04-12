import { beforeEach, describe, expect, it, vi } from "vitest";

const runAllRepositoriesOnce = vi.fn().mockResolvedValue(undefined);

vi.mock("@/backend/container", () => ({
  getContainer: () => ({
    houseKeepingService: {
      runAllRepositoriesOnce,
    },
  }),
}));

import { POST } from "./route";

describe("POST /api/house-keeping/run", () => {
  beforeEach(() => {
    runAllRepositoriesOnce.mockReset();
    runAllRepositoriesOnce.mockResolvedValue(undefined);
  });

  it("returns 202 after triggering a full house-keeping sweep", async () => {
    const res = await POST();

    expect(res.status).toBe(202);
    expect(runAllRepositoriesOnce).toHaveBeenCalledOnce();
  });

  it("returns 500 when the house-keeping trigger fails", async () => {
    runAllRepositoriesOnce.mockRejectedValueOnce(new Error("boom"));

    const res = await POST();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Internal server error",
    });
  });
});
