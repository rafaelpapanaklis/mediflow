// ws1-t11 (11d) — la marca «Paciente de prueba / no contactar» en la base.
//
// La columna `patients."isTestPatient"` (sql/ws1-t11-paciente-de-prueba.sql) NO
// se declara en prisma/schema.prisma a propósito: `prisma.patient.findMany()`
// sin `select` lo hacen decenas de rutas, y con la columna declarada y el SQL
// sin pegar TODAS tirarían P2022. Va por SQL crudo con su sonda, igual que
// `whatsapp/bot/precios-bot.ts`.
//
// Sin la columna: nadie es de prueba, nada se bloquea, la casilla de la ficha
// sale deshabilitada con «todavía no está activo». Cero errores en los logs de
// Postgres: la sonda pregunta a information_schema, que nunca falla.
//
// Sin "server-only" a propósito: lo importan send-and-log y la cola, que las
// pruebas cargan con tsx/node:test (mismo criterio que crear-desde-cita.server.ts).

import { prisma } from "@/lib/prisma";
import { MOTIVO_NO_CONTACTAR, correoNormalizado, debeBloquearse, ultimos10 } from "./paciente-de-prueba";

// ── ¿Ya se pegó el SQL? ─────────────────────────────────────────────────────
// La respuesta vive en globalThis (`next dev` recarga módulos y una variable
// del módulo se perdería). «Sí» se recuerda para siempre; «no», 10 minutos o
// hasta que alguien intente marcar a un paciente (`forzar`).
const RECORDAR_AUSENCIA_MS = 10 * 60 * 1000;
const CLAVE = Symbol.for("dalecontrol.pacienteDePrueba.columna");
type Sonda = { existe: boolean; at: number };
const memoria = globalThis as unknown as Record<symbol, Sonda | undefined>;

export async function columnaDePruebaExiste(forzar = false): Promise<boolean> {
  const s = memoria[CLAVE];
  if (!forzar && s && (s.existe || Date.now() - s.at < RECORDAR_AUSENCIA_MS)) return s.existe;
  try {
    const filas = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'patients'
         AND column_name = 'isTestPatient'`;
    const existe = Number(filas?.[0]?.n ?? 0) === 1;
    memoria[CLAVE] = { existe, at: Date.now() };
    return existe;
  } catch (e) {
    // Sin poder preguntar (una prueba con un Prisma a medias, un corte): se
    // trata como «todavía no» y se vuelve a preguntar en 10 minutos.
    memoria[CLAVE] = { existe: false, at: Date.now() };
    if (process.env.NODE_ENV !== "test") console.warn("[paciente-de-prueba] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** Solo para pruebas. */
export function _olvidarSondaDePrueba(): void {
  memoria[CLAVE] = undefined;
}

/** ¿Este paciente (de esta clínica) está marcado? Nunca lanza: ante la duda, no. */
export async function esPacienteDePrueba(clinicId: string | null | undefined, patientId: string | null | undefined): Promise<boolean> {
  // Regla dura (c): sin clínica o sin paciente no se consulta.
  if (!clinicId || !patientId) return false;
  if (!(await columnaDePruebaExiste())) return false;
  try {
    const filas = await prisma.$queryRaw<{ v: boolean | null }[]>`
      SELECT "isTestPatient" AS v FROM "patients"
       WHERE "id" = ${patientId} AND "clinicId" = ${clinicId} LIMIT 1`;
    return filas[0]?.v === true;
  } catch (e) {
    console.error("[paciente-de-prueba] no se pudo leer la marca:", e);
    return false;
  }
}

/**
 * Ids de los pacientes de prueba de la clínica, para sacarlos de una métrica.
 * Lista vacía si no hay ninguno, si la columna aún no existe o si falla: la
 * métrica queda como antes, nunca rota.
 */
export async function idsDePacientesDePrueba(clinicId: string | null | undefined): Promise<string[]> {
  if (!clinicId) return [];
  if (!(await columnaDePruebaExiste())) return [];
  try {
    const filas = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "patients"
       WHERE "clinicId" = ${clinicId} AND "isTestPatient" = true
       LIMIT 500`;
    return filas.map((f) => f.id);
  } catch (e) {
    console.error("[paciente-de-prueba] no se pudieron leer los pacientes de prueba:", e);
    return [];
  }
}

