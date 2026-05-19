import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { revalidateAfter } from "@/lib/cache/revalidate";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true } });
    if (u) return u;
  }
  return prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" } });
}

export async function PATCH(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // SECURITY: solo admins pueden modificar configuracion de la clinica.
  // RECEPTIONIST/DOCTOR no deben poder cambiar timezone/name/address.
  if (dbUser.role !== "ADMIN" && dbUser.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Solo administradores pueden modificar la configuracion de la clinica" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // Validar timezone IANA — string invalido tira Intl.DateTimeFormat con
  // RangeError en cada render. Verificar antes de persistir.
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || body.timezone.length === 0) {
      return NextResponse.json({ error: "Zona horaria invalida" }, { status: 400 });
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: body.timezone });
    } catch {
      return NextResponse.json({ error: "Zona horaria no soportada (formato IANA)" }, { status: 400 });
    }
  }

  // Build update object — only update fields that were sent
  const data: Record<string, any> = {};
  if (body.name        !== undefined) data.name        = body.name;
  if (body.city        !== undefined) data.city        = body.city        || null;
  if (body.address     !== undefined) data.address     = body.address     || null;
  if (body.phone       !== undefined) data.phone       = body.phone       || null;
  if (body.email       !== undefined) data.email       = body.email       || null;
  if (body.description !== undefined) data.description = body.description || null;
  if (body.isPublic    !== undefined) {
    data.isPublic      = Boolean(body.isPublic);
    data.landingActive = Boolean(body.isPublic);
  }
  if (body.category    !== undefined) data.category    = body.category;
  // NOM-024: CLUES Sector Salud (11 chars). Trim y null si vacío.
  if (body.clues       !== undefined) {
    const clues = typeof body.clues === "string" ? body.clues.trim() : "";
    data.clues = clues.length === 0 ? null : clues.slice(0, 11);
  }
  if (body.timezone !== undefined && typeof body.timezone === "string" && body.timezone.length > 0) {
    data.timezone = body.timezone;
  }

  const updated = await prisma.clinic.update({
    where: { id: dbUser.clinicId },
    data,
  });

  revalidateAfter("clinic");
  return NextResponse.json(updated);
}
