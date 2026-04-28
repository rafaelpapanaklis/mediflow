import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { chat } from "@/lib/integrations/claude";

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
 */
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

  const result = await chat({
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
