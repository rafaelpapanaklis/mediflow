import "server-only";

/**
 * La tarjeta de detalles al pasar el mouse (decisión de Rafael, 28-oct-2026) — lo que toca la base.
 *
 *  1. `detallesDeCitaAlPasar`: lo PESADO de una cita (alergias, «En esta cita», «Debe hoy», teléfono, edad,
 *     primera vez, confirmada por WhatsApp). Lo pide la ruta GET `/api/appointments/[id]/detalles-al-pasar`
 *     cuando el mouse se queda sobre la cita. Toda consulta lleva el `clinicId` de la sesión; la ruta ya
 *     comprobó que la cita es de esa clínica y que quien mira puede ver al paciente.
 *  2. La preferencia POR USUARIO «Mostrar detalles al pasar el mouse»: columna
 *     `users."agendaDetallesAlPasar"` (sql/agenda-detalles-al-pasar.sql), por SQL crudo y SIN tocar el modelo
 *     de Prisma. Sin la columna, encendida para todos y el interruptor no guarda (la ruta contesta 503).
 *
 * 🔗 Con t12 (feat/plan-por-cobrar): «En esta cita» y «Debe hoy» son lo mismo que su bloque del detalle de la
 * cita. Mientras su ayudante no esté en la base común, aquí van dos con nombre propio
 * (`procedimientosEnEstaCitaAlPasar`, `debeHoyDelPacienteAlPasar`) que hacen la MISMA consulta y la MISMA
 * cuenta (saldo por cobrar − `loQueAunNoSeDebe`, la cifra de Pacientes). Al unir las ramas se sustituyen por
 * `planDeLaCita` / `debeDelPaciente` sin cambiar lo que se ve.
 */

import { prisma } from "@/lib/prisma";
import { receivableInvoiceWhere } from "@/lib/caja";
import { loQueAunNoSeDebe } from "@/lib/dinero/lo-que-se-debe.server";
import { aCentavos, aPesos, ESTADOS_DE_FILA, type EstadoDeFila } from "@/lib/treatments/items";
import { tablaDeFilasExiste } from "@/lib/treatments/items-db";
import { citasDelPlanDisponible } from "@/lib/treatments/citas-del-plan-db";
import { confirmoPorWhatsapp, edadEnAnios, type DetallesPesados } from "./detalles-al-pasar";

/** Los estados que NO cuentan como «ya vino antes» para decir «Primera vez» / «Recurrente». */
const NO_CUENTAN_COMO_VISITA = ["CANCELLED", "NO_SHOW"] as const;

/**
 * Lo pesado de la cita `appointmentId`. Cada pieza es tolerante: si una falla, esa pieza sale vacía y las
 * demás se pintan. `null` si la cita no es de la clínica.
 */
export async function detallesDeCitaAlPasar(
  clinicId: string,
  appointmentId: string,
  opciones: { timezone: string; ahora?: Date },
): Promise<DetallesPesados | null> {
  if (!clinicId) throw new Error("agenda:al-pasar: clinicId ausente — se corta antes de consultar");
  if (!appointmentId) return null;
  const ahora = opciones.ahora ?? new Date();
  const cita = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId },
    select: {
      id: true,
      patientId: true,
      startsAt: true,
      confirmedAt: true,
      patient: { select: { dob: true, phone: true, allergies: true } },
    },
  });
  if (!cita) return null;

  // Tres tandas pequeñas (< 7 consultas por Promise.all: el pooler).
  const [anteriores, respuestas, enEstaCita] = await Promise.all([
    prisma.appointment
      .count({
        where: {
          clinicId,
          patientId: cita.patientId,
          id: { not: cita.id },
          startsAt: { lt: cita.startsAt },
          status: { notIn: [...NO_CUENTAN_COMO_VISITA] },
        },
      })
      .catch((e) => {
        console.warn(`[agenda:al-pasar] clínica ${clinicId}: no se contaron las citas anteriores.`, e);
        return null;
      }),
    cita.confirmedAt
      ? prisma.whatsAppReminder
          .findMany({
            where: { clinicId, appointmentId: cita.id, repliedAt: { not: null } },
            select: { repliedAt: true },
            take: 10,
          })
          .catch(() => [] as Array<{ repliedAt: Date | null }>)
      : Promise.resolve([] as Array<{ repliedAt: Date | null }>),
    procedimientosEnEstaCitaAlPasar(clinicId, cita.id).catch((e) => {
      console.warn(`[agenda:al-pasar] clínica ${clinicId}: no se leyó «En esta cita».`, e);
      return [];
    }),
  ]);
  const debeHoy = await debeHoyDelPacienteAlPasar(clinicId, cita.patientId).catch((e) => {
    console.warn(`[agenda:al-pasar] clínica ${clinicId}: no se calculó «Debe hoy».`, e);
    return 0;
  });

  return {
    paciente: {
      edad: edadEnAnios(cita.patient?.dob ?? null, ahora, opciones.timezone),
      // Sin poder contar, no se afirma nada: «Recurrente» es lo prudente (no dispara trato de primera vez).
      primeraVez: anteriores === 0,
      telefono: cita.patient?.phone?.trim() || null,
    },
    alergias: (cita.patient?.allergies ?? []).map((a) => a.trim()).filter(Boolean),
    confirmadaPorWhatsapp: confirmoPorWhatsapp(cita.confirmedAt, respuestas),
    enEstaCita,
    debeHoy,
  };
}

