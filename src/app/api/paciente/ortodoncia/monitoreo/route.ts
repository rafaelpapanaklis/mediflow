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

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { uploadFileToStorage } from "@/lib/storage";
import { validateMagicNumber } from "@/lib/validate-upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};
const ALLOWED_TYPES = Object.keys(ALLOWED);
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB
const ANGLES = ["FRONTAL", "LATERAL", "SMILE", "INTRAORAL", "OTHER"];

function sanitizeName(name: string): string {
  const base = (name || "foto").split(/[\\/]/).pop() || "foto";
  return base.replace(/[^a-zA-Z0-9._ ()-]/g, "_").replace(/_{2,}/g, "_").slice(0, 120) || "foto";
}

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
      select: { clinicId: true, patientId: true, deletedAt: true },
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

    const angle = ANGLES.includes(angleRaw) ? angleRaw : "OTHER";

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Tipo no permitido. Sube JPG, PNG o WEBP." }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Foto demasiado grande (máx 20 MB)." }, { status: 413 });
    }

    const bytes = await file.arrayBuffer();
    const magicError = await validateMagicNumber(bytes, ALLOWED_TYPES);
    if (magicError) {
      return NextResponse.json(
        { error: "El contenido del archivo no coincide con una imagen válida." },
        { status: 400 },
      );
    }

    const ext = ALLOWED[file.type];
    const storageKey = `${link.clinicId}/${link.patientId}/ortho-monitoreo/${randomUUID()}.${ext}`;

    try {
      await uploadFileToStorage(storageKey, bytes, file.type);
    } catch (e) {
      console.error("[paciente/ortodoncia/monitoreo] storage:", e);
      return NextResponse.json({ error: "No se pudo subir la foto" }, { status: 500 });
    }

    return NextResponse.json(
      {
        storageKey,
        fileName: sanitizeName(file.name),
        mimeType: file.type,
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
