import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { chat } from "@/lib/integrations/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutos — suficiente para iterar
                                // 100s de clínicas con 1-2s cada una.

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
 * Response: { processed, skipped, failed, weekStart, weekEnd }
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

  const clinics = await prisma.clinic.findMany({
    select: { id: true, name: true },
  });

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ clinicId: string; error: string }> = [];

  // Iteramos secuencial para no saturar el rate limit de Claude.
  for (const clinic of clinics) {
    try {
      // Idempotency: si ya existe insight para (clinicId, weekStart), skip.
      const existing = await prisma.weeklyInsight.findFirst({
        where: { clinicId: clinic.id, weekStart },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

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
      if (weekAppts.length === 0) {
        skipped += 1;
        continue;
      }

      const weekStats = summarize(weekAppts, weekTimelines);
      const prevStats = summarize(prevWeekAppts, []);

      const aiResult = await chat({
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
      processed += 1;
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : "unknown";
      errors.push({ clinicId: clinic.id, error: msg.slice(0, 200) });
      console.error(`[weekly-insights] clinic=${clinic.id} error=${msg}`);
    }
  }

  return NextResponse.json({
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    totalClinics: clinics.length,
    processed,
    skipped,
    failed,
    errors: errors.slice(0, 20),
  });
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
