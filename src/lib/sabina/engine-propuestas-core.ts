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
  /** Lo que se creó, para abrirlo: «Ver comprobante MF-0043». Solo rutas de la propia app. */
  enlace?: SabinaEnlace;
}

/* ═══════════════════════════════════════════════════════════════════════
   TABLA Y ENLACE — lo que «etiqueta: valor» no sabe decir
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Una tabla dentro de la tarjeta. Existe porque tres conceptos con precio,
 * cantidad y descuento, escritos como filas «etiqueta: valor», se leen como una
 * sopa y nadie comprueba el total antes de confirmar. Es genérica a propósito:
 * la factura trae conceptos; una receta, medicamentos.
 *
 * Todo viaja ya formateado en texto (montos con signo de pesos): la pantalla no
 * hace cuentas, pinta lo que la acción calculó, que es lo que se va a guardar.
 */
export interface SabinaTabla {
  columnas: Array<{ titulo: string; /** Alinea a la derecha (importes, cantidades). */ numerica?: boolean }>;
  filas: string[][];
  /** Totales bajo la tabla, alineados a la derecha. `fuerte` para el que se cobra. */
  pie?: Array<{ etiqueta: string; valor: string; fuerte?: boolean }>;
}

export interface SabinaEnlace {
  texto: string;
  /** Ruta de la propia app (`/api/…` o `/dashboard/…`). Nunca una URL con dominio. */
  url: string;
}

const TABLA_MAX_COLUMNAS = 6;
const TABLA_MAX_FILAS = 40;
const TABLA_MAX_CELDA = 200;

function textoCorto(v: unknown, max = TABLA_MAX_CELDA): string | null {
  return typeof v === "string" ? v.slice(0, max) : null;
}

/**
 * Lee una tabla a la defensiva (viene de la base, o del JSON del servidor). Una
 * tabla que no cuadra —filas de otro ancho, columnas vacías— se descarta entera:
 * pintar media tabla desalineada es peor que no pintarla, porque los importes
 * caerían bajo la columna que no es.
 */
export function leerTabla(raw: unknown): SabinaTabla | null {
  const t = raw as { columnas?: unknown; filas?: unknown; pie?: unknown } | null;
  if (!t || typeof t !== "object" || !Array.isArray(t.columnas) || !Array.isArray(t.filas)) return null;
  const columnas = t.columnas
    .slice(0, TABLA_MAX_COLUMNAS)
    .map((c: any) => (c && typeof c.titulo === "string" ? { titulo: c.titulo.slice(0, 40), ...(c.numerica === true ? { numerica: true } : {}) } : null));
  if (columnas.length === 0 || columnas.some((c) => c === null) || t.columnas.length > TABLA_MAX_COLUMNAS) return null;
  const filas: string[][] = [];
  for (const f of t.filas.slice(0, TABLA_MAX_FILAS)) {
    if (!Array.isArray(f) || f.length !== columnas.length) return null;
    const celdas = f.map((c) => textoCorto(c));
    if (celdas.some((c) => c === null)) return null;
    filas.push(celdas as string[]);
  }
  const pie = Array.isArray(t.pie)
    ? t.pie
        .filter((p: any) => p && typeof p.etiqueta === "string" && typeof p.valor === "string")
        .slice(0, 6)
        .map((p: any) => ({ etiqueta: p.etiqueta.slice(0, 60), valor: p.valor.slice(0, 60), ...(p.fuerte === true ? { fuerte: true } : {}) }))
    : [];
  return { columnas: columnas as SabinaTabla["columnas"], filas, ...(pie.length ? { pie } : {}) };
}

/**
 * Un enlace del resultado, solo si apunta DENTRO de la app. La tarjeta lo pinta
 * como `<a href>`: una ruta que llegara como `javascript:` o `https://otro.sitio`
 * desde una fila de base manipulada sería un enlace del panel hacia fuera.
 */
export function leerEnlace(raw: unknown): SabinaEnlace | null {
  const e = raw as { texto?: unknown; url?: unknown } | null;
  if (!e || typeof e !== "object" || typeof e.texto !== "string" || typeof e.url !== "string") return null;
  if (!/^\/(api|dashboard)\/[A-Za-z0-9_\-./]*$/.test(e.url) || e.url.includes("..") || e.url.includes("//")) return null;
  return { texto: e.texto.slice(0, 80), url: e.url };
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
    tabla?: SabinaTabla;
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
    const enlace = leerEnlace(r.enlace);
    resultado = {
      ok: r.ok === true,
      tipo: typeof r.tipo === "string" ? r.tipo : r.ok === true ? "hecha" : "error",
      frase: typeof r.frase === "string" ? r.frase : "",
      ...(enlace ? { enlace } : {}),
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

  const tabla = leerTabla(tarjeta.tabla);
  return {
    id,
    accion: c.accion,
    titulo: typeof c.titulo === "string" ? c.titulo : c.accion,
    boton: typeof c.boton === "string" ? c.boton : "Confirmar",
    tarjeta: {
      frase: tarjeta.frase,
      detalles: Array.isArray(tarjeta.detalles) ? tarjeta.detalles : [],
      avisos: Array.isArray(tarjeta.avisos) ? tarjeta.avisos : [],
      ...(tabla ? { tabla } : {}),
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
