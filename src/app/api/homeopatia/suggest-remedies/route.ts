import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { addAiTokens, aiTokenLimitError } from "@/lib/ai-tokens";
import { persistentRateLimit } from "@/lib/failban";

const SYSTEM_PROMPT = `Eres un homeópata experto basado en Boericke, Kent y el Organon de Hahnemann. Dado un conjunto de síntomas rúbricos (mentales, generales y locales), sugieres los remedios más probables con su score de coincidencia (0-100) y la potencia inicial recomendada.

Reglas:
- Devuelve EXACTAMENTE un JSON válido, nada más.
- Entre 3 y 6 remedios, ordenados de mayor a menor score.
- Para cada uno: name (nombre latino abreviado), score (0-100), potency ("30CH", "200CH", "1M"), rationale (una línea corta en español).
- El top 1 debe destacar claramente por síntomas característicos (keynotes).
- Prefiere policresto si los síntomas son generales; remedios específicos si hay keynotes claros.
- No inventes remedios. Solo remedios del repertorio clásico.

Formato de salida:
{"remedies":[{"name":"...","score":...,"potency":"...","rationale":"..."}]}`;

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Freno de gasto POR CLÍNICA (no por IP: todo el consultorio comparte IP) y
  // persistente en Upstash — el Map en memoria no limita en serverless.
  // Misma ventana de siempre: 10 / 5 min.
  const rl = await persistentRateLimit(req, { id: `ai:${ctx.clinicId}`, limit: 10, windowSec: 300 });
  if (rl) return rl;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurado" }, { status: 503 });
  }

  const { symptoms, constitutional } = await req.json();
  if (!Array.isArray(symptoms) || symptoms.length === 0) {
    return NextResponse.json({ error: "symptoms debe ser un array no vacío" }, { status: 400 });
  }

  // Mismo gate que el resto de la IA. Antes esta ruta era la ÚNICA que leía el
  // contador crudo sin aplicar el reseteo mensual perezoso: el día 1 cobraba
  // contra el mes viejo (falso 429 con el cupo agotado de ayer, y el desglose
  // del mes nuevo descuadrado contra aiTokensUsed). aiTokenLimitError resetea
  // si cambió el mes y devuelve además used/limit, así que el cliente puede
  // distinguir "plan sin IA" (limit 0) de "se acabó el cupo".
  const aiErr = await aiTokenLimitError(ctx.clinicId);
  if (aiErr) return NextResponse.json(aiErr, { status: 429 });

  const userMsg = `Síntomas rúbricos:\n${symptoms.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}${constitutional ? `\n\nConstitucional: ${constitutional}` : ""}\n\nResponde con el JSON exacto.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? "Error API");

    const totalTokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    await addAiTokens(ctx.clinicId, totalTokens, "homeopathy", ctx.userId);

    const text = data.content?.[0]?.text ?? "{}";
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { remedies: [] };

    return NextResponse.json(parsed);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}
