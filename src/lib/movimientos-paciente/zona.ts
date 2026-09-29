import { prisma } from "@/lib/prisma";

/**
 * Zona horaria de una clínica para redactar las fechas de un movimiento («Agendó
 * una cita para el 3 oct 2026 10:00»). Cache en memoria por instancia, 10 min:
 * una consulta como mucho por clínica cada 10 minutos, no una por cada escritura.
 * Nunca tira: sin dato devuelve null y el texto usa la zona por defecto (México).
 */
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { zona: string | null; hasta: number }>();

/** Solo para pruebas. */
export function _reiniciarZonas() {
  cache.clear();
}

export async function zonaDeClinica(clinicId: string): Promise<string | null> {
  if (!clinicId) return null;
  const ahora = Date.now();
  const previo = cache.get(clinicId);
  if (previo && previo.hasta > ahora) return previo.zona;
  try {
    const c = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
    const zona = c?.timezone ?? null;
    if (cache.size > 500) cache.clear();
    cache.set(clinicId, { zona, hasta: ahora + TTL_MS });
    return zona;
  } catch {
    return null;
  }
}
