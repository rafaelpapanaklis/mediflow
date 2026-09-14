/**
 * La tarjeta de confirmación de Sabina — reglas PURAS de la pantalla.
 *
 * Nada de React ni de `fetch`: qué estado enseña la tarjeta, cuándo se puede
 * pulsar el botón, cuánto le queda, y cómo se lee lo que contesta el servidor.
 * Lo prueba `__tests__/propuesta-core.test.ts`.
 *
 * La verdad está en el servidor (engine-propuestas.ts): una propuesta caducada o
 * usada NO se ejecuta aunque la pantalla se equivoque. Estas reglas existen para
 * que la pantalla no invite al error: que no se pueda confirmar sin querer, y que
 * nunca diga «hecho» sin que el servidor lo haya dicho.
 */
import type {
  EstadoPropuesta,
  ResultadoVista,
  SabinaPropuestaVista,
} from "@/lib/sabina/engine-propuestas-core";

export type { EstadoPropuesta, ResultadoVista, SabinaPropuestaVista };

/**
 * El botón de confirmar nace apagado este rato. Una tarjeta aparece cuando llega
 * la respuesta, a veces justo bajo el dedo que iba a tocar otra cosa; sin esta
 * pausa, ese toque confirma algo que nadie leyó.
 */
export const SABINA_ARMADO_MS = 1_200;

/* ── Lectura defensiva de lo que manda el servidor ─────────────────────── */

const ESTADOS: readonly EstadoPropuesta[] = [
  "pendiente",
  "en_curso",
  "hecha",
  "fallida",
  "descartada",
  "reemplazada",
  "caducada",
];

