import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MediFlow · vista pública",
  robots: { index: false, follow: false },
};

/**
 * Layout standalone para /live/[slug]. NO incluye sidebar dashboard, NO
 * requiere auth, fullscreen-friendly para TV de sala de espera. La página
 * misma maneja su background — el wrapper queda neutral para que el
 * toggle de tema (light/dark) lo controle vía CSS módulo.
 */
export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
}
