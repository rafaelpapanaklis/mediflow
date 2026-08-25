import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  checkLeadsAccess,
  getLeadDetail,
  markLeadContacted,
  RealtyLeadError,
} from "@/lib/realty/leads";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

const PostSchema = z.object({
  kind: z.enum(["NOTA", "LLAMADA", "WHATSAPP", "CORREO", "VISITA"]),
  note: z.string().max(4000).nullable().optional(),
});

/**
 * POST — apunta algo en la bitácora del prospecto.
 *
 * LLAMADA/WHATSAPP/CORREO/VISITA cuentan como CONTACTO: sellan
 * firstResponseAt (una sola vez), apagan el semáforo y sacan al prospecto
 * de la cola de reasignación automática. NOTA no: apuntar algo no es
 * haberle hablado, y si contara, cualquiera podría quedarse un prospecto
 * escribiendo "pendiente" sin marcarle nunca.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.edit");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const scope = {
    role: ctx.role,
    realtyUserId: ctx.realtyUserId,
    permissionsOverride: ctx.user.permissionsOverride,
  };

  try {
    await markLeadContacted(
      ctx.accountId,
      params.id,
      parsed.data.kind,
      parsed.data.note ?? null,
      ctx.realtyUserId,
      scope,
    );
  } catch (err) {
    if (err instanceof RealtyLeadError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "NOT_FOUND" ? 404 : 400 },
      );
    }
    throw err;
  }

  const lead = await getLeadDetail(ctx.accountId, params.id, scope);
  return NextResponse.json({ lead }, { status: 201 });
}
