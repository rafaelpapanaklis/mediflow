import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { rateLimit } from "@/lib/rate-limit";
import { chat } from "@/lib/integrations/claude";

export const dynamic = "force-dynamic";

/**
 * Multi-tenant resolver: clinicId del cookie de clínica activa o el primer
 * registro del usuario. Idéntico al patrón en /api/clinic-layout/route.ts.
 */
async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({
      where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true },
    });
    if (u) return u;
  }
  return prisma.user.findFirst({
    where: { supabaseId: user.id, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

const PostSchema = z.object({
  /** YYYY-MM-DD del día a optimizar; default = hoy. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

interface OptimizedAppt {
  resourceId: string;
  patient: string;
  treatment: string;
  doctor: string;
  startHour: number;
  startMin: number;
  durationMins: number;
}

interface OptimizerResult {
  optimized: OptimizedAppt[];
  stats: {
    deadTimeSavedMins: number;
    extraPatientsCapacity: number;
    efficiency: number;
  };
  reasoning: string;
}

/**
 * POST /api/clinic-layout/optimize
 * Devuelve sugerencias de Claude (Sonnet 4.6) para reorganizar la agenda
 * del día. NUNCA expone la API key — el cliente solo recibe el JSON
 * estructurado.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 5, 5 * 60 * 1000);
  if (rl) return rl;

  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!["SUPER_ADMIN", "ADMIN"].includes(dbUser.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const dateStr = parsed.data.date ?? new Date().toISOString().slice(0, 10);
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59`);

  const [appointments, chairs] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        clinicId: dbUser.clinicId,
        startsAt: { gte: dayStart, lte: dayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        resourceId: true,
        startsAt: true,
        endsAt: true,
        type: true,
        notes: true,
        patient: { select: { firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.resource.findMany({
      where: { clinicId: dbUser.clinicId, kind: "CHAIR", isActive: true },
      select: { id: true, name: true },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    }),
  ]);

  if (appointments.length === 0) {
    return NextResponse.json({
      result: {
        optimized: [],
        stats: { deadTimeSavedMins: 0, extraPatientsCapacity: 0, efficiency: 100 },
        reasoning: "No hay citas para optimizar en este día.",
      } satisfies OptimizerResult,
    });
  }

  const fmtT = (d: Date) =>
    d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });

  const aptSummary = appointments
    .map((a) => {
      const dur = Math.max(1, Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000));
      const chair = chairs.find((c) => c.id === a.resourceId)?.name ?? "Sin asignar";
      const patient =
        `${a.patient?.firstName ?? ""} ${a.patient?.lastName ?? ""}`.trim() || "Paciente";
      const doctor =
        `${a.doctor?.firstName ?? ""} ${a.doctor?.lastName ?? ""}`.trim() || "—";
      const treatment = a.type || a.notes || "Consulta";
      return `- chair="${chair}" (id=${a.resourceId ?? "null"}) | ${patient} | ${treatment} | ${fmtT(a.startsAt)}-${fmtT(a.endsAt)} (${dur}min) | ${doctor}`;
    })
    .join("\n");

  const chairsList = chairs.map((c) => `- "${c.name}" (id=${c.id})`).join("\n");

  const prompt = `Eres un optimizador de agenda para una clínica dental. Analiza estas citas y propón una reorganización optimizada.

CITAS ACTUALES (${dateStr}):
${aptSummary}

SILLONES DISPONIBLES:
${chairsList}

HORARIO: 8:00 - 20:00

REGLAS:
1. Cada cita debe asignarse a un sillón válido (resourceId)
2. No puede haber dos citas simultáneas en el mismo sillón
3. Minimizar tiempos muertos entre citas
4. Agrupar tratamientos similares cuando sea posible
5. Respetar la duración original de cada tratamiento
6. Si una cita ya está en el sillón óptimo, mantenla

Responde SOLO con un JSON válido (sin markdown, sin texto extra) con esta estructura exacta:
{
  "optimized": [
    { "resourceId": "<id>", "patient": "nombre", "treatment": "tratamiento", "doctor": "doctor", "startHour": 9, "startMin": 0, "durationMins": 50 }
  ],
  "stats": {
    "deadTimeSavedMins": 45,
    "extraPatientsCapacity": 1,
    "efficiency": 87
  },
  "reasoning": "Explicación breve en español de los cambios realizados (2-3 oraciones)"
}`;

  const result = await chat({
    model: "claude-sonnet-4-6",
    maxTokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  if (result.error) {
    return NextResponse.json(
      { error: "claude_error", detail: result.error },
      { status: 502 },
    );
  }
  if (result.mock) {
    return NextResponse.json({
      result: {
        optimized: appointments.slice(0, 3).map((a) => ({
          resourceId: a.resourceId ?? chairs[0]?.id ?? "",
          patient:
            `${a.patient?.firstName ?? ""} ${a.patient?.lastName ?? ""}`.trim() || "Paciente",
          treatment: a.type || "Consulta",
          doctor: `${a.doctor?.firstName ?? ""} ${a.doctor?.lastName ?? ""}`.trim() || "—",
          startHour: a.startsAt.getHours(),
          startMin: a.startsAt.getMinutes(),
          durationMins: Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000),
        })),
        stats: { deadTimeSavedMins: 0, extraPatientsCapacity: 0, efficiency: 100 },
        reasoning:
          "[Mock] ANTHROPIC_API_KEY no configurada. La respuesta real requiere clave válida.",
      } satisfies OptimizerResult,
      mock: true,
    });
  }

  // Claude a veces envuelve el JSON en markdown a pesar del system prompt.
  const match = result.text.match(/\{[\s\S]*\}/);
  if (!match) {
    return NextResponse.json(
      { error: "claude_no_json", raw: result.text.slice(0, 500) },
      { status: 502 },
    );
  }
  let parsedJson: OptimizerResult;
  try {
    parsedJson = JSON.parse(match[0]) as OptimizerResult;
  } catch (err) {
    return NextResponse.json(
      {
        error: "claude_invalid_json",
        detail: err instanceof Error ? err.message : "parse_failed",
        raw: match[0].slice(0, 500),
      },
      { status: 502 },
    );
  }

  // Sanity: cada resourceId optimizado debe pertenecer a la clínica.
  const validChairIds = new Set(chairs.map((c) => c.id));
  parsedJson.optimized = (parsedJson.optimized ?? []).filter((a) =>
    validChairIds.has(a.resourceId),
  );

  return NextResponse.json({ result: parsedJson });
}
