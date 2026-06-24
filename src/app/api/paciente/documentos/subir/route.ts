// POST /api/paciente/documentos/subir — el paciente sube un archivo a SU
// expediente en una clínica vinculada (WS1-T8).
//
// Seguridad (NO negociable):
// · getPatientPortalContext() | pacienteUnauthorized().
// · clinicId/patientId SIEMPRE del link de la sesión (ctx.links). El cliente
//   solo manda `clinicId` para ELEGIR entre sus clínicas; se valida contra
//   ctx.links y de ahí sale el patientId. El patientId del cliente se IGNORA.
// · Whitelist de tipo (pdf/jpg/png/webp) + magic number (file-type) + tamaño
//   ≤ 15MB. Nombre saneado (sin path traversal).
// · storageKey = clinicId/patientId/patient-uploads/<uuid>.<ext> en el bucket
//   PRIVADO patient-files. Nunca se expone al cliente (se firma on-demand).
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { uploadFileToStorage } from "@/lib/storage";
import { validateMagicNumber } from "@/lib/validate-upload";
import type { PacienteSubidoKind } from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// MIME → extensión. Whitelist dura: solo documentos/imágenes que un paciente
// razonablemente sube (estudios, identificación). NADA ejecutable.
const ALLOWED: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const ALLOWED_TYPES = Object.keys(ALLOWED);
const MAX_SIZE = 15 * 1024 * 1024; // 15 MB
const KINDS: PacienteSubidoKind[] = ["ESTUDIO", "IDENTIFICACION", "OTRO"];

/** Nombre visible saneado (sin path traversal ni caracteres raros). */
function sanitizeName(name: string): string {
  const base = (name || "archivo").split(/[\\/]/).pop() || "archivo";
  return (
    base
      .replace(/[^a-zA-Z0-9._ ()-]/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(0, 120) || "archivo"
  );
}

export async function POST(req: Request) {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    if (ctx.links.length === 0) {
      return NextResponse.json({ error: "No tienes expedientes vinculados" }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const clinicIdRaw = ((form.get("clinicId") as string | null) ?? "").trim();
    const kindRaw = ((form.get("kind") as string | null) ?? "OTRO").trim();

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
    }

    // clinicId: del cliente SOLO para elegir entre clínicas vinculadas; el
    // patientId NUNCA viene del cliente — sale del link de la sesión.
    const link =
      ctx.links.length === 1
        ? ctx.links[0]
        : ctx.links.find((l) => l.clinicId === clinicIdRaw);
    if (!link) {
      return NextResponse.json({ error: "Clínica no válida" }, { status: 400 });
    }

    const kind: PacienteSubidoKind = KINDS.includes(kindRaw as PacienteSubidoKind)
      ? (kindRaw as PacienteSubidoKind)
      : "OTRO";

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo no permitido. Sube PDF, JPG, PNG o WEBP." },
        { status: 400 },
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Archivo demasiado grande (máx 15 MB)." }, { status: 413 });
    }

    const bytes = await file.arrayBuffer();
    const magicError = await validateMagicNumber(bytes, ALLOWED_TYPES);
    if (magicError) {
      return NextResponse.json(
        { error: "El contenido del archivo no coincide con un PDF o imagen válida." },
        { status: 400 },
      );
    }

    const ext = ALLOWED[file.type];
    const storageKey = `${link.clinicId}/${link.patientId}/patient-uploads/${randomUUID()}.${ext}`;

    try {
      await uploadFileToStorage(storageKey, bytes, file.type);
    } catch (e) {
      console.error("[paciente/documentos/subir] storage:", e);
      return NextResponse.json({ error: "No se pudo subir el archivo" }, { status: 500 });
    }

    const record = await prisma.patientUpload.create({
      data: {
        clinicId: link.clinicId,
        patientId: link.patientId,
        accountId: ctx.account.id,
        fileName: sanitizeName(file.name),
        fileType: file.type,
        storageKey,
        sizeBytes: file.size,
        kind,
      },
      select: {
        id: true,
        clinicId: true,
        fileName: true,
        fileType: true,
        sizeBytes: true,
        kind: true,
        createdAt: true,
      },
    });

    return NextResponse.json(
      {
        item: {
          id: record.id,
          clinicId: record.clinicId,
          fileName: record.fileName,
          fileType: record.fileType,
          sizeBytes: record.sizeBytes,
          kind: record.kind,
          createdAt: record.createdAt.toISOString(),
        },
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[paciente/documentos/subir] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
