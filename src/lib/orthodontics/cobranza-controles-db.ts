// ═══════════════════════════════════════════════════════════════════════════
// CARGADOR de los «cargos de control» del modo PAGO_POR_CONTROL (ws1-t1,
// Ola 2) — el I/O que alimenta `cobranzaPorControles`/`cobranzaDelCasoUnificada`
// (cobranza-caso.ts, puro, sin tocar).
//
// Un cargo de control es una factura AUTOMÁTICA creada al firmar la hoja de
// un control (signTreatmentCard.ts) con el concepto «Control de ortodoncia»
// del catálogo — se distingue de cualquier otro «extra» del caso (retenedor,
// microimplante…) porque SOLO ella nace ligada a la cita de control
// (`invoices.appointmentId`, único por cita) Y al caso
// (`invoices.orthodonticTreatmentPlanId`, sql/ortodoncia-cobro.sql —
// exactamente la misma columna que ya usan los extras, extras-db.ts). Un
// extra normal (reposición de bracket, retenedor…) SIEMPRE nace con
// `appointmentId` nulo (se factura aparte, ver DrawerCobrarExtra), así que el
// filtro `appointmentId IS NOT NULL AND appointment.type = 'Control de
// ortodoncia'` no puede atrapar un extra por accidente.
//
// SQL crudo + sonda de columna, mismo patrón que extras-db.ts: sin
// sql/ortodoncia-modo-cobro.sql pegado, esto no tumba nada — devuelve un mapa
// vacío (el caso se ve «sin controles cobrados todavía», no rompe la pantalla).
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";
import type { CargoDeControl } from "./cobranza-caso";

let columna: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

