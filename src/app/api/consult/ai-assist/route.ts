import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { hasPermission } from "@/lib/auth/permissions";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logAudit } from "@/lib/audit";
import { buildConsultContext } from "@/lib/ai/consult-context";

export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const DISCLAIMER = "Apoyo diagnóstico generado por IA. No sustituye el juicio clínico del profesional.";

type Role = "DOCTOR" | "ADMIN" | "SUPER_ADMIN" | "RECEPTIONIST" | "READONLY";

const SYSTEM_PROMPT = `Eres un asistente clínico de APOYO para dentistas en México. Recibes el expediente de un paciente (antecedentes, odontograma actual, consultas previas, recetas activas, tratamientos, radiografías, cuestionario de salud) y el motivo/borrador de la consulta de HOY. Produces un análisis breve, conservador y accionable para AYUDAR al doctor. NO eres el tratante y NO sustituyes su juicio.

Usa SIEMPRE la herramienta "report_consult_analysis"; no respondas en texto libre.

Estructura tu análisis en:
- hallazgos ("Qué tiene"): síntesis del estado del paciente relevante para hoy, integrando odontograma + antecedentes + consultas previas.
- puntosAlerta ("Puntos a considerar"): lista de banderas a vigilar (interacciones, alergias, riesgos por padecimientos/embarazo/edad, hallazgos que requieren atención). Array vacío si no hay.
- plan ("Cómo abordarlo"): sugerencias de manejo/estudios/siguiente paso, en lenguaje claro. Son opciones de apoyo, no órdenes.
- resumen: 1-2 oraciones.

Reglas: sé conservador (ante duda, señala precaución); NO inventes datos que no estén en el contexto; español neutro y claro; breve. Si el contexto es escaso, dilo en el resumen.`;

const REPORT_TOOL = {
  name: "report_consult_analysis",
  description:
    "Reporta el análisis estructurado de apoyo para la consulta. Claude DEBE usar esta herramienta; no debe responder en texto libre.",
  input_schema: {
    type: "object",
    required: ["hallazgos", "puntosAlerta", "plan", "resumen"],
    properties: {
      hallazgos: { type: "string", description: "Qué tiene el paciente: síntesis clínica relevante para hoy." },
      puntosAlerta: {
        type: "array",
        items: { type: "string" },
        description: "Puntos a considerar / banderas. Array vacío si no hay.",
      },
      plan: { type: "string", description: "Cómo abordarlo: sugerencias de manejo/siguiente paso (apoyo, no órdenes)." },
      resumen: { type: "string", description: "Resumen en 1-2 oraciones." },
    },
  },
} as const;

interface ConsultResult {
  hallazgos: string;
  puntosAlerta: string[];
  plan: string;
  resumen: string;
}

function normalizeResult(parsed: any): ConsultResult {
  const arr = Array.isArray(parsed?.puntosAlerta) ? parsed.puntosAlerta : [];
  return {
    hallazgos: String(parsed?.hallazgos ?? "").slice(0, 4000),
    puntosAlerta: arr
      .map((s: any) => String(s ?? "").slice(0, 500))
      .filter((s: string) => s.trim().length > 0)
      .slice(0, 20),
    plan: String(parsed?.plan ?? "").slice(0, 4000),
    resumen: String(parsed?.resumen ?? "").slice(0, 1200),
  };
}

