import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  checkLeadsAccess,
  createTask,
  getLeadDetail,
  RealtyLeadError,
} from "@/lib/realty/leads";
import { getRealtyContext } from "@/lib/realty-auth";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

const PostSchema = z.object({
  title: z.string().trim().min(2).max(200),
  dueAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  /** Vacío = para mí. */
  userId: z.string().max(40).nullable().optional(),
});

/** POST — crea un pendiente colgado del prospecto. */
export async function POST(req: NextRequest, { params }: Params) {
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

  // Encargarle un pendiente a OTRA persona es repartir trabajo: pide
  // leads.assign. Sin eso, solo puede ponérselo a sí mismo.
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
      { title: parsed.data.title, dueAt: due, userId: ownerId, leadId: params.id },
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
    return NextResponse.json({ taskId, lead }, { status: 201 });
  } catch (err) {
    if (err instanceof RealtyLeadError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    throw err;
  }
}
