import { NextResponse } from "next/server";
import { z } from "zod";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  checkLeadsAccess,
  getAssigneeCandidates,
  getLeadRoutingConfig,
  saveLeadRoutingConfig,
  REALTY_ROUTING_STRATEGIES,
} from "@/lib/realty/leads";
import {
  listInboundMailLog,
  realtyInboundAddress,
  REALTY_PORTAL_CATALOG,
  inboundSecret,
} from "@/lib/realty/inbound-mail";

export const dynamic = "force-dynamic";

/**
 * GET — reglas de asignación + buzón de correo de la cuenta + bitácora de
 * los últimos correos recibidos (para depurar un parser que se rompió).
 */
export async function GET() {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.view");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const config = await getLeadRoutingConfig(ctx.accountId);
  // 🔴 La bitácora de correos solo para quien reparte. El asunto de un aviso
  // de portal trae el NOMBRE del prospecto y el `from` suele ser su correo:
  // servírsela a cualquiera con leads.view era entregarle la lista de
  // prospectos entrantes de sus compañeros por una puerta lateral.
  const canEdit = checkLeadsAccess(ctx, "leads.assign").ok;
  const [candidates, log] = await Promise.all([
    getAssigneeCandidates(ctx.accountId, { ...config, poolUserIds: [] }),
    canEdit ? listInboundMailLog(ctx.accountId, 15) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    config,
    canEdit,
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      zones: c.zones,
      openLeads: c.openLeads,
      lastAssignedAt: c.lastAssignedAt ? c.lastAssignedAt.toISOString() : null,
    })),
    inbox: {
      address: realtyInboundAddress(ctx.accountId),
      portals: REALTY_PORTAL_CATALOG,
      /** false = el webhook está sin secret: en producción rechaza todo. */
      configured: Boolean(inboundSecret()),
      log,
    },
    mode: ctx.mode,
  });
}

const ShiftSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

const PutSchema = z.object({
  strategy: z.enum(REALTY_ROUTING_STRATEGIES as unknown as [string, ...string[]]).optional(),
  reassignEnabled: z.boolean().optional(),
  reassignAfterMinutes: z.number().int().min(1).max(1440).optional(),
  reassignMaxHops: z.number().int().min(0).max(10).optional(),
  poolUserIds: z.array(z.string().max(40)).max(100).optional(),
  zoneOverrides: z.record(z.array(z.string().max(40)).max(50)).optional(),
  shifts: z.record(z.array(ShiftSchema).max(14)).optional(),
  matchTolerancePct: z.number().int().min(0).max(50).optional(),
});

/**
 * PUT — guarda las reglas. Pide leads.assign: quién recibe los prospectos
 * es una decisión de quien reparte, no de cualquiera que edite un lead.
 *
 * En modo AGENT (asesor solo) las reglas existen pero dan igual: todo es
 * suyo. Se deja escribir para que la cuenta pueda ajustar la tolerancia del
 * match, que sí le sirve.
 */
export async function PUT(req: Request) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.assign");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Configuración inválida", detail: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const config = await saveLeadRoutingConfig(
    ctx.accountId,
    parsed.data as Parameters<typeof saveLeadRoutingConfig>[1],
    ctx.realtyUserId,
  );
  return NextResponse.json({ config });
}
