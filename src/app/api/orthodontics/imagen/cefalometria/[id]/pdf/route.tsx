// Ortodoncia — PDF del trazado cefalométrico (sección I de la revisión de
// lógica de uso). GET /api/orthodontics/imagen/cefalometria/<analysisId>/pdf
//
// `<analysisId>` es el id de `orthodontic_cephalometry_analyses` (el `id`
// que devuelve `listCephalometricAnalyses`). El PDF ya existía en
// src/lib/orthodontics/cefalometria/pdf/ sin ninguna ruta que lo sirviera.
//
// Candados, los mismos que los PDFs del caso: módulo activo + permiso
// `medicalRecord.view` (`getOrthoActionContext({ write: false })`), la fila
// se busca con el `clinicId` de la sesión, y el paciente tiene que ser visible
// para quien pide (`assertPatientVisible`). Solo lectura.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { signMaybeUrls } from "@/lib/storage";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { CLINIC_LETTERHEAD_SELECT, clinicLetterheadProps } from "@/lib/pdf/clinic-letterhead";
import { getOrthoActionContext } from "@/app/actions/orthodontics/_helpers";
import { isFailure } from "@/app/actions/orthodontics/result";
import { CephReportPdf } from "@/lib/orthodontics/cefalometria/pdf/ceph-report-pdf";
import { datosDelTrazado, mimeDeImagen } from "@/lib/orthodontics/cefalometria/pdf/datos-del-trazado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IMAGEN_MAX_BYTES = 15 * 1024 * 1024;
const IMAGEN_TIMEOUT_MS = 10_000;

/** La radiografía como data URL para @react-pdf. Falla en suave: sin imagen, el PDF sale con la tabla. */
async function radiografiaComoDataUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    const [firmada] = await signMaybeUrls([path]);
    if (!firmada || !/^https?:\/\//i.test(firmada)) return null;
    const res = await fetch(firmada, { signal: AbortSignal.timeout(IMAGEN_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > IMAGEN_MAX_BYTES) return null;
    const mime = mimeDeImagen(buf);
    return mime ? `data:${mime};base64,${buf.toString("base64")}` : null;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
  }
  const { ctx } = auth.data;
  if (!ctx.clinicId || !params.id) {
    return NextResponse.json({ ok: false, error: "Trazado no encontrado" }, { status: 404 });
  }

  const fila = await prisma.orthodonticCephalometryAnalysis.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, deletedAt: null },
    select: {
      patientId: true,
      kind: true,
      analysisType: true,
      normSet: true,
      points: true,
      calibrationMmPerPixel: true,
      createdAt: true,
      lateralXrayFile: { select: { url: true } },
      createdByUser: { select: { firstName: true, lastName: true, cedulaProfesional: true } },
      patient: { select: { firstName: true, lastName: true, dob: true, clinicId: true, deletedAt: true } },
      clinic: { select: CLINIC_LETTERHEAD_SELECT },
    },
  });
  if (!fila || fila.patient.deletedAt || fila.patient.clinicId !== ctx.clinicId) {
    return NextResponse.json({ ok: false, error: "Trazado no encontrado" }, { status: 404 });
  }

  const oculto = await assertPatientVisible(fila.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (oculto) return oculto;

  const [cabecera, imagenDataUrl] = await Promise.all([
    clinicLetterheadProps(fila.clinic),
    radiografiaComoDataUrl(fila.lateralXrayFile?.url),
  ]);

  const data = datosDelTrazado({
    fila: {
      kind: fila.kind,
      analysisType: fila.analysisType,
      normSet: fila.normSet,
      points: fila.points,
      calibrationMmPerPixel: fila.calibrationMmPerPixel,
      createdAt: fila.createdAt,
    },
    cabecera,
    patientName: `${fila.patient.firstName} ${fila.patient.lastName}`.trim(),
    patientDobIso: fila.patient.dob ? fila.patient.dob.toISOString() : null,
    doctorName: fila.createdByUser ? `${fila.createdByUser.firstName} ${fila.createdByUser.lastName}`.trim() : "—",
    doctorCedula: fila.createdByUser?.cedulaProfesional ?? null,
    imagenDataUrl,
    ahora: new Date(),
  });

  const buffer = await renderToBuffer(<CephReportPdf data={data} />);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="trazado-cefalometrico-${params.id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
