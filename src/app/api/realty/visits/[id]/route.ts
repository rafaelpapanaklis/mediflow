// ═══════════════════════════════════════════════════════════════════════
// PATCH /api/realty/visits/[id]
//
// Dos operaciones distintas por la misma puerta, porque las dos son "editar
// la visita" desde la pantalla:
//
//   · MOVER  → { scheduledAt, userId? }   (arrastrar en el calendario)
//   · ESTADO → { status, outcome?, note? } (confirmar, realizada, no llegó…)
//
// 🔴 Mover DEVUELVE `remindersCancelled` y la pantalla lo DICE. No es un
// adorno: es la prueba visible de que el recordatorio con la hora vieja se
// canceló. El bug M-22 del dental fue exactamente no hacer esto.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  checkVisitsAccess,
  moveVisit,
  RealtyVisitError,
  setVisitStatus,
  visitErrorStatus,
} from "@/lib/realty/visits";
import { REALTY_VISIT_OUTCOMES } from "@/components/realty/visits/visit-core";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

const MoveSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  /** Ausente = no se toca el asesor. null explícito = se le quita. */
  userId: z.string().max(40).nullable().optional(),
});

const StatusSchema = z.object({
  status: z.enum(["PROGRAMADA", "CONFIRMADA", "REALIZADA", "CANCELADA", "NO_ASISTIO"]),
  outcome: z.enum(REALTY_VISIT_OUTCOMES).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getRealtyContext();
  const guard = checkVisitsAccess(ctx, "visits.manage");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  }
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Falta el cuerpo de la petición" }, { status: 400 });
  }

  try {
    // ── Mover ──
    if (Object.prototype.hasOwnProperty.call(body, "scheduledAt")) {
      const parsed = MoveSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Datos del movimiento inválidos", detail: parsed.error.issues[0]?.message },
          { status: 400 },
        );
      }
      const when = new Date(parsed.data.scheduledAt);
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json({ error: "Esa fecha no es válida" }, { status: 400 });
      }
      const result = await moveVisit(ctx, params.id, {
        scheduledAt: when,
        // `undefined` deja el asesor como estaba; en Prisma un `null` SÍ lo
        // borra, así que se distingue "no lo mencionaron" de "quítalo".
        userId: Object.prototype.hasOwnProperty.call(body, "userId")
          ? parsed.data.userId ?? null
          : undefined,
      });
      return NextResponse.json(result);
    }

    // ── Estado (+ retroalimentación) ──
    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      const parsed = StatusSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Datos del estado inválidos", detail: parsed.error.issues[0]?.message },
          { status: 400 },
        );
      }
      const traeFeedback =
        Object.prototype.hasOwnProperty.call(body, "outcome") ||
        Object.prototype.hasOwnProperty.call(body, "note");
      const result = await setVisitStatus(
        ctx,
        params.id,
        parsed.data.status,
        traeFeedback
          ? { outcome: parsed.data.outcome ?? null, note: parsed.data.note ?? null }
          : undefined,
      );
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "No hay nada que cambiar" }, { status: 400 });
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
