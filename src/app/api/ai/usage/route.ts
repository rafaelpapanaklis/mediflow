import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import {
  AI_FEATURE_LABEL_KEY,
  aiMonthStart,
  normalizeAiFeature,
  type AiFeature,
} from "@/lib/ai-tokens";
import { localeFromClinic, serverTForLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/usage — cupo mensual de IA del plan (clinics.aiTokensUsed/Limit)
 * + desglose por feature del MES EN CURSO.
 *
 * Multi-tenant: el clinicId sale SIEMPRE de la sesión, jamás del query string.
 * Sin datos de paciente. userId se guarda en el desglose pero NO se expone
 * en esta v1 (el corte por usuario queda como follow-up).
 *
 * NO es el monedero prepago del bot de WhatsApp (ver /api/ai-wallet).
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: {
      aiTokensUsed: true,
      aiTokensLimit: true,
      aiLastResetAt: true,
      locale: true,
    },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const now = new Date();
  const lastReset = new Date(clinic.aiLastResetAt);
  // Misma aritmética que aiTokenLimitError: mes de calendario con getters
  // locales. Aquí NO escribimos el reseteo (un GET no debe mutar) — solo
  // reportamos 0 si el contador quedó en un mes anterior; la próxima llamada
  // de IA hace el reset real.
  const monthsDiff =
    (now.getFullYear() - lastReset.getFullYear()) * 12 + (now.getMonth() - lastReset.getMonth());
  const counterIsStale = monthsDiff >= 1;
  const limit = clinic.aiTokensLimit ?? 0;
  // El cupo se renueva el día 1 del mes siguiente.
  const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const { t } = serverTForLocale(localeFromClinic(clinic));

  // Desglose del mes en curso. Fail-open: si la tabla todavía no existe
  // (sql/ai-quota-usage.sql sin aplicar) devolvemos el medidor sin detalle en
  // vez de romper la pantalla.
  let byFeature: { feature: AiFeature; label: string; tokens: number; percent: number }[] = [];
  let byFeatureTotal = 0;
  try {
    const rows = await prisma.aiQuotaUsage.groupBy({
      by: ["feature"],
      where: { clinicId: ctx.clinicId, createdAt: { gte: aiMonthStart(now) } },
      _sum: { tokens: true },
    });

    // Agrupa por slug normalizado (un slug viejo/desconocido cae en "other").
    const totals: Record<string, number> = {};
    for (let i = 0; i < rows.length; i++) {
      const slug = normalizeAiFeature(rows[i].feature);
      totals[slug] = (totals[slug] ?? 0) + (rows[i]._sum.tokens ?? 0);
    }

    byFeatureTotal = Object.keys(totals).reduce((acc, k) => acc + totals[k], 0);

    byFeature = Object.keys(totals)
      .map((slug) => ({
        feature: slug as AiFeature,
        label: t(AI_FEATURE_LABEL_KEY[slug as AiFeature] ?? AI_FEATURE_LABEL_KEY.other),
        tokens: totals[slug],
        percent:
          byFeatureTotal > 0 ? Math.round((totals[slug] / byFeatureTotal) * 100) : 0,
      }))
      .filter((r) => r.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens);
  } catch (err) {
    console.error("[ai/usage] desglose no disponible (fail-open)", {
      clinicId: ctx.clinicId,
      err,
    });
  }

  // Reconciliación. Si el contador quedó en un mes anterior reportamos 0 (el
  // reseteo real lo escribe la siguiente llamada de IA), PERO si el desglose
  // del mes en curso ya tiene filas, esas filas SON consumo real de este mes
  // que se cobró antes de que alguna ruta disparara el reseteo perezoso. Sin
  // esto la pantalla mostraría "0 usado" encima de un desglose con tokens.
  const used = counterIsStale ? byFeatureTotal : clinic.aiTokensUsed;
  const remaining = Math.max(0, limit - used);
  // Guarda contra límite 0 (plan Básico): 0/0 daría NaN.
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return NextResponse.json({
    used,
    limit,
    remaining,
    percent,
    resetAt: resetAt.toISOString(),
    // El aviso proactivo de cupo es solo para ADMIN; el flag viaja aquí para
    // que el banner pueda auto-gatearse desde componentes cliente que no
    // conocen el rol. clinicId va para que el cliente pueda namespacear cosas
    // por sede (p. ej. el "descartado" del aviso) — es la clínica de su propia
    // sesión, no expone nada ajeno.
    isAdmin: ctx.isAdmin,
    clinicId: ctx.clinicId,
    byFeature,
    // Suma del desglose. Puede ser menor que `used` si la clínica consumió IA
    // antes de que existiera el desglose: la UI lo muestra como "sin detalle".
    byFeatureTotal,
  });
}