/** De estos pacientes, cuáles están marcados (para pintar la etiqueta en una lista). */
export async function marcadosDePrueba(clinicId: string | null | undefined, patientIds: readonly string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(patientIds.filter(Boolean)));
  if (!clinicId || ids.length === 0) return new Set();
  if (!(await columnaDePruebaExiste())) return new Set();
  try {
    const filas = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "patients"
       WHERE "clinicId" = ${clinicId} AND "isTestPatient" = true AND "id" = ANY(${ids}::text[])`;
    return new Set(filas.map((f) => f.id));
  } catch (e) {
    console.error("[paciente-de-prueba] no se pudieron leer las marcas:", e);
    return new Set();
  }
}

/**
 * EL freno. Devuelve el motivo si NO se debe contactar, o null si se puede.
 *
 * - Con `patientId`: manda la marca de ese paciente (ver `debeBloquearse`).
 * - Sin él: basta con que un paciente de la clínica con ese teléfono (últimos
 *   10 dígitos) o ese correo esté marcado.
 *
 * Nunca lanza. Si la base falla, deja pasar (y lo deja en el log): un tropiezo
 * de la consulta no puede callar los recordatorios de TODAS las clínicas.
 */
export async function motivoParaNoContactar(args: {
  clinicId: string | null | undefined;
  patientId?: string | null;
  telefono?: string | null;
  correo?: string | null;
}): Promise<string | null> {
  if (!args.clinicId) return null;
  if (!(await columnaDePruebaExiste())) return null;
  try {
    let delPaciente: boolean | null = null;
    if (args.patientId) {
      const filas = await prisma.$queryRaw<{ v: boolean | null }[]>`
        SELECT "isTestPatient" AS v FROM "patients"
         WHERE "id" = ${args.patientId} AND "clinicId" = ${args.clinicId} LIMIT 1`;
      // Un id que no es de esta clínica no cuenta como «identificado».
      if (filas.length) delPaciente = filas[0]?.v === true;
    }
    if (delPaciente !== null) return debeBloquearse({ delPaciente, delDestino: [] }) ? MOTIVO_NO_CONTACTAR : null;

    const tel = ultimos10(args.telefono);
    const correo = correoNormalizado(args.correo);
    if (tel.length !== 10 && !correo) return null;
    const filas = await prisma.$queryRaw<{ v: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM "patients"
         WHERE "clinicId" = ${args.clinicId}
           AND "isTestPatient" = true
           AND "deletedAt" IS NULL
           AND (
             (${tel.length === 10} AND "phone" IS NOT NULL
               AND right(regexp_replace("phone", '[^0-9]', '', 'g'), 10) = ${tel})
             OR (${correo !== ""} AND "email" IS NOT NULL AND lower(trim("email")) = ${correo})
           )
      ) AS v`;
    return debeBloquearse({ delPaciente: null, delDestino: [filas[0]?.v === true] }) ? MOTIVO_NO_CONTACTAR : null;
  } catch (e) {
    console.error("[paciente-de-prueba] no se pudo decidir si contactar (se deja pasar):", e);
    return null;
  }
}

/** Escribe la marca. Tenant en el WHERE. `columna_faltante` si el SQL no está pegado. */
export async function guardarMarcaDePrueba(
  clinicId: string,
  patientId: string,
  valor: boolean,
): Promise<
  // Los dos campos en las dos formas: con `strict: false`, TS no estrecha la unión por `ok`.
  | { ok: true; antes: boolean; error?: undefined }
  | { ok: false; error: "columna_faltante" | "no_encontrado"; antes?: undefined }
> {
  if (!(await columnaDePruebaExiste(true))) return { ok: false, error: "columna_faltante" };
  const antes = await prisma.$queryRaw<{ v: boolean | null }[]>`
    SELECT "isTestPatient" AS v FROM "patients"
     WHERE "id" = ${patientId} AND "clinicId" = ${clinicId} LIMIT 1`;
  if (!antes.length) return { ok: false, error: "no_encontrado" };
  await prisma.$executeRaw`
    UPDATE "patients" SET "isTestPatient" = ${valor}
     WHERE "id" = ${patientId} AND "clinicId" = ${clinicId}`;
  return { ok: true, antes: antes[0]?.v === true };
}
