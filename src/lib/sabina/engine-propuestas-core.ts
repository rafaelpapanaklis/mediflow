/**
 * Sabina — las reglas PURAS de las propuestas: cuánto duran, en qué estado está
 * cada una y qué se le dice al usuario. Sin base, sin red, sin `server-only`:
 * las importan el servidor, la pantalla (solo tipos) y las pruebas.
 *
 * ── DÓNDE SE GUARDA UNA PROPUESTA, Y POR QUÉ AHÍ ────────────────────────────
 *
 * En `audit_logs`, como una serie de eventos de solo agregar, con
 * `entityType = "sabina-propuesta"` y `entityId = <id de la propuesta>`:
 *
 *   sabina_proponer    qué pidió el usuario, qué propuso Sabina (tarjeta, datos,
 *                      huella) y hasta cuándo vale.
 *   sabina_confirmar   el usuario pulsó el botón. Se escribe bajo candado de base
 *                      (`pg_advisory_xact_lock`) y SOLO si no había otro evento
 *                      final: es lo que hace la propuesta de un solo uso.
 *   sabina_resultado   qué devolvió el servidor y qué se le dijo al usuario.
 *   sabina_descartar   el usuario la descartó, o la sustituyó una más nueva.
 *   sabina_rechazo     se intentó confirmar tarde (caducada) o ya usada.
 *
 * Tres razones: (1) el contrato pide rastro —quién pidió, qué propuso Sabina, qué
 * confirmó, qué devolvió el servidor— y eso es literalmente una bitácora; (2)
 * `audit_logs` es append-only por trigger (sql/nom-audit-immutable.sql), así que
 * el rastro no se puede reescribir después; (3) no hace falta tabla nueva, ni SQL,
 * ni tocar `schema.prisma`. Y queda visible en /dashboard/auditoria.
 *
 * ── CUÁNTO DURA ──────────────────────────────────────────────────────────────
 *
 * Diez minutos. Lo que se resolvió al proponer (la hora libre, el estado de la
 * cita) se pudre: pasado ese rato ya no se confirma, se vuelve a pedir. Y dentro
 * de esos diez minutos tampoco se escribe a ciegas: al confirmar se recalcula la
 * huella de la acción y el endpoint vuelve a validar todo lo suyo.
 */

export const SABINA_PROPUESTA_TTL_MS = 10 * 60_000;

/**
 * Una propuesta por turno, y vale la última. Si en una misma frase caben dos
 * acciones, se propone la primera y se sigue después: lo contrario abre la puerta
 * a dos tarjetas vivas para la misma intención (el modelo corrige la hora y quedan
 * la vieja y la nueva) y a confirmar las dos. Si el modelo prepara otra dentro
 * del mismo turno, sustituye a la anterior. Las operaciones en lote son una
 * decisión abierta de Rafael (MAPA §9.7).
 */
export const SABINA_MAX_PROPUESTAS_POR_TURNO = 1;

/** Tope del texto del pedido que se guarda en el rastro. */
export const SABINA_PEDIDO_MAX_CHARS = 500;

/** Tope del cuerpo de respuesta del endpoint que se guarda en el rastro. */
export const SABINA_CUERPO_RASTRO_MAX_CHARS = 4_000;

export const ENTIDAD_PROPUESTA = "sabina-propuesta";

export const EVENTO = {
  proponer: "sabina_proponer",
  confirmar: "sabina_confirmar",
  resultado: "sabina_resultado",
  descartar: "sabina_descartar",
  rechazo: "sabina_rechazo",
} as const;

