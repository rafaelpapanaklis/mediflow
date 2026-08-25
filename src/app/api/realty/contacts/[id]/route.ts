import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  checkLeadsAccess,
  contactScopeWhere,
  contactWriteScopeWhere,
  leadScopeWhere,
} from "@/lib/realty/leads";
import { readSearchProfileKinds } from "@/lib/realty/matching";
import { mxTenDigits } from "@/lib/phone-mx";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.view");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const scope = {
    role: ctx.role,
    realtyUserId: ctx.realtyUserId,
    permissionsOverride: ctx.user.permissionsOverride,
  };

  const contact = await prisma.realtyContact.findFirst({
    where: { AND: [{ id: params.id, accountId: ctx.accountId }, contactScopeWhere(scope)] },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      kind: true,
      source: true,
      notes: true,
      assignedUserId: true,
      createdAt: true,
      // Los prospectos también van recortados: la etapa en la que va el
      // cliente de otro asesor es exactamente el dato que el embudo esconde.
      leads: {
        where: leadScopeWhere(scope),
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, stage: true, portal: true, createdAt: true },
      },
      searchProfiles: {
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  const profile = contact.searchProfiles[0] ?? null;
  return NextResponse.json({
    contact: {
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      kind: contact.kind,
      source: contact.source,
      notes: contact.notes,
      assignedUserId: contact.assignedUserId,
      createdAt: contact.createdAt.toISOString(),
      leads: contact.leads.map((l) => ({
        id: l.id,
        stage: l.stage,
        portal: l.portal,
        createdAt: l.createdAt.toISOString(),
      })),
      searchProfile: profile
        ? {
            id: profile.id,
            operation: profile.operation,
            kinds: readSearchProfileKinds(profile.kinds),
            zones: profile.zones,
            budgetMin: profile.budgetMin ? Number(profile.budgetMin) : null,
            budgetMax: profile.budgetMax ? Number(profile.budgetMax) : null,
            bedroomsMin: profile.bedroomsMin,
            notifyByWhatsapp: profile.notifyByWhatsapp,
          }
        : null,
    },
  });
}

const PatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  source: z.string().max(60).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.edit");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
  if (parsed.data.source !== undefined) data.source = parsed.data.source;
  if (parsed.data.email !== undefined) {
    data.email = parsed.data.email?.trim().toLowerCase() || null;
  }
  if (parsed.data.phone !== undefined) {
    const phone = mxTenDigits(parsed.data.phone ?? null);
    if (parsed.data.phone && !phone) {
      return NextResponse.json({ error: "El teléfono va a 10 dígitos" }, { status: 400 });
    }
    // 🔴 SIEMPRE normalizado: el hilo de WhatsApp liga por este número. Un
    // teléfono guardado "como lo escribieron" deja al contacto sin nombre en
    // el inbox para siempre.
    data.phone = phone;

    if (phone) {
      const clash = await prisma.realtyContact.findFirst({
        where: { accountId: ctx.accountId, phone, id: { not: params.id } },
        select: { id: true, name: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `Ese teléfono ya es de ${clash.name}`, contactId: clash.id },
          { status: 409 },
        );
      }
    }
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true });

  // updateMany para que el accountId entre en el WHERE (un update por id a
  // secas cruzaría cuentas).
  const res = await prisma.realtyContact.updateMany({
    where: {
      AND: [
        { id: params.id, accountId: ctx.accountId },
        // ESCRITURA: más estricto que la lectura. La libreta se comparte
        // para no duplicar personas; editarla —sobre todo el teléfono, que
        // es la llave de deduplicación y del hilo de WhatsApp— no.
        contactWriteScopeWhere({
          role: ctx.role,
          realtyUserId: ctx.realtyUserId,
          permissionsOverride: ctx.user.permissionsOverride,
        }),
      ],
    },
    data,
  });
  if (res.count === 0) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
