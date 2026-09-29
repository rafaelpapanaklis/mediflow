import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import { NextResponse } from "next/server";
import { medirAlmacenamientoDeClinica } from "@/lib/storage-usage";
import { totalDesglose } from "@/lib/storage-usage-core";
import { formatBytes } from "@/lib/uploads/patient-study-upload";

/**
 * Cuota de almacenamiento por plan. El uso sale de `medirAlmacenamiento`
 * (@/lib/storage-usage), la MISMA función que pinta la tarjeta de Suscripción y
 * /admin: cuenta todo lo que la clínica sube a Storage (archivos de pacientes,
 * fotos, CBCT y sus derivados, modelos 3D, firmas, comprobantes, landing,
 * laboratorio, soporte…). Si al agregar `addBytes` se pasa del límite del plan
 * devuelve una respuesta 402; si hay espacio (o el plan es ilimitado), null.
 * Llamar ANTES de subir.
 */
export async function storageQuotaError(clinicId: string, addBytes: number): Promise<NextResponse | null> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { plan: true } });
  const { storageBytes } = await getPlanLimits(clinic?.plan);
  if (storageBytes == null) return null; // ilimitado
  const used = totalDesglose(await medirAlmacenamientoDeClinica(clinicId));
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
