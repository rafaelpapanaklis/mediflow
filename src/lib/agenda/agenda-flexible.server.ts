/**
 * AGENDA FLEXIBLE (WS1-T5 · grupo Salamanca) — leer y guardar la bandera y el
 * modo de color. Lo puro vive en `agenda-flexible.ts`.
 *
 * ⚠️ SIN `import "server-only"`, como `horario-doctor/consulta.server.ts`, que
 * lo importa: lo cargan módulos cuya mitad pura se prueba con `tsx --test`.
 *
 * 🔴 APAGADA POR DEFECTO Y FALLA CERRADO. Sin tabla, sin fila, con error o sin
 * clínica → apagada: la agenda de siempre. Al revés que el rediseño
 * (`menu-dos-niveles/interruptor.ts`), que nace encendido.
 *
 * 🔴 SIN ERRORES EN LOS LOGS DE POSTGRES. Se pregunta si la tabla existe con
 * `to_regclass` (nunca falla) y la respuesta vive en `globalThis`, que
 * sobrevive a las recargas de `next dev`. La respuesta de cada clínica vive
 * 60 s: la lee el bot en cada mensaje y la rejilla en cada vista.
 */
import { prisma } from "@/lib/prisma";
import {
  AGENDA_FLEXIBLE_APAGADA,
  BANDERAS_AGENDA_FLEXIBLE,
  FLAG_COLOR_POR_PROCEDIMIENTO,
  ajustesDesdeFilas,
  type AjustesAgendaFlexible,
  type ModoColorCitas,
} from "./agenda-flexible";

/** La rendija de lectura (Sabina pasa la suya; las pruebas, un doble). */
export interface BanderasDb {
  clinicFeatureFlag?: { findMany(args: any): Promise<any[]> };
  $queryRaw?: (...args: any[]) => Promise<any>;
}

const TTL_CLINICA_MS = 60_000;
const TTL_FALLO_SIN_PREVIA_MS = 5_000;
const RECORDAR_SIN_TABLA_MS = 10 * 60_000;
const MAX_CLINICAS = 5000;

type Memoria = {
  tabla: { existe: boolean; at: number } | null;
  clinicas: Map<string, { valor: AjustesAgendaFlexible; hasta: number }>;
};
const CLAVE = Symbol.for("dalecontrol.agenda.flexible");
const global_ = globalThis as unknown as Record<symbol, Memoria | undefined>;
function memoria(): Memoria {
  let m = global_[CLAVE];
  if (!m) {
    m = { tabla: null, clinicas: new Map() };
    global_[CLAVE] = m;
  }
  return m;
}

/** Para las pruebas: olvida lo aprendido. */
export function _olvidarAgendaFlexible(): void {
  global_[CLAVE] = undefined;
}

async function tablaExiste(db: BanderasDb): Promise<boolean> {
  if (typeof db.$queryRaw !== "function") return false;
  const filas = (await db.$queryRaw`
    SELECT to_regclass('public.clinic_feature_flags') IS NOT NULL AS existe`) as { existe: boolean }[];
  return filas?.[0]?.existe === true;
}

async function leerDeLaBase(clinicId: string, db: BanderasDb): Promise<AjustesAgendaFlexible> {
  if (typeof db.clinicFeatureFlag?.findMany !== "function") return AGENDA_FLEXIBLE_APAGADA;
  const filas = await db.clinicFeatureFlag.findMany({
    where: { clinicId, flag: { in: [...BANDERAS_AGENDA_FLEXIBLE] } },
    select: { flag: true, enabled: true },
  });
  return ajustesDesdeFilas(filas);
}

/**
 * Los ajustes de la agenda flexible de ESTA clínica. `clinicId` sale SIEMPRE
 * de la sesión (o de la clínica que resolvió el bot/la web), nunca del cliente.
 *
 * Con `db` (Sabina, pruebas) no se guarda nada en memoria: cada llamada pregunta.
 */
