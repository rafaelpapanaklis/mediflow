import { prisma } from "@/lib/prisma";

/**
 * El teléfono del responsable de pago del caso cuya factura del tratamiento es
 * `invoiceId` (de esta clínica), o null. El recordatorio de mensualidad de Alertas
 * y los cobros automáticos van a ESE teléfono; el aviso de la factura, al del
 * paciente: para el tope de «un aviso de cobro al día» hay que mirar los dos.
 * Nunca lanza (sin columna o sin tabla: null).
 */
export async function telefonoDelResponsableDeLaFactura(clinicId: string, invoiceId: string): Promise<string | null> {
  if (!clinicId || !invoiceId) return null;
  try {
    const plan = await prisma.orthodonticTreatmentPlan.findFirst({
      where: { clinicId, invoiceId, deletedAt: null },
      select: { responsibleGuardian: { select: { phone: true } } },
    });
    const tel = plan?.responsibleGuardian?.phone?.trim();
    return tel ? tel : null;
  } catch {
    return null;
  }
}
