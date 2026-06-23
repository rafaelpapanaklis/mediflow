import type { Metadata } from "next";
import { getAdminSession, listAdminSessions } from "@/lib/admin-auth";
import { SesionesClient } from "./sesiones-client";

export const metadata: Metadata = { title: "Sesiones — DaleControl" };
// La sesión es por-request; nunca cachear.
export const dynamic = "force-dynamic";

export default async function SesionesPage() {
  const ctx = await getAdminSession();
  // El layout ya bloquea sin sesión; este guard es defensa en profundidad.
  if (!ctx) {
    return (
      <div style={{ padding: 24, color: "var(--text-2)", fontSize: 14 }}>
        No autorizado.
      </div>
    );
  }

  const sessions = await listAdminSessions(ctx.user.id, ctx.sessionId);

  // Solo datos NO sensibles al cliente (jamás totpSecret/tokenHash).
  const initial = sessions.map((s) => ({
    id: s.id,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: s.current,
  }));

  return <SesionesClient initial={initial} adminEmail={ctx.user.email} />;
}
