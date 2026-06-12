import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { hasPermission } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

/* ═══════════════════════════════════════════════════════════════════════ */
/*  POST /api/prescriptions/check-contraindications                         */
/*                                                                          */
/*  Apoyo IA: revisa contraindicaciones por medicamento e interacciones    */
/*  entre los medicamentos de una receta, según el contexto clínico del     */
/*  paciente (que arma el SERVIDOR desde la BD — del body solo IDs).        */
/*                                                                          */
/*  Reusa el patrón de cobro de xrays/[id]/analyze: 503 sin API key,        */
/*  wallet de tokens por clínica (aiTokensUsed/aiTokensLimit) con reset      */
/*  mensual, 429 al agotar saldo, y cache SHA256 que evita cobrar dos veces  */
/*  el mismo análisis.                                                       */
/* ═══════════════════════════════════════════════════════════════════════ */

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `Eres un asistente de odontofarmacología para dentistas en México. Revisas una receta dental y adviertes posibles contraindicaciones e interacciones, considerando el contexto clínico del paciente. NO eres el prescriptor: el doctor decide. Eres una herramienta de APOYO informativo.

Usa SIEMPRE la herramienta "report_contraindication_check". No respondas en texto libre.

Criterios:
- Sé CONSERVADOR: ante cualquier duda razonable marca PRECAUCION en vez de OK. Reserva CONTRAINDICADO para riesgos claros y bien establecidos.
- Considera: embarazo y lactancia; anticoagulantes (warfarina, DOACs) junto con AINEs; bifosfonatos y riesgo de osteonecrosis de los maxilares en extracciones/cirugía; alergias declaradas y reactividad cruzada (penicilinas <-> cefalosporinas); ajuste o evitación en insuficiencia renal o hepática; edad pediátrica (dosis y fármacos no recomendados en niños, p. ej. evitar aspirina por síndrome de Reye); adultos mayores.
- Evalúa las interacciones ENTRE los medicamentos listados. No inventes medicamentos que no estén en la lista.
- Para cada medicamento da un veredicto (OK / PRECAUCION / CONTRAINDICADO), un motivo de 1-2 líneas en español claro y, cuando aplique, una alternativa más segura de uso común en odontología.
- Si falta información del paciente, no la inventes; sé prudente y dilo en el motivo.
- Respuestas breves, accionables y en español neutro.`;

const CHECK_TOOL = {
  name: "report_contraindication_check",
  description:
    "Reporta el chequeo estructurado de contraindicaciones por medicamento e interacciones entre los medicamentos de la receta. Claude DEBE usar esta herramienta; no debe responder con texto libre.",
  input_schema: {
    type: "object",
    required: ["perMedication", "interactions", "summary"],
    properties: {
      perMedication: {
        type: "array",
        description: "Un veredicto por cada medicamento de la receta.",
        items: {
          type: "object",
          required: ["name", "verdict", "reason"],
          properties: {
            name: { type: "string", description: "Nombre del medicamento evaluado, igual al recibido." },
            verdict: {
              type: "string",
              enum: ["OK", "PRECAUCION", "CONTRAINDICADO"],
              description: "OK sin objeción; PRECAUCION úsese con cuidado/ajuste; CONTRAINDICADO no recomendado en este paciente.",
            },
            reason: { type: "string", description: "Motivo clínico breve, 1-2 líneas, español claro." },
            saferAlternative: {
              type: ["string", "null"],
              description: "Alternativa más segura si aplica; null si no procede.",
            },
          },
        },
      },
      interactions: {
        type: "array",
        description: "Interacciones relevantes ENTRE los medicamentos de esta receta. Array vacío si no hay.",
        items: {
          type: "object",
          required: ["pair", "severity", "reason"],
          properties: {
            pair: { type: "string", description: "Los dos medicamentos implicados, ej 'Ibuprofeno + Warfarina'." },
            severity: { type: "string", enum: ["leve", "moderada", "grave"] },
            reason: { type: "string", description: "Por qué interactúan y el riesgo, 1-2 líneas." },
          },
        },
      },
      summary: { type: "string", description: "Resumen general en 1-2 oraciones, español claro." },
    },
  },
} as const;

type Verdict = "OK" | "PRECAUCION" | "CONTRAINDICADO";

interface PerMedication {
  name: string;
  verdict: Verdict;
  reason: string;
  saferAlternative?: string | null;
}
interface Interaction {
  pair: string;
  severity: "leve" | "moderada" | "grave";
  reason: string;
}
interface CheckResult {
  perMedication: PerMedication[];
  interactions: Interaction[];
  summary: string;
  checkedAt: string;
  modelUsed: string;
}

