import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

const AI_SYSTEM_PROMPT = `Eres un asistente clínico de apoyo para médicos en México. 
Tu función es ayudar al doctor a:
1. Sugerir diagnósticos diferenciales basados en síntomas descritos
2. Recordar dosis estándar de medicamentos comunes
3. Redactar notas de evolución SOAP de forma rápida
4. Sugerir estudios de laboratorio relevantes
5. Revisar interacciones medicamentosas básicas

IMPORTANTE:
- Eres un apoyo, NO reemplazas el juicio médico del doctor
- Siempre menciona que tus sugerencias deben validarse con criterio clínico
- Responde en español médico claro y conciso
- Para medicamentos, usa nombres genéricos y menciona que las dosis deben ajustarse al paciente
- Si la consulta es urgente o de alta complejidad, recomienda consultar especialista
- Máximo 300 palabras por respuesta para ser eficiente`;

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Check API key is configured
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "El Asistente IA no está configurado. Agrega ANTHROPIC_API_KEY en las variables de entorno de Vercel.",
    }, { status: 503 });
  }

  const { message, patientContext, conversationHistory } = await req.json();
  if (!message?.trim()) return NextResponse.json({ error: "Mensaje vacío" }, { status: 400 });

  const clinic = await prisma.clinic.findUnique({
    where:  { id: ctx.clinicId },
    select: { aiTokensUsed: true, aiTokensLimit: true, aiLastResetAt: true },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  let currentTokensUsed = clinic.aiTokensUsed;

  // Reset monthly counter if needed
  const lastReset  = new Date(clinic.aiLastResetAt);
  const now        = new Date();
  const monthsDiff = (now.getFullYear() - lastReset.getFullYear()) * 12 + (now.getMonth() - lastReset.getMonth());

  if (monthsDiff >= 1) {
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data:  { aiTokensUsed: 0, aiLastResetAt: now },
    });
    currentTokensUsed = 0;
  }

  // Check monthly token limit
  if (currentTokensUsed >= clinic.aiTokensLimit) {
    const resetDate = new Date(lastReset.getFullYear(), lastReset.getMonth() + 1, 1);
    return NextResponse.json({
      error:        `Límite mensual de consultas IA alcanzado. Se renueva el ${resetDate.toLocaleDateString("es-MX", { day:"numeric", month:"long" })}.`,
      limitReached: true,
      used:         currentTokensUsed,
      limit:        clinic.aiTokensLimit,
    }, { status: 429 });
  }

  const systemPrompt = patientContext
    ? `${AI_SYSTEM_PROMPT}\n\nCONTEXTO DEL PACIENTE:\n${patientContext}`
    : AI_SYSTEM_PROMPT;

  const messages = [
    ...(conversationHistory ?? []),
    { role: "user", content: message },
  ];

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,              // ← THE FIX
        "anthropic-version": "2023-06-01",         // required by Anthropic API
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system:     systemPrompt,
        messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Anthropic API error:", data);
      throw new Error(data.error?.message ?? "Error de API de Anthropic");
    }

    const inputTokens  = data.usage?.input_tokens  ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const totalTokens  = inputTokens + outputTokens;

    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data:  { aiTokensUsed: { increment: totalTokens } },
    });

    const reply           = data.content?.[0]?.text ?? "";
    const tokensRemaining = Math.max(0, clinic.aiTokensLimit - currentTokensUsed - totalTokens);

    return NextResponse.json({
      reply,
      tokensUsed:      totalTokens,
      tokensRemaining,
      tokensLimit:     clinic.aiTokensLimit,
    });

  } catch (err: any) {
    console.error("AI error:", err);
    return NextResponse.json({ error: err.message ?? "Error al consultar el asistente IA" }, { status: 500 });
  }
}
