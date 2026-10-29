import type { Metadata } from "next";
import { listAdminSessions } from "@/lib/admin-auth";
import { SesionesClient } from "./sesiones-client";
import { requireAdminPage } from "@/lib/admin-page-guard";

export const metadata: Metadata = { title: "Sesiones — DaleControl" };
// La sesión es por-request; nunca cachear.
export const dynamic = "force-dynamic";

export default async function SesionesPage() {
  // Sin sesión, a /admin/login (el layout no basta: ver @/lib/admin-page-guard).
  const ctx = await requireAdminPage();

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
