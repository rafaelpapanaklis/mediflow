/**
 * DaleControl INSTITUCIONAL — LA TARIFA SE RESUELVE EN EL SERVIDOR.
 *
 * SERVIDOR: importa prisma. No lo importe un componente "use client". Lo
 * puro y compartible vive en dinero-core.ts; aquí están la resolución del
 * precio y el catálogo.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL CORAZÓN DE LA OLA, EN TRES FRASES
 *
 * 1. Qué lista de precios le toca a un paciente lo decide el SERVIDOR a
 *    partir de un dato que el paciente no controla: quién lo trajo
 *    (`referredByStudentId`, que solo escribe alguien con
 *    `pacientes.origen` — caja o dirección).
 * 2. Cuánto cuesta un procedimiento en esa lista lo decide el SERVIDOR
 *    leyendo la tabla de precios.
 * 3. El navegador NO pone precios. Manda `procedureId` y cantidad; si
 *    además manda un precio, se descarta.
 *
 * Sin el punto 3, los otros dos son decoración: bastaría con abrir las
 * herramientas del navegador y mandar el precio de "paciente de alumno"
 * para cualquier paciente. Y como el descarte tiene que poder auditarse,
 * el precio descartado se GUARDA en la línea del cobro
 * (`EduChargeItem.clientPriceCents`) en vez de perderse en un log.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── SOBRE LA FIRMA `(institutionId, patientId)` ─────────────────────────
 * El resto del vertical tiene una regla: las funciones reciben el CONTEXTO
 * de sesión y sacan de ahí el institutionId, nunca lo aceptan suelto. Estas
 * dos son la excepción, porque el contrato de la ola las nombra así — y la
 * excepción se paga con tres cerraduras:
 *   · lanzan si el institutionId llega vacío (un `undefined` en un `where`
 *     de Prisma BORRA el filtro de tenant y devuelve las filas de TODOS los
 *     institutos);
 *   · el único llamador legítimo es un endpoint que ya pasó por
 *     `eduApiGuard`, y le pasa `ctx.institutionId`;
 *   · una prueba recorre /api/instituto/** y falla si algún endpoint lee un
 *     institutionId del body o del query.
 * Todas las demás funciones de este archivo sí reciben el contexto.
 *
 * ── SOBRE EL PARÁMETRO `fuente` ─────────────────────────────────────────
 * Es una costura para PROBAR sin base de datos, igual que visibility.ts
 * devuelve `where` sin ejecutarlos. En producción nadie lo pasa: el default
 * es la fuente de Prisma. Sin esta costura, la regla más importante de la
 * ola solo se podría comprobar levantando un Postgres.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId, eduOptionalText } from "@/lib/edu/agenda-core";
import { eduRequiredText, eduParseInt } from "@/lib/edu/padron-core";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
import {
  EDU_MAX_PRICE_CENTS,
  EDU_CAJA_MAX_ROWS,
  normalizeEduKey,
  normalizeEduProcedureCode,
  parseEduFeeRule,
  parseEduMoneyCentsMax,
  type EduFeeScheduleRow,
  type EduPrecioResuelto,
  type EduProcedureRow,
  type EduTarifaMatch,
  type EduTarifaRow,
  type EduTarifario,
} from "@/lib/edu/dinero-core";
import { eduVisibility, eduScopeIsEmpty, type EduClinicaContext } from "@/lib/edu/visibility";
import type { EduFeeRule } from "@/lib/edu/types";

/** Mismo error con status del resto del vertical: `eduApiError` lo mapea. */
export { EduPadronError as EduTarifaError };

/** Duración de un procedimiento, en minutos. */
const EDU_MIN_DURACION = 5;
const EDU_MAX_DURACION = 8 * 60;

/** Cuántos procedimientos y cuántas listas caben en una pantalla. */
export const EDU_MAX_PROCEDURES = 400;
export const EDU_MAX_FEE_SCHEDULES = 20;

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

/**
 * 🔴 El guardia del tenant para las dos funciones de firma suelta. Un
 * institutionId vacío no devuelve cero filas en Prisma: BORRA el filtro.
 */
