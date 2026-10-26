import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { logAdminClinicMutation } from "@/lib/admin-audit";
import { logError } from "@/lib/safe-log";
import { estadoFresco, quitarClave, tablaExiste } from "@/lib/sede-clave/estado.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * «Quitar clave de la sede» desde el /admin de plataforma (ws1-t4).
 *
 *   GET  → { disponible, activa }
 *   POST → { motivo }   deja la sede SIN clave (sube la versión: caducan todos
 *                        los desbloqueos) para que el dueño o el admin con el
 *                        permiso pongan una nueva.
 *
 * Es la ÚNICA salida cuando la clínica olvidó la clave: desde la clínica nadie
 * la quita sin la clave actual. Misma autorización que el resto de
 * /api/admin/clinics (sesión de admin viva, getAdminSession; el middleware ya
 * corta el CSRF de /api/admin) y bitácora admin de la mutación, con el motivo.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!params.id) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
  try {
    if (!(await tablaExiste(true))) return NextResponse.json({ disponible: false, activa: false });
    const estado = await estadoFresco(params.id);
    return NextResponse.json({ disponible: true, activa: estado.activa });
  } catch (err) {
    logError("[api/admin/clinics/[id]/sede-clave GET]", err);
    return NextResponse.json({ error: "No se pudo leer la clave de la sede" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!params.id) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim().slice(0, 500) : "";
  if (motivo.length < 5) {
    return NextResponse.json({ error: "Escribe el motivo (al menos 5 caracteres)." }, { status: 400 });
  }

  try {
    const clinic = await prisma.clinic.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
    if (!(await tablaExiste(true))) {
      return NextResponse.json({ error: "La clave de la sede no está disponible (falta sql/sede-clave.sql).", code: "sin_sql" }, { status: 409 });
    }

    const version = await quitarClave(clinic.id, `admin:${admin.user.id}`);
    if (version === null) {
      return NextResponse.json({ error: "Esta sede no tiene clave.", code: "sin_clave" }, { status: 409 });
    }

    await logAdminClinicMutation({
      req,
      admin: { id: admin.user.id, email: admin.user.email },
      clinicId: clinic.id,
      entityType: "clinic",
      entityId: clinic.id,
      action: "update",
      before: { claveDeSede: "activa" },
      after: { claveDeSede: "sin clave", evento: "restablecer", versionClave: version, motivo },
    });
    console.log(JSON.stringify({
      type: "admin.clinic.sedeClaveReset",
      at: new Date().toISOString(),
      clinicId: clinic.id,
      adminId: admin.user.id,
      adminEmail: admin.user.email,
    }));

    return NextResponse.json({ ok: true, activa: false });
  } catch (err) {
    logError("[api/admin/clinics/[id]/sede-clave POST]", err);
    return NextResponse.json({ error: "No se pudo quitar la clave" }, { status: 500 });
  }
}
