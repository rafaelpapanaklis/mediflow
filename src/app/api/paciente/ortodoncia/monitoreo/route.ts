// POST /api/paciente/ortodoncia/monitoreo — el paciente sube una foto de
// monitoreo a distancia para SU caso de ortodoncia (H15, ws1-t8, ola 1,
// sep-2026). Mismo patrón de seguridad que /api/paciente/documentos/subir:
//
// · getPatientPortalContext() | pacienteUnauthorized().
// · treatmentPlanId lo manda el cliente para ELEGIR el caso, pero se valida
//   que su patientId/clinicId estén en los links de la sesión — nunca se
//   confía en un clinicId/patientId que mande el cliente.
// · Whitelist de imagen + magic number + tamaño ≤ 20MB.
// · storageKey = clinicId/patientId/ortho-monitoreo/<uuid>.<ext>, bucket
//   PRIVADO patient-files (mismo bucket que patient_uploads).
// · Solo sube el binario y crea el registro (vía submitMonitoringPhoto) —
//   SIN análisis de IA (H15 es captura + revisión humana en esta ola).
// · ws1-t5 (ronda 6, fila 16 del mapa): solo se aceptan fotos de un caso
//   ABIERTO en una clínica con el módulo ACTIVO. Se comprueba ANTES de subir
//   el binario: un caso terminado no debe dejar archivos sueltos.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { uploadFileToStorage } from "@/lib/storage";
import { storageQuotaError } from "@/lib/storage-quota";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { permisosDelCaso } from "@/lib/patient-portal/ortodoncia-portal";
import {
  validarArchivo,
  generarLlaveAlmacenamiento,
  registrarSubidaRechazada,
  limiteSubidasPorUsuario,
  type PerfilSubida,
} from "@/lib/uploads/validar-archivo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PERFIL: PerfilSubida = {
  id: "ORTHO_MONITOREO_PACIENTE",
  mimesPermitidos: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  maxBytes: 20 * 1024 * 1024,
  imagen: true,
  descripcion: "foto de monitoreo de ortodoncia",
};
const ANGLES = ["FRONTAL", "LATERAL", "SMILE", "INTRAORAL", "OTHER"];

export async function POST(req: Request) {
  try {
    const portal = await getPatientPortalContext();
    if (!portal) return pacienteUnauthorized();
    if (portal.links.length === 0) {
      return NextResponse.json({ error: "No tienes expedientes vinculados" }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const treatmentPlanId = ((form.get("treatmentPlanId") as string | null) ?? "").trim();
    const angleRaw = ((form.get("angle") as string | null) ?? "OTHER").trim().toUpperCase();
    const patientNote = ((form.get("patientNote") as string | null) ?? "").trim().slice(0, 500) || null;

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Foto requerida" }, { status: 400 });
    }
    if (!treatmentPlanId) {
      return NextResponse.json({ error: "Falta el caso de ortodoncia" }, { status: 400 });
    }

    const plan = await prisma.orthodonticTreatmentPlan.findUnique({
      where: { id: treatmentPlanId },
      select: { clinicId: true, patientId: true, deletedAt: true, status: true },
    });
    if (!plan || plan.deletedAt) {
      return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
    }
    const link = portal.links.find(
      (l) => l.patientId === plan.patientId && l.clinicId === plan.clinicId,
    );
    if (!link) {
      return NextResponse.json({ error: "Sin acceso a este caso" }, { status: 403 });
    }

    const permisos = permisosDelCaso(plan.status, await hasActiveOrthodonticsModule(plan.clinicId));
    if (permisos.soloLectura) {
      return NextResponse.json(
        { error: permisos.aviso ?? "Este caso es de solo lectura." },
        { status: 409 },
      );
    }

    const angle = ANGLES.includes(angleRaw) ? angleRaw : "OTHER";

    if (!limiteSubidasPorUsuario(`paciente:monitoreo:${portal.account.id}`)) {
      return NextResponse.json({ error: "Demasiadas subidas. Espera unos minutos." }, { status: 429 });
    }

    const bytes = await file.arrayBuffer();
    const validado = await validarArchivo({ bytes, nombreOriginal: file.name, perfil: PERFIL });
    if (validado.ok === false) {
      await registrarSubidaRechazada({
        clinicId: link.clinicId,
        patientId: link.patientId,
        ruta: "/api/paciente/ortodoncia/monitoreo",
        motivo: validado.motivo,
        codigo: validado.codigo,
        nombreOriginal: file.name,
      });
      return NextResponse.json(
        { error: "El contenido del archivo no coincide con una imagen válida." },
        { status: 400 },
      );
    }

    const storageKey = generarLlaveAlmacenamiento(
      [link.clinicId, link.patientId, "ortho-monitoreo"],
      validado.extensionReal,
    );

    // El espacio es de la clínica: si ya no cabe, el paciente recibe un aviso
    // suyo (no el mensaje de «mejora tu plan», que es para la clínica).
    if (await storageQuotaError(link.clinicId, file.size)) {
      return NextResponse.json(
        { error: "Tu clínica no puede recibir más archivos por ahora. Avísale a la clínica." },
        { status: 402 },
      );
    }

    try {
      await uploadFileToStorage(storageKey, bytes, validado.mimeReal);
    } catch (e) {
      console.error("[paciente/ortodoncia/monitoreo] storage:", e);
      return NextResponse.json({ error: "No se pudo subir la foto" }, { status: 500 });
    }

    return NextResponse.json(
      {
        storageKey,
        fileName: validado.nombreSaneado,
        mimeType: validado.mimeReal,
        sizeBytes: file.size,
        angle,
        patientNote,
        treatmentPlanId,
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[paciente/ortodoncia/monitoreo] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