/**
 * «Debe hoy» del paciente: saldo de sus facturas por cobrar − lo que aún no se debe (`loQueAunNoSeDebe`),
 * la cifra de Pacientes (`/api/patients`) y del «Debe» de la ficha. No es una fórmula nueva: son las mismas
 * dos piezas. 🔗 Es el `debeDelPaciente` de t12; al unir las ramas, se usa ése.
 */
export async function debeHoyDelPacienteAlPasar(clinicId: string, patientId: string | null): Promise<number> {
  if (!clinicId) throw new Error("dinero: clinicId ausente — se corta antes de consultar");
  if (!patientId) return 0;
  const facturas = await prisma.invoice.findMany({
    where: { ...receivableInvoiceWhere(clinicId), patientId },
    select: { id: true, balance: true },
    take: 500,
  });
  if (facturas.length === 0) return 0;
  const r = await loQueAunNoSeDebe(clinicId, { ids: facturas.map((f) => f.id) });
  const saldo = facturas.reduce((s, f) => s + Math.round((Number(f.balance) || 0) * 100), 0) / 100;
  return Math.max(0, Math.round((saldo - r.total) * 100) / 100);
}

interface FilaSql {
  id: string;
  nombre: string;
  dientes: number[] | null;
  caras: string[] | null;
  cantidad: number;
  precio: unknown;
  estado: string;
}

/**
 * «En esta cita: resina $700»: los procedimientos del plan agendados para esta cita (`citaAgendadaId`) y/o
 * hechos en ella (`citaId`), sin los cancelados. Sin la tabla de filas, nada. 🔗 Es el `planDeLaCita` de t12.
 */
