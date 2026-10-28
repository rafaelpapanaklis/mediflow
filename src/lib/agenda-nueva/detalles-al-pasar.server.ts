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
 * 🔗 Con t12 (feat/plan-por-cobrar): «En esta cita» y «Debe hoy» son su bloque del detalle de la cita, con sus
 * ayudantes `planDeLaCita` y `debeDelPaciente` (unión ws1-t9, m4 de la revisión t11). `planDeLaCita` no lee el
 * dinero cuando la cita no tiene filas del plan (`debeHoy: null`); la tarjeta pide «Debe hoy» SIEMPRE
 * (decisión 2 de t2), así que entonces se pregunta a `debeDelPaciente` aparte.
 */

import { prisma } from "@/lib/prisma";
import { debeDelPaciente } from "@/lib/dinero/lo-que-se-debe.server";
import { planDeLaCita } from "@/lib/treatments/plan-de-la-cita.server";
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
  const [anteriores, respuestas, plan] = await Promise.all([
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
    planDeLaCita(clinicId, cita.id).catch((e) => {
      console.warn(`[agenda:al-pasar] clínica ${clinicId}: no se leyó «En esta cita».`, e);
      return null;
    }),
  ]);
  // La tarjeta enseña 20 como mucho (el `LIMIT 20` que tenía su consulta propia); `planDeLaCita` las da todas.
  const enEstaCita: DetallesPesados["enEstaCita"] = (plan?.filas ?? []).slice(0, 20).map((f) => ({
    id: f.id,
    nombre: f.nombre,
    importe: f.importe,
    estado: f.estado,
  }));
  // Con filas, `planDeLaCita` ya trae «Debe hoy»; sin filas (o si falló) lo da null y se pide aparte.
  const debeHoy =
    plan?.debeHoy ??
    (await (cita.patientId ? debeDelPaciente(clinicId, cita.patientId) : Promise.resolve(0)).catch((e) => {
      console.warn(`[agenda:al-pasar] clínica ${clinicId}: no se calculó «Debe hoy».`, e);
      return 0;
    }));

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
