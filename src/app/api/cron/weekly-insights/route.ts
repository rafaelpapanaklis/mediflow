import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { chat, type ChatInput, type ChatResult } from "@/lib/integrations/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min (límite duro de Vercel).

// Cuántas clínicas (= llamadas a la IA) procesamos en paralelo por lote.
// Modesto a propósito para no saturar el rate limit de Claude.
const CONCURRENCY = 5;
// Presupuesto blando: cortamos limpio antes del límite duro y dejamos margen
// para responder. Lo que falte se reanuda en la próxima corrida (idempotencia).
const SOFT_DEADLINE_MS = 270_000; // 4.5 de 5 min

/**
 * GET /api/cron/weekly-insights
 *
 * Vercel cron schedule: domingo 22:00 UTC (0 22 * * 0). Genera
 * WeeklyInsight por cada clínica activa basado en datos de la semana
 * recién cerrada (lunes 00:00 → domingo 23:59 de la semana previa).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} (Vercel agrega esto auto-
 * máticamente cuando llama desde su scheduler).
 *
 * Multi-tenant strict:
 * - Itera UNA vez por clínica con prisma.clinic.findMany.
 * - Cada llamada a Claude es per-clinica con su propio data slice.
 * - Idempotente: si ya existe (clinicId, weekStart) → skip silencioso.
 * - Errores de IA por clínica NO matan el cron — se loguean y sigue.
 *
 * Concurrencia: procesa las clínicas en lotes (CONCURRENCY en paralelo) con
 * corte blando antes de maxDuration; lo pendiente se reanuda por idempotencia.
 *
 * Response: { processed, skipped, failed, stoppedEarly, remaining, weekStart, weekEnd }
 */
