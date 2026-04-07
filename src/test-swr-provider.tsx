import type { ReactNode } from "react";
import { SWRConfig } from "swr";

export function SWRTestProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        dedupingInterval: 0,
        provider: () => new Map(),
      }}
    >
      {children}
    </SWRConfig>
  );
}
