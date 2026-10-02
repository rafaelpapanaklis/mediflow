import "server-only";
import { prisma } from "@/lib/prisma";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { leerTecnicasDeLaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { tecnicasActivas } from "@/lib/orthodontics/tecnicas-de-la-clinica";
import { bloquePreciosDelBot } from "./precios-core";
import { AGENDA_SENTINEL, HANDOFF_SENTINEL } from "./ai-prompt";

// ws1-t3 (2-oct-2026) — los dos interruptores de precios del bot y el bloque
// que entra en la parte fija del prompt. Las reglas viven en precios-core.ts.
//
// Las dos columnas (sql/ws1-t3-bot-precios.sql) NO se declaran en
// schema.prisma a propósito: `whatsappBotConfig.findUnique` sin `select` lo
// hacen el motor, el webhook y la API de configuración, y con la columna
// declarada y el SQL sin pegar TODAS esas lecturas tirarían P2022 (el bot
// entero se callaría). Van por SQL crudo con su sonda, igual que
// `techniqueList` (orthodontics/tecnicas-de-la-clinica-db.ts).
//
// Sin las columnas = los dos interruptores APAGADOS, sin errores ni 500.

export interface InterruptoresDePrecios {
  canQuoteProcedurePrices: boolean;
  canQuoteOrthoPrices: boolean;
}

export const PRECIOS_APAGADOS: InterruptoresDePrecios = Object.freeze({
  canQuoteProcedurePrices: false,
  canQuoteOrthoPrices: false,
});

// ── ¿Ya se pegó el SQL? ─────────────────────────────────────────────────────
// Se pregunta a information_schema (nunca falla, no deja errores en los logs
// de Postgres) y la respuesta vive en globalThis: `next dev` recarga módulos y
// una variable del módulo se perdería en cada recarga. «Sí» se recuerda para
// siempre; «no», 10 minutos (o hasta que alguien intente encenderlo).
const RECORDAR_AUSENCIA_MS = 10 * 60 * 1000;
const CLAVE = Symbol.for("dalecontrol.bot.preciosColumnas");
type Sonda = { existe: boolean; at: number };
const memoria = globalThis as unknown as Record<symbol, Sonda | undefined>;

export async function columnasDePreciosExisten(forzar = false): Promise<boolean> {
  const s = memoria[CLAVE];
  if (!forzar && s && (s.existe || Date.now() - s.at < RECORDAR_AUSENCIA_MS)) return s.existe;
  try {
    const filas = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'whatsapp_bot_configs'
         AND column_name IN ('canQuoteProcedurePrices', 'canQuoteOrthoPrices')`;
    const existe = Number(filas[0]?.n ?? 0) === 2;
    memoria[CLAVE] = { existe, at: Date.now() };
    return existe;
  } catch (e) {
    console.warn("[bot/precios] no se pudo comprobar las columnas:", e);
    return false;
  }
}

/** Solo para pruebas. */
export function _olvidarSondaDePrecios(): void {
  memoria[CLAVE] = undefined;
}

/** Los interruptores de ESTA clínica. Nunca lanza: ante cualquier duda, apagados. */
export async function leerInterruptoresDePrecios(clinicId: string | null | undefined): Promise<InterruptoresDePrecios> {
  // Regla dura (c): sin clínica no se consulta.
  if (!clinicId) return { ...PRECIOS_APAGADOS };
  if (!(await columnasDePreciosExisten())) return { ...PRECIOS_APAGADOS };
  try {
    const filas = await prisma.$queryRaw<{ canQuoteProcedurePrices: boolean | null; canQuoteOrthoPrices: boolean | null }[]>`
      SELECT "canQuoteProcedurePrices", "canQuoteOrthoPrices"
        FROM "whatsapp_bot_configs" WHERE "clinicId" = ${clinicId} LIMIT 1`;
    const f = filas[0];
    return {
      canQuoteProcedurePrices: f?.canQuoteProcedurePrices === true,
      canQuoteOrthoPrices: f?.canQuoteOrthoPrices === true,
    };
  } catch (e) {
    console.warn("[bot/precios] no se pudieron leer los interruptores:", e);
    return { ...PRECIOS_APAGADOS };
  }
}

/** Del body del PATCH, solo los dos booleanos (whitelist). */
export function interruptoresDelBody(body: Record<string, unknown>): Partial<InterruptoresDePrecios> {
  const out: Partial<InterruptoresDePrecios> = {};
  if (typeof body.canQuoteProcedurePrices === "boolean") out.canQuoteProcedurePrices = body.canQuoteProcedurePrices;
  if (typeof body.canQuoteOrthoPrices === "boolean") out.canQuoteOrthoPrices = body.canQuoteOrthoPrices;
  return out;
}

/**
 * Guarda los interruptores de la clínica de la SESIÓN (la fila ya existe:
 * la API hace getOrCreateBotConfig antes). `sin-columna` = falta pegar el
 * SQL: apagar no hace falta guardarlo (ya está apagado), encender se rechaza.
 */
export async function guardarInterruptoresDePrecios(
  clinicId: string,
  cambios: Partial<InterruptoresDePrecios>,
): Promise<{ ok: true } | { ok: false; motivo: "sin-columna" | "sin-clinica" | "error" }> {
  if (!clinicId) return { ok: false, motivo: "sin-clinica" };
  const procs = cambios.canQuoteProcedurePrices;
  const orto = cambios.canQuoteOrthoPrices;
  if (procs === undefined && orto === undefined) return { ok: true };
  if (!(await columnasDePreciosExisten(true))) {
    if (procs !== true && orto !== true) return { ok: true };
    return { ok: false, motivo: "sin-columna" };
  }
  try {
    // COALESCE: un interruptor que no vino en el body se queda como está.
    await prisma.$executeRaw`
      UPDATE "whatsapp_bot_configs"
         SET "canQuoteProcedurePrices" = COALESCE(${procs ?? null}::boolean, "canQuoteProcedurePrices"),
             "canQuoteOrthoPrices"     = COALESCE(${orto ?? null}::boolean, "canQuoteOrthoPrices")
       WHERE "clinicId" = ${clinicId}`;
    return { ok: true };
  } catch (e) {
    console.error("[bot/precios] no se pudieron guardar los interruptores:", e);
    return { ok: false, motivo: "error" };
  }
}

/** Lo que la pantalla necesita para pintar los dos interruptores. */
export interface EstadoDePreciosDelBot extends InterruptoresDePrecios {
  /** false = falta pegar el SQL: los interruptores salen apagados y deshabilitados. */
  preciosDisponibles: boolean;
  /** false = la clínica no tiene el módulo de Ortodoncia: el de Ortodoncia no aplica. */
  tieneOrtodoncia: boolean;
}

export async function estadoDePreciosDelBot(clinicId: string): Promise<EstadoDePreciosDelBot> {
  const preciosDisponibles = await columnasDePreciosExisten();
  const interruptores = await leerInterruptoresDePrecios(clinicId);
  const tieneOrtodoncia = await tieneModuloDeOrtodoncia(clinicId);
  return { ...interruptores, preciosDisponibles, tieneOrtodoncia };
}

async function tieneModuloDeOrtodoncia(clinicId: string): Promise<boolean> {
  try {
    return await hasActiveOrthodonticsModule(clinicId);
  } catch (e) {
    console.warn("[bot/precios] no se pudo saber si hay módulo de Ortodoncia:", e);
    return false;
  }
}

/**
 * El bloque de precios para el prompt del bot (parte FIJA, cacheada). "" si
 * no hay nada que decir o si algo falla: el bot contesta igual que antes.
 * Solo lee datos de `clinicId` (la clínica del hilo, que viene del número de
 * WhatsApp de la clínica, nunca del paciente).
 */
export async function bloqueDePreciosDeLaClinica(
  clinicId: string | null | undefined,
  opciones: { puedeAgendar: boolean },
): Promise<string> {
  if (!clinicId) return "";
  try {
    const interruptores = await leerInterruptoresDePrecios(clinicId);
    const tieneOrtodoncia = await tieneModuloDeOrtodoncia(clinicId);
    const procedimientos = await prisma.procedureCatalog.findMany({
      where: { clinicId, isActive: true },
      select: { name: true, category: true, basePrice: true },
      orderBy: { name: "asc" },
      // Holgura sobre el tope del prompt (80 por grupo): los $0 se descartan después.
      take: 400,
    });
    const tecnicas = tieneOrtodoncia
      ? tecnicasActivas((await leerTecnicasDeLaClinica(clinicId)).tecnicas).map((t) => ({ nombre: t.nombre, precio: t.precio }))
      : [];
    return bloquePreciosDelBot(
      {
        darPreciosProcedimientos: interruptores.canQuoteProcedurePrices,
        darPreciosOrtodoncia: interruptores.canQuoteOrthoPrices,
        tieneOrtodoncia,
        procedimientos,
        tecnicas,
        puedeAgendar: opciones.puedeAgendar,
      },
      { agenda: AGENDA_SENTINEL, handoff: HANDOFF_SENTINEL },
    );
  } catch (e) {
    console.error("[bot/precios] no se pudo armar el bloque de precios:", e);
    return "";
  }
}
