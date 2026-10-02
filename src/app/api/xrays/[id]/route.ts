import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logAudit } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { textoArchivo } from "@/lib/movimientos-paciente/textos";
import { validarCambioDeTipo } from "@/lib/uploads/categorias-archivo";

/* ═══════════════════════════════════════════════════════════════════ */
/*  PATCH — notas clínicas del doctor O tipo del archivo (uno por vez)  */
/* ═══════════════════════════════════════════════════════════════════ */

const UpdateNotesSchema = z.object({
  doctorNotes: z.string().max(5000, "Las notas no pueden exceder 5000 caracteres"),
});
const UpdateCategorySchema = z.object({
  category: z.string().min(1).max(40),
});

const MOTIVO_TIPO: Record<string, string> = {
  tipo_no_permitido: "Ese tipo no corresponde al formato del archivo",
  tipo_bloqueado: "Este archivo pertenece a un set de ortodoncia o a un modelo 3D: su tipo no se cambia aquí",
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const cambiaTipo = !!body && typeof body === "object" && "category" in (body as object);
  if (cambiaTipo && "doctorNotes" in (body as object)) {
    return NextResponse.json({ error: "Cambia el tipo o las notas, no ambos a la vez" }, { status: 400 });
  }

  // EQ-07: las notas del doctor sobre la placa son interpretación clínica, no
  // "subir un archivo": mismo interruptor que las notas SOAP y que el DELETE
  // de abajo (SA/ADMIN/DOCTOR). Antes cualquier sesión de la clínica escribía
  // aquí, recepción y solo-lectura incluidas.
  // Corregir el TIPO (ws1-t9) es la etiqueta de lo que se subió, no su lectura
  // clínica: lo mismo que subirlo (`xrays.upload`), así recepción corrige lo que
  // ella misma subió mal.
  const denied = denyIfMissingPermission(ctx, cambiaTipo ? "xrays.upload" : "medicalRecord.edit");
  if (denied) return denied;

  if (cambiaTipo) return cambiarTipo(ctx, params.id, body);

  const parsed = UpdateNotesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Body inválido" }, { status: 400 });
  }

  // Multi-tenant guard
  const existing = await prisma.patientFile.findFirst({
    where:  { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, doctorNotes: true, patientId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  // Visibilidad por paciente (barrido Ola 3): las notas del doctor sobre la
  // radiografía de un paciente restringido exigen poder verlo.
  if (existing.patientId) {
    const visDenied = await assertPatientVisible(existing.patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId: ctx.clinicId,
    });
    if (visDenied) return visDenied;
  }

  const updated = await prisma.patientFile.update({
    where: { id: existing.id },
    data:  {
      doctorNotes:          parsed.data.doctorNotes,
      doctorNotesUpdatedAt: new Date(),
    },
    select: {
      doctorNotes:          true,
      doctorNotesUpdatedAt: true,
    },
  });

  await logAudit({
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "patient-file",
    entityId:   existing.id,
    action:     "FILE_NOTES_UPDATED",
    patientId:  existing.patientId,
    texto:      "Actualizó las notas de un estudio del paciente",
    changes: {
      doctorNotes: {
        before: existing.doctorNotes ?? "",
        after:  parsed.data.doctorNotes,
      },
    },
  });

  return NextResponse.json({
    doctorNotes:          updated.doctorNotes ?? "",
    doctorNotesUpdatedAt: updated.doctorNotesUpdatedAt?.toISOString() ?? null,
  });
}

/**
 * Cambia SOLO la etiqueta `category` (el archivo en Storage no se toca). Deja en
 * Movimientos quién lo cambió y de qué a qué. Como la reevaluación radiográfica
 * del plan de ortodoncia lee `category` en cada consulta, una panorámica corregida
 * cuenta sin más pasos.
 */
async function cambiarTipo(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>, id: string, body: unknown) {
  const parsed = UpdateCategorySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  const nuevo = parsed.data.category;

  const existing = await prisma.patientFile.findFirst({
    where:  { id, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, category: true, mimeType: true, patientId: true },
  });
  if (!existing) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

  if (existing.patientId) {
    const visDenied = await assertPatientVisible(existing.patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId: ctx.clinicId,
    });
    if (visDenied) return visDenied;
  }

  const actual = String(existing.category);
  const veredicto = validarCambioDeTipo({ actual, nuevo, mimeType: existing.mimeType });
  if (!veredicto.ok) {
    // Mismo tipo: nada que hacer ni que registrar (idempotente).
    if (veredicto.motivo === "mismo_tipo") return NextResponse.json({ category: actual, unchanged: true });
    return NextResponse.json({ error: MOTIVO_TIPO[veredicto.motivo] }, { status: 400 });
  }

  await prisma.patientFile.updateMany({
    where: { id: existing.id, clinicId: ctx.clinicId },
    data:  { category: nuevo as any },
  });

  await logAudit({
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "patient-file",
    entityId:   existing.id,
    action:     "update",
    patientId:  existing.patientId,
    texto:      textoArchivo.tipoCambiado(actual, nuevo),
    changes:    { category: { before: actual, after: nuevo } },
  });

  return NextResponse.json({ category: nuevo });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ISO-03: antes `hasPermission(ctx.role, "medicalRecord.delete")`, la capa
  // por rol que ignoraba permissionsOverride. Borrar la placa es editar el
  // expediente — mismo interruptor que el DELETE de modelos 3D (mismos roles
  // por default: SA/ADMIN/DOCTOR). NO xrays.upload: se lo daría a recepción,
  // que hoy no puede borrar.
  const denied = denyIfMissingPermission(ctx, "medicalRecord.edit");
  if (denied) return denied;

  const file = await prisma.patientFile.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!file) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

  // Visibilidad por paciente (barrido Ola 3) — antes del early-return
  // idempotente para no revelar el estado del archivo.
  if (file.patientId) {
    const visDenied = await assertPatientVisible(file.patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId: ctx.clinicId,
    });
    if (visDenied) return visDenied;
  }

  // Ya borrado lógicamente — idempotente.
  if (file.deletedAt) return NextResponse.json({ success: true, softDeleted: true });

  // Motivo opcional del body.
  let reason: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim().slice(0, 2000);
    }
  } catch {
    /* sin body */
  }

  // NOM-004 conservación / NOM-024 §7 — NO hard-delete: borrado LÓGICO. El blob
  // en Storage se PRESERVA (parte del expediente, conservación ≥5 años); solo se
  // marca deletedAt para ocultarlo de las vistas activas.
  await prisma.patientFile.updateMany({
    where: { id: params.id, clinicId: ctx.clinicId },
    data:  { deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason },
  });

  await logAudit({
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "patient-file",
    entityId:   params.id,
    action:     "soft_delete",
    patientId:  file.patientId,
    texto:      textoArchivo.quitado(file.category),
    changes: {
      _deleted: {
        before: { name: file.name, category: file.category, url: file.url },
        after:  { deletedAt: new Date().toISOString(), deleteReason: reason },
      },
    },
  });

  return NextResponse.json({ success: true, softDeleted: true });
}
