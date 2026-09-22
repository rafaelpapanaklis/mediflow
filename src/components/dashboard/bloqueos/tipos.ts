/**
 * EL CONTRATO DE BLOQUEOS DE AGENDA — lo que la pantalla espera del servidor.
 *
 * La API la escribe ws1-t2 en `src/lib/agenda-bloqueos/` y `src/app/api/`; esto
 * es la otra mitad del cable, y vive aquí a propósito: la pantalla NO importa
 * de esas dos carpetas, así que puede compilar, probarse y entrar a `main`
 * antes de que existan. Cuando existan, lo único que tiene que cuadrar es lo
 * escrito en este archivo.
 *
 * 🔴 TODO LO QUE ENTRA POR RED SE PARSEA. Nada de `await res.json() as X`: un
 * campo que llegue `null` donde se esperaba string no puede tumbar la pantalla
 * de Configuración entera. Cada parser de aquí devuelve el valor o descarta la
 * fila, nunca lanza.
 */

/** Los cinco tipos del formulario. Valores de cable, no etiquetas. */
export const TIPOS_BLOQUEO = [
  "FESTIVO",
  "VACACIONES",
  "PERSONAL",
  "MANTENIMIENTO",
  "OTRO",
] as const;

export type TipoBloqueo = (typeof TIPOS_BLOQUEO)[number];

/**
 * ⚠️ PENDIENTE DE CONFIRMAR CON ws1-t2 — el encargo nombra los cinco tipos en
 * castellano («Festivo · Vacaciones · Personal · Mantenimiento · Otro») pero no
 * da sus valores de cable. Estos siguen el precedente de la casa: el mismo
 * concepto ya existe en el vertical Instituto (`enum EduAgendaBlockKind`, que
 * es `FESTIVO | PUENTE | MANTENIMIENTO | OTRO` — castellano, mayúsculas), así
 * que el enum de Dental se supone igual con `VACACIONES` y `PERSONAL` en vez de
 * `PUENTE`. Si el suyo no coincide, se cambia SOLO esta constante.
 */
export const TIPO_POR_DEFECTO: TipoBloqueo = "OTRO";

/** Máximo del motivo. El mismo 200 del `@db.VarChar(200)` de la tabla hermana. */
export const MAX_MOTIVO = 200;

/** Un bloqueo tal y como lo devuelve la API. `inicio`/`fin` son ISO EN UTC. */
export interface BloqueoDTO {
  id: string;
  doctorId: string | null;
  doctorNombre: string | null;
  kind: TipoBloqueo;
  reason: string;
  /** Instante ISO en UTC. NUNCA una hora de pared. */
  inicio: string;
  /** Instante ISO en UTC, EXCLUSIVO (medianoche del día siguiente si es día completo). */
  fin: string;
  diaCompleto: boolean;
  holidayKey: string | null;
  creadoPor: string;
  creadoEl: string;
  /** Lo decide el SERVIDOR. La pantalla no lo vuelve a razonar. */
  puedoRetirarlo: boolean;
}

/** Un festivo del catálogo de México, ya calculado para el año pedido. */
export interface FestivoDTO {
  key: string;
  nombre: string;
  /** `YYYY-MM-DD` — día de calendario, no instante. */
  fecha: string;
  /** De ley (LFT art. 74). */
  oficial: boolean;
  /** Si viene marcado de salida. Se respeta TAL CUAL: ver `festivos-card.tsx`. */
  porDefecto: boolean;
  /** Ya hay un bloqueo aplicado para este festivo. */
  aplicado: boolean;
}

/** Una cita que impide bloquear, tal y como viaja en el 409. */
export interface CitaEnConflicto {
  id: string;
  /** ISO en UTC, o `YYYY-MM-DD`; se pinta siempre en la zona de la clínica. */
  fecha: string;
  hora: string;
  pacienteNombre: string;
  doctorNombre: string | null;
  doctorId: string | null;
}

/** El cuerpo del 409, y también lo que devuelve `/revision` cuando hay choque. */
export interface ConflictoCitas {
  error: "CITAS_EN_EL_RANGO";
  total: number;
  citas: CitaEnConflicto[];
}

export const ERROR_CONFLICTO = "CITAS_EN_EL_RANGO";

/* ────────────────────────────── parsers ────────────────────────────────── */

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const texto = (v: unknown, fb = ""): string => (typeof v === "string" ? v : fb);

