import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { logAdminGlobalEvent } from "@/lib/admin-audit";
import { armarCambioArco } from "@/lib/arco/alcance";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/arco/[id] — el admin de plataforma atiende una solicitud ARCO
 * ANÓNIMA (clinicId NULL). Una solicitud con clínica no se toca desde aquí: es
 * de la clínica (404). La mutación pasa por el chequeo de Origin del middleware
 * y queda en el log de auditoría de admin (sin clínica → evento estructurado).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const arco = await prisma.arcoRequest.findFirst({ where: { id: params.id, clinicId: null } });
  if (!arco) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: { status?: unknown; resolvedNotes?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const cambio = armarCambioArco(body);
  if ("error" in cambio) return NextResponse.json({ error: cambio.error }, { status: 400 });

  // updateMany con clinicId:null en el where: aunque la fila cambiara de dueño
  // entre la lectura y la escritura, no se edita una solicitud de clínica.
  const r = await prisma.arcoRequest.updateMany({
    where: { id: params.id, clinicId: null },
    data: cambio.data,
  });
  if (r.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const updated = await prisma.arcoRequest.findUnique({ where: { id: params.id } });

  logAdminGlobalEvent({
    req,
    admin: admin.user,
    entity: "arco_request",
    entityId: params.id,
    action: "update",
    before: { status: arco.status, resolvedNotes: arco.resolvedNotes },
    after: { status: updated?.status, resolvedNotes: updated?.resolvedNotes },
  });

  return NextResponse.json(updated);
}
