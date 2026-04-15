import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";

const ANALYSIS_SYSTEM_PROMPT = `Actúas como un asistente de análisis radiográfico dental. Tu rol es identificar hallazgos visibles en la imagen y reportarlos con confianza calibrada a lo que realmente se ve. NO eres el diagnóstico final — el doctor revisa tu análisis y decide.

Usa la herramienta "report_radiograph_analysis" para reportar tu análisis estructurado. NO respondas con texto libre — siempre usa la herramienta.

INSTRUCCIONES:
- Analiza la imagen dental proporcionada
- Identifica hallazgos clínicamente relevantes: caries, lesiones periapicales, pérdida ósea, restauraciones existentes, fracturas, dientes impactados, cálculo, reabsorción radicular, etc.
- Para cada hallazgo indica: diente/zona afectada (notación FDI), descripción, severidad, nivel de confianza (decimal 0.0-1.0) y una breve justificación de ese nivel de confianza
- Responde SIEMPRE en español clínico
- Máximo 6 hallazgos, priorizando los más relevantes clínicamente

ESCALA DE CONFIANZA (decimal 0.0 a 1.0):
- 0.90-1.00: Hallazgo visualmente inequívoco, claramente visible, sin ambigüedad
- 0.75-0.89: Hallazgo probable con señales radiográficas claras y consistentes
- 0.60-0.74: Hallazgo sospechoso pero con ambigüedad (puede tener múltiples causas)
- 0.40-0.59: Hallazgo posible pero poco claro, se recomienda proyección adicional
- 0.00-0.39: Muy ambiguo, casi descartable

IMPORTANTE SOBRE CONFIANZA: Sé confiado cuando el hallazgo es visualmente claro. NO bajes la confianza por "precaución diagnóstica general" — la baja confianza se reserva para imágenes con ruido, recorte pobre, o hallazgos verdaderamente ambiguos. Un hallazgo claro y visible debe tener confianza 0.85 o superior.

EJEMPLOS DE CALIBRACIÓN CORRECTA:
- "Caries visible en molar inferior derecho con pérdida de esmalte clara" → 0.92
- "Zona radiolúcida periapical sugestiva de lesión, con contornos definidos" → 0.85
- "Posible reabsorción radicular, aunque la imagen tiene algo de ruido" → 0.65
- "Sombra ambigua que podría ser artefacto o lesión temprana" → 0.45

SEVERIDAD:
- "critical": emergencia dental (absceso activo, fractura expuesta con dolor agudo)
- "high":     patología significativa que requiere atención pronta
- "medium":   hallazgo moderado que requiere tratamiento planeado
- "low":      hallazgo menor o preventivo
- "informational" (solo findings individuales): observación anatómica normal

La severidad top-level debe reflejar el peor hallazgo encontrado. Las recomendaciones van en "recommendations" como array de strings individuales (una recomendación por string).

NOTA: Esto es una herramienta de APOYO al doctor. La nota de "los hallazgos deben confirmarse clínicamente" va dentro del summary o como una recommendation más, NO afecta tu calibración de confianza.`;

/* Tool definition — obliga a Claude a devolver estructurado.
   Las descriptions guían brevedad SIN imponer cortes duros (no maxItems, no maxLength). */
const ANALYSIS_TOOL = {
  name: "report_radiograph_analysis",
  description: "Reporta el análisis estructurado de una radiografía dental. Claude DEBE usar esta herramienta para reportar hallazgos, no debe responder con texto libre.",
  input_schema: {
    type: "object",
    required: ["summary", "severity", "confidence", "findings", "recommendations"],
    properties: {
      summary: {
        type: "string",
        description: "Resumen general del análisis, 2-3 oraciones concisas.",
      },
      severity: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description: "Severidad general del caso, reflejando el peor hallazgo encontrado.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confianza general del análisis, escala decimal 0.0 a 1.0.",
      },
      findings: {
        type: "array",
        description: "Hallazgos clínicamente relevantes, priorizados por severidad.",
        items: {
          type: "object",
          required: ["id", "title", "description", "severity", "confidence"],
          properties: {
            id:          { type: "string", description: "Identificador secuencial del hallazgo, ej '1', '2'." },
            title:       { type: "string", description: "Nombre corto del hallazgo en español clínico, una frase." },
            description: { type: "string", description: "Descripción clínica del hallazgo, 1-3 oraciones." },
            tooth:       { type: ["string", "null"], description: "Diente/zona afectada en notación FDI (ej '36'). Null si no aplica." },
            severity:    { type: "string", enum: ["low", "medium", "high", "critical", "informational"] },
            confidence:  { type: "number", minimum: 0, maximum: 1, description: "Confianza calibrada del hallazgo, decimal 0.0-1.0." },
            confidenceRationale: { type: ["string", "null"], description: "Opcional. Incluir solo si confidence < 0.85. Una frase corta explicando por qué esa confianza." },
          },
        },
      },
      recommendations: {
        type: "array",
        description: "Recomendaciones clínicas accionables.",
        items: { type: "string", description: "Una recomendación accionable en una oración." },
      },
    },
  },
} as const;

/**
 * Severidad aceptada por el backend — unión de los valores nuevos (inglés, del tool)
 * y los viejos (español, de respuestas pre-tool-use). El frontend normaliza al mostrar.
 */