function requireInstitutionId(institutionId: string, fn: string): string {
  if (!institutionId || typeof institutionId !== "string") {
    throw new Error(
      `${fn} sin institutionId: un undefined BORRA el filtro de tenant y devuelve las filas de TODOS los institutos`,
    );
  }
  return institutionId;
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA FUENTE DE DATOS (la costura de prueba)
// ═══════════════════════════════════════════════════════════════════════

export interface EduFeeScheduleData {
  id: string;
  key: string;
  name: string;
  rule: EduFeeRule;
  isDefault: boolean;
  isActive: boolean;
  orderIndex: number;
}

export interface EduPacienteTarifaData {
  id: string;
  referredByStudentId: string | null;
  referredByStudentName: string | null;
  referredByStudentMatricula: string | null;
}

export interface EduProcedureData {
  id: string;
  code: string;
  name: string;
  category: string | null;
  durationMinutes: number;
  isActive: boolean;
}

export interface EduFeeItemData {
  feeScheduleId: string;
  procedureId: string;
  priceCents: number;
}

/**
 * Lo mínimo que hace falta para decidir un precio. Cuatro lecturas, todas
 * con el institutionId por delante.
 */
export interface EduTarifaFuente {
  listas(institutionId: string): Promise<EduFeeScheduleData[]>;
  paciente(institutionId: string, patientId: string): Promise<EduPacienteTarifaData | null>;
  procedimientos(institutionId: string, procedureIds: string[]): Promise<EduProcedureData[]>;
  precios(institutionId: string, procedureIds: string[]): Promise<EduFeeItemData[]>;
}

const FEE_SCHEDULE_SELECT = {
  id: true,
  key: true,
  name: true,
  rule: true,
  isDefault: true,
  isActive: true,
  orderIndex: true,
} satisfies Prisma.EduFeeScheduleSelect;

/** La fuente de verdad en producción. */
export const fuenteTarifaPrisma: EduTarifaFuente = {
  async listas(institutionId) {
    return prisma.eduFeeSchedule.findMany({
      where: { institutionId },
      orderBy: [{ orderIndex: "asc" }, { key: "asc" }],
      take: EDU_MAX_FEE_SCHEDULES,
      select: FEE_SCHEDULE_SELECT,
    });
  },

  async paciente(institutionId, patientId) {
    const p = await prisma.eduPatient.findFirst({
      where: { id: patientId, institutionId },
      select: {
        id: true,
        referredByStudentId: true,
        referredByStudent: {
          select: {
            matricula: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    if (!p) return null;
    return {
      id: p.id,
      referredByStudentId: p.referredByStudentId,
      referredByStudentName: p.referredByStudent
        ? eduPatientFullName(p.referredByStudent.user)
        : null,
      referredByStudentMatricula: p.referredByStudent?.matricula ?? null,
    };
  },

  async procedimientos(institutionId, procedureIds) {
    if (procedureIds.length === 0) return [];
    return prisma.eduProcedure.findMany({
      where: { institutionId, id: { in: procedureIds } },
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        durationMinutes: true,
        isActive: true,
      },
    });
  },

  async precios(institutionId, procedureIds) {
    if (procedureIds.length === 0) return [];
    return prisma.eduFeeScheduleItem.findMany({
      where: { institutionId, procedureId: { in: procedureIds } },
      select: { feeScheduleId: true, procedureId: true, priceCents: true },
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════
// 2 · QUÉ LISTA LE TOCA A ESTE PACIENTE
// ═══════════════════════════════════════════════════════════════════════

/** Orden TOTAL y determinista: si dos listas empatan, gana siempre la misma. */
function porOrden(a: EduFeeScheduleData, b: EduFeeScheduleData): number {
  if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
  return a.key.localeCompare(b.key);
}

function match(
  lista: EduFeeScheduleData,
  reason: string,
  isDefault: boolean,
): EduTarifaMatch {
  return {
    feeScheduleId: lista.id,
    feeScheduleName: lista.name,
    feeScheduleKey: lista.key,
    reason,
    isDefault,
  };
}

function nombreDelAlumno(p: EduPacienteTarifaData): string {
  const nombre = p.referredByStudentName;
  const mat = p.referredByStudentMatricula;
  if (nombre && mat) return `${nombre} (${mat})`;
  if (nombre) return nombre;
  return "un alumno";
}

/**
 * La decisión, en memoria. La comparten `resolveFeeSchedule` y la pantalla
 * de caja para que no puedan discrepar: si la lista que se pinta y la que
 * se aplica salieran de dos algoritmos, el paciente vería un precio y
 * pagaría otro.
 */
function elegirLista(
  listas: EduFeeScheduleData[],
  paciente: EduPacienteTarifaData,
): EduTarifaMatch | null {
  const activas = listas.filter((l) => l.isActive).sort(porOrden);

  // 1 · ¿Alguna regla automática dispara? Hoy hay una: la del paciente que
  //     trajo un alumno. Si mañana hay tres, se evalúan aquí en orden.
  if (paciente.referredByStudentId) {
    const porRegla = activas.filter((l) => l.rule === "REFERRED_BY_STUDENT");
    if (porRegla.length > 0) {
      return match(porRegla[0], `Lo trajo ${nombreDelAlumno(paciente)}`, false);
    }
  }

  // 2 · La lista predeterminada.
  const porDefecto = activas.filter((l) => l.isDefault);
  if (porDefecto.length > 0) {
    // El motivo se escribe distinto según por qué se llegó aquí. Decirle a
    // caja "llegó solo a la clínica" cuando SÍ lo trajo un alumno, solo
    // porque la escuela no ha creado esa lista, es mentirle al que cobra.
    const reason = paciente.referredByStudentId
      ? `Lo trajo ${nombreDelAlumno(paciente)}, pero no hay una lista activa para pacientes de alumno`
      : "Llegó solo a la clínica";
    return match(porDefecto[0], reason, true);
  }

  // 3 · Nada. NO se cae a "la primera lista que haya": elegir sola una
  //     lista de precios que nadie marcó como predeterminada es cobrar a
  //     ojo. La pantalla dice qué falta.
  return null;
}

/**
 * 🔴 QUÉ LISTA DE PRECIOS LE TOCA A ESTE PACIENTE.
 *
 * Si tiene `referredByStudentId` (lo trajo un alumno) → la lista activa con
 * regla REFERRED_BY_STUDENT. Si no la hay, o si el paciente llegó solo → la
 * lista predeterminada. Si tampoco hay predeterminada → `null`, y quien
 * llama tiene que decirlo en pantalla en vez de inventarse un precio.
 *
 * Lanza si el paciente no es de este instituto: eso no es "no hay tarifa",
 * es un id de otra escuela.
 */
export async function resolveFeeSchedule(
  institutionId: string,
  patientId: string,
  fuente: EduTarifaFuente = fuenteTarifaPrisma,
): Promise<EduTarifaMatch | null> {
  return (await resolverListaYCatalogo(institutionId, patientId, fuente)).applied;
}

/**
 * La resolución de arriba, devolviendo TAMBIÉN las listas que ya leyó.
 *
 * Existe para que `resolveUnitPrice` no vuelva a pedir las mismas listas
 * para buscar la predeterminada: dos consultas idénticas en la misma
 * petición es la clase de desperdicio que se multiplica por cada renglón
 * de un tarifario.
 */
async function resolverListaYCatalogo(
  institutionId: string,
  patientId: string,
  fuente: EduTarifaFuente,
): Promise<{ applied: EduTarifaMatch | null; listas: EduFeeScheduleData[] }> {
  requireInstitutionId(institutionId, "resolveFeeSchedule");
  const id = eduCleanId(patientId);
  if (!id) throw new EduPadronError("Ese paciente no es válido.", 400);

  const [paciente, listas] = await Promise.all([
    fuente.paciente(institutionId, id),
    fuente.listas(institutionId),
  ]);
  if (!paciente) throw new EduPadronError("Ese paciente no es de este instituto.", 404);

  return { applied: elegirLista(listas, paciente), listas };
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · CUÁNTO CUESTA
// ═══════════════════════════════════════════════════════════════════════

export interface EduPrecioUnitario {
  procedureId: string;
  procedure: EduProcedureData;
  priceCents: number;
  /** La lista que LE TOCABA al paciente. */
  applied: EduTarifaMatch;
  /** De qué lista salió el precio de verdad. */
  fromFeeScheduleId: string;
  fromFeeScheduleName: string;
  /** true = la lista que le tocaba no cubre este procedimiento. */
  fallback: boolean;
}

function precioEn(
  items: EduFeeItemData[],
  feeScheduleId: string,
  procedureId: string,
): number | null {
  for (const it of items) {
    if (it.feeScheduleId === feeScheduleId && it.procedureId === procedureId) return it.priceCents;
  }
  return null;
}

/**
 * 🔴 EL PRECIO DE UN PROCEDIMIENTO PARA UN PACIENTE.
 *
 * Resuelve la lista y busca el precio en ella. Si esa lista NO tiene ese
 * procedimiento, cae a la lista predeterminada y lo marca (`fallback`), y
 * la pantalla lo dice: "precio de Público general — la lista de alumno no
 * cubre este tratamiento". Callarlo sería cobrarle a un paciente de alumno
 * el precio de público sin que nadie se enterara.
 *
 * Devuelve `null` cuando NINGUNA lista tiene precio para ese
 * procedimiento. Un `0` implícito ahí sería regalar el tratamiento sin que
 * nadie lo decidiera; el cobro se rechaza y se dice qué falta capturar.
 */
export async function resolveUnitPrice(
  institutionId: string,
  patientId: string,
  procedureId: string,
  fuente: EduTarifaFuente = fuenteTarifaPrisma,
): Promise<EduPrecioUnitario | null> {
  requireInstitutionId(institutionId, "resolveUnitPrice");
  const procId = eduCleanId(procedureId);
  if (!procId) throw new EduPadronError("Ese procedimiento no es válido.", 400);

  const { applied, listas } = await resolverListaYCatalogo(institutionId, patientId, fuente);
  if (!applied) return null;

  const [procs, items] = await Promise.all([
    fuente.procedimientos(institutionId, [procId]),
    fuente.precios(institutionId, [procId]),
  ]);

  const procedure = procs.find((p) => p.id === procId);
  if (!procedure) throw new EduPadronError("Ese procedimiento no es de este instituto.", 404);
  if (!procedure.isActive) {
    throw new EduPadronError(
      `"${procedure.name}" está dado de baja del catálogo y no se puede cobrar.`,
      409,
    );
  }

  // 1 · El precio en la lista que le toca.
  const directo = precioEn(items, applied.feeScheduleId, procId);
  if (directo !== null) {
    return {
      procedureId: procId,
      procedure,
      priceCents: directo,
      applied,
      fromFeeScheduleId: applied.feeScheduleId,
      fromFeeScheduleName: applied.feeScheduleName,
      fallback: false,
    };
  }

  // 2 · La lista predeterminada, marcado como caída.
  const porDefecto = listas
    .filter((l) => l.isActive && l.isDefault)
    .sort(porOrden)[0];
  if (porDefecto && porDefecto.id !== applied.feeScheduleId) {
    const respaldo = precioEn(items, porDefecto.id, procId);
    if (respaldo !== null) {
      return {
        procedureId: procId,
        procedure,
        priceCents: respaldo,
        applied,
        fromFeeScheduleId: porDefecto.id,
        fromFeeScheduleName: porDefecto.name,
        fallback: true,
      };
    }
  }

  // 3 · Nadie le puso precio.
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL ANTIFRAUDE: LAS LÍNEAS DE UN COBRO
// ═══════════════════════════════════════════════════════════════════════

/** Una línea tal como llega del navegador. Todo es `unknown` a propósito. */
export interface EduLineaCliente {
  procedureId?: unknown;
  description?: unknown;
  quantity?: unknown;
  /** 🔴 Se IGNORA cuando hay procedureId. Solo se guarda si difería. */
  unitPriceCents?: unknown;
  discountCents?: unknown;
}

export interface EduLineaResuelta {
  procedureId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  /** El precio que mandó el navegador y se descartó. null = no hubo. */
  clientPriceCents: number | null;
}

export interface EduLineasResueltas {
  applied: EduTarifaMatch | null;
  lines: EduLineaResuelta[];
  /** Cuántas veces el navegador mandó un precio distinto al del servidor. */
  descartados: number;
}

/**
 * 🔴 AQUÍ SE DESCARTA EL PRECIO DEL CLIENTE.
 *
 * Para cada línea:
 *  · CON `procedureId` → el precio lo pone el SERVIDOR. Lo que venga en
 *    `unitPriceCents` se ignora; si era distinto, se guarda en
 *    `clientPriceCents` y se anota en el log del servidor. No se devuelve
 *    error: el contrato dice "se descarta EN SILENCIO", y tiene razón —
 *    reventar le avisaría al que lo intenta que hay algo que intentar, y
 *    rompería a un cliente honesto con la caché vieja de un precio que
 *    acaba de cambiar. El cobro sale con el precio bueno.
 *  · SIN `procedureId` (línea libre: un material, una placa) → el precio
 *    sí lo pone quien cobra, porque el servidor no tiene ninguna opinión
 *    sobre algo que no está en el catálogo. Queda registrado igualmente:
 *    la línea no tiene procedimiento y eso se ve en el recibo y en el corte.
 *
 * `quantity` y `discountCents` SÍ vienen del cliente: son decisiones de
 * quien cobra, no precios. Van validados y con tope.
 */
export async function resolveEduChargeLines(
  institutionId: string,
  patientId: string,
  lineas: EduLineaCliente[],
  fuente: EduTarifaFuente = fuenteTarifaPrisma,
): Promise<EduLineasResueltas> {
  requireInstitutionId(institutionId, "resolveEduChargeLines");
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new EduPadronError("El cobro no tiene ni un concepto.");
  }

  const { applied, listas } = await resolverListaYCatalogo(institutionId, patientId, fuente);

  const ids: string[] = [];
  for (const l of lineas) {
    const id = eduCleanId(l?.procedureId);
    if (id && !ids.includes(id)) ids.push(id);
  }

  const [procs, items] = await Promise.all([
    fuente.procedimientos(institutionId, ids),
    fuente.precios(institutionId, ids),
  ]);

  const porDefecto = listas.filter((l) => l.isActive && l.isDefault).sort(porOrden)[0] ?? null;

  const lines: EduLineaResuelta[] = [];
  let descartados = 0;

  for (const linea of lineas) {
    const cantidad = parseCantidad(linea?.quantity);
    const descuentoCliente = linea?.discountCents;
    const procedureId = eduCleanId(linea?.procedureId);

    if (!procedureId) {
      // ── Línea libre ──────────────────────────────────────────────────
      const description = eduRequiredText(linea?.description, 160);
      if (!description) {
        throw new EduPadronError(
          "Una línea sin procedimiento necesita una descripción (máximo 160 caracteres).",
        );
      }
      const precio = parseEduMoneyCentsMax(linea?.unitPriceCents, EDU_MAX_PRICE_CENTS);
      if (precio === null) {
        throw new EduPadronError(
          `El precio de "${description}" no es una cantidad válida (máximo $100,000.00).`,
        );
      }
      lines.push({
        procedureId: null,
        description,
        quantity: cantidad,
        unitPriceCents: precio,
        discountCents: parseDescuento(descuentoCliente, cantidad * precio, description),
        clientPriceCents: null,
      });
      continue;
    }

    // ── Línea de catálogo: el precio lo pone el servidor ───────────────
    const procedure = procs.find((p) => p.id === procedureId);
    if (!procedure) throw new EduPadronError("Ese procedimiento no es de este instituto.", 404);
    if (!procedure.isActive) {
      throw new EduPadronError(
        `"${procedure.name}" está dado de baja del catálogo y no se puede cobrar.`,
        409,
      );
    }
    if (!applied) {
      throw new EduPadronError(
        "No hay ninguna lista de precios predeterminada. Marca una en Tarifarios antes de cobrar.",
        409,
      );
    }

    let precio = precioEn(items, applied.feeScheduleId, procedureId);
    if (precio === null && porDefecto && porDefecto.id !== applied.feeScheduleId) {
      precio = precioEn(items, porDefecto.id, procedureId);
    }
    if (precio === null) {
      throw new EduPadronError(
        `"${procedure.name}" no tiene precio en ninguna lista. Captúralo en Tarifarios y vuelve a cobrar.`,
        409,
      );
    }

    // El precio del navegador: se lee SOLO para poder decir si difería.
    const enviado = parseEduMoneyCentsMax(linea?.unitPriceCents, EDU_MAX_PRICE_CENTS);
    const difiere = enviado !== null && enviado !== precio;
    if (difiere) {
      descartados += 1;
      console.warn(
        `[instituto] tarifa: precio del cliente DESCARTADO — procedimiento ${procedure.code} ` +
          `(${procedureId}), enviado ${enviado}, servidor ${precio}, lista ${applied.feeScheduleKey}, ` +
          `instituto ${institutionId}`,
      );
    }

    lines.push({
      procedureId,
      description: procedure.name,
      quantity: cantidad,
      unitPriceCents: precio,
      discountCents: parseDescuento(descuentoCliente, cantidad * precio, procedure.name),
      clientPriceCents: difiere ? enviado : null,
    });
  }

  return { applied, lines, descartados };
}

function parseCantidad(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 1;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    throw new EduPadronError("La cantidad de una línea va de 1 a 99.");
  }
  return n;
}

/**
 * El descuento de una línea. Se rechaza el que supera a la línea en vez de
 * recortarlo callando: quien teclea $900 de descuento sobre $500 se
 * equivocó de casilla, y un recorte silencioso le confirma que hizo bien.
 */
function parseDescuento(raw: unknown, brutoCents: number, concepto: string): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  const v = parseEduMoneyCentsMax(raw, EDU_MAX_PRICE_CENTS * 99);
  if (v === null) throw new EduPadronError(`El descuento de "${concepto}" no es una cantidad válida.`);
  if (v > brutoCents) {
    throw new EduPadronError(
      `El descuento de "${concepto}" es mayor que la línea. Si hay que devolver dinero, es una devolución, no un descuento.`,
    );
  }
  return v;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LO QUE PIDE LA PANTALLA DE CAJA
// ═══════════════════════════════════════════════════════════════════════

export interface EduTarifaDePaciente {
  patientId: string;
  patientName: string;
  patientFolio: string;
  applied: EduTarifaMatch | null;
  /** Todos los procedimientos activos, con SU precio para ESTE paciente. */
  prices: EduPrecioResuelto[];
  /** Procedimientos activos que no tienen precio en ninguna lista. */
  sinPrecio: { id: string; code: string; name: string }[];
}

/**
 * 🔴 LO QUE HACE QUE NO HAYA UN SOLO PRECIO ESCRITO EN LA UI.
 *
 * La pantalla de caja elige un paciente y pide ESTO. Recibe la lista que le
 * toca, el motivo escrito en español y el precio ya resuelto de cada
 * procedimiento. No calcula nada: si el navegador supiera calcular un
 * precio, sabría calcular uno más barato.
 */
export async function getEduTarifaDePaciente(
  ctx: EduClinicaContext,
  patientId: string,
): Promise<EduTarifaDePaciente> {
  const institutionId = requireInstitution(ctx);
  // El dinero es de caja y dirección. El alcance se comprueba aquí ADEMÁS
  // del permiso del endpoint: son dos cerraduras distintas.
  if (eduScopeIsEmpty(eduVisibility(ctx, "charges"))) {
    throw new EduPadronError("Tu rol no ve precios ni cobros.", 403);
  }
  const id = eduCleanId(patientId);
  if (!id) throw new EduPadronError("Ese paciente no es válido.", 400);

  const paciente = await prisma.eduPatient.findFirst({
    where: { id, institutionId },
    select: { id: true, folio: true, firstName: true, lastName: true },
  });
  if (!paciente) throw new EduPadronError("Ese paciente no es de este instituto.", 404);

  const [applied, procedimientos, items, listas] = await Promise.all([
    resolveFeeSchedule(institutionId, id),
    prisma.eduProcedure.findMany({
      where: { institutionId, isActive: true },
      orderBy: [{ orderIndex: "asc" }, { code: "asc" }],
      take: EDU_MAX_PROCEDURES,
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        durationMinutes: true,
        isActive: true,
      },
    }),
    prisma.eduFeeScheduleItem.findMany({
      where: { institutionId },
      select: { feeScheduleId: true, procedureId: true, priceCents: true },
    }),
    fuenteTarifaPrisma.listas(institutionId),
  ]);

  const porDefecto = listas.filter((l) => l.isActive && l.isDefault).sort(porOrden)[0] ?? null;

  const prices: EduPrecioResuelto[] = [];
  const sinPrecio: { id: string; code: string; name: string }[] = [];

  for (const p of procedimientos) {
    let precio: number | null = null;
    let desdeId = "";
    let desdeNombre = "";
    let fallback = false;

    if (applied) {
      precio = precioEn(items, applied.feeScheduleId, p.id);
      if (precio !== null) {
        desdeId = applied.feeScheduleId;
        desdeNombre = applied.feeScheduleName;
      }
    }
    if (precio === null && porDefecto && (!applied || porDefecto.id !== applied.feeScheduleId)) {
      const respaldo = precioEn(items, porDefecto.id, p.id);
      if (respaldo !== null) {
        precio = respaldo;
        desdeId = porDefecto.id;
        desdeNombre = porDefecto.name;
        fallback = Boolean(applied);
      }
    }

    if (precio === null) {
      sinPrecio.push({ id: p.id, code: p.code, name: p.name });
      continue;
    }

    prices.push({
      procedureId: p.id,
      code: p.code,
      name: p.name,
      category: p.category,
      durationMinutes: p.durationMinutes,
      priceCents: precio,
      fromFeeScheduleId: desdeId,
      fromFeeScheduleName: desdeNombre,
      fallback,
    });
  }

  return {
    patientId: paciente.id,
    patientName: eduPatientFullName(paciente),
    patientFolio: paciente.folio,
    applied,
    prices,
    sinPrecio,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · EL CATÁLOGO DE PROCEDIMIENTOS
//
// Lecturas: exigen "tarifarios.view" en el endpoint. Escrituras:
// "tarifarios.manage". Aquí solo se comprueba la PERTENENCIA al instituto,
// que es lo que un permiso no puede saber.
// ═══════════════════════════════════════════════════════════════════════

export async function listEduProcedures(
  ctx: EduClinicaContext,
  options: { soloActivos?: boolean } = {},
): Promise<EduProcedureRow[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduProcedure.findMany({
    where: { institutionId, ...(options.soloActivos ? { isActive: true } : {}) },
    orderBy: [{ orderIndex: "asc" }, { code: "asc" }],
    take: EDU_MAX_PROCEDURES,
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      durationMinutes: true,
      isActive: true,
      orderIndex: true,
      _count: { select: { feeItems: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    category: p.category,
    durationMinutes: p.durationMinutes,
    isActive: p.isActive,
    orderIndex: p.orderIndex,
    pricedIn: p._count.feeItems,
  }));
}

export interface EduProcedureInput {
  code?: unknown;
  name?: unknown;
  category?: unknown;
  durationMinutes?: unknown;
  orderIndex?: unknown;
  isActive?: unknown;
}

function parseDuracion(raw: unknown, actual: number): number {
  if (raw === undefined || raw === null || raw === "") return actual;
  const n = eduParseInt(raw, EDU_MIN_DURACION, EDU_MAX_DURACION);
  if (n === null) {
    throw new EduPadronError(
      `La duración va de ${EDU_MIN_DURACION} a ${EDU_MAX_DURACION} minutos.`,
    );
  }
  return n;
}

export async function createEduProcedure(
  ctx: EduClinicaContext,
  input: EduProcedureInput,
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const name = eduRequiredText(input.name, 120);
  if (!name) throw new EduPadronError("El nombre del procedimiento es obligatorio (máximo 120 caracteres).");

  const code = normalizeEduProcedureCode(input.code);
  if (!code) throw new EduPadronError("La clave es obligatoria (máximo 20 caracteres, sin espacios).");

  const dup = await prisma.eduProcedure.findFirst({
    where: { institutionId, code },
    select: { id: true },
  });
  if (dup) throw new EduPadronError(`La clave ${code} ya está en uso.`, 409);

  const ultimo = await prisma.eduProcedure.findFirst({
    where: { institutionId },
    orderBy: { orderIndex: "desc" },
    select: { orderIndex: true },
  });

  const created = await prisma.eduProcedure.create({
    data: {
      institutionId,
      name,
      code,
      category: eduOptionalText(input.category, 60) ?? null,
      durationMinutes: parseDuracion(input.durationMinutes, 60),
      orderIndex: (ultimo?.orderIndex ?? 0) + 1,
    },
    select: { id: true },
  });
  return created;
}

export async function updateEduProcedure(
  ctx: EduClinicaContext,
  procedureId: string,
  input: EduProcedureInput,
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(procedureId);
  if (!id) throw new EduPadronError("Ese procedimiento no es válido.", 400);

  const actual = await prisma.eduProcedure.findFirst({
    where: { id, institutionId },
    select: { id: true, durationMinutes: true },
  });
  if (!actual) throw new EduPadronError("Ese procedimiento no es de este instituto.", 404);

  const data: Prisma.EduProcedureUpdateInput = {};

  if (input.name !== undefined) {
    const name = eduRequiredText(input.name, 120);
    if (!name) throw new EduPadronError("El nombre del procedimiento es obligatorio (máximo 120 caracteres).");
    data.name = name;
  }

  if (input.code !== undefined) {
    const code = normalizeEduProcedureCode(input.code);
    if (!code) throw new EduPadronError("La clave es obligatoria (máximo 20 caracteres, sin espacios).");
    const dup = await prisma.eduProcedure.findFirst({
      where: { institutionId, code, NOT: { id } },
      select: { id: true },
    });
    if (dup) throw new EduPadronError(`La clave ${code} ya está en uso.`, 409);
    data.code = code;
  }

  if (input.category !== undefined) {
    data.category = eduOptionalText(input.category, 60) ?? null;
  }
  if (input.durationMinutes !== undefined) {
    data.durationMinutes = parseDuracion(input.durationMinutes, actual.durationMinutes);
  }
  if (input.isActive !== undefined) {
    data.isActive = Boolean(input.isActive);
  }
  if (input.orderIndex !== undefined) {
    const n = eduParseInt(input.orderIndex, 0, 9999);
    if (n === null) throw new EduPadronError("El orden va de 0 a 9999.");
    data.orderIndex = n;
  }

  // 🔴 Un `data` vacío en Prisma no es un error: es un update que no
  // actualiza nada y devuelve éxito. La pantalla diría "guardado" sin
  // haber guardado. Se rechaza antes.
  if (Object.keys(data).length === 0) {
    throw new EduPadronError("No mandaste ningún cambio.");
  }

  await prisma.eduProcedure.update({ where: { id }, data });
  return { id };
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · LAS LISTAS DE PRECIOS
// ═══════════════════════════════════════════════════════════════════════

export async function listEduFeeSchedules(
  ctx: EduClinicaContext,
): Promise<EduFeeScheduleRow[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduFeeSchedule.findMany({
    where: { institutionId },
    orderBy: [{ orderIndex: "asc" }, { key: "asc" }],
    take: EDU_MAX_FEE_SCHEDULES,
    select: { ...FEE_SCHEDULE_SELECT, notes: true, _count: { select: { items: true } } },
  });
  return rows.map((l) => ({
    id: l.id,
    key: l.key,
    name: l.name,
    rule: l.rule as EduFeeRule,
    isDefault: l.isDefault,
    isActive: l.isActive,
    orderIndex: l.orderIndex,
    notes: l.notes,
    itemCount: l._count.items,
  }));
}

export interface EduFeeScheduleInput {
  key?: unknown;
  name?: unknown;
  rule?: unknown;
  isDefault?: unknown;
  isActive?: unknown;
  orderIndex?: unknown;
  notes?: unknown;
}

/**
 * Deja UNA sola lista predeterminada y UNA sola por regla automática.
 *
 * No lo puede garantizar la base: un índice único parcial con `isActive` de
 * por medio no lo expresa, y uno completo prohibiría tener dos listas
 * históricas desactivadas. Así que lo garantiza esto, dentro de la MISMA
 * transacción que escribe: apagar la marca en las demás y encenderla aquí
 * son una sola operación o no son ninguna.
 */
async function apagarMarcasDeOtras(
  tx: Prisma.TransactionClient,
  institutionId: string,
  id: string | null,
  opciones: { isDefault: boolean; rule: EduFeeRule },
): Promise<void> {
  if (opciones.isDefault) {
    await tx.eduFeeSchedule.updateMany({
      where: { institutionId, isDefault: true, ...(id ? { NOT: { id } } : {}) },
      data: { isDefault: false },
    });
  }
  if (opciones.rule !== "MANUAL") {
    await tx.eduFeeSchedule.updateMany({
      where: { institutionId, rule: opciones.rule, ...(id ? { NOT: { id } } : {}) },
      data: { rule: "MANUAL" },
    });
  }
}

export async function createEduFeeSchedule(
  ctx: EduClinicaContext,
  input: EduFeeScheduleInput,
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const name = eduRequiredText(input.name, 80);
  if (!name) throw new EduPadronError("El nombre de la lista es obligatorio (máximo 80 caracteres).");

  // La clave se deriva del nombre si no la teclearon: "Convenio IMSS" →
  // "convenio-imss". Nadie debería tener que inventarse una clave.
  const key = normalizeEduKey(input.key ?? name);
  if (!key) throw new EduPadronError("La clave de la lista no es válida (letras, números y guiones).");

  const cuantas = await prisma.eduFeeSchedule.count({ where: { institutionId } });
  if (cuantas >= EDU_MAX_FEE_SCHEDULES) {
    throw new EduPadronError(
      `Ya hay ${EDU_MAX_FEE_SCHEDULES} listas de precios. Desactiva alguna antes de crear otra.`,
      409,
    );
  }

  const dup = await prisma.eduFeeSchedule.findFirst({
    where: { institutionId, key },
    select: { id: true },
  });
  if (dup) throw new EduPadronError(`La clave ${key} ya está en uso.`, 409);

  const rule = input.rule === undefined ? "MANUAL" : parseEduFeeRule(input.rule);
  if (!rule) throw new EduPadronError("Esa regla de aplicación no existe.");
  const isDefault = Boolean(input.isDefault);

  const created = await prisma.$transaction(async (tx) => {
    await apagarMarcasDeOtras(tx, institutionId, null, { isDefault, rule });
    return tx.eduFeeSchedule.create({
      data: {
        institutionId,
        name,
        key,
        rule,
        isDefault,
        orderIndex: cuantas + 1,
        notes: eduOptionalText(input.notes, 300) ?? null,
      },
      select: { id: true },
    });
  });
  return created;
}

export async function updateEduFeeSchedule(
  ctx: EduClinicaContext,
  feeScheduleId: string,
  input: EduFeeScheduleInput,
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(feeScheduleId);
  if (!id) throw new EduPadronError("Esa lista no es válida.", 400);

  const actual = await prisma.eduFeeSchedule.findFirst({
    where: { id, institutionId },
    select: { id: true, isDefault: true, rule: true, isActive: true },
  });
  if (!actual) throw new EduPadronError("Esa lista no es de este instituto.", 404);

  const data: Prisma.EduFeeScheduleUpdateInput = {};

  if (input.name !== undefined) {
    const name = eduRequiredText(input.name, 80);
    if (!name) throw new EduPadronError("El nombre de la lista es obligatorio (máximo 80 caracteres).");
    data.name = name;
  }
  if (input.key !== undefined) {
    const key = normalizeEduKey(input.key);
    if (!key) throw new EduPadronError("La clave de la lista no es válida (letras, números y guiones).");
    const dup = await prisma.eduFeeSchedule.findFirst({
      where: { institutionId, key, NOT: { id } },
      select: { id: true },
    });
    if (dup) throw new EduPadronError(`La clave ${key} ya está en uso.`, 409);
    data.key = key;
  }
  if (input.rule !== undefined) {
    const rule = parseEduFeeRule(input.rule);
    if (!rule) throw new EduPadronError("Esa regla de aplicación no existe.");
    data.rule = rule;
  }
  if (input.isDefault !== undefined) data.isDefault = Boolean(input.isDefault);
  if (input.notes !== undefined) data.notes = eduOptionalText(input.notes, 300) ?? null;
  if (input.orderIndex !== undefined) {
    const n = eduParseInt(input.orderIndex, 0, 9999);
    if (n === null) throw new EduPadronError("El orden va de 0 a 9999.");
    data.orderIndex = n;
  }

  if (input.isActive !== undefined) {
    const activa = Boolean(input.isActive);
    // 🔴 Desactivar la lista predeterminada dejaría a la clínica sin
    // ninguna: el siguiente cobro no sabría qué precio poner. Se rechaza
    // con la instrucción de qué hacer antes.
    const seraDefault = input.isDefault === undefined ? actual.isDefault : Boolean(input.isDefault);
    if (!activa && seraDefault) {
      throw new EduPadronError(
        "No puedes desactivar la lista predeterminada. Marca otra como predeterminada primero.",
        409,
      );
    }
    data.isActive = activa;
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  const seraDefault = data.isDefault === undefined ? actual.isDefault : Boolean(data.isDefault);
  const seraRule = (data.rule === undefined ? actual.rule : data.rule) as EduFeeRule;

  await prisma.$transaction(async (tx) => {
    await apagarMarcasDeOtras(tx, institutionId, id, { isDefault: seraDefault, rule: seraRule });
    await tx.eduFeeSchedule.update({ where: { id }, data });
  });
  return { id };
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · LA TABLA COMPARATIVA Y LA CAPTURA DE PRECIOS
// ═══════════════════════════════════════════════════════════════════════

/**
 * El tarifario completo: N listas × M procedimientos, con el precio de
 * cada celda o `null` si esa lista no cubre ese procedimiento.
 *
 * Se arma con DOS consultas y no con una por celda: 40 procedimientos × 4
 * listas serían 160 viajes a la base para pintar una tabla.
 */
export async function getEduTarifario(ctx: EduClinicaContext): Promise<EduTarifario> {
  const institutionId = requireInstitution(ctx);

  const [schedules, procedimientos, items] = await Promise.all([
    listEduFeeSchedules(ctx),
    prisma.eduProcedure.findMany({
      where: { institutionId },
      orderBy: [{ orderIndex: "asc" }, { code: "asc" }],
      take: EDU_MAX_PROCEDURES + 1,
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        durationMinutes: true,
        isActive: true,
        orderIndex: true,
        _count: { select: { feeItems: true } },
      },
    }),
    prisma.eduFeeScheduleItem.findMany({
      where: { institutionId },
      select: { feeScheduleId: true, procedureId: true, priceCents: true },
    }),
  ]);

  const truncated = procedimientos.length > EDU_MAX_PROCEDURES;
  const visibles = procedimientos.slice(0, EDU_MAX_PROCEDURES);

  const porProcedimiento = new Map<string, Map<string, number>>();
  for (const it of items) {
    let m = porProcedimiento.get(it.procedureId);
    if (!m) {
      m = new Map();
      porProcedimiento.set(it.procedureId, m);
    }
    m.set(it.feeScheduleId, it.priceCents);
  }

  const rows: EduTarifaRow[] = visibles.map((p) => {
    const precios = porProcedimiento.get(p.id);
    return {
      procedure: {
        id: p.id,
        code: p.code,
        name: p.name,
        category: p.category,
        durationMinutes: p.durationMinutes,
        isActive: p.isActive,
        orderIndex: p.orderIndex,
        pricedIn: p._count.feeItems,
      },
      cells: schedules.map((s) => ({
        feeScheduleId: s.id,
        priceCents: precios?.get(s.id) ?? null,
      })),
    };
  });

  return { schedules, rows, truncated };
}

export interface EduPrecioInput {
  feeScheduleId?: unknown;
  /** null o "" BORRA el precio de esa lista (la lista deja de cubrirlo). */
  priceCents?: unknown;
}

/**
 * Captura los precios de UN procedimiento en TODAS las listas de golpe.
 *
 * Se guarda en una transacción: si se escribieran uno por uno, un fallo a
 * la mitad dejaría la mitad del tarifario nuevo y la mitad del viejo, que
 * es la peor forma posible de tener precios.
 *
 * 🔴 Esto NO reescribe cobros ya emitidos. El precio de un cobro vive
 * congelado en su línea (`EduChargeItem.unitPriceCents`); esta tabla solo
 * decide lo que costará el PRÓXIMO.
 */
export async function setEduProcedurePrices(
  ctx: EduClinicaContext,
  procedureId: string,
  precios: EduPrecioInput[],
): Promise<{ id: string; escritos: number; borrados: number }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(procedureId);
  if (!id) throw new EduPadronError("Ese procedimiento no es válido.", 400);
  if (!Array.isArray(precios)) throw new EduPadronError("No mandaste precios.");

  const procedimiento = await prisma.eduProcedure.findFirst({
    where: { id, institutionId },
    select: { id: true },
  });
  if (!procedimiento) throw new EduPadronError("Ese procedimiento no es de este instituto.", 404);

  const listas = await prisma.eduFeeSchedule.findMany({
    where: { institutionId },
    select: { id: true },
  });
  const validas = new Set(listas.map((l) => l.id));

  const aEscribir: { feeScheduleId: string; priceCents: number }[] = [];
  const aBorrar: string[] = [];

  for (const p of precios) {
    const feeScheduleId = eduCleanId(p?.feeScheduleId);
    if (!feeScheduleId || !validas.has(feeScheduleId)) {
      throw new EduPadronError("Esa lista de precios no es de este instituto.", 404);
    }
    if (p?.priceCents === null || p?.priceCents === undefined || p?.priceCents === "") {
      aBorrar.push(feeScheduleId);
      continue;
    }
    const cents = parseEduMoneyCentsMax(p.priceCents, EDU_MAX_PRICE_CENTS);
    if (cents === null) {
      throw new EduPadronError("Ese precio no es una cantidad válida (máximo $100,000.00).");
    }
    aEscribir.push({ feeScheduleId, priceCents: cents });
  }

  await prisma.$transaction(async (tx) => {
    if (aBorrar.length > 0) {
      await tx.eduFeeScheduleItem.deleteMany({
        where: { institutionId, procedureId: id, feeScheduleId: { in: aBorrar } },
      });
    }
    for (const it of aEscribir) {
      // upsert por el índice único COMPLETO (feeScheduleId, procedureId).
      // Uno parcial no lo infiere el ON CONFLICT que emite Prisma.
      await tx.eduFeeScheduleItem.upsert({
        where: {
          feeScheduleId_procedureId: { feeScheduleId: it.feeScheduleId, procedureId: id },
        },
        create: {
          institutionId,
          feeScheduleId: it.feeScheduleId,
          procedureId: id,
          priceCents: it.priceCents,
        },
        update: { priceCents: it.priceCents },
      });
    }
  });

  return { id, escritos: aEscribir.length, borrados: aBorrar.length };
}

/** Procedimientos activos para un `<select>`, sin precio (lo pone el server). */
export async function listEduProcedureOptions(
  ctx: EduClinicaContext,
): Promise<{ id: string; code: string; name: string; category: string | null }[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduProcedure.findMany({
    where: { institutionId, isActive: true },
    orderBy: [{ orderIndex: "asc" }, { code: "asc" }],
    take: EDU_CAJA_MAX_ROWS,
    select: { id: true, code: true, name: true, category: true },
  });
  return rows;
}
