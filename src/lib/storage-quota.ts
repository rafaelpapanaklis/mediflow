import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import { NextResponse } from "next/server";
import { formatBytes } from "@/lib/uploads/patient-study-upload";

/**
 * Cuota de almacenamiento por plan. Suma el tamaño de:
 *   - TODOS los patientFile de la clínica,
 *   - las fotos clínicas vivas (clinical_photos.sizeBytes, ficha v3),
 *   - los documentos que sube el paciente desde su portal (patient_uploads).
 * Si al agregar `addBytes` se pasa del límite del plan devuelve una respuesta
 * 402; si hay espacio (o el plan es ilimitado), null. Llamar ANTES de subir.
 *
 * SIGUE SIN CONTAR varias rutas que suben a Storage sin registrar el tamaño en
 * ninguna tabla (soporte, archivos de laboratorios y proveedores,
 * landing-upload, firmas, cbct-lite, comprobantes SPEI). Están documentadas
 * como follow-up: el contador subestima el uso real, nunca lo sobreestima.
 */
export async function storageQuotaError(clinicId: string, addBytes: number): Promise<NextResponse | null> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { plan: true } });
  const { storageBytes } = await getPlanLimits(clinic?.plan);
  if (storageBytes == null) return null; // ilimitado
  const [fileAgg, photoAgg, uploadAgg] = await Promise.all([
    prisma.patientFile.aggregate({ where: { clinicId }, _sum: { size: true } }),
    // Fotos con sizeBytes null (previas a ficha v3) no suman — no hay dato.
    prisma.clinicalPhoto.aggregate({ where: { clinicId, deletedAt: null }, _sum: { sizeBytes: true } }),
    // Documentos del portal del paciente. sizeBytes es NOT NULL y lo escribe
    // /api/paciente/documentos/subir con file.size. Falla suave: si la tabla no
    // respondiera, se suma 0 en vez de tumbar toda la subida (fail-open).
    prisma.patientUpload
      .aggregate({ where: { clinicId }, _sum: { sizeBytes: true } })
      .catch((e) => {
        console.error("[storage-quota] no se pudo sumar patient_uploads:", e);
        return { _sum: { sizeBytes: 0 } };
      }),
  ]);
  const used =
    Number(fileAgg._sum.size ?? 0) +
    Number(photoAgg._sum.sizeBytes ?? 0) +
    Number(uploadAgg._sum.sizeBytes ?? 0);
  if (used + addBytes > storageBytes) {
    const gb = Math.round(storageBytes / (1024 ** 3));
    const free = Math.max(0, storageBytes - used);
    // El mensaje dice las TRES cosas que el usuario necesita para decidir:
    // cuánto pesa lo que intenta subir, cuánto espacio le queda y qué hacer.
    // Con estudios de cientos de MB un "llegaste al límite" a secas no basta.
    const detail =
      addBytes > 0
        ? `Este archivo ocupa ${formatBytes(addBytes)} y solo te quedan ${formatBytes(free)} libres de ${gb} GB.`
        : `Ya usaste los ${gb} GB de tu plan.`;
    return NextResponse.json(
      {
        error: `${detail} Libera espacio o mejora tu plan.`,
        code: "PLAN_LIMIT_STORAGE",
        limit: storageBytes,
        used,
        free,
        needed: addBytes,
      },
      { status: 402 },
    );
  }
  return null;
}
