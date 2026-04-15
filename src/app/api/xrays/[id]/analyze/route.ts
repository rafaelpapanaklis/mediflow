import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";

const ANALYSIS_SYSTEM_PROMPT = `Actúas como un asistente de análisis radiográfico dental. Tu rol es identificar hallazgos visibles en la imagen y reportarlos con confianza calibrada a lo que realmente se ve. NO eres el diagnóstico final — el doctor revisa tu análisis y decide. Por eso no necesitas ser excesivamente conservador: reporta con confianza lo que ves claramente.

INSTRUCCIONES:
- Analiza la imagen dental proporcionada
- Identifica hallazgos clínicamente relevantes: caries, lesiones periapicales, pérdida ósea, restauraciones existentes, fracturas, dientes impactados, cálculo, reabsorción radicular, etc.
- Para cada hallazgo indica: diente/zona afectada, descripción, severidad (alta/media/baja/informativo), nivel de confianza (entero 0-100) y una breve justificación de ese nivel de confianza
- Usa nomenclatura dental estándar (numeración FDI/universal)
- Responde SIEMPRE en español clínico
- Sé específico pero conciso
- Máximo 6 hallazgos, priorizando los más relevantes clínicamente

ESCALA DE CONFIANZA (aplica al campo "confidence", entero 0-100):
- 90-100: Hallazgo visualmente inequívoco, claramente visible en la imagen, sin ambigüedad
- 75-89:  Hallazgo probable con señales radiográficas claras y consistentes
- 60-74:  Hallazgo sospechoso pero con ambigüedad (puede tener múltiples causas)
- 40-59:  Hallazgo posible pero poco claro, se recomienda proyección adicional
- 0-39:   Muy ambiguo, casi descartable

IMPORTANTE SOBRE CONFIANZA: Sé confiado cuando el hallazgo es visualmente claro. NO bajes la confianza por "precaución diagnóstica general" — la baja confianza se reserva para imágenes con ruido, recorte pobre, o hallazgos verdaderamente ambiguos. Un hallazgo claro y visible debe tener confianza 85 o superior, aunque luego el doctor lo confirme con su criterio clínico.

EJEMPLOS DE CALIBRACIÓN CORRECTA:
- "Caries visible en molar inferior derecho con pérdida de esmalte clara" → confidence 92
- "Zona radiolúcida periapical sugestiva de lesión, con contornos definidos" → confidence 85
- "Posible reabsorción radicular, aunque la imagen tiene algo de ruido" → confidence 65
- "Sombra ambigua que podría ser artefacto o lesión temprana" → confidence 45

NOTA FINAL: Esto es una herramienta de APOYO al doctor. La nota de "los hallazgos deben ser confirmados clínicamente" va en el campo "recommendations", NO afecta tu calibración de confianza.

Responde EXCLUSIVAMENTE en este formato JSON (sin markdown, sin backticks):
{
  "summary": "Resumen general en 2-3 líneas",
  "findings": [
    {
      "id": 1,
      "title": "Nombre del hallazgo",
      "description": "Descripción detallada",
      "tooth": "Pieza #XX (Nombre del diente)",
      "severity": "alta|media|baja|informativo",
      "confidence": 85,
      "confidenceRationale": "Breve razón del nivel de confianza (opcional)"
    }
  ],
  "recommendations": "Recomendaciones generales en 1-2 líneas"
}`;

type Severity = "alta" | "media" | "baja" | "informativo";

interface Finding {
  id: number;
  title: string;
  description: string;
  tooth?: string;
  severity: Severity;
  confidence: number;
  confidenceRationale?: string;
}

interface Analysis {
  summary: string;
  findings: Finding[];
  recommendations: string | string[];
}

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/** Max severity encontrada en findings (alta > media > baja > informativo) */
function topSeverity(findings: Finding[]): Severity {
  const order: Severity[] = ["alta", "media", "baja", "informativo"];
  for (const s of order) if (findings.some((f) => f.severity === s)) return s;
  return "informativo";
}

/** Avg confidence en findings, clamp 0-100 */
function avgConfidence(findings: Finding[]): number {
  if (findings.length === 0) return 0;
  const sum = findings.reduce((acc, f) => acc + (Number(f.confidence) || 0), 0);
  return Math.round((sum / findings.length) * 10) / 10;
}