interface ItemBody {
  cumsKey?: string | null;
  name?: string | null;
  dosage?: string | null;
}

function genderLabel(g?: string | null): string {
  if (g === "M" || g === "MALE") return "masculino";
  if (g === "F" || g === "FEMALE") return "femenino";
  return "no especificado";
}

/** Recalcula saldo de tokens con el estado actual de la clínica. */
async function computeRemaining(clinicId: string): Promise<{ remaining: number; limit: number }> {
  const c = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { aiTokensUsed: true, aiTokensLimit: true },
  });
  if (!c) return { remaining: 0, limit: 0 };
  return { remaining: Math.max(0, c.aiTokensLimit - c.aiTokensUsed), limit: c.aiTokensLimit };
}

/** Normaliza el veredicto del modelo a uno de los tres válidos (conservador). */
function normalizeVerdict(v: unknown): Verdict {
  const s = String(v ?? "").toUpperCase();
  if (s === "OK") return "OK";
  if (s === "CONTRAINDICADO" || s === "CONTRAINDICATED") return "CONTRAINDICADO";
  return "PRECAUCION"; // default seguro ante valores inesperados
}

function normalizeSeverity(v: unknown): "leve" | "moderada" | "grave" {
  const s = String(v ?? "").toLowerCase();
  if (s === "grave" || s === "high" || s === "severe") return "grave";
  if (s === "leve" || s === "low" || s === "mild") return "leve";
  return "moderada";
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 10, 5 * 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.role as "DOCTOR" | "ADMIN" | "SUPER_ADMIN" | "RECEPTIONIST" | "READONLY", "prescription.create")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "IA no configurada. Agrega ANTHROPIC_API_KEY." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const patientId: string | undefined = body.patientId;
  if (!patientId || typeof patientId !== "string") {
    return NextResponse.json({ error: "patientId requerido" }, { status: 400 });
  }

  // Del body solo tomamos IDs/nombres de medicamentos. El contexto clínico lo
  // arma el servidor desde la BD (nunca confiar en el cliente para eso).
  const rawItems: ItemBody[] = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map((it) => ({
      cumsKey: typeof it?.cumsKey === "string" ? it.cumsKey : null,
      name: typeof it?.name === "string" ? it.name.trim() : "",
      dosage: typeof it?.dosage === "string" ? it.dosage.trim() : "",
    }))
    .filter((it) => it.name.length > 0 || (it.cumsKey && it.cumsKey.length > 0))
    .slice(0, 25); // tope defensivo
  if (items.length === 0) {
    return NextResponse.json({ error: "Se requiere al menos un medicamento" }, { status: 400 });
  }

  // Multi-tenant: el paciente debe ser de la clínica de la sesión.
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
    select: {
      dob: true,
      gender: true,
      isChild: true,
      allergies: true,
      chronicConditions: true,
      currentMedications: true,
    },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const age = patient.dob
    ? new Date().getFullYear() - new Date(patient.dob).getFullYear()
    : null;

  // Contexto normalizado (ordenado) para el hash de cache — determinista.
  const allergies = (patient.allergies ?? []).slice().sort();
  const chronic = (patient.chronicConditions ?? []).slice().sort();
  const currentMeds = (patient.currentMedications ?? []).slice().sort();
  const ctxNorm = {
    age,
    isChild: patient.isChild,
    gender: patient.gender,
    allergies,
    chronicConditions: chronic,
    currentMedications: currentMeds,
  };
  const medsNorm = items
    .map((m) => ({ cumsKey: m.cumsKey ?? null, name: m.name.toLowerCase(), dosage: m.dosage.toLowerCase() }))
    .slice()
    .sort((a, b) => (a.name + a.cumsKey).localeCompare(b.name + b.cumsKey));

  // Hash incluye clinicId + patientId → aislamiento multi-tenant garantizado.
  const canonical = JSON.stringify({ clinicId: ctx.clinicId, patientId, ctx: ctxNorm, meds: medsNorm });
  const hash = createHash("sha256").update(canonical).digest("hex");

  // ── Cache hit: devuelve sin cobrar. try/catch por si la tabla aún no se
  //    migró en prod (degradación elegante → se comporta como sin-cache).
  try {
    const cached = await prisma.prescriptionAiCheck.findFirst({
      where: { hash, clinicId: ctx.clinicId },
    });
    if (cached && cached.result && typeof cached.result === "object") {
      const { remaining, limit } = await computeRemaining(ctx.clinicId);
      return NextResponse.json({
        ...(cached.result as object),
        cached: true,
        tokensUsed: 0,
        tokensRemaining: remaining,
        tokensLimit: limit,
      });
    }
  } catch {
    /* tabla prescription_ai_checks no disponible aún — continuar sin cache */
  }

  // ── Wallet de tokens IA (mismo manejo que xray-analyze): reset mensual y 429.
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
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: { aiTokensUsed: 0, aiLastResetAt: now },
    });
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

  // ── Mensaje del usuario: contexto clínico + lista de medicamentos.
  const lines: string[] = [];
  lines.push("CONTEXTO DEL PACIENTE:");
  lines.push(`- Edad: ${age !== null ? `${age} años` : "no registrada"}${patient.isChild ? " (paciente pediátrico)" : ""}`);
  lines.push(`- Sexo: ${genderLabel(patient.gender as unknown as string)}`);
  lines.push(`- Alergias declaradas: ${allergies.length > 0 ? allergies.join(", ") : "ninguna registrada"}`);
  lines.push(`- Padecimientos / condiciones: ${chronic.length > 0 ? chronic.join(", ") : "ninguno registrado"}`);
  lines.push(`- Medicamentos actuales: ${currentMeds.length > 0 ? currentMeds.join(", ") : "ninguno registrado"}`);
  lines.push("");
  lines.push("MEDICAMENTOS DE ESTA RECETA:");
  items.forEach((m, i) => {
    lines.push(`${i + 1}. ${m.name || m.cumsKey}${m.dosage ? ` — ${m.dosage}` : ""}`);
  });
  lines.push("");
  lines.push("Evalúa cada medicamento y las interacciones entre ellos según el contexto del paciente.");
  const userMessage = lines.join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [{ ...CHECK_TOOL, cache_control: { type: "ephemeral" } }],
        tool_choice: { type: "tool", name: CHECK_TOOL.name },
        messages: [{ role: "user", content: [{ type: "text", text: userMessage }] }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Anthropic contraindication API error:", data);
      throw new Error(data.error?.message ?? "Error de API");
    }

    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const cacheCreation = data.usage?.cache_creation_input_tokens ?? 0;
    const cacheRead = data.usage?.cache_read_input_tokens ?? 0;
    const totalTokens = inputTokens + outputTokens + cacheCreation + cacheRead;

    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: { aiTokensUsed: { increment: totalTokens } },
    });

    /* Extrae el tool_use forzado; fallback defensivo si el modelo no lo usó. */
    const contentBlocks: any[] = Array.isArray(data.content) ? data.content : [];
    const toolUseBlock = contentBlocks.find((b) => b?.type === "tool_use" && b?.name === CHECK_TOOL.name);

    let parsed: { perMedication?: unknown; interactions?: unknown; summary?: unknown } = {};
    if (toolUseBlock && toolUseBlock.input && typeof toolUseBlock.input === "object") {
      parsed = toolUseBlock.input;
    } else {
      parsed = {
        perMedication: [],
        interactions: [],
        summary: "No se obtuvo un análisis estructurado. Vuelve a intentar la revisión.",
      };
    }

    const perMedication: PerMedication[] = Array.isArray(parsed.perMedication)
      ? (parsed.perMedication as any[]).map((m) => ({
          name: String(m?.name ?? "").slice(0, 200) || "Medicamento",
          verdict: normalizeVerdict(m?.verdict),
          reason: String(m?.reason ?? "").slice(0, 500),
          saferAlternative:
            m?.saferAlternative && typeof m.saferAlternative === "string"
              ? m.saferAlternative.slice(0, 300)
              : null,
        }))
      : [];

    const interactions: Interaction[] = Array.isArray(parsed.interactions)
      ? (parsed.interactions as any[]).map((it) => ({
          pair: String(it?.pair ?? "").slice(0, 200),
          severity: normalizeSeverity(it?.severity),
          reason: String(it?.reason ?? "").slice(0, 500),
        }))
      : [];

    const result: CheckResult = {
      perMedication,
      interactions,
      summary: String(parsed.summary ?? "").slice(0, 800),
      checkedAt: now.toISOString(),
      modelUsed: MODEL,
    };

    // Guarda en cache (try/catch — dup hash o tabla faltante no debe romper).
    try {
      await prisma.prescriptionAiCheck.create({
        data: { hash, clinicId: ctx.clinicId, patientId, result: result as any, model: MODEL },
      });
    } catch {
      /* ya existe o tabla no migrada — ignorar */
    }

    const tokensRemaining = Math.max(0, clinic.aiTokensLimit - currentTokensUsed - totalTokens);
    return NextResponse.json({
      ...result,
      cached: false,
      tokensUsed: totalTokens,
      tokensRemaining,
      tokensLimit: clinic.aiTokensLimit,
    });
  } catch (err: any) {
    console.error("AI contraindication check error:", err);
    return NextResponse.json({ error: err.message ?? "Error al revisar contraindicaciones" }, { status: 500 });
  }
}
