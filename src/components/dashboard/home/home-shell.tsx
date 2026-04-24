// src/components/dashboard/home/home-shell.tsx
import type { ReactNode } from "react";

export function HomeShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: "clamp(14px, 1.6vw, 28px)",
        width: "100%",
      }}
    >
      {children}
    </div>
  );
}
