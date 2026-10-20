/**
 * Una SEDE NUEVA hereda la bandera «Google Calendar → agenda» de la sede
 * PRINCIPAL del dueño, SIEMPRE (WS1-T9; revisión t8, C4: mismo criterio que la
 * agenda flexible, no solo al «copiar configuración»). La llama el alta de
 * sedes (`POST /api/clinics`). Solo la bandera: la conexión de Google
 * (tokens, calendario) es de cada sede y se conecta aparte en Configuración.
 *
 * Nunca lanza (no puede tumbar el alta de una sede). Sin SQL aplicado, o con
 * la bandera apagada en el origen, no hace nada. Devuelve 1 si la heredó.
 */

import { prisma } from "@/lib/prisma";
import { tablasGoogleListas } from "./tablas.server";

export async function heredarBanderaGoogle(origenId: string, destinoId: string): Promise<number> {
  if (!origenId || !destinoId || origenId === destinoId) return 0;
  try {
    if (!(await tablasGoogleListas())) return 0;
    const origen = await prisma.googleAgendaImport.findUnique({
      where: { clinicId: origenId },
      select: { enabled: true },
    });
    if (!origen?.enabled) return 0;
    await prisma.googleAgendaImport.upsert({
      where: { clinicId: destinoId },
      create: { clinicId: destinoId, enabled: true },
      update: { enabled: true },
    });
    return 1;
  } catch (e) {
    console.error("[google-entrante] la sede nueva no heredó la bandera:", (e as any)?.message ?? e);
    return 0;
  }
}
