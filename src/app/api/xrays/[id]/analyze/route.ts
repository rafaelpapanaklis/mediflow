import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";

const ANALYSIS_SYSTEM_PROMPT = `Eres un asistente de apoyo en radiología dental. Analizas radiografías dentales para ayudar al odontólogo a identificar hallazgos relevantes.

INSTRUCCIONES:
- Analiza la imagen dental proporcionada
- Identifica hallazgos clínicamente relevantes: caries, lesiones periapicales, pérdida ósea, restauraciones existentes, fracturas, dientes impactados, cálculo, reabsorción radicular, etc.
- Para cada hallazgo indica: diente/zona afectada, descripción, severidad (alta/media/baja/informativo), y nivel de confianza (0-100)
- Usa nomenclatura dental estándar (numeración FDI/universal)
- Responde SIEMPRE en español clínico
- Sé específico pero conciso
- Máximo 6 hallazgos, priorizando los más relevantes clínicamente

IMPORTANTE: Esto es una herramienta de APOYO. Siempre indica que los hallazgos deben ser confirmados clínicamente.

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
      "confidence": 85
    }
  ],
  "recommendations": "Recomendaciones generales en 1-2 líneas"
}`;

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "IA no configurada. Agrega ANTHROPIC_API_KEY." }, { status: 503 });
  }

  // Fetch the file record
  const file = await prisma.patientFile.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!file) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

  // Only allow image files
  if (!file.mimeType?.startsWith("image/")) {
    return NextResponse.json({ error: "Solo se pueden analizar imágenes" }, { status: 400 });
  }

  // Check AI token limit
  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
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

  if (currentTokensUsed >= clinic.aiTokensLimit) {
    const resetDate = new Date(lastReset.getFullYear(), lastReset.getMonth() + 1, 1);
    return NextResponse.json({
      error: `Límite mensual de IA alcanzado (${clinic.aiTokensLimit.toLocaleString()} tokens). Se renueva el ${resetDate.toLocaleDateString("es-MX", { day: "numeric", month: "long" })}.`,
      limitReached: true,
    }, { status: 429 });
  }

  // Download the image from Supabase Storage to get raw bytes
  // Extract the storage path from the URL or use the file record
  const supabase = getAdminSupabase();

  // The file URL is a signed URL — we need the storage path
  // Storage path pattern: {clinicId}/{patientId}/{timestamp}_{random}.{ext}
  // We can reconstruct it or download via the signed URL
  // Safest: generate a fresh signed URL and download from it
  const storagePath = file.url.includes("/patient-files/")
    ? file.url.split("/patient-files/").pop()?.split("?")[0] ?? ""
    : "";

  let imageBase64: string;
  let mediaType: string;

  if (storagePath) {
    // Download directly from Supabase Storage
    const { data, error } = await supabase.storage.from("patient-files").download(storagePath);
    if (error || !data) {
      return NextResponse.json({ error: "No se pudo descargar la imagen" }, { status: 500 });
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    imageBase64 = buffer.toString("base64");
    mediaType = file.mimeType || "image/jpeg";
  } else {
    // Fallback: try fetching from the URL directly
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

  // Get patient context for better analysis
  const patient = await prisma.patient.findUnique({
    where: { id: file.patientId },
    select: { firstName: true, lastName: true, dob: true, gender: true },
  });

  const patientInfo = patient
    ? `Paciente: ${patient.firstName} ${patient.lastName}, ${patient.gender === "M" ? "masculino" : "femenino"}${patient.dob ? `, ${new Date().getFullYear() - new Date(patient.dob).getFullYear()} años` : ""}.`
    : "";

  const categoryLabel = file.category?.replace(/_/g, " ").toLowerCase() ?? "radiografía dental";
  const toothInfo = file.toothNumber ? ` Zona de interés: pieza #${file.toothNumber}.` : "";
  const userMessage = `Analiza esta ${categoryLabel}.${toothInfo} ${patientInfo} ${file.notes ? `Notas del doctor: ${file.notes}` : ""}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-6",
        max_tokens: 1500,
        system:     ANALYSIS_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type:       "base64",
                media_type: mediaType,
                data:       imageBase64,
              },
            },
            {
              type: "text",
              text: userMessage,
            },
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

    // Parse JSON response from Claude
    let analysis;
    try {
      // Try to extract JSON from the response (Claude might wrap it in backticks sometimes)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: rawText, findings: [], recommendations: "" };
    } catch {
      analysis = { summary: rawText, findings: [], recommendations: "" };
    }

    const tokensRemaining = Math.max(0, clinic.aiTokensLimit - currentTokensUsed - totalTokens);

    return NextResponse.json({
      analysis,
      tokensUsed: totalTokens,
      tokensRemaining,
      tokensLimit: clinic.aiTokensLimit,
    });
  } catch (err: any) {
    console.error("AI X-ray analysis error:", err);
    return NextResponse.json({ error: err.message ?? "Error al analizar radiografía" }, { status: 500 });
  }
}
