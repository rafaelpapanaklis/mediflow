import { prisma } from "@/lib/prisma";

/**
 * Si la clínica agotó su cupo mensual de tokens IA, devuelve el objeto de error
 * (úsalo con status 429); si hay cupo, null. Resetea el contador si cambió el mes.
 * Mismo patrón que /api/ai. Plan Básico (límite 0) → siempre bloquea.
 */
export async function aiTokenLimitError(
  clinicId: string,
): Promise<{ error: string; limitReached: true; used: number; limit: number } | null> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { aiTokensUsed: true, aiTokensLimit: true, aiLastResetAt: true },
  });
  if (!clinic) return null;
  const lastReset = new Date(clinic.aiLastResetAt);
  const now = new Date();
  const monthsDiff =
    (now.getFullYear() - lastReset.getFullYear()) * 12 + (now.getMonth() - lastReset.getMonth());
  let used = clinic.aiTokensUsed;
  if (monthsDiff >= 1) {
    await prisma.clinic.update({ where: { id: clinicId }, data: { aiTokensUsed: 0, aiLastResetAt: now } });
    used = 0;
  }
  if (used >= clinic.aiTokensLimit) {
    return {
      error: "Tu plan no incluye esta función de IA o agotaste el cupo mensual. Sube de plan.",
      limitReached: true,
      used,
      limit: clinic.aiTokensLimit,
    };
  }
  return null;
}

/** Suma tokens consumidos al contador de la clínica. */
export async function addAiTokens(clinicId: string, tokens: number): Promise<void> {
  if (!tokens || tokens <= 0) return;
  await prisma.clinic.update({ where: { id: clinicId }, data: { aiTokensUsed: { increment: tokens } } });
}
