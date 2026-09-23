import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { chat } from "@/lib/integrations/claude";
import { aiTokenLimitError, addAiTokens } from "@/lib/ai-tokens";
import { recordUsageNoCharge } from "@/lib/ai-billing/record-usage";
import { AI_FEATURE_AI_INSIGHT } from "@/lib/ai-billing/types";
import { cortarSiIaApagada } from "@/lib/ai-billing/interruptores.server";

export const dynamic = "force-dynamic";

/**
 * POST /api/analytics/ai-insight
 * Body: { contextData: object, question: string }
 *
 * Pasa contextData estructurado a Claude Sonnet 4.6 con un system prompt
 * que lo limita a respuestas en español, accionables, en 80-150 palabras.
 *
 * Usado por:
 *  - Tab Procedimientos → analizar tiempos vs benchmark
 *  - Tab No-shows (futuro) → razones del riesgo por cita
 *  - Insight semanal (futuro cron) → resumen vs semana anterior
 *
 * Costo aproximado: ~$0.005 por insight con Sonnet 4.6 (input ~500 tokens
 * + output ~200 tokens). Negligible para el caso de uso pero la clínica
 * podrá desactivar IA en BASIC plan en el futuro (no implementado aún).
 *
 * Gasto (ws1-t1): descuenta del cupo del plan (addAiTokens) como siempre y
 * además deja su AiUsageEvent con el costo real (billedCents = 0) para que la
 * Tesorería lo vea. La clínica puede apagarlo en Saldo de IA.
 */
const MODEL = "claude-sonnet-4-6";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { contextData?: unknown; question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.question || !body.contextData) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // Interruptor de la clínica: ANTES de gastar, en el servidor.
  const apagada = await cortarSiIaApagada(user.clinicId, "ai_insight");
  if (apagada) return apagada;

  const aiErr = await aiTokenLimitError(user.clinicId);
  if (aiErr) return NextResponse.json(aiErr, { status: 429 });

  const result = await chat({
    model: MODEL,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Datos de la clínica (JSON):\n\n${JSON.stringify(body.contextData, null, 2)}\n\nPregunta: ${body.question}`,
      },
    ],
    maxTokens: 400,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  await addAiTokens(user.clinicId, (result.inputTokens ?? 0) + (result.outputTokens ?? 0), "ai_insight", user.id);

  // Costo real para la Tesorería. No cobra nada (el cupo ya se movió arriba) y
  // se traga sus fallos: la respuesta sigue aunque no se registre.
  if (!result.mock) {
    await recordUsageNoCharge({
      clinicId: user.clinicId,
      feature: AI_FEATURE_AI_INSIGHT,
      model: MODEL,
      inputTokens: result.inputTokens ?? 0,
      outputTokens: result.outputTokens ?? 0,
      cacheTokens: result.cacheRead ?? 0,
      cacheWriteTokens: result.cacheCreation ?? 0,
    });
  }

  return NextResponse.json({
    insight: result.text,
    mock: result.mock ?? false,
    tokens: { input: result.inputTokens ?? 0, output: result.outputTokens ?? 0 },
  });
}

const SYSTEM_PROMPT = `Eres un analista operativo de clínicas médicas y dentales. Recibes datos
estructurados (JSON) de una clínica y una pregunta. Responde en español, en
80-150 palabras, con tono profesional y accionable.

Reglas:
- Identifica el dato más anómalo o relevante.
- Da 1-2 acciones concretas (no genéricas).
- Si los datos son insuficientes, dilo y sugiere qué falta capturar.
- NO inventes números que no estén en el JSON.
- NO uses encabezados markdown grandes (#, ##). Sí puedes usar negritas con **.
- Si una métrica está dentro de rango normal, dilo brevemente y pasa al siguiente punto.`;
