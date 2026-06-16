// Estudio IA (WS-MKT-T2) — server component.
// Pre-carga el saldo de tokens IA de la clínica (en el servidor, sin round-trip
// extra en el cliente) y delega la UI interactiva a StudioClient.

import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import StudioClient from "./studio-client";

export const dynamic = "force-dynamic";

export default async function MarketingStudioPage() {
  const ctx = await getAuthContext();

  let initialTokens: { used: number; limit: number; remaining: number } | null = null;
  if (ctx?.clinicId) {
    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { aiTokensUsed: true, aiTokensLimit: true },
    });
    if (clinic) {
      initialTokens = {
        used: clinic.aiTokensUsed,
        limit: clinic.aiTokensLimit,
        remaining: Math.max(0, clinic.aiTokensLimit - clinic.aiTokensUsed),
      };
    }
  }

  return <StudioClient initialTokens={initialTokens} />;
}