function texto(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function leerResultado(raw: unknown): ResultadoVista | null {
  const r = raw as { ok?: unknown; tipo?: unknown; frase?: unknown } | null;
  if (!r || typeof r !== "object" || typeof r.frase !== "string") return null;
  return { ok: r.ok === true, tipo: texto(r.tipo) ?? (r.ok === true ? "hecha" : "error"), frase: r.frase };
}

/** Una propuesta cruda del servidor → vista pintable, o `null` si no cuadra. */
export function leerPropuesta(raw: unknown): SabinaPropuestaVista | null {
  const p = raw as Record<string, any> | null;
  if (!p || typeof p !== "object") return null;
  if (!texto(p.id) || !texto(p.accion) || !p.tarjeta || typeof p.tarjeta.frase !== "string") return null;
  if (!ESTADOS.includes(p.estado)) return null;
  if (typeof p.expiraEn !== "number" || !isFinite(p.expiraEn)) return null;
  const deshacer =
    p.deshacer?.reversible === true && typeof p.deshacer.como === "string"
      ? { reversible: true as const, como: p.deshacer.como as string }
      : {
          // Lo que no declara con claridad que se puede deshacer, se trata como
          // que NO se puede: pedir una casilla de más es un toque; lo contrario
          // es una sorpresa irreversible.
          reversible: false as const,
          aviso: typeof p.deshacer?.aviso === "string" ? (p.deshacer.aviso as string) : "Esto no se puede deshacer desde aquí.",
        };
  return {
    id: p.id,
    accion: p.accion,
    titulo: texto(p.titulo) ?? p.accion,
    boton: texto(p.boton) ?? "Confirmar",
    tarjeta: {
      frase: p.tarjeta.frase,
      detalles: (Array.isArray(p.tarjeta.detalles) ? p.tarjeta.detalles : [])
        .filter((d: any) => d && typeof d.etiqueta === "string" && typeof d.valor === "string")
        .map((d: any) => ({ etiqueta: d.etiqueta, valor: d.valor, ...(typeof d.antes === "string" ? { antes: d.antes } : {}) })),
      avisos: (Array.isArray(p.tarjeta.avisos) ? p.tarjeta.avisos : []).filter((a: unknown) => typeof a === "string"),
    },
    deshacer,
    creadaEn: typeof p.creadaEn === "number" ? p.creadaEn : Date.now(),
    expiraEn: p.expiraEn,
    estado: p.estado,
    resultado: leerResultado(p.resultado),
  };
}

export function leerPropuestas(raw: unknown): SabinaPropuestaVista[] {
  return (Array.isArray(raw) ? raw : []).map(leerPropuesta).filter((p): p is SabinaPropuestaVista => p !== null);
}

/* ── El reloj ──────────────────────────────────────────────────────────── */

/**
 * Cuánto va adelantado el reloj del servidor respecto al del navegador. Las
 * propuestas caducan con la hora del SERVIDOR; un teléfono con la hora mal no
 * debe enseñar una tarjeta viva que el servidor ya da por caducada (ni al revés).
 */
export function desfaseReloj(ahoraServidor: unknown, ahoraCliente: number): number {
  return typeof ahoraServidor === "number" && isFinite(ahoraServidor) ? ahoraServidor - ahoraCliente : 0;
}

/** El estado que se enseña: una pendiente cuyo plazo ya pasó se enseña caducada. */
export function estadoVisible(p: SabinaPropuestaVista, ahoraCliente: number, desfase: number): EstadoPropuesta {
  if (p.estado === "pendiente" && ahoraCliente + desfase >= p.expiraEn) return "caducada";
  return p.estado;
}

/** «Caduca en 9 min» · «Caduca en menos de un minuto». */
export function textoCaducidad(p: SabinaPropuestaVista, ahoraCliente: number, desfase: number): string {
  const restante = p.expiraEn - (ahoraCliente + desfase);
  if (restante <= 0) return "Caducada";
  const min = Math.floor(restante / 60_000);
  return min < 1 ? "Caduca en menos de un minuto" : `Caduca en ${min} min`;
}

/* ── Cuándo se puede pulsar ────────────────────────────────────────────── */

/** Si la acción no se puede deshacer, se pide marcar una casilla antes. */
export function pideCasilla(p: SabinaPropuestaVista): boolean {
  return !p.deshacer.reversible;
}

export function puedeConfirmar(args: {
  propuesta: SabinaPropuestaVista;
  ahoraCliente: number;
  desfase: number;
  /** Pasó `SABINA_ARMADO_MS` desde que se pintó la tarjeta. */
  armada: boolean;
  casillaMarcada: boolean;
  /** Hay otra petición en marcha (una pregunta a Sabina u otra confirmación). */
  ocupado: boolean;
}): boolean {
  if (args.ocupado || !args.armada) return false;
  if (estadoVisible(args.propuesta, args.ahoraCliente, args.desfase) !== "pendiente") return false;
  if (pideCasilla(args.propuesta) && !args.casillaMarcada) return false;
  return true;
}

/* ── Lo que dice la cabecera de la tarjeta en cada estado ─────────────── */

export type TonoEstado = "pendiente" | "bien" | "mal" | "neutro";

export function etiquetaEstado(estado: EstadoPropuesta): { texto: string; tono: TonoEstado } {
  switch (estado) {
    case "pendiente":
      return { texto: "Sin confirmar · todavía no se hizo nada", tono: "pendiente" };
    case "en_curso":
      return { texto: "Confirmada · procesando", tono: "pendiente" };
    case "hecha":
      return { texto: "Hecho", tono: "bien" };
    case "fallida":
      return { texto: "No se hizo", tono: "mal" };
    case "descartada":
      return { texto: "Descartada · no se hizo nada", tono: "neutro" };
    case "reemplazada":
      return { texto: "Sustituida por otra · no se hizo nada", tono: "neutro" };
    case "caducada":
    default:
      return { texto: "Caducada · no se hizo nada", tono: "neutro" };
  }
}

/** La frase de pie para los estados que no traen resultado del servidor. */
export function fraseDeEstado(estado: EstadoPropuesta): string | null {
  switch (estado) {
    case "caducada":
      return "Pasaron más de 10 minutos. Pídeselo otra vez a Sabina y lo revisa con los datos de ahora.";
    case "reemplazada":
      return "Vale la propuesta más nueva.";
    case "en_curso":
      return "Se está procesando. No hace falta volver a confirmar.";
    default:
      return null;
  }
}

/* ── Lo que contesta el servidor al confirmar o descartar ─────────────── */

export type LecturaRespuesta =
  | { tipo: "propuesta"; propuesta: SabinaPropuestaVista; desfase: number }
  /** El servidor contestó, pero sin propuesta (404, 503…): se dice su frase. */
  | { tipo: "sin_propuesta"; resultado: ResultadoVista }
  /**
   * No hubo respuesta legible. NO se sabe si se ejecutó: la tarjeta lo dice así y
   * ofrece consultar, que es volver a llamar a confirmar — el servidor no repite
   * una propuesta ya usada, devuelve lo que pasó con ella.
   */
  | { tipo: "desconocido" };

export function leerRespuestaPropuesta(status: number | null, cuerpo: unknown, ahoraCliente: number): LecturaRespuesta {
  if (status === null) return { tipo: "desconocido" };
  const c = cuerpo as { propuesta?: unknown; resultado?: unknown; ahora?: unknown } | null;
  const propuesta = leerPropuesta(c?.propuesta);
  if (propuesta) return { tipo: "propuesta", propuesta, desfase: desfaseReloj(c?.ahora, ahoraCliente) };
  const resultado = leerResultado(c?.resultado);
  if (resultado) return { tipo: "sin_propuesta", resultado };
  if (status === 401) {
    return { tipo: "sin_propuesta", resultado: { ok: false, tipo: "sin_sesion", frase: "Tu sesión terminó. Vuelve a entrar; no se hizo nada." } };
  }
  if (status === 429) {
    return { tipo: "sin_propuesta", resultado: { ok: false, tipo: "limite", frase: "Demasiados intentos seguidos. Espera un minuto; no se hizo nada." } };
  }
  if (status === 403) {
    return { tipo: "sin_propuesta", resultado: { ok: false, tipo: "origen", frase: "No se aceptó la confirmación desde esta página. Recarga y vuelve a intentarlo." } };
  }
  return { tipo: "desconocido" };
}

/* ── Las tarjetas dentro de la conversación ────────────────────────────── */

interface ConPropuestas {
  role: string;
  timestamp: number;
  propuestas?: SabinaPropuestaVista[];
}

/**
 * Al llegar una propuesta nueva, las pendientes de antes se enseñan sustituidas.
 * Es lo que ya hizo el servidor al guardarla (engine-propuestas.ts): solo vale
 * la última.
 */
export function marcarReemplazadas<M extends ConPropuestas>(mensajes: M[], idsNuevos: readonly string[]): M[] {
  if (idsNuevos.length === 0) return mensajes;
  return mensajes.map((m) => {
    if (!m.propuestas?.some((p) => p.estado === "pendiente" && !idsNuevos.includes(p.id))) return m;
    return {
      ...m,
      propuestas: m.propuestas.map((p) =>
        p.estado === "pendiente" && !idsNuevos.includes(p.id) ? { ...p, estado: "reemplazada" as const } : p,
      ),
    };
  });
}

/** Sustituye una propuesta (por id) donde esté. */
export function actualizarPropuesta<M extends ConPropuestas>(mensajes: M[], nueva: SabinaPropuestaVista): M[] {
  return mensajes.map((m) =>
    m.propuestas?.some((p) => p.id === nueva.id)
      ? { ...m, propuestas: m.propuestas.map((p) => (p.id === nueva.id ? nueva : p)) }
      : m,
  );
}

/**
 * Al reabrir una conversación: cada propuesta va bajo la primera respuesta de
 * Sabina guardada DESPUÉS de crearse (la propuesta nace dentro del turno y los
 * mensajes se guardan al terminarlo). Si no hay ninguna, bajo la última.
 */
export function repartirPropuestas<M extends ConPropuestas>(mensajes: M[], propuestas: readonly SabinaPropuestaVista[]): M[] {
  if (propuestas.length === 0) return mensajes;
  const copia = mensajes.map((m) => ({ ...m, propuestas: m.propuestas ? [...m.propuestas] : undefined }));
  const respuestas = copia.filter((m) => m.role === "assistant");
  if (respuestas.length === 0) return mensajes;
  for (const p of [...propuestas].sort((a, b) => a.creadaEn - b.creadaEn)) {
    const destino = respuestas.find((m) => m.timestamp >= p.creadaEn) ?? respuestas[respuestas.length - 1];
    destino.propuestas = [...(destino.propuestas ?? []), p];
  }
  return copia;
}
