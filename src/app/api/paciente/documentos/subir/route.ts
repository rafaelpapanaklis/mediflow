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
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { uploadFileToStorage } from "@/lib/storage";
import {
  PERFILES,
  validarArchivo,
  generarLlaveAlmacenamiento,
  registrarSubidaRechazada,
  limiteSubidasPorUsuario,
} from "@/lib/uploads/validar-archivo";
import type { PacienteSubidoKind } from "@/lib/patient-portal/types";
import { registrarMovimientoExterno } from "@/lib/movimientos-paciente/registrar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS: PacienteSubidoKind[] = ["ESTUDIO", "IDENTIFICACION", "OTRO"];

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

    if (!limiteSubidasPorUsuario(`paciente:documentos:${ctx.account.id}`)) {
      return NextResponse.json({ error: "Demasiadas subidas. Espera unos minutos." }, { status: 429 });
    }

    const kind: PacienteSubidoKind = KINDS.includes(kindRaw as PacienteSubidoKind)
      ? (kindRaw as PacienteSubidoKind)
      : "OTRO";

    const bytes = await file.arrayBuffer();
    const validado = await validarArchivo({
      bytes,
      nombreOriginal: file.name,
      perfil: PERFILES.DOCUMENTO_PACIENTE,
    });
    if (validado.ok === false) {
      await registrarSubidaRechazada({
        clinicId: link.clinicId,
        userId: ctx.account.id,
        patientId: link.patientId,
        ruta: "/api/paciente/documentos/subir",
        motivo: validado.motivo,
        codigo: validado.codigo,
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: validado.motivo }, { status: 400 });
    }

    const storageKey = generarLlaveAlmacenamiento(
      [link.clinicId, link.patientId, "patient-uploads"],
      validado.extensionReal,
    );

    try {
      await uploadFileToStorage(storageKey, bytes, validado.mimeReal);
    } catch (e) {
      console.error("[paciente/documentos/subir] storage:", e);
      return NextResponse.json({ error: "No se pudo subir el archivo" }, { status: 500 });
    }

    const record = await prisma.patientUpload.create({
      data: {
        clinicId: link.clinicId,
        patientId: link.patientId,
        accountId: ctx.account.id,
        fileName: validado.nombreSaneado,
        fileType: validado.mimeReal,
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

    await registrarMovimientoExterno({
      actor: "patient",
      clinicId: link.clinicId,
      patientId: link.patientId,
      entityType: "patient-file",
      entityId: record.id,
      action: "create",
      categoria: "archivos",
      texto: "Subió un documento desde su portal",
      req,
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
