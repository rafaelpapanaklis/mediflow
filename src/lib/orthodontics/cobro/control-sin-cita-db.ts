import { prisma } from "@/lib/prisma";
import { marcaDeControlDeHoja } from "./control-sin-cita";

/**
 * ¿Ya existe la factura del control de ESTA hoja (registrado sin cita)? Por la marca de la
 * hoja al inicio de las notas, dentro de la clínica de la sesión. Ante un fallo de lectura
 * responde `true` (mejor no facturar dos veces; la firma ya avisó si no se facturó).
 */
export async function existeFacturaDeControlSinCita(clinicId: string, cardId: string): Promise<boolean> {
  if (!clinicId || !cardId) return true;
  try {
    const f = await prisma.invoice.findFirst({
      where: { clinicId, notes: { startsWith: marcaDeControlDeHoja(cardId) } },
      select: { id: true },
    });
    return f !== null;
  } catch (e) {
    console.warn("[ortho] no se pudo comprobar la factura del control sin cita:", e);
    return true;
  }
}
