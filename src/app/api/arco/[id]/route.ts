import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logMutation } from "@/lib/audit";
import { arcoEsDeMiClinica, armarCambioArco } from "@/lib/arco/alcance";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * GET /api/arco/[id] — quien atiende ARCO en la clínica ve el detalle de una
 * solicitud.
 *
 * ISO-03: antes `hasPermission(user.role, "arco.read")`, la capa por rol que
 * ignoraba permissionsOverride (y `arco.read` ni siquiera existía en el
 * catálogo del modal). Ahora manda "Ver y atender solicitudes ARCO"
 * (arco.manage), que por default tienen SUPER_ADMIN y ADMIN — los mismos que
 * pasaban antes.
 *
 * Multi-tenant:
 *  - La solicitud debe tener clinicId y coincidir con el de la sesión.
 *  - Las anónimas (clinicId NULL) NO son de ninguna clínica: las atiende el
 *    admin de plataforma en /api/admin/arco. SUPER_ADMIN no las abre — ese rol
 *    lo recibe todo dueño de clínica (A3, auditoría 30-sep-2026). Se responde
 *    404 y no 403 para no confirmar que el id existe.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = denyIfMissingPermission(user, "arco.manage");
  if (denied) return denied;

  const arco = await prisma.arcoRequest.findUnique({ where: { id: params.id } });
  if (!arco) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!arcoEsDeMiClinica(arco.clinicId, user.clinicId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(arco);
}

/**
 * PATCH /api/arco/[id] — actualiza status/resolvedNotes de una solicitud.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  // ISO-03: mismo interruptor que el GET (antes `arco.update`, capa por rol).
  const denied = denyIfMissingPermission(user, "arco.manage");
  if (denied) return denied;

  const arco = await prisma.arcoRequest.findUnique({ where: { id: params.id } });
  if (!arco) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Multi-tenant scope: solo las de MI clínica (las anónimas son de /admin).
  if (!arcoEsDeMiClinica(arco.clinicId, user.clinicId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: { status?: string; resolvedNotes?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const cambio = armarCambioArco(body);
  if ("error" in cambio) return NextResponse.json({ error: cambio.error }, { status: 400 });
  const data = cambio.data;

  const updated = await prisma.arcoRequest.update({
    where: { id: params.id },
    data,
  });

  await logMutation({
    req,
    clinicId: user.clinicId,
    userId: user.id,
    entityType: "consent", // reusamos consent — ARCO toca consent/datos
    entityId: params.id,
    action: "update",
    before: { status: arco.status, resolvedNotes: arco.resolvedNotes },
    after:  { status: updated.status, resolvedNotes: updated.resolvedNotes },
  });

  return NextResponse.json(updated);
}
