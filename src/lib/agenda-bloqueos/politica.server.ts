/**
 * ¿SE PUEDE AGENDAR SOBRE UN BLOQUEO? — leer y guardar el ajuste. WS1-T5.
 *
 * El ajuste vive en `agenda_block_policies` (`model AgendaBlockPolicy`): una
 * fila por clínica, y solo si alguien lo tocó. Antes de esta tarea no vivía en
 * ninguna parte: la tarjeta de Configuración pedía una ruta que no existía.
 *
 * ⚠️ SIN `import "server-only"`, por lo mismo que `consulta.server.ts`: lo
 * importan el POST y el PATCH de la cita, y esas rutas se prueban con
 * `tsx --test`, donde ese paquete no se resuelve.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LO QUE NO SE LEE ES «SÍ»
 *
 * Sin fila, sin tabla (el SQL se aplica a mano y puede llegar después que el
 * código) o sin `clinicId`: «Sí, avisando y dejando registro», que es lo de
 * fábrica y lo de siempre. Ninguna clínica puede cambiar de comportamiento
 * porque esto se despliegue. GUARDAR, en cambio, no se degrada: fingir que se
 * guardó un «No» dejaría a la clínica creyendo que prohibió algo.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { hasPermission } from "@/lib/auth/permissions";
import { blockedSlotNotAllowed, type BookingRuleViolation } from "@/lib/agenda/booking-rules";
import { fraseBloqueoProhibido, puedeAgendarEncima, type BloqueoLike } from "./core";
import { esTablaAusente } from "./consulta.server";

/** De fábrica: «Sí, avisando y dejando registro». */
export const RECEPCION_PUEDE_AGENDAR_DE_FABRICA = true;

/** La rendija, para que las pruebas pasen un doble. */
export interface PoliticaDb {
  agendaBlockPolicy: {
    findUnique(args: any): Promise<any>;
    upsert(args: any): Promise<any>;
  };
}

/** El SQL de esta tarea sin aplicar: se dice qué falta, no un 500 mudo. */
export class PoliticaSinTablaError extends Error {
  constructor() {
    super(
      "Este ajuste todavía no está activado en esta base. " +
        "Falta aplicar sql/agenda-bloqueos-politica.sql; avisa a soporte.",
    );
    this.name = "PoliticaSinTablaError";
  }
}

/** ¿Recepción puede agendar sobre un bloqueo en ESTA clínica? */
export async function leerRecepcionPuedeAgendar(
  clinicId: string,
  opciones: { db?: PoliticaDb } = {},
): Promise<boolean> {
  // Sin clínica no hay a quién preguntarle, y un `clinicId` vacío no filtra.
  if (!clinicId || typeof clinicId !== "string") return RECEPCION_PUEDE_AGENDAR_DE_FABRICA;

  const db = opciones.db ?? (prisma as unknown as PoliticaDb);
  // Un doble de pruebas que no declara el modelo = el comportamiento de
  // siempre. Mismo criterio que `leerBloqueosDelRango`.
  if (typeof db?.agendaBlockPolicy?.findUnique !== "function") {
    return RECEPCION_PUEDE_AGENDAR_DE_FABRICA;
  }

  try {
    const fila = await db.agendaBlockPolicy.findUnique({
      where: { clinicId },
      select: { recepcionPuedeAgendar: true },
    });
    // Solo un `false` guardado prohíbe.
    return fila?.recepcionPuedeAgendar !== false;
  } catch (err) {
    if (esTablaAusente(err)) return RECEPCION_PUEDE_AGENDAR_DE_FABRICA;
    throw err;
  }
}

/**
 * Guarda el ajuste y deja rastro en `AuditLog` si cambió. Devuelve lo que
 * quedó guardado. El permiso (`settings.edit`) lo comprueba la ruta; el
 * `clinicId` y el `userId` salen de la sesión.
 */
export async function guardarRecepcionPuedeAgendar(
  quien: { clinicId: string; userId: string },
  valor: boolean,
  meta: { ipAddress?: string; userAgent?: string } = {},
  opciones: { db?: PoliticaDb } = {},
): Promise<boolean> {
  if (!quien.clinicId) throw new Error("guardarRecepcionPuedeAgendar sin clinicId");
  const db = opciones.db ?? (prisma as unknown as PoliticaDb);

  try {
    const antes = await leerRecepcionPuedeAgendar(quien.clinicId, { db });
    const fila = await db.agendaBlockPolicy.upsert({
      where: { clinicId: quien.clinicId },
      create: { clinicId: quien.clinicId, recepcionPuedeAgendar: valor, updatedById: quien.userId },
      update: { recepcionPuedeAgendar: valor, updatedById: quien.userId },
      select: { recepcionPuedeAgendar: true },
    });
    const ahora = fila?.recepcionPuedeAgendar !== false;

    if (antes !== ahora) {
      await logAudit({
        clinicId: quien.clinicId,
        userId: quien.userId,
        entityType: "clinic",
        entityId: quien.clinicId,
        action: "update",
        changes: { "agendaBlockPolicy.recepcionPuedeAgendar": { before: antes, after: ahora } },
        ...meta,
      });
    }
    return ahora;
  } catch (err) {
    if (esTablaAusente(err)) throw new PoliticaSinTablaError();
    throw err;
  }
}

/**
 * EL CANDADO de verdad, para el POST y el PATCH de la cita: con la clínica en
 * «No», agendar o mover encima de un bloqueo se rechaza con su frase. Esconder
 * el botón en la ventana de confirmar no es prohibir.
 *
 * Solo pregunta a la base si HAY un bloqueo encima: el 99 % de las citas no
 * tocan ninguno y no ganan ni una consulta.
 */
export async function rechazoPorBloqueo(
  bloqueo: BloqueoLike | null,
  clinicId: string,
  usuario: { role: string; permissionsOverride?: string[] | null },
  opciones: { db?: PoliticaDb } = {},
): Promise<BookingRuleViolation | null> {
  if (!bloqueo) return null;
  const recepcionPuede = await leerRecepcionPuedeAgendar(clinicId, opciones);
  if (puedeAgendarEncima(recepcionPuede, hasPermission(usuario, "settings.edit"))) return null;
  return blockedSlotNotAllowed(fraseBloqueoProhibido(bloqueo));
}
