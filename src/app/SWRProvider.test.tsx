// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import useSWR from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import SWRProvider from "./SWRProvider";

vi.mock("@/lib/hooks/swr/useNotificationRevalidation", () => ({
  useNotificationRevalidation: vi.fn(),
}));

afterEach(cleanup);

describe("SWRProvider", () => {
  it("sets keepPreviousData to true in the global SWR config", async () => {
    const fetcher = vi.fn(async (key: string) => {
      return `data-for-${key}`;
    });

    function TestComponent({ swrKey }: { swrKey: string }) {
      const { data, isLoading } = useSWR(swrKey, fetcher);
      return (
        <div>
          <span data-testid="data">{data ?? "no-data"}</span>
          <span data-testid="loading">
            {isLoading ? "loading" : "not-loading"}
          </span>
        </div>
      );
    }

    // Render with key-1
    const { rerender } = render(
      <SWRProvider>
        <TestComponent swrKey="key-1" />
      </SWRProvider>,
    );

    // Wait for initial data
    await waitFor(() => {
      expect(screen.getByTestId("data")).toHaveTextContent("data-for-key-1");
    });

    // Change key to key-2 — with keepPreviousData: true, "data-for-key-1" should be
    // retained while key-2 fetches, so we should never see "no-data"
    rerender(
      <SWRProvider>
        <TestComponent swrKey="key-2" />
      </SWRProvider>,
    );

    // The data should never be "no-data" because keepPreviousData keeps stale data
    expect(screen.getByTestId("data")).not.toHaveTextContent("no-data");

    // Eventually it should show the new data
    await waitFor(() => {
      expect(screen.getByTestId("data")).toHaveTextContent("data-for-key-2");
    });
  });
});
