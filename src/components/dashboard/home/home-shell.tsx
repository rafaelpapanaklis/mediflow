// src/components/dashboard/home/home-shell.tsx
import type { ReactNode } from "react";

export function HomeShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding:
          "clamp(16px, 2.4vw, 28px) clamp(16px, 2vw, 24px) clamp(24px, 2.8vw, 32px)",
        width: "100%",
      }}
    >
      {children}
    </div>
  );
}