const textoONulo = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const bool = (v: unknown): boolean => v === true;

/** Un entero >= 0, o el respaldo. Un `total` raro no puede dar «y NaN más». */
const entero = (v: unknown, fb = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : fb;

/** ¿Es una cadena que `new Date` entiende? Un `fin` inválido descarta la fila. */
const esInstante = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && !Number.isNaN(new Date(v).getTime());

/* ───────────────────── los errores, como los lee una persona ───────────── */

/**
 * EL MENSAJE DE UN ERROR DE ESTA API. NUNCA EL CÓDIGO.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ ESTO EXISTE
 *
 * El servidor manda LAS DOS COSAS (`respuestaDeError`, ruta.server.ts):
 *
 *     { error: "RANGO_REQUERIDO", mensaje: "Elige el día en que empieza…" }
 *
 * `error` es el código estable, para que la pantalla DECIDA sin leer texto.
 * `mensaje` es la frase para la persona. Pintar el código es un fallo por sí
 * mismo: Rafael llenó el formulario entero y lo que le salió fue
 * «RANGO_REQUERIDO» en rojo, que no le dice ni qué falta ni qué hacer.
 *
 * El orden es: la frase del servidor → el texto de i18n → y nunca el código.
 * El servidor conoce el caso exacto («el último día no puede ser anterior al
 * primero», «ese bloqueo dura 900 días: revisa el año»); i18n solo conoce la
 * familia. Por eso manda el servidor, y i18n es la red cuando no dice nada.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function mensajeDeError(raw: unknown, respaldo: string): string {
  if (esObjeto(raw) && typeof raw.mensaje === "string" && raw.mensaje.trim()) {
    return raw.mensaje.trim();
  }
  return respaldo;
}

/**
 * El CÓDIGO estable, para decidir. No se pinta nunca: se compara.
 *
 * Existe aparte de `mensajeDeError` para que la diferencia esté en el nombre
 * de la función y no en la cabeza de quien lee — el que devuelve texto no
 * puede devolver un código ni por accidente.
 */
export function codigoDeError(raw: unknown): string | null {
  return esObjeto(raw) && typeof raw.error === "string" && raw.error ? raw.error : null;
}

/** El 503 de la tabla que todavía no existe: el SQL de ws1-t2 sin aplicar. */
export const ERROR_SQL_PENDIENTE = "SQL_PENDIENTE";

export function parseTipo(raw: unknown): TipoBloqueo {
  return (TIPOS_BLOQUEO as readonly string[]).includes(raw as string)
    ? (raw as TipoBloqueo)
    : TIPO_POR_DEFECTO;
}

/** Una fila de bloqueo, o `null` si le falta lo imprescindible para pintarla. */
export function parseBloqueo(raw: unknown): BloqueoDTO | null {
  if (!esObjeto(raw)) return null;
  const id = texto(raw.id);
  if (!id) return null;
  // Sin un rango legible no hay nada que pintar: ni renglón ni franja.
  if (!esInstante(raw.inicio) || !esInstante(raw.fin)) return null;
  return {
    id,
    doctorId: textoONulo(raw.doctorId),
    doctorNombre: textoONulo(raw.doctorNombre),
    kind: parseTipo(raw.kind),
    reason: texto(raw.reason),
    inicio: raw.inicio,
    fin: raw.fin,
    diaCompleto: bool(raw.diaCompleto),
    holidayKey: textoONulo(raw.holidayKey),
    creadoPor: texto(raw.creadoPor),
    creadoEl: texto(raw.creadoEl),
    // Fail-closed: sin el campo, NO se enseña el botón de retirar. Esconder no
    // es permitir, pero enseñar una puerta que da 403 tampoco ayuda a nadie.
    puedoRetirarlo: bool(raw.puedoRetirarlo),
  };
}

export function parseBloqueos(raw: unknown): BloqueoDTO[] {
  const lista = esObjeto(raw) && Array.isArray(raw.bloqueos) ? raw.bloqueos : [];
  const out: BloqueoDTO[] = [];
  for (const fila of lista) {
    const b = parseBloqueo(fila);
    if (b) out.push(b);
  }
  return out;
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function parseFestivo(raw: unknown): FestivoDTO | null {
  if (!esObjeto(raw)) return null;
  const key = texto(raw.key);
  const fecha = texto(raw.fecha).slice(0, 10);
  if (!key || !ES_FECHA.test(fecha)) return null;
  return {
    key,
    nombre: texto(raw.nombre, key),
    fecha,
    oficial: bool(raw.oficial),
    porDefecto: bool(raw.porDefecto),
    aplicado: bool(raw.aplicado),
  };
}

export function parseFestivos(raw: unknown): FestivoDTO[] {
  const lista = esObjeto(raw) && Array.isArray(raw.festivos) ? raw.festivos : [];
  const out: FestivoDTO[] = [];
  for (const fila of lista) {
    const f = parseFestivo(fila);
    if (f) out.push(f);
  }
  return out;
}

export function parseCita(raw: unknown): CitaEnConflicto | null {
  if (!esObjeto(raw)) return null;
  const id = texto(raw.id);
  if (!id) return null;
  return {
    id,
    fecha: texto(raw.fecha),
    hora: texto(raw.hora),
    pacienteNombre: texto(raw.pacienteNombre),
    doctorNombre: textoONulo(raw.doctorNombre),
    doctorId: textoONulo(raw.doctorId),
  };
}

/**
 * El cuerpo de un choque de citas, venga del 409 de `POST /bloqueos` o del 200
 * de `POST /bloqueos/revision`. Devuelve `null` cuando el cuerpo NO es un
 * choque — y eso incluye el caso en que la revisión responde «todo libre».
 *
 * `total` manda sobre `citas.length`: el servidor manda una muestra y el total
 * de verdad, y es ese el que dice «y 7 más».
 */
export function parseConflicto(raw: unknown): ConflictoCitas | null {
  if (!esObjeto(raw)) return null;
  if (raw.error !== ERROR_CONFLICTO) return null;
  const citas: CitaEnConflicto[] = [];
  if (Array.isArray(raw.citas)) {
    for (const fila of raw.citas) {
      const c = parseCita(fila);
      if (c) citas.push(c);
    }
  }
  // Un choque sin `total` pero con citas vale lo que trae; un choque sin
  // NADA que enseñar no es un choque que esta pantalla sepa explicar.
  const total = entero(raw.total, citas.length);
  if (total === 0 && citas.length === 0) return null;
  return { error: ERROR_CONFLICTO, total: Math.max(total, citas.length), citas };
}

/** Una entrada de `chocaron[]` al aplicar festivos. */
export interface FestivoQueChoco {
  key: string;
  /** Cuántas citas lo impidieron, si el servidor lo dice. */
  total: number;
  citas: CitaEnConflicto[];
}

/**
 * La respuesta de `POST /bloqueos/festivos`: los creados y los que chocaron,
 * por separado. Aplicar diciembre entero no puede fallar en bloque porque el
 * 24 tenga dos citas.
 *
 * ⚠️ PENDIENTE DE CONFIRMAR CON ws1-t2 — el encargo fija `{ creados[],
 * chocaron[] }` pero no la forma de cada entrada. Se acepta tanto una cadena
 * suelta (la `key`) como un objeto `{ key, total?, citas? }`, para que un
 * cambio en su lado no deje la pantalla sin pintar nada.
 */
export interface RespuestaFestivos {
  creados: string[];
  chocaron: FestivoQueChoco[];
}

function claveDe(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (esObjeto(raw)) return texto(raw.key) || texto(raw.holidayKey);
  return "";
}

export function parseRespuestaFestivos(raw: unknown): RespuestaFestivos {
  const creados: string[] = [];
  const chocaron: FestivoQueChoco[] = [];
  if (!esObjeto(raw)) return { creados, chocaron };

  if (Array.isArray(raw.creados)) {
    for (const fila of raw.creados) {
      const k = claveDe(fila);
      if (k) creados.push(k);
    }
  }
  if (Array.isArray(raw.chocaron)) {
    for (const fila of raw.chocaron) {
      const key = claveDe(fila);
      if (!key) continue;
      const citas: CitaEnConflicto[] = [];
      if (esObjeto(fila) && Array.isArray(fila.citas)) {
        for (const c of fila.citas) {
          const cita = parseCita(c);
          if (cita) citas.push(cita);
        }
      }
      const total = esObjeto(fila) ? entero(fila.total, citas.length) : 0;
      chocaron.push({ key, total: Math.max(total, citas.length), citas });
    }
  }
  return { creados, chocaron };
}
