import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  assignLead,
  checkLeadsAccess,
  createLeadWithContact,
  autoAssignLead,
  getLeadRoutingConfig,
  getLeadsCatalogs,
  listLeads,
  sweepStaleLeadAssignments,
  REALTY_LEADS_PAGE_SIZE,
  type RealtyLeadFilters,
} from "@/lib/realty/leads";
import { notifyLeadByWhatsapp } from "@/lib/realty/inbound-mail";
import {
  REALTY_LEAD_FLOW,
  type RealtyCreditKind,
  type RealtyLeadStage,
  type RealtyOperation,
  type RealtyPropertyKind,
} from "@/lib/realty/types";

export const dynamic = "force-dynamic";

const STAGES = new Set<string>([...REALTY_LEAD_FLOW, "PERDIDO"]);
const CREDITS = new Set<string>(["INFONAVIT", "FOVISSSTE", "BANCARIO", "CONTADO", "NINGUNO"]);

function numberOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/realty/leads — el embudo completo (el kanban agrupa en el
 * cliente) + catálogos para los filtros.
 *
 * ⭐ Aprovecha la visita para correr la BARRIDA de reasignación por
 * no-respuesta. Es una decisión consciente: en serverless no hay proceso
 * vivo que la dispare, y el momento en que alguien abre el embudo es
 * exactamente cuando importa que los prospectos ya estén repartidos. El
 * cron (POST /api/realty/leads/sweep) la corre igual sin que nadie mire.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.view");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const stage = sp.get("stage");
  const credit = sp.get("creditKind");
  const assigned = sp.get("assignedUserId");

  const filters: RealtyLeadFilters = {
    stage: stage && STAGES.has(stage) ? (stage as RealtyLeadStage) : null,
    assignedUserId: assigned && assigned !== "SIN_ASIGNAR" ? assigned : null,
    unassigned: assigned === "SIN_ASIGNAR",
    source: sp.get("source"),
    creditKind: credit && CREDITS.has(credit) ? (credit as RealtyCreditKind) : null,
    budgetMin: numberOrNull(sp.get("budgetMin")),
    budgetMax: numberOrNull(sp.get("budgetMax")),
    maxAgeDays: numberOrNull(sp.get("maxAgeDays")),
    onlyUncontacted: sp.get("onlyUncontacted") === "1",
    search: sp.get("search"),
  };

  let sweep: { reassigned: number } | null = null;
  if (sp.get("sweep") !== "0") {
    try {
      const r = await sweepStaleLeadAssignments(ctx.accountId, {
        timeZone: ctx.account.timezone,
      });
      sweep = { reassigned: r.reassigned };
    } catch {
      // Una barrida que truena NO puede dejar sin embudo a quien entró.
      sweep = null;
    }
  }

  const [data, catalogs, routing] = await Promise.all([
    listLeads(
      ctx.accountId,
      filters,
      {
        role: ctx.role,
        realtyUserId: ctx.realtyUserId,
        permissionsOverride: ctx.user.permissionsOverride,
      },
      REALTY_LEADS_PAGE_SIZE,
    ),
    getLeadsCatalogs(ctx.accountId),
    getLeadRoutingConfig(ctx.accountId),
  ]);

  return NextResponse.json({
    leads: data.leads,
    total: data.total,
    truncated: data.truncated,
    catalogs,
    routing: { strategy: routing.strategy, reassignAfterMinutes: routing.reassignAfterMinutes, reassignEnabled: routing.reassignEnabled },
    sweep,
    me: { realtyUserId: ctx.realtyUserId, role: ctx.role },
  });
}

const SearchSchema = z.object({
  operation: z.enum(["VENTA", "RENTA", "AMBAS"]).optional(),
  kinds: z
    .array(z.enum(["CASA", "DEPARTAMENTO", "TERRENO", "BODEGA", "LOCAL", "EDIFICIO", "OFICINA", "RANCHO"]))
    .optional(),
  zones: z.array(z.string().max(80)).max(20).optional(),
  budgetMin: z.number().nonnegative().nullable().optional(),
  budgetMax: z.number().nonnegative().nullable().optional(),
  bedroomsMin: z.number().int().min(0).max(20).nullable().optional(),
  notifyByWhatsapp: z.boolean().optional(),
});

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  source: z.string().max(60).nullable().optional(),
  propertyId: z.string().max(40).nullable().optional(),
  budgetMin: z.number().nonnegative().nullable().optional(),
  budgetMax: z.number().nonnegative().nullable().optional(),
  creditKind: z.enum(["INFONAVIT", "FOVISSSTE", "BANCARIO", "CONTADO", "NINGUNO"]).optional(),
  note: z.string().max(4000).nullable().optional(),
  /** null = respeta la regla de la cuenta; un id = asignación a mano. */
  assignedUserId: z.string().max(40).nullable().optional(),
  search: SearchSchema.nullable().optional(),
});

/** POST /api/realty/leads — alta a mano de un prospecto. */
export async function POST(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.edit");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Faltan datos del prospecto", detail: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const { leadId, contactId, reusedContact } = await createLeadWithContact(
    ctx.accountId,
    {
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      source: input.source ?? "manual",
      propertyId: input.propertyId ?? null,
      budgetMin: input.budgetMin ?? null,
      budgetMax: input.budgetMax ?? null,
      creditKind: (input.creditKind as RealtyCreditKind | undefined) ?? "NINGUNO",
      note: input.note ?? null,
      search: input.search
        ? {
            operation: input.search.operation as RealtyOperation | undefined,
            kinds: input.search.kinds as RealtyPropertyKind[] | undefined,
            zones: input.search.zones,
            budgetMin: input.search.budgetMin ?? input.budgetMin ?? null,
            budgetMax: input.search.budgetMax ?? input.budgetMax ?? null,
            bedroomsMin: input.search.bedroomsMin ?? null,
            notifyByWhatsapp: input.search.notifyByWhatsapp,
          }
        : null,
    },
    ctx.realtyUserId,
  );

  // Asignación: a mano si quien lo captura lo pide Y puede repartir; si no,
  // la regla de la cuenta. Un AGENT que da de alta un prospecto suyo cae en
  // la regla, que puede acabar dándoselo a otro — eso es lo correcto en una
  // agencia con rotación, y por eso la bitácora dice quién y por qué.
  let assignedUserId: string | null = null;
  const canAssign = checkLeadsAccess(ctx, "leads.assign").ok;
  if (input.assignedUserId && canAssign) {
    await assignLead(ctx.accountId, leadId, input.assignedUserId, ctx.realtyUserId);
    assignedUserId = input.assignedUserId;
  } else {
    const pick = await autoAssignLead(
      ctx.accountId,
      leadId,
      { zones: input.search?.zones ?? [] },
      { timeZone: ctx.account.timezone },
    );
    assignedUserId = pick.userId;
  }

  const whatsapp = await notifyLeadByWhatsapp({
    accountId: ctx.accountId,
    leadId,
    contactId,
    phone: input.phone ?? null,
    contactName: input.name,
    source: input.source ?? "manual",
    propertyId: input.propertyId ?? null,
    propertyTitle: null,
    reason: "INBOUND_LEAD",
    assignedUserId,
    assignedUserName: null,
  });

  return NextResponse.json({ leadId, contactId, reusedContact, assignedUserId, whatsapp }, { status: 201 });
}