export async function GET(req: NextRequest) {
  // Auth check — Vercel inyecta Authorization: Bearer <CRON_SECRET>.
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Calcular semana cerrada: domingo previo 23:59 → lunes anterior 00:00.
  // Asumimos cron corre domingo 22:00 UTC, así que "ayer + retroceso a
  // lunes" = la semana que acaba de cerrar.
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Lun=0
  // weekEnd = el domingo más reciente a las 23:59:59. Si hoy es domingo
  // (dow=6) y son las 22:00, entonces "esta semana" cierra hoy y la
  // queremos. weekStart = lunes de esa semana 00:00.
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() - (dow === 6 ? 0 : dow + 1));
  weekEnd.setHours(23, 59, 59, 999);
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  // Semana anterior para comparativa.
  const prevWeekEnd = new Date(weekStart);
  prevWeekEnd.setDate(prevWeekEnd.getDate() - 1);
  prevWeekEnd.setHours(23, 59, 59, 999);
  const prevWeekStart = new Date(prevWeekEnd);
  prevWeekStart.setDate(prevWeekStart.getDate() - 6);
  prevWeekStart.setHours(0, 0, 0, 0);

  const startedAt = Date.now();
  const clinics = await prisma.clinic.findMany({
    select: { id: true, name: true },
  });

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let stoppedEarly = false;
  let remaining = 0;
  const errors: Array<{ clinicId: string; error: string }> = [];

  // Procesa UNA clínica de punta a punta. Captura sus propios errores y NUNCA
  // lanza, para que un fallo de IA no aborte el resto del lote.
  async function processClinic(
    clinic: { id: string; name: string },
  ): Promise<"processed" | "skipped" | "failed"> {
    try {
      // Idempotencia = progreso reanudable: si ya existe insight para
      // (clinicId, weekStart) lo saltamos. Ese row ES la marca por clínica de
      // la última semana procesada; si una corrida se corta, la siguiente
      // continúa con las que faltan en vez de empezar de cero.
      const existing = await prisma.weeklyInsight.findFirst({
        where: { clinicId: clinic.id, weekStart },
        select: { id: true },
      });
      if (existing) return "skipped";

      // Recolecta datos de la semana de ESTA clínica (clinicId scoped).
      const [weekAppts, prevWeekAppts, weekTimelines] = await Promise.all([
        prisma.appointment.findMany({
          where: { clinicId: clinic.id, startsAt: { gte: weekStart, lte: weekEnd } },
          select: { id: true, status: true, startsAt: true, doctorId: true, type: true },
        }),
        prisma.appointment.findMany({
          where: { clinicId: clinic.id, startsAt: { gte: prevWeekStart, lte: prevWeekEnd } },
          select: { id: true, status: true },
        }),
        prisma.appointmentTimeline.findMany({
          where: {
            appointment: { clinicId: clinic.id, startsAt: { gte: weekStart, lte: weekEnd } },
          },
          select: { totalWaitMin: true, totalConsultMin: true },
        }),
      ]);

      // Si no hubo actividad la semana → skip silencioso (no insight vacío).
      if (weekAppts.length === 0) return "skipped";

      const weekStats = summarize(weekAppts, weekTimelines);
      const prevStats = summarize(prevWeekAppts, []);

      const aiResult = await chatWithRetry({
        system: WEEKLY_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              week: weekStats,
              prevWeek: prevStats,
            }),
          },
        ],
        maxTokens: 600,
      });

      let summary = `${weekStats.total} citas la semana del ${weekStart.toLocaleDateString("es-MX")}.`;
      let insightsArr: Array<{ tone: string; title: string; detail: string }> = [];

      if (!aiResult.error && aiResult.text) {
        const parsed = parseInsightJSON(aiResult.text);
        if (parsed) {
          summary = parsed.summary;
          insightsArr = parsed.insights;
        }
      }

      // Fallback si IA no parseable: bullets básicos heurísticos.
      if (insightsArr.length === 0) {
        insightsArr = buildFallbackInsights(weekStats, prevStats);
      }

      await prisma.weeklyInsight.create({
        data: {
          clinicId: clinic.id,
          weekStart,
          weekEnd,
          summary: summary.slice(0, 500),
          insights: insightsArr,
        },
      });
      return "processed";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      errors.push({ clinicId: clinic.id, error: msg.slice(0, 200) });
      console.error(`[weekly-insights] clinic=${clinic.id} error=${msg}`);
      return "failed";
    }
  }

  // Lotes con concurrencia limitada: CONCURRENCY llamadas a la IA en paralelo
  // por vez. Esto multiplica el throughput (antes era 1 a la vez en serie y se
  // cortaba a ~120 clínicas) respetando el rate limit de Claude.
  for (let i = 0; i < clinics.length; i += CONCURRENCY) {
    // Corte controlado antes del límite duro de maxDuration. Lo pendiente se
    // reanuda en la próxima corrida por la idempotencia de arriba.
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      stoppedEarly = true;
      remaining = clinics.length - i;
      break;
    }
    const batch = clinics.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((c) => processClinic(c)));
    for (const r of results) {
      if (r === "processed") processed += 1;
      else if (r === "skipped") skipped += 1;
      else failed += 1;
    }
  }

  return NextResponse.json({
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    totalClinics: clinics.length,
    processed,
    skipped,
    failed,
    stoppedEarly,
    remaining,
    errors: errors.slice(0, 20),
  });
}

/** Pausa para el backoff entre reintentos. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ¿El error de chat() es transitorio? Solo reintentamos en rate limit (429),
 * overload (529) y 5xx/red — reintentar aquí ES respetar el rate limit. Un 400
 * (request mal formado) no se reintenta.
 */
function isRetryableError(error: string): boolean {
  return (
    /claude_(429|500|502|503|529)/.test(error) ||
    /fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(error)
  );
}

/**
 * chat() con reintentos acotados (backoff exponencial + jitter) SOLO ante
 * errores transitorios. No cambia el contenido del insight: misma llamada,
 * solo más resiliente. chat() no lanza — devuelve { error } — así que
 * inspeccionamos ese campo en vez de un try/catch.
 */
async function chatWithRetry(input: ChatInput, maxRetries = 2): Promise<ChatResult> {
  let result = await chat(input);
  let attempt = 0;
  while (result.error && isRetryableError(result.error) && attempt < maxRetries) {
    attempt += 1;
    const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250);
    await sleep(backoff);
    result = await chat(input);
  }
  return result;
}

interface WeekSummary {
  total: number;
  completed: number;
  noShow: number;
  cancelled: number;
  noShowRate: number;
  avgWaitMin: number;
  avgConsultMin: number;
  topType: string;
}

