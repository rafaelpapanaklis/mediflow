import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  assignLead,
  checkLeadsAccess,
  getLeadDetail,
  leadScopeWhere,
  moveLeadStage,
  RealtyLeadError,
} from "@/lib/realty/leads";
import { REALTY_LEAD_FLOW, REALTY_LOST_REASONS } from "@/lib/realty/types";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.view");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const lead = await getLeadDetail(ctx.accountId, params.id, {
    role: ctx.role,
    realtyUserId: ctx.realtyUserId,
    permissionsOverride: ctx.user.permissionsOverride,
  });
  if (!lead) return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });
  return NextResponse.json({ lead });
}

/** Las siete etapas como tupla literal: z.enum pide [string, ...string[]] y
 *  un spread de array normal no satisface esa forma. */
const STAGE_VALUES = [...REALTY_LEAD_FLOW, "PERDIDO"] as unknown as [string, ...string[]];

const PatchSchema = z.object({
  stage: z.enum(STAGE_VALUES).optional(),
  lostReason: z.enum(REALTY_LOST_REASONS as unknown as [string, ...string[]]).nullable().optional(),
  assignedUserId: z.string().max(40).nullable().optional(),
  budgetMin: z.number().nonnegative().nullable().optional(),
  budgetMax: z.number().nonnegative().nullable().optional(),
  creditKind: z.enum(["INFONAVIT", "FOVISSSTE", "BANCARIO", "CONTADO", "NINGUNO"]).optional(),
  propertyId: z.string().max(40).nullable().optional(),
});

/**
 * PATCH — mueve etapa, reasigna y edita los datos del embudo.
 *
 * La transición la valida moveLeadStage con canTransition() del contrato:
 * el kanban puede arrastrar donde sea, el servidor es quien dice que no.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.edit");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const input = parsed.data;

  const scope = {
    role: ctx.role,
    realtyUserId: ctx.realtyUserId,
    permissionsOverride: ctx.user.permissionsOverride,
  };

  try {
    if (input.stage) {
      await moveLeadStage(
        ctx.accountId,
        params.id,
        input.stage as (typeof REALTY_LEAD_FLOW)[number] | "PERDIDO",
        ctx.realtyUserId,
        input.lostReason ?? null,
        scope,
      );
    }

    if (input.assignedUserId !== undefined) {
      // Quitarle un prospecto a OTRO asesor no es leads.edit: es
      // leads.assign. Sin esa puerta, un asesor le vaciaba el embudo al de
      // al lado desde la consola del navegador.
      //
      // 🔴 CON UNA EXCEPCIÓN: LEVANTAR UN HUÉRFANO. Un prospecto sin asesor
      // es el que nadie contesta, y el embudo se los enseña a todos justo
      // para que alguien lo tome. Si tomarlo pidiera leads.assign, en una
      // cuenta con reparto MANUAL el huérfano se quedaba huérfano para
      // siempre aunque hubiera quien lo trabajara. Así que cualquiera con
      // leads.edit puede asignárselo A SÍ MISMO, y solo si hoy no tiene
      // dueño.
      const seLoQuedaElMismo = input.assignedUserId === ctx.realtyUserId;
      if (!checkLeadsAccess(ctx, "leads.assign").ok) {
        const actual = await prisma.realtyLead.findFirst({
          where: { id: params.id, accountId: ctx.accountId },
          select: { assignedUserId: true },
        });
        if (!actual) {
          return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });
        }
        if (!seLoQuedaElMismo || actual.assignedUserId !== null) {
          return NextResponse.json({ error: "No puedes repartir prospectos" }, { status: 403 });
        }
      }
      await assignLead(ctx.accountId, params.id, input.assignedUserId, ctx.realtyUserId);
    }

    const data: Record<string, unknown> = {};
    if (input.budgetMin !== undefined) data.budgetMin = input.budgetMin;
    if (input.budgetMax !== undefined) data.budgetMax = input.budgetMax;
    if (input.creditKind !== undefined) data.creditKind = input.creditKind;
    if (input.propertyId !== undefined) {
      if (input.propertyId) {
        const p = await prisma.realtyProperty.findFirst({
          where: { id: input.propertyId, accountId: ctx.accountId },
          select: { id: true },
        });
        if (!p) return NextResponse.json({ error: "Ese inmueble no es de tu cartera" }, { status: 400 });
        data.propertyId = p.id;
      } else {
        data.propertyId = null;
      }
    }
    if (Object.keys(data).length > 0) {
      // updateMany (no update por id) para que el accountId entre en el
      // WHERE: un update por id a secas cruzaría cuentas. Y con el ALCANCE
      // del rol, que es lo que evita que un asesor le edite el presupuesto
      // o le recuelgue el inmueble al prospecto de un compañero.
      const res = await prisma.realtyLead.updateMany({
        where: { AND: [{ id: params.id, accountId: ctx.accountId }, leadScopeWhere(scope)] },
        data,
      });
      if (res.count === 0) {
        return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });
      }
    }
  } catch (err) {
    if (err instanceof RealtyLeadError) {
      const status = err.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }

  const lead = await getLeadDetail(ctx.accountId, params.id, scope);
  return NextResponse.json({ lead });
}