/** Formato del id: un UUID v4. Cualquier otra cosa no se busca en la base. */
export function esIdDePropuesta(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

/* ═══════════════════════════════════════════════════════════════════════
   LO QUE VIAJA A LA PANTALLA
   ═══════════════════════════════════════════════════════════════════════ */

export type EstadoPropuesta =
  | "pendiente"
  | "en_curso" // se confirmó y el servidor todavía no apuntó el resultado
  | "hecha"
  | "fallida"
  | "descartada"
  | "reemplazada"
  | "caducada";

export interface ResultadoVista {
  ok: boolean;
  /** `sin_permiso` · `conflicto` · `invalido` · `error` · `cambio` · `caducada`… */
  tipo: string;
  frase: string;
}

export interface SabinaPropuestaVista {
  id: string;
  accion: string;
  titulo: string;
  boton: string;
  tarjeta: {
    frase: string;
    detalles: Array<{ etiqueta: string; valor: string; antes?: string }>;
    avisos: string[];
  };
  deshacer: { reversible: true; como: string } | { reversible: false; aviso: string };
  /** Epoch ms del servidor. */
  creadaEn: number;
  expiraEn: number;
  estado: EstadoPropuesta;
  resultado: ResultadoVista | null;
}

/* ═══════════════════════════════════════════════════════════════════════
   EL ESTADO, A PARTIR DE LOS EVENTOS
   ═══════════════════════════════════════════════════════════════════════ */

export interface EventoPropuesta {
  action: string;
  userId: string;
  createdAt: Date | number | string;
  changes: unknown;
}

function ms(v: Date | number | string): number {
  return v instanceof Date ? v.getTime() : typeof v === "number" ? v : new Date(v).getTime();
}

/**
 * Lo que dice cada evento de su `changes`. Se lee a la defensiva: son filas de
 * base, y una fila rara se trata como si no existiera, no revienta la pantalla.
 */
function cambios(e: EventoPropuesta): Record<string, unknown> {
  return e.changes && typeof e.changes === "object" && !Array.isArray(e.changes)
    ? (e.changes as Record<string, unknown>)
    : {};
}

/** El evento final (confirmar o descartar) si lo hay. */
export function eventoFinal(eventos: readonly EventoPropuesta[]): EventoPropuesta | null {
  return (
    eventos.find((e) => e.action === EVENTO.confirmar || e.action === EVENTO.descartar) ?? null
  );
}

/**
 * La vista de UNA propuesta a partir de sus eventos, o `null` si no hay un
 * `sabina_proponer` legible de ESTE usuario. Una propuesta de otra persona es,
 * para quien pregunta, una propuesta que no existe.
 */
export function vistaDePropuesta(
  id: string,
  eventos: readonly EventoPropuesta[],
  userId: string,
  ahora: number,
): SabinaPropuestaVista | null {
  const ordenados = [...eventos].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const propuesta = ordenados.find((e) => e.action === EVENTO.proponer);
  if (!propuesta || propuesta.userId !== userId) return null;
  const c = cambios(propuesta);
  const tarjeta = c.tarjeta as SabinaPropuestaVista["tarjeta"] | undefined;
  const deshacer = c.deshacer as SabinaPropuestaVista["deshacer"] | undefined;
  const expiraEn = typeof c.expiraEn === "string" || typeof c.expiraEn === "number" ? ms(c.expiraEn) : NaN;
  if (typeof c.accion !== "string" || !tarjeta || typeof tarjeta.frase !== "string" || !deshacer || !isFinite(expiraEn)) {
    return null;
  }

  const final = eventoFinal(ordenados);
  const resultadoEv = ordenados.find((e) => e.action === EVENTO.resultado);
  let estado: EstadoPropuesta;
  let resultado: ResultadoVista | null = null;

  if (resultadoEv) {
    const r = cambios(resultadoEv);
    resultado = {
      ok: r.ok === true,
      tipo: typeof r.tipo === "string" ? r.tipo : r.ok === true ? "hecha" : "error",
      frase: typeof r.frase === "string" ? r.frase : "",
    };
    estado = resultado.ok ? "hecha" : "fallida";
  } else if (final?.action === EVENTO.confirmar) {
    estado = "en_curso";
  } else if (final?.action === EVENTO.descartar) {
    estado = cambios(final).motivo === "reemplazada" ? "reemplazada" : "descartada";
  } else if (ahora >= expiraEn) {
    estado = "caducada";
  } else {
    estado = "pendiente";
  }

  return {
    id,
    accion: c.accion,
    titulo: typeof c.titulo === "string" ? c.titulo : c.accion,
    boton: typeof c.boton === "string" ? c.boton : "Confirmar",
    tarjeta: {
      frase: tarjeta.frase,
      detalles: Array.isArray(tarjeta.detalles) ? tarjeta.detalles : [],
      avisos: Array.isArray(tarjeta.avisos) ? tarjeta.avisos : [],
    },
    deshacer,
    creadaEn: ms(propuesta.createdAt),
    expiraEn,
    estado,
    resultado,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   LAS FRASES DEL MECANISMO (las de cada acción las pone la acción)
   ═══════════════════════════════════════════════════════════════════════ */

export const FRASE = {
  noEncontrada: "No encuentro esa propuesta. No se hizo nada.",
  caducada:
    "Esta propuesta caducó sin confirmarse, así que no hice nada. Pídemela otra vez y lo reviso con los datos de ahora.",
  descartada: "Descartaste esta propuesta. No se hizo nada.",
  reemplazada: "Esta propuesta la sustituyó una más nueva. No se hizo nada con esta.",
  enCurso: "Esta propuesta ya se confirmó y se está procesando. No la repito.",
  cambio:
    "Algo cambió desde que te lo propuse, así que no hice nada. Pídemelo otra vez y lo reviso con los datos de ahora.",
  noComprobable: "No pude comprobar que todo siga igual que cuando te lo propuse, así que no hice nada.",
  accionDesconocida: "Esa acción ya no está disponible. No se hizo nada.",
  errorInterno: "No se pudo completar por un error del sistema. Revisa si quedó algo hecho antes de repetirlo.",
} as const;

/**
 * ¿La petición viene de esta misma página? Es el mismo criterio que el middleware
 * aplica a `/api/admin/*` (`csrfOriginMismatch`): Origin, o en su defecto Referer,
 * tiene que ser el mismo host. Una confirmación escribe; no se acepta de otro sitio.
 */
export function origenValido(headers: { get(nombre: string): string | null }): boolean {
  const host = headers.get("host");
  if (!host) return false;
  const origen = headers.get("origin");
  const referer = headers.get("referer");
  try {
    const fuente = origen ? new URL(origen).host : referer ? new URL(referer).host : null;
    return fuente === host;
  } catch {
    return false;
  }
}