function summarize(
  appts: Array<{ status: string; type?: string }>,
  timelines: Array<{ totalWaitMin: number | null; totalConsultMin: number | null }>,
): WeekSummary {
  const total = appts.length;
  const completed = appts.filter((a) => a.status === "COMPLETED" || a.status === "CHECKED_OUT").length;
  const noShow = appts.filter((a) => a.status === "NO_SHOW").length;
  const cancelled = appts.filter((a) => a.status === "CANCELLED").length;

  const waits = timelines.map((t) => t.totalWaitMin).filter((n): n is number => n != null && n >= 0);
  const consults = timelines.map((t) => t.totalConsultMin).filter((n): n is number => n != null && n > 0);

  const avgWaitMin = waits.length > 0
    ? Math.round(waits.reduce((s, n) => s + n, 0) / waits.length)
    : 0;
  const avgConsultMin = consults.length > 0
    ? Math.round(consults.reduce((s, n) => s + n, 0) / consults.length)
    : 0;

  const typeCounts = new Map<string, number>();
  for (const a of appts) {
    if (!a.type) continue;
    typeCounts.set(a.type, (typeCounts.get(a.type) ?? 0) + 1);
  }
  const topType = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  return {
    total,
    completed,
    noShow,
    cancelled,
    noShowRate: total > 0 ? Math.round((noShow / total) * 1000) / 10 : 0,
    avgWaitMin,
    avgConsultMin,
    topType,
  };
}

function buildFallbackInsights(week: WeekSummary, prev: WeekSummary): Array<{ tone: string; title: string; detail: string }> {
  const insights: Array<{ tone: string; title: string; detail: string }> = [];

  if (week.total > 0 && prev.total > 0) {
    const delta = Math.round(((week.total - prev.total) / prev.total) * 100);
    insights.push({
      tone: delta >= 0 ? "success" : "warning",
      title: `${week.total} citas esta semana`,
      detail: `${delta >= 0 ? "+" : ""}${delta}% vs semana anterior (${prev.total} citas)`,
    });
  }

  if (week.noShowRate > 10) {
    insights.push({
      tone: "danger",
      title: `Tasa de no-shows: ${week.noShowRate}%`,
      detail: `${week.noShow} pacientes no llegaron. Considera recordatorios extra el día anterior.`,
    });
  }

  if (week.avgWaitMin > 20) {
    insights.push({
      tone: "warning",
      title: `Espera promedio: ${week.avgWaitMin} min`,
      detail: "Por encima de 20 min — revisa la duración de citas o el flujo de check-in.",
    });
  }

  if (week.topType !== "—") {
    insights.push({
      tone: "info",
      title: `Procedimiento más realizado: ${week.topType}`,
      detail: "Es donde más volumen tienes esta semana.",
    });
  }

  return insights;
}

const WEEKLY_SYSTEM_PROMPT = `Eres un analista operativo de clínicas. Recibes
un JSON con métricas de la semana cerrada y la semana anterior. Genera un
resumen accionable.

Responde SOLO con JSON válido:
{
  "summary": "<frase de 1-2 oraciones, máx 200 chars>",
  "insights": [
    { "tone": "success|warning|danger|info", "title": "<corto>", "detail": "<accionable, 1-2 oraciones>" }
  ]
}

Reglas:
- 3-5 insights, los más relevantes (no rellenar).
- title <= 60 chars, detail <= 200 chars.
- Compara contra prevWeek cuando aporte (delta % en citas, no-shows).
- Si una métrica está bien, NO inventes problemas — pasa a la siguiente.
- NO uses markdown. NO uses emojis. Tono profesional y conciso.
- Responde SOLO el JSON, sin texto antes o después.`;

function parseInsightJSON(text: string): { summary: string; insights: Array<{ tone: string; title: string; detail: string }> } | null {
  try {
    const trimmed = text.trim();
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.summary !== "string") return null;
    if (!Array.isArray(parsed.insights)) return null;
    return {
      summary: parsed.summary,
      insights: parsed.insights.slice(0, 8).map((i: { tone?: unknown; title?: unknown; detail?: unknown }) => ({
        tone: typeof i.tone === "string" ? i.tone : "info",
        title: String(i.title ?? "").slice(0, 60),
        detail: String(i.detail ?? "").slice(0, 200),
      })),
    };
  } catch {
    return null;
  }
}
