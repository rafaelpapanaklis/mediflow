/**
 * DaleControl INSTITUCIONAL — EL LIBRO DE MOVIMIENTOS DEL ODONTOGRAMA ·
 * la parte PURA (N-3).
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin
 * `new Date()` escondido.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL FALLO QUE ESTO CIERRA, PASO A PASO
 *
 * La Ola B cambió el DELETE del odontograma por una baja lógica (H-17) y
 * la auditoría encontró que se deshace sola:
 *
 *   ortodoncia marca caries en 16-O → endodoncia la quita (`deletedAt`,
 *   `deletedById`) → ortodoncia la vuelve a marcar → el upsert cae en
 *   `update` y escribe `deletedById: null` SOBRE LA MISMA FILA.
 *
 * En base queda un hallazgo vivo firmado por ortodoncia y NINGUNA huella
 * de que endodoncia lo borró. Y el historial de la pantalla se alimenta de
 * esas mismas filas: una por LLAVE, no una por MOVIMIENTO.
 *
 * No es un descuido del código: `edu_odontogram_hallazgo_key` es de CINCO
 * columnas y NO es parcial, así que una fila dada de baja sigue ocupando
 * su clave e insertar otra choca. El código revive porque es lo único que
 * la base le deja hacer.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 UNA FILA POR ACTO, Y AUTOSUFICIENTE.
 *
 * Las tres columnas del hallazgo (diente, cara, condición) van COPIADAS y
 * `entryId` es opcional con SetNull: el movimiento tiene que poder leerse
 * aunque la fila del hallazgo desaparezca. Un libro de movimientos que
 * depende de que exista lo que registra no es un libro de movimientos.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Espejo 1:1 del enum `EduOdontogramEventAction` de Prisma, escrito como
 * unión de strings para poder importarlo desde componentes "use client".
 * El candado de que no se desincronicen es un chequeo de TIPOS en
 * edu-odontograma-eventos.test.ts.
 */
export type EduOdontogramEventAction = "MARCA" | "QUITA" | "REVIVE" | "EDITA";

export const EDU_ODONTO_EVENT_ACTIONS: EduOdontogramEventAction[] = [
  "MARCA",
  "QUITA",
  "REVIVE",
  "EDITA",
];

export const EDU_ODONTO_EVENT_LABELS: Record<EduOdontogramEventAction, string> = {
  MARCA: "Lo marcó",
  QUITA: "Lo quitó",
  REVIVE: "Lo volvió a marcar",
  EDITA: "Cambió la nota",
};

/** Tope de movimientos que se leen de un paciente. */
export const EDU_ODONTO_EVENT_MAX_ROWS = 200;

/**
 * Qué acto es, a partir de cómo estaba la fila ANTES de escribir.
 *
 * 🔴 ESTA FUNCIÓN ES TODO EL ARREGLO EN TRES LÍNEAS, y por eso está aparte
 * y probada: distinguir MARCA de REVIVE es exactamente lo que N-3 pedía.
 * Con la fila revivida, `deletedById` ya se perdió; lo que queda escrito
 * en el libro es que ALGUIEN la había quitado y que ALGUIEN la volvió a
 * poner, con sus dos nombres y sus dos horas.
 *
 * `previa` null = la fila no existía → MARCA.
 * `previa.deletedAt` con fecha = estaba dada de baja → REVIVE.
 * Si no → EDITA (se tocó la nota de una que ya estaba viva).
 */
export function eduOdontoEventAccionAlMarcar(
  previa: { deletedAt: Date | null } | null,
): EduOdontogramEventAction {
  if (!previa) return "MARCA";
  return previa.deletedAt ? "REVIVE" : "EDITA";
}

export interface EduOdontoEventRow {
  id: string;
  createdAt: string;
  /**
   * El instante YA ESCRITO por el servidor en la zona del INSTITUTO
   * («12 mar 14:20»). Formatearlo en el navegador lo pintaría en la zona
   * de quien mira —dos cadenas distintas para el mismo dato entre el
   * render del servidor y el del cliente, que es un aviso de hidratación—
   * y en UTC un acto de las 19:00 en Tijuana se fecharía al día siguiente.
   */
  createdLabel: string;
  actorName: string;
  action: EduOdontogramEventAction | string;
  actionLabel: string;
  tooth: number;
  surface: string;
  condition: string;
  notes: string | null;
  reason: string | null;
}

/** La etiqueta del diente y la cara, como se lee en el historial. */
export function eduOdontoEventPieza(tooth: number, surface: string): string {
  return surface ? `${tooth}-${surface}` : String(tooth);
}

/**
 * El historial de UN hallazgo concreto, en orden cronológico DESCENDENTE.
 *
 * Se filtra por las tres columnas copiadas y no por `entryId` a propósito:
 * si la fila del hallazgo se fue, `entryId` está en null en todos los
 * renglones y el historial se quedaría vacío justo cuando más falta hace.
 */
export function eduOdontoEventFiltrarHallazgo<
  T extends { tooth: number; surface: string; condition: string },
>(eventos: T[], hallazgo: { tooth: number; surface: string; condition: string }): T[] {
  return eventos.filter(
    (e) =>
      e.tooth === hallazgo.tooth &&
      e.surface === hallazgo.surface &&
      e.condition === hallazgo.condition,
  );
}

/**
 * ¿Quién fue el ÚLTIMO que lo quitó, y cuándo?
 *
 * Es literalmente la pregunta que H-17 existía para contestar y que N-3
 * demostró que dejaba de contestarse. Devuelve null si nunca lo quitó
 * nadie.
 */
export function eduOdontoEventUltimaBaja<
  T extends { action: string; actorName: string; createdAt: Date | string },
>(eventos: T[]): T | null {
  const bajas = eventos.filter((e) => e.action === "QUITA");
  if (bajas.length === 0) return null;
  const ts = (x: T) => new Date(x.createdAt).getTime();
  return bajas.reduce((mejor, e) => (ts(e) > ts(mejor) ? e : mejor), bajas[0]);
}
