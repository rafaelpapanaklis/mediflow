import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  checkLeadsAccess,
  createTask,
  listTasksForToday,
  RealtyLeadError,
  setTaskDone,
} from "@/lib/realty/leads";

export const dynamic = "force-dynamic";

/**
 * GET — "mis pendientes de hoy": lo vencido más lo que cae hoy, en la ZONA
 * DE LA CUENTA. El Inicio (otra terminal) consume esta misma ruta para no
 * reimplementar el criterio de "hoy".
 *
 * ?all=1 devuelve los de todo el equipo (pide leads.assign).
 */
export async function GET(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.view");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const wantsAll = req.nextUrl.searchParams.get("all") === "1";
  const includeAll = wantsAll && checkLeadsAccess(ctx, "leads.assign").ok;

  const tasks = await listTasksForToday(ctx.accountId, ctx.realtyUserId, {
    includeAll,
    timeZone: ctx.account.timezone,
  });
  return NextResponse.json({ tasks, scope: includeAll ? "EQUIPO" : "MIOS" });
}

const PostSchema = z.object({
  title: z.string().trim().min(2).max(200),
  dueAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  userId: z.string().max(40).nullable().optional(),
  leadId: z.string().max(40).nullable().optional(),
  propertyId: z.string().max(40).nullable().optional(),
});

/** POST — pendiente suelto (puede colgar de un prospecto o de un inmueble). */
export async function POST(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.edit");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Escribe el pendiente y para cuándo" }, { status: 400 });
  }
  const due = new Date(parsed.data.dueAt);
  if (Number.isNaN(due.getTime())) {
    return NextResponse.json({ error: "Esa fecha no es válida" }, { status: 400 });
  }

  let ownerId = ctx.realtyUserId;
  if (parsed.data.userId && parsed.data.userId !== ctx.realtyUserId) {
    if (!checkLeadsAccess(ctx, "leads.assign").ok) {
      return NextResponse.json({ error: "Solo puedes crear pendientes tuyos" }, { status: 403 });
    }
    ownerId = parsed.data.userId;
  }

  try {
    const taskId = await createTask(
      ctx.accountId,
      {
        title: parsed.data.title,
        dueAt: due,
        userId: ownerId,
        leadId: parsed.data.leadId ?? null,
        propertyId: parsed.data.propertyId ?? null,
      },
      ctx.realtyUserId,
    {
      role: ctx.role,
      realtyUserId: ctx.realtyUserId,
      permissionsOverride: ctx.user.permissionsOverride,
    },
    );
    return NextResponse.json({ taskId }, { status: 201 });
  } catch (err) {
    if (err instanceof RealtyLeadError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

const PatchSchema = z.object({ taskId: z.string().min(1).max(40), done: z.boolean() });

/** PATCH — palomear (o despalomear) un pendiente. */
export async function PATCH(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.edit");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const ok = await setTaskDone(ctx.accountId, parsed.data.taskId, parsed.data.done, {
    role: ctx.role,
    realtyUserId: ctx.realtyUserId,
    permissionsOverride: ctx.user.permissionsOverride,
  });
  if (!ok) return NextResponse.json({ error: "Pendiente no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
