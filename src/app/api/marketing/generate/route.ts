// POST /api/marketing/generate — Estudio IA (WS-MKT-T2).
// Genera ideas / captions / calendario / hashtags / briefs de imagen con Claude,
// personalizado por la especialidad de la clínica, en español neutro de México.
//
// COBRO DE TOKENS: reusa EXACTAMENTE el patrón del Asistente IA (src/app/api/ai/route.ts)
// — contador Clinic.aiTokensUsed / aiTokensLimit con reset mensual, 429 al exceder,
// incremento atómico con input_tokens + output_tokens tras una llamada exitosa.
// NO usa el wallet (AiWallet) ni cobra fee: ese sistema es solo del bot de WhatsApp.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { categoryLabel } from "@/lib/directory/types";
import type { StudioMode } from "@/lib/marketing/types";

// ── Validación del body (StudioRequest, ver src/lib/marketing/types.ts) ──────────
const MODES = ["ideas", "caption", "calendar", "hashtags", "image_brief"] as const;
const CHANNELS = ["FACEBOOK", "INSTAGRAM", "BOTH"] as const;

const bodySchema = z.object({
  mode: z.enum(MODES),
  topic: z.string().trim().max(400).optional(),
  tone: z.string().trim().max(80).optional(),
  channel: z.enum(CHANNELS).optional(),
  count: z.number().int().min(1).max(30).optional(),
});

// ── Helpers de generación ────────────────────────────────────────────────────────
function channelLabel(ch?: string): string {
  if (ch === "FACEBOOK") return "Facebook";
  if (ch === "INSTAGRAM") return "Instagram";
  return "Facebook e Instagram";
}

// Cantidad efectiva de elementos según el modo (con tope para acotar tokens).
function effectiveCount(mode: StudioMode, count?: number): number {
  const c = count && count > 0 ? Math.floor(count) : undefined;
  switch (mode) {
    case "ideas":
      return Math.min(Math.max(c ?? 6, 1), 12);
    case "caption":
      return Math.min(Math.max(c ?? 3, 1), 6);
    case "calendar":
      return Math.min(Math.max(c ?? 7, 1), 30);
    case "image_brief":
      return Math.min(Math.max(c ?? 3, 1), 6);
    case "hashtags":
      return 3; // 3 grupos: amplios / nicho / locales
    default:
      return 3;
  }
}

function maxTokensFor(mode: StudioMode, n: number): number {
  switch (mode) {
    case "ideas":
      return Math.min(2200, 240 + n * 90);
    case "caption":
      return Math.min(2400, 320 + n * 220);
    case "calendar":
      return Math.min(3000, 360 + n * 130);
    case "image_brief":
      return Math.min(2600, 320 + n * 300);
    case "hashtags":
      return 500;
    default:
      return 1000;
  }
}

const SYSTEM_BASE =
  "Eres un estratega experto en marketing de redes sociales (Instagram y Facebook) para clínicas de salud y bienestar en México. " +
  "Escribes en español neutro de México: claro, cercano y profesional, tratando SIEMPRE de \"tú\". " +
  "JAMÁS uses voseo ni formas argentinas (nada de \"vos\", \"tenés\", \"querés\", \"hacé\", \"mirá\"). " +
  "Cuidas la publicidad sanitaria responsable: no prometas curas ni garantices resultados, no hagas afirmaciones médicas absolutas y evita lenguaje alarmista. " +
  "Si propones testimonios o casos de éxito, mantenlos genéricos y nunca prometas resultados específicos. " +
  "Responde EXCLUSIVAMENTE con un arreglo JSON válido de cadenas de texto, por ejemplo: [\"texto 1\", \"texto 2\"]. " +
  "No incluyas explicaciones, títulos, ni bloques de código markdown: solo el arreglo JSON.";

