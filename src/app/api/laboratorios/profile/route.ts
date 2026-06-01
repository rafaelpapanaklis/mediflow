import { type NextRequest, NextResponse } from "next/server";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/laboratorios/profile → perfil del laboratorio en sesión.
export async function GET() {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const lab = await prisma.dentalLab.findUnique({ where: { id: ctx.labId } });
  if (!lab) return NextResponse.json({ error: "Laboratorio no encontrado." }, { status: 404 });

  return NextResponse.json(lab, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

// PATCH /api/laboratorios/profile → editar datos del laboratorio.
// No se permite cambiar email (identidad de auth) ni slug (URL pública estable)
// ni status (lo controla el admin). labId SIEMPRE de la sesión.
export async function PATCH(req: NextRequest) {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }
  if (ctx.role !== "OWNER" && ctx.role !== "MANAGER") {
    return NextResponse.json(
      { error: "No tienes permiso para editar el perfil del laboratorio." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const str = (v: unknown): string | undefined => (typeof v === "string" ? v.trim() : undefined);

  const name = str(b.name);
  if (name !== undefined && name.length === 0) {
    return NextResponse.json({ error: "El nombre del laboratorio no puede estar vacío." }, { status: 400 });
  }

  const rfcRaw = str(b.rfc);
  const rfc = rfcRaw !== undefined ? rfcRaw.toUpperCase().slice(0, 13) : undefined;
  const phone = str(b.phone);
  const whatsapp = str(b.whatsapp);
  const website = str(b.website);
  const address = str(b.address);
  const city = str(b.city);
  const state = str(b.state);
  const description = str(b.description);

  // founded: año opcional. undefined = no cambiar; ""/null = limpiar; entero válido.
  let founded: number | null | undefined = undefined;
  if (b.founded !== undefined) {
    if (b.founded === null || b.founded === "") {
      founded = null;
    } else {
      const n = Math.floor(Number(b.founded));
      if (!Number.isInteger(n) || n < 1900 || n > 2100) {
        return NextResponse.json({ error: "El año de fundación no es válido." }, { status: 400 });
      }
      founded = n;
    }
  }

  const willUpdate = [
    name,
    rfc,
    phone,
    whatsapp,
    website,
    address,
    city,
    state,
    description,
    founded,
  ].some((v) => v !== undefined);
  if (!willUpdate) {
    return NextResponse.json({ error: "Nada que actualizar." }, { status: 400 });
  }

  const lab = await prisma.dentalLab.update({
    where: { id: ctx.labId },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(rfc !== undefined ? { rfc: rfc || null } : {}),
      ...(phone !== undefined ? { phone: phone || null } : {}),
      ...(whatsapp !== undefined ? { whatsapp: whatsapp || null } : {}),
      ...(website !== undefined ? { website: website || null } : {}),
      ...(address !== undefined ? { address: address || null } : {}),
      ...(city !== undefined ? { city: city || null } : {}),
      ...(state !== undefined ? { state: state || null } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
      ...(founded !== undefined ? { founded } : {}),
    },
  });

  return NextResponse.json(lab);
}