export async function procedimientosEnEstaCitaAlPasar(
  clinicId: string,
  appointmentId: string,
): Promise<DetallesPesados["enEstaCita"]> {
  if (!clinicId) throw new Error("plan:cita: clinicId ausente — se corta antes de consultar");
  if (!appointmentId || !(await tablaDeFilasExiste())) return [];
  const conAgendadas = await citasDelPlanDisponible();
  const filas = conAgendadas
    ? await prisma.$queryRaw<FilaSql[]>`
        SELECT t."id", t."nombre", t."dientes", t."caras", t."cantidad", t."precio", t."estado"
          FROM "treatment_plan_items" t
          JOIN "treatment_plans" p ON p."id" = t."planId" AND p."clinicId" = t."clinicId"
         WHERE t."clinicId" = ${clinicId} AND t."estado" <> 'cancelado'
           AND (t."citaId" = ${appointmentId} OR t."citaAgendadaId" = ${appointmentId})
         ORDER BY p."createdAt", t."orden", t."createdAt", t."id"
         LIMIT 20`
    : await prisma.$queryRaw<FilaSql[]>`
        SELECT t."id", t."nombre", t."dientes", t."caras", t."cantidad", t."precio", t."estado"
          FROM "treatment_plan_items" t
          JOIN "treatment_plans" p ON p."id" = t."planId" AND p."clinicId" = t."clinicId"
         WHERE t."clinicId" = ${clinicId} AND t."estado" <> 'cancelado' AND t."citaId" = ${appointmentId}
         ORDER BY p."createdAt", t."orden", t."createdAt", t."id"
         LIMIT 20`;
  return filas.map((r) => {
    const dientes = (r.dientes ?? []).map(Number);
    const caras = (r.caras ?? []).map(String);
    const centavos = aCentavos(String(r.precio ?? "0"));
    const estado = (ESTADOS_DE_FILA as readonly string[]).includes(r.estado) ? (r.estado as EstadoDeFila) : "pendiente";
    return {
      id: r.id,
      nombre: `${r.nombre}${dientes.length ? ` ${dientes.join(", ")}` : ""}${caras.length ? ` (${caras.join("")})` : ""}`,
      importe: aPesos((Number(r.cantidad) || 1) * (Number.isFinite(centavos) ? centavos : 0)),
      estado,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// La preferencia por usuario
// ═══════════════════════════════════════════════════════════════════════

/** Sin columna (o sin fila), la tarjeta sale: «encendida por defecto». */
export const DETALLES_AL_PASAR_POR_DEFECTO = true;

const REPREGUNTAR_MS = 10 * 60_000;
const CLAVE = Symbol.for("dalecontrol.agenda-nueva.detalles-al-pasar");
type Sonda = { existe: boolean; en: number };

function memoria(): { columna?: Sonda } {
  const g = globalThis as unknown as Record<symbol, { columna?: Sonda } | undefined>;
  if (!g[CLAVE]) g[CLAVE] = {};
  return g[CLAVE]!;
}

/** Solo para las pruebas. */
export function _olvidarSondaDetallesAlPasar(): void {
  delete memoria().columna;
}

/**
 * ¿Existe `users."agendaDetallesAlPasar"`? Se pregunta a `information_schema` (nunca falla) y se recuerda en
 * `globalThis`: mientras no se pegue el SQL, ni una consulta a la columna (los logs de Postgres de producción).
 */
export async function columnaDetallesAlPasarExiste(forzar = false): Promise<boolean> {
  const m = memoria();
  if (m.columna?.existe) return true;
  if (m.columna && !forzar && Date.now() - m.columna.en < REPREGUNTAR_MS) return false;
  try {
    const r = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'agendaDetallesAlPasar'
      ) AS existe`;
    const existe = r[0]?.existe === true;
    m.columna = { existe, en: Date.now() };
    return existe;
  } catch (e) {
    console.warn("[agenda:al-pasar] no se pudo saber si existe la columna:", e);
    return false;
  }
}

/** La preferencia de ESTE usuario en ESTA clínica. Sin columna, sin fila o con error: encendida. */
export async function leerDetallesAlPasar(clinicId: string, userId: string): Promise<boolean> {
  if (!clinicId || !userId) return DETALLES_AL_PASAR_POR_DEFECTO;
  if (!(await columnaDetallesAlPasarExiste())) return DETALLES_AL_PASAR_POR_DEFECTO;
  try {
    const r = await prisma.$queryRaw<{ valor: boolean | null }[]>`
      SELECT "agendaDetallesAlPasar" AS valor FROM "users" WHERE "id" = ${userId} AND "clinicId" = ${clinicId}`;
    const v = r[0]?.valor;
    return typeof v === "boolean" ? v : DETALLES_AL_PASAR_POR_DEFECTO;
  } catch (e) {
    console.warn("[agenda:al-pasar] no se leyó la preferencia:", e);
    return DETALLES_AL_PASAR_POR_DEFECTO;
  }
}

export class DetallesAlPasarSinColumnaError extends Error {
  constructor() {
    super("Falta sql/agenda-detalles-al-pasar.sql: la preferencia no se puede guardar todavía.");
  }
}

/**
 * Guarda la preferencia de ESTA persona. Una persona tiene una fila `User` por clínica (mismo `supabaseId`,
 * como `mustChangePassword`): se guarda en todas sus filas, para que la preferencia sea de su cuenta y no de
 * la sede en la que estaba (decisión de Rafael, m6 de la revisión). Se parte de SU fila (`id` + `clinicId` de
 * la sesión); nunca toca a otra persona. Su propia fila va siempre, aunque no tenga `supabaseId` (con
 * `supabaseId` nulo la subconsulta no casaba con nada y no se guardaba ni la suya).
 *
 * Devuelve cuántas filas tocó: 0 = no se guardó (la ruta lo dice y la pantalla avisa).
 */
export async function guardarDetallesAlPasar(clinicId: string, userId: string, encendida: boolean): Promise<number> {
  if (!clinicId || !userId) throw new Error("agenda:al-pasar: sesión incompleta — se corta antes de escribir");
  if (!(await columnaDetallesAlPasarExiste(true))) throw new DetallesAlPasarSinColumnaError();
  const filas = await prisma.$executeRaw`
    UPDATE "users" SET "agendaDetallesAlPasar" = ${encendida}
     WHERE ("id" = ${userId} AND "clinicId" = ${clinicId})
        OR "supabaseId" = (SELECT "supabaseId" FROM "users"
                            WHERE "id" = ${userId} AND "clinicId" = ${clinicId} AND "supabaseId" IS NOT NULL)`;
  return Number(filas) || 0;
}