function buildUserPrompt(
  mode: StudioMode,
  n: number,
  ctx: { name: string; specialty: string; city?: string | null; state?: string | null },
  opts: { topic?: string; tone?: string; channel?: string },
): string {
  const place = ctx.city ? `${ctx.city}${ctx.state ? `, ${ctx.state}` : ""}` : ctx.state || "";
  const ctxLine =
    `Clínica: "${ctx.name}". Giro / especialidad: ${ctx.specialty}.` + (place ? ` Ubicación: ${place}.` : "");
  const toneLine = opts.tone
    ? `Tono deseado: ${opts.tone}.`
    : "Tono: cercano, confiable y profesional.";
  const ch = channelLabel(opts.channel);
  const channelLine = `Canal objetivo: ${ch}.`;
  const topicLine = opts.topic ? `Tema o enfoque específico: ${opts.topic}.` : "";

  const head = [ctxLine, channelLine, toneLine, topicLine].filter(Boolean).join("\n");

  switch (mode) {
    case "ideas":
      return (
        `${head}\n\n` +
        `Genera ${n} ideas de publicaciones para redes sociales, pensadas para esta clínica y su giro. ` +
        `Cada elemento del arreglo es UNA idea concreta y accionable (1–2 frases) con un gancho claro. ` +
        `Varía los formatos: educativa, tip rápido, testimonio/caso, promoción, detrás de cámaras, pregunta a la audiencia y fecha/temporada relevante. ` +
        `Evita repetir el mismo formato. Devuelve un arreglo JSON de ${n} cadenas.`
      );
    case "caption":
      return (
        `${head}\n\n` +
        `Escribe ${n} variantes de caption listas para publicar en ${ch} sobre el tema indicado. ` +
        `Cada caption debe tener: gancho inicial potente, cuerpo breve (2–4 líneas), una llamada a la acción clara (agendar, escribir por WhatsApp, etc.) y 2–4 emojis pertinentes. ` +
        `No agregues hashtags al final (se generan aparte). Devuelve un arreglo JSON de ${n} cadenas, cada una un caption completo.`
      );
    case "calendar":
      return (
        `${head}\n\n` +
        `Crea un calendario de contenido de ${n} días para esta clínica. ` +
        `Cada elemento del arreglo es UN día, en este formato EXACTO: "Día N · [Canal] — [Tema]: [caption corto]". ` +
        `Donde [Canal] es Instagram o Facebook (alterna según convenga), [Tema] es el ángulo del día y [caption corto] una línea lista para publicar. ` +
        `Alterna tipos de contenido (educativo, promocional, testimonio, interacción) y no repitas temas. ` +
        `Devuelve un arreglo JSON de ${n} cadenas, una por día, en orden.`
      );
    case "hashtags":
      return (
        `${head}\n\n` +
        `Genera 3 grupos de hashtags relevantes para el tema y el giro de la clínica, optimizados para ${ch}. ` +
        `Elemento 1: hashtags amplios y populares del sector salud/bienestar. ` +
        `Elemento 2: hashtags de nicho específicos de la especialidad. ` +
        `Elemento 3: hashtags locales (ciudad/estado/colonia y país). ` +
        `Cada elemento es UNA sola línea con 10–14 hashtags separados por un espacio, cada uno iniciando con "#", sin números ni texto adicional. ` +
        `Devuelve un arreglo JSON de exactamente 3 cadenas.`
      );
    case "image_brief":
      return (
        `${head}\n\n` +
        `Crea ${n} briefs creativos para imágenes (foto o diseño) de redes sociales. NO generes ninguna imagen: solo descríbela en texto para que un diseñador o fotógrafo la produzca. ` +
        `Cada elemento debe describir, en un párrafo: (1) escena y sujeto, (2) estilo visual y paleta de color, (3) composición y encuadre, y (4) el copy/texto sugerido sobre la imagen. ` +
        `Coherente con una clínica de ${ctx.specialty} y apropiado para ${ch}. Devuelve un arreglo JSON de ${n} cadenas.`
      );
    default:
      return head;
  }
}

// Convierte la respuesta de Claude en items: string[] de forma robusta.
function parseItems(raw: string): string[] {
  const norm = (v: unknown): string[] | null => {
    if (!Array.isArray(v)) return null;
    const arr = v
      .map((x) =>
        typeof x === "string" ? x : x && typeof x === "object" ? JSON.stringify(x) : String(x),
      )
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length ? arr : null;
  };

  const tryParse = (s: string): string[] | null => {
    try {
      return norm(JSON.parse(s));
    } catch {
      return null;
    }
  };

  const trimmed = raw.trim();
  let items = tryParse(trimmed);
  if (!items) {
    const match = trimmed.match(/\[[\s\S]*\]/); // extrae el arreglo aunque venga con texto/markdown alrededor
    if (match) items = tryParse(match[0]);
  }
  if (!items) {
    // Fallback final: separa por líneas, quita viñetas/numeración.
    items = trimmed
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter((l) => l.length > 0);
  }
  return items.length ? items : trimmed ? [trimmed] : [];
}