/* ───────────────────────── POST = analizar (cobra tokens) ───────────────────────── */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 10, 5 * 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.role as Role, "medicalRecord.create")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "IA no configurada. Agrega ANTHROPIC_API_KEY." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  const patientId: string | undefined = body.patientId;
  if (!patientId || typeof patientId !== "string") {
    return NextResponse.json({ error: "patientId requerido" }, { status: 400 });
  }
  const ci = body.currentInput && typeof body.currentInput === "object" ? body.currentInput : {};
  const currentInput = {
    subjective: typeof ci.subjective === "string" ? ci.subjective.slice(0, 4000) : "",
    objective: typeof ci.objective === "string" ? ci.objective.slice(0, 4000) : "",
  };

  // Multi-tenant + excluir borrados/anonimizados
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, anonymizedAt: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  if (patient.anonymizedAt) return NextResponse.json({ error: "Paciente anonimizado" }, { status: 409 });

  // Visibilidad por paciente (Ola 3)
  const hidden = await assertPatientVisible(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (hidden) return hidden;

  // Wallet de tokens IA — reset mensual + 429
  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { aiTokensUsed: true, aiTokensLimit: true, aiLastResetAt: true },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  let currentTokensUsed = clinic.aiTokensUsed;
  const lastReset = new Date(clinic.aiLastResetAt);
  const now = new Date();
  const monthsDiff = (now.getFullYear() - lastReset.getFullYear()) * 12 + (now.getMonth() - lastReset.getMonth());
  if (monthsDiff >= 1) {
    await prisma.clinic.update({ where: { id: ctx.clinicId }, data: { aiTokensUsed: 0, aiLastResetAt: now } });
    currentTokensUsed = 0;
  }
  if (currentTokensUsed >= clinic.aiTokensLimit) {
    const resetDate = new Date(lastReset.getFullYear(), lastReset.getMonth() + 1, 1);
    return NextResponse.json(
      {
        error: `Límite mensual de IA alcanzado (${clinic.aiTokensLimit.toLocaleString()} tokens). Se renueva el ${resetDate.toLocaleDateString("es-MX", { day: "numeric", month: "long" })}.`,
        limitReached: true,
      },
      { status: 429 },
    );
  }

  // Contexto clínico armado por el SERVIDOR (filtrado por clinicId)
  let contextText = "";
  try {
    contextText = await buildConsultContext({ patientId, clinicId: ctx.clinicId, userId: ctx.userId, currentInput });
  } catch (e) {
    console.error("buildConsultContext error:", e);
    contextText = "No se pudo construir el contexto completo del paciente.";
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [{ ...REPORT_TOOL, cache_control: { type: "ephemeral" } }],
        tool_choice: { type: "tool", name: REPORT_TOOL.name },
        messages: [{ role: "user", content: [{ type: "text", text: contextText }] }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Anthropic consult API error:", data);
      throw new Error(data.error?.message ?? "Error de API");
    }

    const usage = data.usage ?? {};
    const totalTokens =
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);

    await prisma.clinic.update({ where: { id: ctx.clinicId }, data: { aiTokensUsed: { increment: totalTokens } } });

    const contentBlocks: any[] = Array.isArray(data.content) ? data.content : [];
    const toolUseBlock = contentBlocks.find((b) => b?.type === "tool_use" && b?.name === REPORT_TOOL.name);
    let parsed: any = {};
    if (toolUseBlock && toolUseBlock.input && typeof toolUseBlock.input === "object") {
      parsed = toolUseBlock.input;
    } else {
      parsed = { hallazgos: "", puntosAlerta: [], plan: "", resumen: "No se obtuvo un análisis estructurado. Intenta de nuevo." };
    }
    const result = normalizeResult(parsed);

    // Audit NOM-024 (fire-and-forget)
    await logAudit({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "ai-consult",
      entityId: patientId,
      action: "create",
      changes: { generate: { before: null, after: { model: MODEL, tokens: totalTokens } } },
    });

    const tokensRemaining = Math.max(0, clinic.aiTokensLimit - currentTokensUsed - totalTokens);
    return NextResponse.json({
      result,
      disclaimer: DISCLAIMER,
      model: MODEL,
      generatedAt: now.toISOString(),
      tokensUsed: totalTokens,
      tokensRemaining,
      tokensLimit: clinic.aiTokensLimit,
    });
  } catch (err: any) {
    console.error("AI consult analyze error:", err);
    return NextResponse.json({ error: err.message ?? "Error al analizar la consulta" }, { status: 500 });
  }
}

/* ─────────────── PATCH = aplicar / quitar en un record EXISTENTE (no cobra) ─────────────── */
export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.role as Role, "medicalRecord.update")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  const recordId: string | undefined = body.recordId;
  const apply: boolean = body.apply === true;
  if (!recordId || typeof recordId !== "string") {
    return NextResponse.json({ error: "recordId requerido" }, { status: 400 });
  }

  // Multi-tenant: el record debe ser de la clínica de la sesión
  const record = await prisma.medicalRecord.findFirst({
    where: { id: recordId, clinicId: ctx.clinicId },
    select: { id: true, patientId: true, aiAssist: true },
  });
  if (!record) return NextResponse.json({ error: "Consulta no encontrada" }, { status: 404 });

  // Visibilidad por paciente
  const hidden = await assertPatientVisible(record.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (hidden) return hidden;

  const now = new Date();
  const wasApplied = (record.aiAssist as any)?.applied === true;

  if (apply) {
    const result = normalizeResult(body.result && typeof body.result === "object" ? body.result : {});
    const aiAssist = {
      version: 1,
      model: typeof body.model === "string" ? body.model : MODEL,
      generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : now.toISOString(),
      applied: true,
      appliedAt: now.toISOString(),
      appliedByUserId: ctx.userId,
      result,
      disclaimer: DISCLAIMER,
    };
    await prisma.medicalRecord.update({ where: { id: recordId }, data: { aiAssist: aiAssist as unknown as Prisma.InputJsonValue } });
    await logAudit({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "ai-consult",
      entityId: recordId,
      action: "update",
      changes: { apply: { before: wasApplied, after: true } },
    });
    return NextResponse.json({ ok: true, aiAssist });
  }

  // quitar → columna a NULL (Prisma.DbNull para Json? nullable)
  await prisma.medicalRecord.update({ where: { id: recordId }, data: { aiAssist: Prisma.DbNull } });
  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "ai-consult",
    entityId: recordId,
    action: "delete",
    changes: { remove: { before: wasApplied, after: false } },
  });
  return NextResponse.json({ ok: true, aiAssist: null });
}
