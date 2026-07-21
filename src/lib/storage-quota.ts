import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import { NextResponse } from "next/server";

/**
 * Cuota de almacenamiento por plan. Suma el tamaño de TODOS los patientFile de
 * la clínica + las fotos clínicas vivas (clinical_photos.sizeBytes, ficha v3);
 * si al agregar `addBytes` se pasa del límite del plan, devuelve una
 * respuesta 402. Si hay espacio (o el plan es ilimitado), devuelve null.
 * Llamar ANTES de subir el archivo al bucket.
 */
export async function storageQuotaError(clinicId: string, addBytes: number): Promise<NextResponse | null> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { plan: true } });
  const { storageBytes } = await getPlanLimits(clinic?.plan);
  if (storageBytes == null) return null; // ilimitado
  const [fileAgg, photoAgg] = await Promise.all([
    prisma.patientFile.aggregate({ where: { clinicId }, _sum: { size: true } }),
    // Fotos con sizeBytes null (previas a ficha v3) no suman — no hay dato.
    prisma.clinicalPhoto.aggregate({ where: { clinicId, deletedAt: null }, _sum: { sizeBytes: true } }),
  ]);
  const used = Number(fileAgg._sum.size ?? 0) + Number(photoAgg._sum.sizeBytes ?? 0);
  if (used + addBytes > storageBytes) {
    const gb = Math.round(storageBytes / (1024 ** 3));
    return NextResponse.json(
      { error: `Llegaste al límite de almacenamiento de tu plan (${gb} GB). Libera espacio o sube de plan.`, code: "PLAN_LIMIT_STORAGE", limit: storageBytes, used },
      { status: 402 },
    );
  }
  return null;
}