export async function leerAgendaFlexible(
  clinicId: string | null | undefined,
  opciones: { db?: BanderasDb } = {},
): Promise<AjustesAgendaFlexible> {
  // Corta ANTES de consultar: un clinicId vacío no filtra nada en Prisma.
  if (typeof clinicId !== "string" || clinicId.trim() === "") return AGENDA_FLEXIBLE_APAGADA;

  if (opciones.db) {
    try {
      // Un doble sin `$queryRaw` dice «no hay tabla»; uno con el modelo y sin
      // `$queryRaw` se lee directo (las pruebas no siempre simulan to_regclass).
      if (typeof opciones.db.$queryRaw === "function" && !(await tablaExiste(opciones.db))) {
        return AGENDA_FLEXIBLE_APAGADA;
      }
      return await leerDeLaBase(clinicId, opciones.db);
    } catch {
      return AGENDA_FLEXIBLE_APAGADA;
    }
  }

  const m = memoria();
  const ahora = Date.now();
  const previa = m.clinicas.get(clinicId);
  if (previa && ahora < previa.hasta) return previa.valor;

  const db = prisma as unknown as BanderasDb;
  let valor: AjustesAgendaFlexible = AGENDA_FLEXIBLE_APAGADA;
  let ttl = TTL_CLINICA_MS;
  try {
    if (!m.tabla || (!m.tabla.existe && ahora - m.tabla.at >= RECORDAR_SIN_TABLA_MS)) {
      m.tabla = { existe: await tablaExiste(db), at: ahora };
    }
    valor = m.tabla.existe ? await leerDeLaBase(clinicId, db) : AGENDA_FLEXIBLE_APAGADA;
  } catch (err) {
    // Falla cerrado: lo último que se supo, o apagada.
    valor = previa?.valor ?? AGENDA_FLEXIBLE_APAGADA;
    // (revisión t8, A9) Sin respuesta previa, el «apagada» de un fallo NO se
    // recuerda 60 s (dejaría la comida abierta al bot y a la web): unos
    // segundos, y se vuelve a preguntar.
    if (!previa) ttl = TTL_FALLO_SIN_PREVIA_MS;
    console.warn("[agenda-flexible] no se pudo leer la bandera; se usa", valor, (err as { code?: string })?.code ?? err);
  }
  if (m.clinicas.size >= MAX_CLINICAS && !m.clinicas.has(clinicId)) {
    const vieja = m.clinicas.keys().next();
    if (!vieja.done) m.clinicas.delete(vieja.value);
  }
  m.clinicas.set(clinicId, { valor, hasta: ahora + ttl });
  return valor;
}

/** Atajo: ¿la bandera está encendida? */
export async function agendaFlexibleEncendida(
  clinicId: string | null | undefined,
  opciones: { db?: BanderasDb } = {},
): Promise<boolean> {
  return (await leerAgendaFlexible(clinicId, opciones)).encendida;
}

/** El ajuste no se pudo guardar porque falta la tabla (el SQL sin pegar). */
export class AgendaFlexibleSinTablaError extends Error {
  constructor() {
    super("clinic_feature_flags no existe");
    this.name = "AgendaFlexibleSinTablaError";
  }
}

/**
 * Guarda «Colorear las citas por». Upsert de la fila de la clínica: nunca se
 * borra, «Doctor» es `enabled = false`. Quien llama ya comprobó el permiso
 * (`settings.edit`) y que la bandera está encendida.
 */
export async function guardarModoColor(clinicId: string, modo: ModoColorCitas): Promise<void> {
  if (!clinicId) throw new Error("sin clínica");
  const m = memoria();
  if (!(await tablaExiste(prisma as unknown as BanderasDb))) throw new AgendaFlexibleSinTablaError();
  await prisma.clinicFeatureFlag.upsert({
    where: { clinicId_flag: { clinicId, flag: FLAG_COLOR_POR_PROCEDIMIENTO } },
    create: { clinicId, flag: FLAG_COLOR_POR_PROCEDIMIENTO, enabled: modo === "procedimiento" },
    update: { enabled: modo === "procedimiento" },
    select: { clinicId: true },
  });
  // Quien acaba de guardar lo ve ya; las demás instancias, en ≤60 s.
  m.clinicas.delete(clinicId);
}