/** Calcula tokens restantes usando el estado actual de la clínica */
async function computeRemaining(clinicId: string): Promise<{ remaining: number; limit: number }> {
  const c = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { aiTokensUsed: true, aiTokensLimit: true },
  });
  if (!c) return { remaining: 0, limit: 0 };
  return { remaining: Math.max(0, c.aiTokensLimit - c.aiTokensUsed), limit: c.aiTokensLimit };
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  GET — devuelve el análisis guardado si existe, 404 si no           */
/* ═══════════════════════════════════════════════════════════════════ */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verifica que el archivo pertenece a la clínica del ctx
  const file = await prisma.patientFile.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!file) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

  const existing = await prisma.xrayAnalysis.findUnique({
    where: { fileId: params.id },
  });
  if (!existing) return NextResponse.json({ error: "Análisis no encontrado" }, { status: 404 });

  const { remaining, limit } = await computeRemaining(ctx.clinicId);

  return NextResponse.json({
    analysis: {
      summary:         existing.summary,
      findings:        existing.findings,
      recommendations: existing.recommendations,
    },
    severity:        existing.severity,
    confidence:      existing.confidence,
    tokensUsed:      existing.tokensUsed,
    tokensRemaining: remaining,
    tokensLimit:     limit,
    modelUsed:       existing.modelUsed,
    cached:          true,
    analyzedAt:      existing.createdAt.toISOString(),
  });
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  POST — analiza (usa cache salvo ?refresh=true)                     */
/* ═══════════════════════════════════════════════════════════════════ */

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "true";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "IA no configurada. Agrega ANTHROPIC_API_KEY." }, { status: 503 });
  }

  // Fetch file (cross-tenant guard)
  const file = await prisma.patientFile.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!file) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

  if (!file.mimeType?.startsWith("image/")) {
    return NextResponse.json({ error: "Solo se pueden analizar imágenes" }, { status: 400 });
  }

  // Fast path: cache hit
  if (!refresh) {
    const existing = await prisma.xrayAnalysis.findUnique({
      where: { fileId: params.id },
    });
    if (existing) {
      const { remaining, limit } = await computeRemaining(ctx.clinicId);
      return NextResponse.json({
        analysis: {
          summary:         existing.summary,
          findings:        existing.findings,
          recommendations: existing.recommendations,
        },
        severity:        existing.severity,
        confidence:      existing.confidence,
        tokensUsed:      0,                     // no gastamos nada ahora
        originalTokensUsed: existing.tokensUsed, // para mostrar en UI
        tokensRemaining: remaining,
        tokensLimit:     limit,
        modelUsed:       existing.modelUsed,
        cached:          true,
        analyzedAt:      existing.createdAt.toISOString(),
      });
    }
  }

  // Check AI token limit (y reset mensual)
  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { aiTokensUsed: true, aiTokensLimit: true, aiLastResetAt: true },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  let currentTokensUsed = clinic.aiTokensUsed;

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

  if (currentTokensUsed >= clinic.aiTokensLimit) {
    const resetDate = new Date(lastReset.getFullYear(), lastReset.getMonth() + 1, 1);
    return NextResponse.json({
      error: `Límite mensual de IA alcanzado (${clinic.aiTokensLimit.toLocaleString()} tokens). Se renueva el ${resetDate.toLocaleDateString("es-MX", { day: "numeric", month: "long" })}.`,
      limitReached: true,
    }, { status: 429 });
  }

  // Download image from Supabase Storage
  const supabase = getAdminSupabase();
  const storagePath = file.url.includes("/patient-files/")
    ? file.url.split("/patient-files/").pop()?.split("?")[0] ?? ""
    : "";

  let imageBase64: string;
  let mediaType: string;

  if (storagePath) {
    const { data, error } = await supabase.storage.from("patient-files").download(storagePath);
    if (error || !data) {
      return NextResponse.json({ error: "No se pudo descargar la imagen" }, { status: 500 });
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    imageBase64 = buffer.toString("base64");
    mediaType = file.mimeType || "image/jpeg";
  } else {
    try {
      const imgRes = await fetch(file.url);
      if (!imgRes.ok) throw new Error("Failed to fetch image");
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      imageBase64 = buffer.toString("base64");
      mediaType = file.mimeType || "image/jpeg";
    } catch {
      return NextResponse.json({ error: "No se pudo obtener la imagen" }, { status: 500 });
    }
  }

  // Patient context
  const patient = await prisma.patient.findUnique({
    where: { id: file.patientId },
    select: {
      firstName:         true,
      lastName:          true,
      dob:               true,
      gender:            true,
      allergies:         true,
      chronicConditions: true,
    },
  });

  const age = patient?.dob
    ? new Date().getFullYear() - new Date(patient.dob).getFullYear()
    : null;

  const clinicalContextLines: string[] = [];
  if (patient) {
    clinicalContextLines.push(`- Paciente: ${patient.firstName} ${patient.lastName}`);
    if (patient.gender) clinicalContextLines.push(`- Sexo: ${patient.gender === "M" ? "masculino" : "femenino"}`);
    if (age !== null)   clinicalContextLines.push(`- Edad: ${age} años`);
    if (patient.chronicConditions && patient.chronicConditions.length > 0) {
      clinicalContextLines.push(`- Condiciones crónicas: ${patient.chronicConditions.join(", ")}`);
    }
    if (patient.allergies && patient.allergies.length > 0) {
      clinicalContextLines.push(`- Alergias: ${patient.allergies.join(", ")}`);
    }
  }

  const clinicalContext = clinicalContextLines.length > 0
    ? `CONTEXTO DEL PACIENTE:\n${clinicalContextLines.join("\n")}\n\n`
    : "";

  const categoryLabel = file.category?.replace(/_/g, " ").toLowerCase() ?? "radiografía dental";
  const toothInfo = file.toothNumber ? ` Zona de interés: pieza #${file.toothNumber}.` : "";
  const userMessage = `${clinicalContext}Analiza esta ${categoryLabel}.${toothInfo}${file.notes ? ` Notas del doctor: ${file.notes}` : ""}`;

  const MODEL = "claude-sonnet-4-6";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 1500,
        system:     ANALYSIS_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: userMessage },
          ],
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Anthropic Vision API error:", data);
      throw new Error(data.error?.message ?? "Error de API");
    }

    const inputTokens  = data.usage?.input_tokens  ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const totalTokens  = inputTokens + outputTokens;

    // Update token usage
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data:  { aiTokensUsed: { increment: totalTokens } },
    });

    const rawText = data.content?.[0]?.text ?? "";

    // Parse JSON response
    let analysis: Analysis;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      analysis = jsonMatch
        ? JSON.parse(jsonMatch[0])
        : { summary: rawText, findings: [], recommendations: "" };
    } catch {
      analysis = { summary: rawText, findings: [], recommendations: "" };
    }

    const findings       = Array.isArray(analysis.findings) ? analysis.findings : [];
    const topSev         = topSeverity(findings);
    const avgConf        = avgConfidence(findings);

    // Upsert en DB — create o sobreescribe si ya existe (refresh=true)
    await prisma.xrayAnalysis.upsert({
      where:  { fileId: params.id },
      create: {
        fileId:          params.id,
        clinicId:        ctx.clinicId,
        patientId:       file.patientId,
        summary:         analysis.summary ?? "",
        findings:        findings as any,
        recommendations: (analysis.recommendations ?? "") as any,
        severity:        topSev,
        confidence:      avgConf,
        tokensUsed:      totalTokens,
        modelUsed:       MODEL,
        createdBy:       ctx.userId ?? null,
      },
      update: {
        summary:         analysis.summary ?? "",
        findings:        findings as any,
        recommendations: (analysis.recommendations ?? "") as any,
        severity:        topSev,
        confidence:      avgConf,
        tokensUsed:      totalTokens,
        modelUsed:       MODEL,
        createdAt:       new Date(),   // bump timestamp en refresh
        createdBy:       ctx.userId ?? null,
      },
    });

    const tokensRemaining = Math.max(0, clinic.aiTokensLimit - currentTokensUsed - totalTokens);

    return NextResponse.json({
      analysis: {
        summary:         analysis.summary ?? "",
        findings,
        recommendations: analysis.recommendations ?? "",
      },
      severity:        topSev,
      confidence:      avgConf,
      tokensUsed:      totalTokens,
      tokensRemaining,
      tokensLimit:     clinic.aiTokensLimit,
      modelUsed:       MODEL,
      cached:          false,
      analyzedAt:      new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("AI X-ray analysis error:", err);
    return NextResponse.json({ error: err.message ?? "Error al analizar radiografía" }, { status: 500 });
  }
}
