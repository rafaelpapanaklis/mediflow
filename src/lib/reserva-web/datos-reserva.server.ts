// Lector de servidor de lo extra de la reserva web (ws1-t1, tercera ronda — N-39 y N-40): precios del catálogo y
// si la clínica tiene WhatsApp conectado. Solo campos públicos (nombre y precio de lista; nunca el costo). Nunca
// lanza: la página pública no se cae por esto, se queda como hoy.

import { prisma } from "@/lib/prisma";
import { preciosDelCatalogo } from "./datos-reserva";

export async function datosExtraDeReserva(clinicId: string): Promise<{ preciosCatalogo: Record<string, string>; avisosWhatsApp: boolean }> {
  if (!clinicId) return { preciosCatalogo: {}, avisosWhatsApp: false };
  try {
    const [procedimientos, clinica] = await Promise.all([
      prisma.procedureCatalog.findMany({ where: { clinicId, isActive: true }, select: { name: true, basePrice: true } }),
      prisma.clinic.findUnique({ where: { id: clinicId }, select: { waConnected: true } }),
    ]);
    return { preciosCatalogo: preciosDelCatalogo(procedimientos), avisosWhatsApp: clinica?.waConnected === true };
  } catch (e) {
    console.error("[reserva-web/datos-extra]", e);
    return { preciosCatalogo: {}, avisosWhatsApp: false };
  }
}
