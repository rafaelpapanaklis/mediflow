// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/visits   — la ventana del calendario (día o semana)
// POST /api/realty/visits   — alta de una visita desde la agenda o desde la
//                             ficha del inmueble
//
// El guard va PRIMERO y el parseo después: nunca se valida el cuerpo de
// alguien que no tenía derecho a llegar aquí. El aislamiento por cuenta y
// oficina lo hace src/lib/realty/visits.ts — la ruta no arma un where.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  checkVisitsAccess,
  createVisit,
  listVisitsWindow,
  RealtyVisitError,
  visitErrorStatus,
} from "@/lib/realty/visits";
import { isValidDateISO, realtyDateISO } from "@/components/realty/visits/visit-core";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkVisitsAccess(ctx, "visits.manage");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  }
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const timeZone = ctx.account.timezone || "America/Mexico_City";

  // Una fecha inválida NO es un 400: la agenda abre en HOY. Que el
  // calendario reviente porque alguien tocó la URL sería absurdo.
  const asked = sp.get("date");
  const fromISO = isValidDateISO(asked) ? (asked as string) : realtyDateISO(new Date(), timeZone);

  const rawDays = parseInt(sp.get("days") ?? "1", 10);
  const days = rawDays === 7 ? 7 : 1;

  // El filtro por asesor se APILA sobre el alcance del rol; jamás lo
  // sustituye (ver visitRoleWhere).
  const userId = sp.get("userId");

  const data = await listVisitsWindow(ctx, {
    fromISO,
    days,
    userId: userId && userId !== "TODOS" ? userId : null,
  });

  return NextResponse.json(
    { ...data, me: { realtyUserId: ctx.realtyUserId, role: ctx.role } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const CreateSchema = z.object({
  propertyId: z.string().min(1).max(40),
  leadId: z.string().max(40).nullable().optional(),
  userId: z.string().max(40).nullable().optional(),
  /** ISO completo: el navegador manda toISOString(). */
  scheduledAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
});

export async function POST(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkVisitsAccess(ctx, "visits.manage");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  }
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Faltan datos de la visita", detail: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const when = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "Esa fecha no es válida" }, { status: 400 });
  }

  try {
    const visitId = await createVisit(ctx, {
      propertyId: parsed.data.propertyId,
      leadId: parsed.data.leadId ?? null,
      userId: parsed.data.userId ?? null,
      scheduledAt: when,
    });
    return NextResponse.json({ visitId }, { status: 201 });
  } catch (err) {
    if (err instanceof RealtyVisitError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: visitErrorStatus(err.code) },
      );
    }
    throw err;
  }
}