async function columnaExiste(): Promise<boolean> {
  const t = Date.now();
  if (columna && (columna.existe || t - columna.at < TTL_MS)) return columna.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'invoices' AND column_name = 'orthodonticTreatmentPlanId'
      ) AS existe`;
    columna = { existe: filas[0]?.existe === true, at: t };
    return columna.existe;
  } catch (e) {
    console.warn("[ortodoncia:cargos-control] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** Solo para pruebas: olvida lo que se sabía de la columna. */
export function _olvidarColumnaCargosControl(): void {
  columna = null;
}

interface FilaCargo {
  planId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  total: unknown;
  paid: unknown;
  status: string;
  dueDate: Date | null;
  createdAt: Date;
  zona: string | null;
}

function aFechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** El día de calendario de un instante en la zona de la clínica: "YYYY-MM-DD". */
function diaEnZonaDeClinica(instante: Date, zona: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zona || "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instante);
  } catch {
    // Zona inválida guardada en la clínica: la de México, como el resto del panel.
    return diaEnZonaDeClinica(instante, "America/Mexico_City");
  }
}

/**
 * Cuándo vence un cargo de control: su `dueDate` o, si no tiene (nace sin
 * ella al firmar la hoja), el día en que se creó. UNA sola regla, exportada
 * para que Caja y Finanzas digan «vencido» con el mismo criterio que Cobranza
 * de ortodoncia (fila 87 de la revisión de lógica de uso).
 *
 * El día de creación se toma en la zona de la clínica (Caja compara contra el
 * «hoy» de la clínica): un control firmado a las 18:30 del 28 en México vence
 * el 28, no el 29 de UTC. `dueDate` ya es una fecha de calendario y se lee tal cual.
 */
export function vencimientoDeCargoDeControl(
  dueDate: Date | null,
  createdAt: Date,
  zonaClinica?: string | null,
): string {
  return dueDate ? aFechaISO(dueDate) : diaEnZonaDeClinica(createdAt, zonaClinica);
}

/**
 * Los cargos de control (facturas de citas «Control de ortodoncia», ya
 * ligadas a su caso) de varios casos a la vez — UNA sola consulta, sin
 * importar cuántos casos traigas. Solo tiene sentido para casos en modo
 * PAGO_POR_CONTROL; llamarla con casos en modo PRECIO_TOTAL no rompe nada,
 * solo trae un mapa vacío para ellos (no deberían tener facturas así).
 */
export async function cargarCargosDeControlPorCasos(
  clinicId: string,
  treatmentPlanIds: string[],
): Promise<Map<string, CargoDeControl[]>> {
  const salida = new Map<string, CargoDeControl[]>();
  if (!clinicId || treatmentPlanIds.length === 0) return salida;
  if (!(await columnaExiste())) return salida;

  try {
    const filas = await prisma.$queryRaw<FilaCargo[]>`
      SELECT i."orthodonticTreatmentPlanId" AS "planId", i."id" AS "invoiceId",
             i."invoiceNumber", i."total", i."paid", i."status", i."dueDate", i."createdAt",
             c."timezone" AS "zona"
        FROM "invoices" i
        LEFT JOIN "appointments" a ON a."id" = i."appointmentId"
        JOIN "clinics" c ON c."id" = i."clinicId"
       WHERE i."clinicId" = ${clinicId}
         AND i."orthodonticTreatmentPlanId" IN (${Prisma.join(treatmentPlanIds)})
         AND ((i."appointmentId" IS NOT NULL AND a."type" = ${TIPO_CITA_CONTROL_ORTO})
              OR i."notes" LIKE '[control-hoja:%')
         AND i."status" NOT IN ('DRAFT', 'CANCELLED')`;

    for (const f of filas) {
      const cargo: CargoDeControl = {
        invoiceId: f.invoiceId,
        invoiceNumber: f.invoiceNumber,
        total: Number(f.total) || 0,
        pagado: Number(f.paid) || 0,
        status: f.status,
        vencimiento: vencimientoDeCargoDeControl(f.dueDate, f.createdAt, f.zona),
      };
      const lista = salida.get(f.planId);
      if (lista) lista.push(cargo);
      else salida.set(f.planId, [cargo]);
    }
    return salida;
  } catch (e) {
    console.warn("[ortodoncia:cargos-control] no se pudieron leer:", e);
    return salida;
  }
}

/** Mismo cargador, para UN solo caso. */
export async function cargarCargosDeControlDelCaso(
  clinicId: string,
  treatmentPlanId: string,
): Promise<CargoDeControl[]> {
  const mapa = await cargarCargosDeControlPorCasos(clinicId, [treatmentPlanId]);
  return mapa.get(treatmentPlanId) ?? [];
}

/**
 * Los cargos de control POR COBRAR de toda la clínica (de cualquier caso), con
 * su vencimiento: `invoiceId` → "YYYY-MM-DD". Lo usa el «Vencido» de Caja y
 * Finanzas (`computeReceivables`, src/lib/caja.ts) para que un control sin
 * pagar cuente como vencido desde el mismo día que en Cobranza de ortodoncia.
 * Sin la columna, o si la consulta falla, mapa vacío: Caja se queda con su
 * criterio de siempre (`dueDate`).
 */
export async function cargarVencimientosDeCargosDeControl(clinicId: string): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  if (!clinicId) return salida;
  if (!(await columnaExiste())) return salida;
  try {
    const filas = await prisma.$queryRaw<{ invoiceId: string; dueDate: Date | null; createdAt: Date; zona: string | null }[]>`
      SELECT i."id" AS "invoiceId", i."dueDate", i."createdAt", c."timezone" AS "zona"
        FROM "invoices" i
        LEFT JOIN "appointments" a ON a."id" = i."appointmentId"
        JOIN "clinics" c ON c."id" = i."clinicId"
       WHERE i."clinicId" = ${clinicId}
         AND i."orthodonticTreatmentPlanId" IS NOT NULL
         AND ((i."appointmentId" IS NOT NULL AND a."type" = ${TIPO_CITA_CONTROL_ORTO})
              OR i."notes" LIKE '[control-hoja:%')
         AND i."balance" > 0
         AND i."status" NOT IN ('DRAFT', 'CANCELLED')`;
    for (const f of filas) salida.set(f.invoiceId, vencimientoDeCargoDeControl(f.dueDate, f.createdAt, f.zona));
    return salida;
  } catch (e) {
    console.warn("[ortodoncia:cargos-control] no se pudieron leer los vencimientos:", e);
    return new Map();
  }
}
