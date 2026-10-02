// ws1-t11 (11d, tercer ticket de BEVADENT) — «Paciente de prueba / no contactar».
//
// Una casilla en la ficha. El paciente marcado:
//   · NO recibe ningún mensaje, automático ni manual: WhatsApp (recordatorios,
//     recall, cumpleaños, cobranza, reseñas, encuestas, avisos de cita, bot,
//     plantillas del Inbox) ni correo;
//   · NO genera cargos automáticos (la factura del control al firmar la hoja de
//     ortodoncia, la factura borrador de la nota clínica);
//   · NO cuenta en métricas, reportes ni tableros.
//
// Este archivo es PURO (sin Prisma, sin red): la regla de decisión, los textos
// y las cláusulas `where` para sacar a esos pacientes de una cuenta. La lectura
// de la base vive en `paciente-de-prueba-db.ts`.
//
// La regla se aplica en UN punto por transporte: `sendWhatsAppLogged`
// (src/lib/whatsapp/send-and-log.ts) para WhatsApp y `sendEmail` con
// `paciente` (src/lib/email.ts) para correo. Los dos únicos caminos que hablan
// con Meta sin pasar por el primero —la respuesta escrita a mano en el Inbox y
// la respuesta del bot en el webhook— llaman a la misma decisión. Una prueba
// (`paciente-de-prueba-caminos.test.ts`) falla si aparece un camino nuevo.

import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";

/** Nombre de la columna en `patients` (sql/ws1-t11-paciente-de-prueba.sql). */
export const COLUMNA_PACIENTE_DE_PRUEBA = "isTestPatient";

/**
 * El motivo que queda escrito donde ya se guardan los fallos de envío
 * (WhatsAppReminder.errorMsg, la respuesta 409 de un envío manual, la bandeja).
 * En español porque esos campos ya son en español y los lee el equipo.
 */
export const MOTIVO_NO_CONTACTAR =
  "No se envió: el paciente está marcado como «Paciente de prueba / no contactar».";

/** Código estable para las respuestas JSON (el cliente lo traduce). */
export const CODIGO_NO_CONTACTAR = "patient_do_not_contact";

/**
 * Error que lanza el freno de WhatsApp. Hereda de `WhatsAppBlockedError` a
 * propósito: los callers que ya atrapan «envío bloqueado» (19 hoy) enseñan el
 * motivo sin tocar nada, y la cola lo guarda como el motivo de la fila.
 */
export class PacienteNoContactarError extends WhatsAppBlockedError {
  readonly codigo = CODIGO_NO_CONTACTAR;
  constructor() {
    super(MOTIVO_NO_CONTACTAR);
    this.name = "PacienteNoContactarError";
  }
}

export function esPacienteNoContactarError(e: unknown): e is PacienteNoContactarError {
  return e instanceof PacienteNoContactarError || (e as { codigo?: unknown } | null)?.codigo === CODIGO_NO_CONTACTAR;
}

/**
 * La regla, sin base de datos.
 *
 * - Si quien envía SABE a qué paciente le escribe (`delPaciente` no es null),
 *   manda la marca de ESE paciente. Un teléfono compartido con un paciente de
 *   prueba no le quita el recordatorio al paciente real.
 * - Si solo se sabe el destino (teléfono o correo: el bot, una fila de la cola
 *   sin cita), basta con que UNO de los pacientes con ese destino esté marcado.
 *   Es el lado seguro: con el número compartido no se sabe a quién se le
 *   escribe, y el paciente de prueba no debe recibir nada.
 */
export function debeBloquearse(args: {
  /** Marca del paciente identificado; null = no se sabe de quién es el envío. */
  delPaciente: boolean | null;
  /** Marcas de los pacientes que tienen ese teléfono o correo. */
  delDestino: readonly boolean[];
}): boolean {
  if (args.delPaciente !== null) return args.delPaciente;
  return args.delDestino.some(Boolean);
}

/** Últimos 10 dígitos, el mismo criterio que el emparejamiento del Inbox. */
export function ultimos10(telefono: string | null | undefined): string {
  return (telefono ?? "").replace(/\D/g, "").slice(-10);
}

export function correoNormalizado(correo: string | null | undefined): string {
  return (correo ?? "").trim().toLowerCase();
}

// ── Métricas ──────────────────────────────────────────────────────────────
// Los pacientes de prueba son pocos (uno o dos por clínica), así que se sacan
// de una cuenta con una lista de ids. Sin ninguno, las cláusulas son `{}` y la
// consulta queda EXACTAMENTE como antes.

/** `where` de Patient sin los de prueba. */
export function sinPruebaEnPaciente(ids: readonly string[]): { id?: { notIn: string[] } } {
  return ids.length ? { id: { notIn: [...ids] } } : {};
}

/**
 * `where` de una tabla con `patientId` (citas, facturas) sin los de prueba.
 * En `appointments` e `invoices` la columna es NOT NULL, así que basta con
 * `notIn` (Prisma ni siquiera acepta `patientId: null` en esos modelos).
 * Se mezcla con `unirWhere` para no pisar un `patientId` que ya traiga el where.
 */
export function sinPruebaPorPatientId(ids: readonly string[]): { patientId?: { notIn: string[] } } {
  return ids.length ? { patientId: { notIn: [...ids] } } : {};
}

/** `where` de Payment (cuelga de su factura) sin los pagos de pacientes de prueba. */
export function sinPruebaEnPago<T extends { invoice?: unknown }>(where: T, ids: readonly string[]): T {
  if (!ids.length) return where;
  const invoice = (where.invoice && typeof where.invoice === "object" ? where.invoice : {}) as Record<string, unknown>;
  return { ...where, invoice: unirWhere(invoice, sinPruebaPorPatientId(ids)) };
}

/**
 * Une dos `where` de Prisma sin que el segundo pise el `AND` del primero.
 * (`{ ...a, ...b }` perdería el AND de `a` si `b` también trae uno.)
 */
export function unirWhere<T extends Record<string, unknown>>(base: T, extra: Record<string, unknown>): T {
  if (!extra || Object.keys(extra).length === 0) return base;
  const andBase = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
  const andExtra = extra.AND === undefined ? [] : Array.isArray(extra.AND) ? extra.AND : [extra.AND];
  const { AND: _a, ...restoBase } = base as Record<string, unknown>;
  const { AND: _b, ...restoExtra } = extra;
  const and = [...andBase, ...andExtra];
  // Una clave que ya está en la base (p. ej. `id`) no se pisa: va dentro del AND.
  const choques = Object.keys(restoExtra).filter((k) => k in restoBase);
  const libres = Object.fromEntries(Object.entries(restoExtra).filter(([k]) => !(k in restoBase)));
  for (const k of choques) and.push({ [k]: restoExtra[k] });
  return { ...restoBase, ...libres, ...(and.length ? { AND: and } : {}) } as unknown as T;
}