// ── Handler ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // 1) Rate limit por IP+ruta (interactivo, algo más holgado que el chat).
  const limited = rateLimit(req, 20, 5 * 60 * 1000);
  if (limited) return limited;

  // 2) Auth multi-tenant: clinicId SIEMPRE de la sesión, nunca del body.
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 3) Configuración de IA.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "El Estudio IA no está configurado. Agrega ANTHROPIC_API_KEY en las variables de entorno de Vercel.",
      },
      { status: 503 },
    );
  }

  // 4) Validar body.
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parámetros inválidos", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { mode, topic, tone, channel, count } = parsed.data;

  // 5) Cargar clínica + cobro de tokens (patrón Asistente IA).
  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: {
      name: true,
      category: true,
      specialty: true,
      city: true,
      state: true,
      aiTokensUsed: true,
      aiTokensLimit: true,
      aiLastResetAt: true,
    },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  let currentTokensUsed = clinic.aiTokensUsed;

  // Reset mensual del contador si corresponde.
  const lastReset = new Date(clinic.aiLastResetAt);
  const now = new Date();
  const monthsDiff =
    (now.getFullYear() - lastReset.getFullYear()) * 12 + (now.getMonth() - lastReset.getMonth());
  if (monthsDiff >= 1) {
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: { aiTokensUsed: 0, aiLastResetAt: now },
    });
    currentTokensUsed = 0;
  }

  // Tope mensual alcanzado → 429.
  if (currentTokensUsed >= clinic.aiTokensLimit) {
    const resetDate = new Date(lastReset.getFullYear(), lastReset.getMonth() + 1, 1);
    return NextResponse.json(
      {
        error: `Alcanzaste el límite mensual de tokens IA. Se renueva el ${resetDate.toLocaleDateString(
          "es-MX",
          { day: "numeric", month: "long" },
        )}.`,
        limitReached: true,
        used: currentTokensUsed,
        limit: clinic.aiTokensLimit,
      },
      { status: 429 },
    );
  }

  // 6) Modelo: Sonnet por defecto; degrada a Haiku si la clínica está cerca del tope
  //    (estira el presupuesto restante para que pueda seguir generando).
  const remainingBefore = clinic.aiTokensLimit - currentTokensUsed;
  const nearCap = remainingBefore <= Math.max(8000, Math.floor(clinic.aiTokensLimit * 0.15));
  const model = nearCap ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6";

  // 7) Construir prompts.
  const specialty =
    clinic.category && clinic.category !== "OTHER"
      ? categoryLabel(clinic.category)
      : clinic.specialty || "salud y bienestar";
  const n = effectiveCount(mode, count);
  const systemPrompt = SYSTEM_BASE;
  const userPrompt = buildUserPrompt(
    mode,
    n,
    { name: clinic.name, specialty, city: clinic.city, state: clinic.state },
    { topic, tone, channel },
  );

  // 8) Llamar a Claude (mismo patrón que /api/ai).
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokensFor(mode, n),
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Anthropic API error (marketing/generate):", data);
      throw new Error(data?.error?.message ?? "Error de API de Anthropic");
    }

    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const totalTokens = inputTokens + outputTokens;

    // Toma el bloque de texto por tipo (robusto si el modelo agrega otros bloques).
    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: any) => b?.type === "text")
      : null;
    const raw: string = textBlock?.text ?? "";
    const items = parseItems(raw);

    // 9) Cobrar: incremento atómico SOLO tras éxito (input + output, sin fee).
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: { aiTokensUsed: { increment: totalTokens } },
    });

    const tokensRemaining = Math.max(0, clinic.aiTokensLimit - currentTokensUsed - totalTokens);

    // 10) StudioResult (+ extras que la UI usa para el medidor).
    return NextResponse.json({
      mode,
      items,
      raw,
      tokensUsed: totalTokens,
      tokensRemaining,
      tokensLimit: clinic.aiTokensLimit,
      model,
      ...(items.length === 0
        ? { warning: "No se pudo interpretar la respuesta de la IA. Intenta de nuevo o ajusta el tema." }
        : {}),
    });
  } catch (err: any) {
    console.error("Estudio IA error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Error al generar contenido con IA" },
      { status: 500 },
    );
  }
}
