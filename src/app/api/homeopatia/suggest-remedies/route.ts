import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

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
  const rl = rateLimit(req, 10, 5 * 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurado" }, { status: 503 });
  }

  const { symptoms, constitutional } = await req.json();
  if (!Array.isArray(symptoms) || symptoms.length === 0) {
    return NextResponse.json({ error: "symptoms debe ser un array no vacío" }, { status: 400 });
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { aiTokensUsed: true, aiTokensLimit: true },
  });
  if (clinic && clinic.aiTokensUsed >= clinic.aiTokensLimit) {
    return NextResponse.json({ error: "Límite mensual de IA alcanzado" }, { status: 429 });
  }

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
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: { aiTokensUsed: { increment: totalTokens } },
    });

    const text = data.content?.[0]?.text ?? "{}";
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { remedies: [] };

    return NextResponse.json(parsed);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}
