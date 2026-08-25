import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRealtyContext } from "@/lib/realty-auth";
import { checkLeadsAccess, contactScopeWhere, leadScopeWhere } from "@/lib/realty/leads";
import { mxTenDigits } from "@/lib/phone-mx";

export const dynamic = "force-dynamic";

const KINDS = new Set(["PROSPECTO", "PROPIETARIO", "INQUILINO"]);

/**
 * GET — la libreta de contactos del CRM. La usa el buscador del alta ("¿ya
 * lo tengo dado de alta?") para NO duplicar a la misma persona en tres
 * prospectos con la bitácora partida.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.view");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const search = sp.get("search")?.trim() ?? "";
  const kind = sp.get("kind");
  const limitRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 25;

  const scope = {
    role: ctx.role,
    realtyUserId: ctx.realtyUserId,
    permissionsOverride: ctx.user.permissionsOverride,
  };
  const and: Prisma.RealtyContactWhereInput[] = [
    { accountId: ctx.accountId },
    contactScopeWhere(scope),
  ];
  if (kind && KINDS.has(kind)) {
    and.push({ kind: kind as "PROSPECTO" | "PROPIETARIO" | "INQUILINO" });
  }
  if (search) {
    // El teléfono vive NORMALIZADO a 10 dígitos: buscar "+52 33 1234 5678"
    // tal cual no compara nada. Se normaliza antes de comparar.
    const digits = mxTenDigits(search);
    const or: Prisma.RealtyContactWhereInput[] = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
    if (digits) or.push({ phone: digits });
    else if (/^\d{3,}$/.test(search)) or.push({ phone: { contains: search } });
    and.push({ OR: or });
  }

  const rows = await prisma.realtyContact.findMany({
    where: { AND: and },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      kind: true,
      source: true,
      assignedUserId: true,
      createdAt: true,
      // El contador va RECORTADO: si no, a un contacto que ves por tener un
      // prospecto huérfano te decía cuántos más tiene con otros asesores.
      _count: { select: { leads: { where: leadScopeWhere(scope) } } },
    },
  });

  return NextResponse.json({
    contacts: rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      kind: c.kind,
      source: c.source,
      assignedUserId: c.assignedUserId,
      leadCount: c._count.leads,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

const PostSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  kind: z.enum(["PROSPECTO", "PROPIETARIO", "INQUILINO"]).optional(),
  source: z.string().max(60).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

/**
 * POST — alta de contacto sin abrir prospecto (una referencia que todavía
 * no pregunta por nada). Si el teléfono ya existe en la cuenta DEVUELVE el
 * que hay en vez de duplicarlo.
 */
export async function POST(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.edit");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const phone = mxTenDigits(parsed.data.phone ?? null);
  const email = parsed.data.email?.trim().toLowerCase() || null;

  if (phone) {
    const existing = await prisma.realtyContact.findFirst({
      where: { accountId: ctx.accountId, phone },
      select: { id: true, name: true },
    });
    if (existing) {
      return NextResponse.json({ contactId: existing.id, reused: true, name: existing.name });
    }
  }

  const created = await prisma.realtyContact.create({
    data: {
      accountId: ctx.accountId,
      name: parsed.data.name.trim(),
      phone,
      email,
      kind: parsed.data.kind ?? "PROSPECTO",
      source: parsed.data.source ?? "manual",
      notes: parsed.data.notes ?? null,
    },
    select: { id: true },
  });
  return NextResponse.json({ contactId: created.id, reused: false }, { status: 201 });
}
