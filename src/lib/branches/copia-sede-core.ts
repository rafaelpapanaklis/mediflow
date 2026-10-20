/**
 * Copia de configuración al crear una sede (ws1-t10, auditoría BEVADENT · M4).
 *
 * PURO: sin Prisma, sin React. Aquí se decide QUÉ se copia de la sede principal
 * a la nueva y cómo se transforma cada fila; quien lee y escribe en la base es
 * `copia-sede.server.ts`, y quien lo enseña es `new-branch-dialog.tsx`. Las
 * pruebas (`__tests__/copia-sede.test.ts`) ejercitan esto con filas a mano.
 *
 * Qué se copia (todo es configuración, nada son datos de personas):
 *  · catálogo de procedimientos con precios, costos y duración, y su casilla
 *    «Se agenda por WhatsApp» (`botBookable`, columna fuera de schema.prisma);
 *  · paquetes de servicios;
 *  · horario de la clínica (ClinicSchedule) y ajustes de agenda
 *    (duración de la cita, horas de inicio/fin, zona horaria, política de
 *    bloqueos);
 *  · recordatorios y avisos automáticos (`reminderSettings`, las casillas
 *    `waReminder*`, recall, cumpleaños, seguimiento, tarea por no-show) y la
 *    política de cambios de cita del paciente;
 *  · plantillas: notas de evolución y consentimientos (`DocumentTemplate`),
 *    plantillas SOAP por módulo (`ClinicalEvolutionTemplate`), hojas de
 *    indicaciones/constancias (`patient_handout_templates`) con sus
 *    procedimientos re-ligados al catálogo nuevo por NOMBRE;
 *  · los textos del bot de WhatsApp (persona, saludo, fuera de horario, FAQ),
 *    con el bot APAGADO en la sede nueva: la conexión de WhatsApp es por sede;
 *  · las banderas de la agenda flexible (`agenda-flexible` y el color por
 *    procedimiento, filas de `clinic_feature_flags`) y el color de cada
 *    procedimiento del catálogo (`agendaColor`, fuera de schema.prisma). Las
 *    banderas se heredan SIEMPRE, aunque el dueño no marque copiar la configuración.
 *
 * Qué NO se copia, y por qué se le dice al dueño en el diálogo:
 *  · CFDI (emisor, CSD, Facturapi): el RFC y el sello son por sede y los carga
 *    el contador en Configuración → Facturación;
 *  · WhatsApp conectado y sus plantillas de Meta (son por cuenta de WhatsApp);
 *  · Mercado Pago (la cuenta de cobro es por sede);
 *  · pacientes, citas, cobros, expediente: cada sede nace con su propio
 *    expediente (y compartir pacientes es otra pantalla);
 *  · usuarios, roles y permisos: cada persona se da de alta en la sede donde
 *    atiende (los permisos van por persona, no existen roles personalizados);
 *  · módulos de pago (Ortodoncia…): se contratan por sede.
 */

import { BANDERAS_AGENDA_FLEXIBLE, FLAG_AGENDA_FLEXIBLE, FLAG_COLOR_POR_PROCEDIMIENTO } from "@/lib/agenda/agenda-flexible";

/** Columnas escalares de `Clinic` que viajan tal cual a la sede nueva. */
export const AJUSTES_QUE_SE_COPIAN = [
  // Agenda
  "defaultSlotMinutes",
  "agendaDayStart",
  "agendaDayEnd",
  "timezone",
  // Recordatorios y avisos automáticos por WhatsApp
  "waReminderActive",
  "waReminder24h",
  "waReminder1h",
  "waReminderMsg",
  "reminderSettings",
  "recallMonths",
  "recallActive",
  "birthdayMsgActive",
  "postApptFollowupActive",
  "noShowTaskActive",
  // Cambios de cita que pide el paciente
  "patientChangesAutoApprove",
  "patientChangesMinHours",
] as const;

export type AjusteCopiable = (typeof AJUSTES_QUE_SE_COPIAN)[number];

/** Lo que el diálogo dice que hay que conectar aparte en la sede nueva. */
export const NO_SE_COPIA = ["cfdi", "whatsapp", "mercadoPago", "pacientes", "usuarios", "modulos"] as const;
export type NoCopiado = (typeof NO_SE_COPIA)[number];

/** Secciones de la copia, en el orden en que se enseñan. */
export const SECCIONES_COPIA = [
  "catalogo",
  "paquetes",
  "horario",
  "ajustes",
  "plantillasNotas",
  "plantillasConsentimientos",
  "plantillasEvolucion",
  "indicaciones",
  "botWhatsApp",
] as const;
export type SeccionCopia = (typeof SECCIONES_COPIA)[number];

/** Lo que se copió (cuántas filas) o `null` si esa sección falló. */
export type ResultadoCopia = {
  origen: { clinicId: string; nombre: string };
  /** Por sección: número de filas copiadas; `null` = esa parte falló (la sede existe igual). */
  copiado: Record<SeccionCopia, number | null>;
  noSeCopia: readonly NoCopiado[];
};

/* ── Transformaciones fila a fila ─────────────────────────────────────── */

export interface FilaCatalogoOrigen {
  id: string;
  name: string;
  code: string | null;
  cieCode: string | null;
  category: string;
  basePrice: number;
  cost: number | null;
  duration: number | null;
  description: string | null;
  isActive: boolean;
}

