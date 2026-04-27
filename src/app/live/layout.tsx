import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MediFlow · vista pública",
  robots: { index: false, follow: false },
};

/**
 * Layout standalone para /live/[slug]. NO incluye sidebar dashboard, NO
 * requiere auth, fullscreen-friendly para TV de sala de espera. Carga
 * la fuente Inter inline.
 */
export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0F1A2E",
        color: "#fff",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
}
