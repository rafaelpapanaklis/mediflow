import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  checkLeadsAccess,
  getLeadDetail,
  leadScopeWhere,
  RealtyLeadError,
  upsertSearchProfile,
} from "@/lib/realty/leads";
import type { RealtyOperation, RealtyPropertyKind } from "@/lib/realty/types";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

const PutSchema = z.object({
  operation: z.enum(["VENTA", "RENTA", "AMBAS"]),
  kinds: z
    .array(z.enum(["CASA", "DEPARTAMENTO", "TERRENO", "BODEGA", "LOCAL", "EDIFICIO", "OFICINA", "RANCHO"]))
    .max(8),
  zones: z.array(z.string().trim().max(80)).max(20),
  budgetMin: z.number().nonnegative().nullable(),
  budgetMax: z.number().nonnegative().nullable(),
  bedroomsMin: z.number().int().min(0).max(20).nullable(),
  notifyByWhatsapp: z.boolean(),
});

/**
 * PUT — qué busca el prospecto (RealtySearchProfile). Es lo que alimenta el
 * MATCH automático, así que se guarda por CONTACTO (no por lead): la misma
 * persona con dos prospectos busca lo mismo.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.edit");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  if (
    parsed.data.budgetMin != null &&
    parsed.data.budgetMax != null &&
    parsed.data.budgetMin > parsed.data.budgetMax
  ) {
    return NextResponse.json({ error: "El mínimo no puede ser mayor que el máximo" }, { status: 400 });
  }

  // Con el ALCANCE: por aquí se reescribe el perfil de búsqueda del
  // contacto, y poner notifyByWhatsapp en true sobre alguien que lo tenía
  // apagado anula el ÚNICO opt-out que respeta el envío masivo.
  const lead = await prisma.realtyLead.findFirst({
    where: {
      AND: [
        { id: params.id, accountId: ctx.accountId },
        leadScopeWhere({
          role: ctx.role,
          realtyUserId: ctx.realtyUserId,
          permissionsOverride: ctx.user.permissionsOverride,
        }),
      ],
    },
    select: { contactId: true },
  });
  if (!lead) return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });

  try {
    await upsertSearchProfile(ctx.accountId, lead.contactId, {
      operation: parsed.data.operation as RealtyOperation,
      kinds: parsed.data.kinds as RealtyPropertyKind[],
      zones: parsed.data.zones,
      budgetMin: parsed.data.budgetMin,
      budgetMax: parsed.data.budgetMax,
      bedroomsMin: parsed.data.bedroomsMin,
      notifyByWhatsapp: parsed.data.notifyByWhatsapp,
    });
  } catch (err) {
    if (err instanceof RealtyLeadError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const detail = await getLeadDetail(ctx.accountId, params.id, {
    role: ctx.role,
    realtyUserId: ctx.realtyUserId,
    permissionsOverride: ctx.user.permissionsOverride,
  });
  return NextResponse.json({ lead: detail });
}