type SeverityLegacy = "alta" | "media" | "baja" | "informativo";
type SeverityNew    = "low" | "medium" | "high" | "critical" | "informational";
type Severity       = SeverityLegacy | SeverityNew;

interface Finding {
  id: string | number;
  title: string;
  description: string;
  tooth?: string | null;
  severity: Severity;
  confidence: number;
  confidenceRationale?: string | null;
}

interface Analysis {
  summary: string;
  severity?: Severity;          // nuevo top-level (tool use)
  confidence?: number;          // nuevo top-level (tool use, 0-1)
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

/**
 * Max severity encontrada en findings — acepta aliases ES/EN.
 * Orden: critical > high/alta > medium/media > low/baja > informational/informativo.
 */
function topSeverity(findings: Finding[]): Severity {
  const groups: Array<{ canonical: Severity; aliases: string[] }> = [
    { canonical: "critical",      aliases: ["critical"] },
    { canonical: "high",          aliases: ["high", "alta"] },
    { canonical: "medium",        aliases: ["medium", "media"] },
    { canonical: "low",           aliases: ["low", "baja"] },
    { canonical: "informational", aliases: ["informational", "informativo"] },
  ];
  for (const g of groups) {
    if (findings.some((f) => g.aliases.includes(String(f.severity)))) return g.canonical;
  }
  return "informational";
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
    severity:             existing.severity,
    confidence:           existing.confidence,
    tokensUsed:           existing.tokensUsed,
    tokensRemaining:      remaining,
    tokensLimit:          limit,
    modelUsed:            existing.modelUsed,
    cached:               true,
    analyzedAt:           existing.createdAt.toISOString(),
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
        severity:           existing.severity,
        confidence:         existing.confidence,
        tokensUsed:         0,                     // no gastamos nada ahora
        originalTokensUsed: existing.tokensUsed,   // para mostrar en UI
        tokensRemaining:    remaining,
        tokensLimit:        limit,
        modelUsed:          existing.modelUsed,
        cached:             true,
        analyzedAt:         existing.createdAt.toISOString(),
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
        model:       MODEL,
        max_tokens:  1500,
        // System como array con cache_control para habilitar prompt caching
        system: [
          {
            type: "text",
            text: ANALYSIS_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        // Tools con cache_control en el último — cachea system + tools como un bloque
        tools: [
          {
            ...ANALYSIS_TOOL,
            cache_control: { type: "ephemeral" },
          },
        ],
        tool_choice: { type: "tool", name: ANALYSIS_TOOL.name },
        messages: [{
          role: "user",
          content: [
            // Imagen y contexto clínico NO se cachean (varían por paciente)
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

    const inputTokens    = data.usage?.input_tokens    ?? 0;
    const outputTokens   = data.usage?.output_tokens   ?? 0;
    const cacheCreation  = data.usage?.cache_creation_input_tokens ?? 0;
    const cacheRead      = data.usage?.cache_read_input_tokens     ?? 0;
    const totalTokens    = inputTokens + outputTokens + cacheCreation + cacheRead;

    console.log("[xray-analyze] tokens:", {
      cache_creation: cacheCreation,
      cache_read:     cacheRead,
      input:          inputTokens,
      output:         outputTokens,
      cached_hit:     cacheRead > 0,
    });

    // Update token usage (incluye tokens de cache creation/read que también se cobran)
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data:  { aiTokensUsed: { increment: totalTokens } },
    });

    /* ─── Extract tool_use (happy path) o fallback a texto ─── */
    const contentBlocks: any[] = Array.isArray(data.content) ? data.content : [];
    const toolUseBlock = contentBlocks.find(
      (b) => b?.type === "tool_use" && b?.name === ANALYSIS_TOOL.name,
    );

    let analysis: Analysis;

    if (toolUseBlock && toolUseBlock.input && typeof toolUseBlock.input === "object") {
      // HAPPY PATH: Claude usó el tool, el input ya viene parseado como objeto
      analysis = toolUseBlock.input as Analysis;
    } else {
      // FALLBACK: Claude no usó el tool (edge case). Intenta parseo defensivo del texto.
      const textBlock = contentBlocks.find((b) => b?.type === "text");
      const rawText: string = textBlock?.text ?? "";
      console.warn("Claude no usó tool_use — intentando parseo defensivo");

      try {
        // Strip markdown fences (```json ... ``` o ``` ... ```)
        let cleaned = rawText
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```\s*$/i, "")
          .trim();
        // Strip JS-style comments inline
        cleaned = cleaned.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
        // Strip trailing commas antes de } o ]
        cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");
        // Try to match the outer object
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
          analysis = JSON.parse(match[0]) as Analysis;
        } else {
          throw new Error("No JSON object found");
        }
      } catch (parseErr) {
        console.error("Parse defensivo falló:", parseErr);
        analysis = {
          summary: "Claude respondió en formato no estructurado. Haz click en Re-analizar para obtener una versión mejorada.",
          findings: [],
          recommendations: [],
          severity: "medium",
          confidence: 0.5,
        };
      }
    }

    const findings       = Array.isArray(analysis.findings) ? analysis.findings : [];
    // Top-level severity/confidence: del tool si existen, si no se derivan de findings
    const topSev         = (analysis.severity as Severity | undefined) ?? topSeverity(findings);
    const avgConf        = typeof analysis.confidence === "number"
      ? analysis.confidence
      : avgConfidence(findings);

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
