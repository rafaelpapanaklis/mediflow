// GET    /api/paciente/documentos/subidos — lista de archivos que el paciente
//        subió (todas sus clínicas vinculadas). NUNCA expone el storageKey.
// DELETE /api/paciente/documentos/subidos?id=<cuid> — borra UNO propio
//        (valida accountId === ctx.account.id). Quita el objeto del bucket
//        (best-effort) y elimina la fila.
//
// Seguridad: getPatientPortalContext() | pacienteUnauthorized(). El filtro
// primario es accountId (dueño); además se cruza contra ctx.links (defensa en
// profundidad). 404 genérico al borrar lo ajeno — sin oráculo de ids.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { removeFileFromStorage } from "@/lib/storage";
import type { PacienteSubido } from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const rows = await prisma.patientUpload.findMany({
      where: { accountId: ctx.account.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        fileName: true,
        fileType: true,
        sizeBytes: true,
        kind: true,
        createdAt: true,
      },
    });

    // Defensa en profundidad: solo items cuyo (patientId, clinicId) está en los
    // links vivos de la sesión.
    const items: PacienteSubido[] = rows
      .filter((r) =>
        ctx.links.some((l) => l.patientId === r.patientId && l.clinicId === r.clinicId),
      )
      .map((r) => ({
        id: r.id,
        clinicId: r.clinicId,
        fileName: r.fileName,
        fileType: r.fileType,
        sizeBytes: r.sizeBytes,
        kind: r.kind,
        createdAt: r.createdAt.toISOString(),
      }));

    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[paciente/documentos/subidos] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });

    const notFound = () => NextResponse.json({ error: "No encontrado" }, { status: 404 });

    const up = await prisma.patientUpload.findUnique({
      where: { id },
      select: { id: true, accountId: true, storageKey: true },
    });
    // Solo el dueño (la cuenta del paciente) puede borrar. 404 genérico.
    if (!up || up.accountId !== ctx.account.id) return notFound();

    // Quita el binario primero (best-effort); luego elimina la fila.
    try {
      await removeFileFromStorage(up.storageKey);
    } catch (e) {
      console.error("[paciente/documentos/subidos] storage remove:", e);
    }
    await prisma.patientUpload.delete({ where: { id: up.id } });

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[paciente/documentos/subidos] DELETE error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