export interface FilaCatalogoNueva {
  id: string;
  clinicId: string;
  name: string;
  code: string | null;
  cieCode: string | null;
  category: string;
  basePrice: number;
  cost: number | null;
  duration: number | null;
  description: string | null;
  isActive: boolean;
}

/**
 * El catálogo entero (también lo inactivo: un precio «retirado» sigue siendo
 * parte de cómo trabaja la clínica). Cada fila recibe un id nuevo con
 * `nuevoId` para poder re-ligar las hojas de indicaciones y las marcas del bot.
 */
export function copiarCatalogo(
  filas: readonly FilaCatalogoOrigen[],
  clinicId: string,
  nuevoId: () => string,
): { filas: FilaCatalogoNueva[]; idViejoANuevo: Map<string, string> } {
  const idViejoANuevo = new Map<string, string>();
  const out: FilaCatalogoNueva[] = [];
  for (const f of filas) {
    const id = nuevoId();
    idViejoANuevo.set(f.id, id);
    out.push({
      id,
      clinicId,
      name: f.name,
      code: f.code,
      cieCode: f.cieCode,
      category: f.category,
      basePrice: f.basePrice,
      cost: f.cost,
      duration: f.duration,
      description: f.description,
      isActive: f.isActive,
    });
  }
  return { filas: out, idViejoANuevo };
}

/** Los procedimientos ligados a una hoja, traducidos al catálogo nuevo; los que no existan ya, fuera. */
export function religarProcedimientos(ids: readonly string[], idViejoANuevo: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const nuevo = idViejoANuevo.get(id);
    if (nuevo && !out.includes(nuevo)) out.push(nuevo);
  }
  return out;
}

export interface FilaHorario {
  dayOfWeek: number;
  enabled: boolean;
  openTime: string;
  closeTime: string;
}

/** El horario L-V 9-18 con el que nace una sede cuando la principal no tiene horario guardado. */
export const HORARIO_POR_DEFECTO: readonly FilaHorario[] = [0, 1, 2, 3, 4].map((dayOfWeek) => ({
  dayOfWeek,
  enabled: true,
  openTime: "09:00",
  closeTime: "18:00",
}));

/** El horario de la principal si tiene alguno; si no, el de siempre. Un día por fila, sin repetidos. */
export function horarioParaSedeNueva(origen: readonly FilaHorario[] | null | undefined): FilaHorario[] {
  const vistos = new Set<number>();
  const out: FilaHorario[] = [];
  for (const f of origen ?? []) {
    if (!Number.isInteger(f.dayOfWeek) || f.dayOfWeek < 0 || f.dayOfWeek > 6 || vistos.has(f.dayOfWeek)) continue;
    vistos.add(f.dayOfWeek);
    out.push({ dayOfWeek: f.dayOfWeek, enabled: !!f.enabled, openTime: f.openTime, closeTime: f.closeTime });
  }
  return out.length > 0 ? out : HORARIO_POR_DEFECTO.map((f) => ({ ...f }));
}

/** Los ajustes escalares de la principal, solo las columnas de la lista y solo si vienen definidas. */
export function ajustesParaSedeNueva(origen: Record<string, unknown>): Partial<Record<AjusteCopiable, unknown>> {
  const out: Partial<Record<AjusteCopiable, unknown>> = {};
  for (const k of AJUSTES_QUE_SE_COPIAN) {
    if (k in origen && origen[k] !== undefined) out[k] = origen[k];
  }
  return out;
}

/** El resultado vacío, por si la copia no se pidió o falló antes de empezar. */
export function resultadoVacio(origen: { clinicId: string; nombre: string }): ResultadoCopia {
  const copiado = {} as Record<SeccionCopia, number | null>;
  for (const s of SECCIONES_COPIA) copiado[s] = 0;
  return { origen, copiado, noSeCopia: NO_SE_COPIA };
}

/** Cuántas secciones fallaron (para el aviso del diálogo y la bitácora). */
export function seccionesFallidas(r: ResultadoCopia): SeccionCopia[] {
  return SECCIONES_COPIA.filter((s) => r.copiado[s] === null);
}

/** Si la copia dejó algo (para decidir si el diálogo enseña la lista o solo «sede creada»). */
export function copioAlgo(r: ResultadoCopia): boolean {
  return SECCIONES_COPIA.some((s) => (r.copiado[s] ?? 0) > 0);
}

/** Una fila de `clinic_feature_flags`. */
export interface FilaBandera {
  flag: string;
  enabled: boolean;
}

/**
 * Las banderas de la agenda flexible que hereda una sede nueva. Solo cuentan
 * las dos de `BANDERAS_AGENDA_FLEXIBLE`, y solo si la principal tiene
 * `agenda-flexible` encendida: el color por procedimiento sin ella no hace nada.
 */
export function banderasParaSedeNueva(filas: readonly FilaBandera[] | null | undefined): FilaBandera[] {
  const propias = (filas ?? []).filter((f) => (BANDERAS_AGENDA_FLEXIBLE as readonly string[]).includes(f.flag));
  if (!propias.some((f) => f.flag === FLAG_AGENDA_FLEXIBLE && f.enabled === true)) return [];
  const out: FilaBandera[] = [{ flag: FLAG_AGENDA_FLEXIBLE, enabled: true }];
  const color = propias.find((f) => f.flag === FLAG_COLOR_POR_PROCEDIMIENTO);
  if (color) out.push({ flag: FLAG_COLOR_POR_PROCEDIMIENTO, enabled: color.enabled === true });
  return out;
}
