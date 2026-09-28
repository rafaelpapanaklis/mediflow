"use server";
// Ortodoncia — H55/H57: «Elegir de los archivos del paciente». Una foto o una
// radiografía que ya está en el expediente no se sube dos veces: se elige de
// aquí. Solo lectura, con la visibilidad del paciente y el tenant de la sesión.

import { prisma } from "@/lib/prisma";
import { signMaybeUrls } from "@/lib/storage";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { getOrthoActionContext } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";

export type TipoDeArchivoBuscado = "imagen" | "trazado";

export interface ArchivoDelPaciente {
  id: string;
  name: string;
  category: string;
  mimeType: string | null;
  date: string;
  /** URL firmada para la miniatura; null en PDF o si no se pudo firmar. */
  thumbUrl: string | null;
}

const CATEGORIAS_IMAGEN = [
  "PHOTO_FRONTAL", "PHOTO_LATERAL", "PHOTO_OCCLUSAL_UPPER", "PHOTO_OCCLUSAL_LOWER", "PHOTO_INTRAORAL",
  "PHOTO_PATIENT", "ORTHO_PHOTO_T0", "ORTHO_PHOTO_T1", "ORTHO_PHOTO_T2", "ORTHO_PHOTO_CONTROL", "OTHER",
] as const;
const CATEGORIAS_TRAZADO = ["CEPH_ANALYSIS_PDF", "XRAY_CEPHALOMETRIC", "XRAY_PANORAMIC", "OTHER"] as const;

export async function listarArchivosDelPaciente(
  patientId: string,
  tipo: TipoDeArchivoBuscado,
): Promise<ActionResult<ArchivoDelPaciente[]>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!patientId) return fail("patientId requerido");

  const oculto = await assertPatientVisible(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (oculto) return fail("Paciente no encontrado");

  const filas = await prisma.patientFile.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId,
      deletedAt: null,
      category: { in: [...(tipo === "imagen" ? CATEGORIAS_IMAGEN : CATEGORIAS_TRAZADO)] },
      ...(tipo === "imagen" ? { mimeType: { startsWith: "image/" } } : {}),
    },
    select: { id: true, name: true, category: true, mimeType: true, url: true, takenAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const urls = await signMaybeUrls(filas.map((f) => (f.mimeType?.startsWith("image/") ? f.url : null)));
  return ok(
    filas.map((f, i) => ({
      id: f.id,
      name: f.name,
      category: String(f.category),
      mimeType: f.mimeType,
      date: (f.takenAt ?? f.createdAt).toISOString(),
      thumbUrl: urls[i] || null,
    })),
  );
}
