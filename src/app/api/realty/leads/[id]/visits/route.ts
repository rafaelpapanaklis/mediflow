import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  checkLeadsAccess,
  getLeadDetail,
  RealtyLeadError,
  scheduleVisitFromLead,
} from "@/lib/realty/leads";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

const PostSchema = z.object({
  propertyId: z.string().min(1).max(40),
  /** ISO completo con zona: el navegador manda toISOString(). */
  scheduledAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  userId: z.string().max(40).nullable().optional(),
});

/**
 * POST — agenda una visita desde la ficha del prospecto (crea RealtyVisit).
 *
 * Además AVANZA el embudo a VISITA si la etapa lo permite: agendar es el
 * hecho, no un botón aparte que alguien se olvide de picar.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getRealtyContext();
  // Agendar visitas es visits.manage, no leads.edit: un ASSISTANT agenda
  // por todos sin poder tocar el embudo de nadie.
  const guard = checkLeadsAccess(ctx, "visits.manage");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dinos qué inmueble y a qué hora" }, { status: 400 });
  }

  const when = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "Esa fecha no es válida" }, { status: 400 });
  }

  try {
    const visitId = await scheduleVisitFromLead(
      ctx.accountId,
      params.id,
      { propertyId: parsed.data.propertyId, scheduledAt: when, userId: parsed.data.userId ?? null },
      ctx.realtyUserId,
    {
      role: ctx.role,
      realtyUserId: ctx.realtyUserId,
      permissionsOverride: ctx.user.permissionsOverride,
    },
    );
    const lead = await getLeadDetail(ctx.accountId, params.id, {
      role: ctx.role,
      realtyUserId: ctx.realtyUserId,
      permissionsOverride: ctx.user.permissionsOverride,
    });
    return NextResponse.json({ visitId, lead }, { status: 201 });
  } catch (err) {
    if (err instanceof RealtyLeadError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "NOT_FOUND" ? 404 : 400 },
      );
    }
    throw err;
  }
}
