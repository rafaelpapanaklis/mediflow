/**
 * «Clínicas en línea» — el almacén en Redis (Upstash) y la lógica de la señal.
 *
 * 🔴 SIN BASE DE DATOS en el camino de la señal. El 1-oct hubo un incidente de
 * conexiones (pooler lleno); esto manda una señal por minuto y por pestaña, así
 * que NO abre ni una conexión de Prisma por señal:
 *   · quién es el usuario (clínica, id, nombre, si cuenta) se resuelve UNA vez
 *     y queda en el registro de su sesión en Redis 10 min;
 *   · las señales siguientes solo hablan con Redis.
 *
 * Sin Redis (UPSTASH_REDIS_REST_URL/TOKEN sin poner: panel.108, dev.108) nada
 * falla: la señal contesta «no se guarda» sin tocar nada, y la tarjeta dice
 * «sin dato». Un error de Redis en runtime hace lo mismo (fail-open, un warn).
 *
 * ── Costo: UNA llamada por señal ─────────────────────────────────────────
 * Un script de Lua (presencia-lua.ts, EVALSHA) lee el registro de la sesión,
 * aplica el límite por minuto, actualiza «desde»/última señal/pantalla y anota
 * la sesión en el índice. En régimen normal es 1 comando por señal (y 2 en la
 * primera de cada sesión y cada 10 min: una para descubrir que falta la
 * identidad y otra con la identidad ya resuelta). Si EVAL falla en ejecución,
 * se cae al camino de varios comandos (GET → decide en JS → SET + ZADD), con la
 * misma regla (`aplicarLatido`), y no se vuelve a intentar Lua en 5 min.
 *
 * ── Qué hay en Redis (todo con caducidad salvo el índice) ────────────────
 *   pres:s:<sesión>:<clínica de la cookie>   texto  registro de la sesión   TTL 10 min
 *        clínica|usuario|cuenta|desde|ts|minuto|n|pantalla|nombre
 *        `desde` se conserva mientras entre señales pasen ≤ 5 min.
 *   pres:z   zset  «clínica|usuario|<sesión>:<cookie>» → última señal
 *        Es el índice: «quién está en línea» = ZRANGEBYSCORE de la ventana de
 *        5 min. Sin TTL propio; se poda (> 24 h) en cada lectura de /admin.
 */
import { Redis } from "@upstash/redis";
import {
  LATIDO,
  MAX_CLINICAS_EN_LISTA,
  MAX_LATIDOS_POR_MINUTO,
  VENTANA_EN_LINEA_MS,
  aplicarLatido,
  etiquetaDePantalla,
  leerRegistro,
  limpiarTexto,
  type FilaEnLinea,
  type ParamsLatido,
  type UsuarioEnLinea,
} from "./presencia-core";
import { SCRIPT_LATIDO, SHA_SCRIPT_LATIDO } from "./presencia-lua";

// ─────────────────────────── Cliente (mínimo, inyectable) ───────────────────

/** Lo que se usa de un pipeline de Upstash. Lo cumple `redis.pipeline()` y los dobles de las pruebas. */
export interface PipelineMini {
  get(k: string): PipelineMini;
  set(k: string, v: unknown, opts?: { ex?: number }): PipelineMini;
  mget(...ks: string[]): PipelineMini;
  zadd(k: string, sm: { score: number; member: string }): PipelineMini;
  zrange(k: string, min: number, max: number | "+inf", opts: { byScore: true }): PipelineMini;
  zremrangebyscore(k: string, min: number | "-inf", max: number): PipelineMini;
  exec(): Promise<unknown[]>;
}
export interface RedisMini {
  pipeline(): PipelineMini;
  /** EVALSHA / EVAL: sin ellos (o si fallan) se usa el camino de varios comandos. */
  evalsha?(sha1: string, keys: string[], args: unknown[]): Promise<unknown>;
  eval?(script: string, keys: string[], args: unknown[]): Promise<unknown>;
}

let cliente: RedisMini | null | undefined;
let avisoRuntime = false;
/** Hasta cuándo no se intenta Lua (EVAL falló en ejecución). */
let luaRotoHasta = 0;
const PAUSA_LUA_MS = 5 * 60_000;

/** Cliente de Upstash, o null si faltan las variables (decisión tomada una vez). */
export function obtenerRedis(): RedisMini | null {
  if (cliente !== undefined) return cliente;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    cliente = null;
    return null;
  }
  try {
    cliente = new Redis({ url, token }) as unknown as RedisMini;
  } catch (e) {
    console.warn("[presencia] no se pudo iniciar Upstash; sin dato de «en línea»:", e instanceof Error ? e.message : e);
    cliente = null;
  }
  return cliente;
}

/** Solo para pruebas: fija (o limpia con undefined) el cliente y el estado de Lua. */
export function _fijarRedisParaPruebas(r: RedisMini | null | undefined): void {
  cliente = r;
  avisoRuntime = false;
  luaRotoHasta = 0;
}

/** Solo para pruebas: ¿Lua está en pausa por un fallo? */
export function _luaEnPausa(ahora: number): boolean {
  return ahora < luaRotoHasta;
}

function avisarUnaVez(e: unknown): void {
  if (avisoRuntime) return;
  avisoRuntime = true;
  console.warn("[presencia] error de Redis; «en línea» sin dato hasta que vuelva:", e instanceof Error ? e.message : e);
}

// ─────────────────────────── Llaves ─────────────────────────────────────────

const INDICE = "pres:z";
const llaveRegistro = (sufijo: string) => `pres:s:${sufijo}`;
/** Lo que identifica a la sesión: la de Supabase + la clínica de la cookie (cambiar de sede es otra). */
const sufijoDeSesion = (sesion: string, clinicaCookie: string | null) => `${sesion}:${clinicaCookie ?? "-"}`;

/** Vida del registro = vida de la identidad en caché. */
const TTL_REGISTRO_S = 10 * 60;

// ─────────────────────────── La señal ───────────────────────────────────────

/** Quién manda la señal, ya resuelto en el servidor (nunca viene del cliente). */
export interface IdentidadLatido {
  clinicId: string;
  userId: string;
  nombre: string;
  /** false = no cuenta («Ver como clínica», usuarios de plataforma). */
  cuenta: boolean;
}

export type ResultadoLatido =
  | { estado: 200; guardado: true }
  | { estado: 200; guardado: false; motivo: "sin-redis" | "no-cuenta" | "error" }
  | { estado: 401 }
  | { estado: 429; reintentarEnS: number };

export interface EntradaLatido {
  /** Id de la sesión de Supabase (claim session_id); distingue «Ver como clínica» de la sesión real. */
  sesion: string;
  /** Clínica activa de la cookie firmada, o null. */
  clinicaCookie: string | null;
  /** Ruta que dice el navegador: solo sirve para sacar el NOMBRE de la pantalla. */
  ruta: unknown;
  ahora: number;
}

export interface DepsLatido {
  redis: RedisMini | null;
  /**
   * Resuelve la identidad con la base (getAuthContext). Se llama SOLO cuando
   * Redis no la tiene; null = sesión sin acceso (2FA pendiente, plan vencido…).
   */
  resolverIdentidad: () => Promise<IdentidadLatido | null>;
}

interface SalidaLatido {
  codigo: number;
  segundos: number;
}

function esNoscript(e: unknown): boolean {
  return /NOSCRIPT/i.test(e instanceof Error ? e.message : String(e));
}

function leerSalida(v: unknown): SalidaLatido {
  if (Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0]))) return { codigo: Number(v[0]), segundos: Number(v[1]) || 0 };
  throw new Error("respuesta inesperada del script de presencia: " + JSON.stringify(v));
}

/** UNA llamada: EVALSHA (y EVAL completo solo si Redis no tiene el script cargado). */
async function porLua(redis: RedisMini, llave: string, args: unknown[]): Promise<SalidaLatido> {
  if (!redis.evalsha) throw new Error("el cliente no tiene evalsha");
  try {
    return leerSalida(await redis.evalsha(SHA_SCRIPT_LATIDO, [llave, INDICE], args));
  } catch (e) {
    if (!esNoscript(e) || !redis.eval) throw e;
    return leerSalida(await redis.eval(SCRIPT_LATIDO, [llave, INDICE], args));
  }
}

/** Varios comandos: GET → regla en JS → SET + ZADD. Lo mismo que el script, sin atomicidad. */
async function porComandos(redis: RedisMini, llave: string, sufijo: string, p: ParamsLatido): Promise<SalidaLatido> {
  const [crudo] = (await redis.pipeline().get(llave).exec()) as [unknown];
  const d = aplicarLatido(typeof crudo === "string" ? crudo : null, p);
  if (d.codigo === 1) return { codigo: 1, segundos: 0 };
  if (d.codigo === 3) return { codigo: 3, segundos: d.reintentarEnS };
  if (d.codigo === 2) {
    if (d.escribir) await redis.pipeline().set(llave, d.escribir, { ex: p.ttlS }).exec();
    return { codigo: 2, segundos: 0 };
  }
  await redis
    .pipeline()
    .set(llave, d.escribir, { ex: p.ttlS })
    .zadd(INDICE, { score: p.ahora, member: `${d.indexar.clinicId}|${d.indexar.userId}|${sufijo}` })
    .exec();
  return { codigo: 0, segundos: 0 };
}

async function ejecutarLatido(
  redis: RedisMini,
  sufijo: string,
  p: ParamsLatido,
): Promise<SalidaLatido> {
  const llave = llaveRegistro(sufijo);
  if (redis.evalsha && p.ahora >= luaRotoHasta) {
    const args: unknown[] = [p.ahora, p.ttlS, p.limitePorMinuto, limpiarTexto(p.pantalla, 60), p.ventanaMs, sufijo];
    if (p.identidad) args.push(p.identidad.clinicId, p.identidad.userId, p.identidad.cuenta ? "1" : "0", limpiarTexto(p.identidad.nombre));
    try {
      return await porLua(redis, llave, args);
    } catch (e) {
      // EVAL no sirvió (no soportado, error del script, red): se sigue con el camino de
      // varios comandos y no se insiste con Lua durante 5 min (cada intento fallido costaría de más).
      luaRotoHasta = p.ahora + PAUSA_LUA_MS;
      console.warn("[presencia] EVAL falló; se usa el camino de varios comandos 5 min:", e instanceof Error ? e.message : e);
    }
  }
  return porComandos(redis, llave, sufijo, p);
}

/**
 * Procesa UNA señal.
 *   1. sin Redis → nada (ni siquiera se pregunta quién es);
 *   2. una llamada: el script decide todo (límite, desde, índice);
 *   3. si falta la identidad (primera señal de la sesión, o pasaron 10 min):
 *      UNA resolución con la base y una segunda llamada que ya la lleva;
 *   4. límite superado → 429; no cuenta → fuera.
 */
export async function procesarLatido(deps: DepsLatido, e: EntradaLatido): Promise<ResultadoLatido> {
  const redis = deps.redis;
  if (!redis) return { estado: 200, guardado: false, motivo: "sin-redis" };

  try {
    const sufijo = sufijoDeSesion(e.sesion, e.clinicaCookie);
    const base: ParamsLatido = {
      ahora: e.ahora,
      ttlS: TTL_REGISTRO_S,
      limitePorMinuto: MAX_LATIDOS_POR_MINUTO,
      pantalla: etiquetaDePantalla(e.ruta),
      ventanaMs: VENTANA_EN_LINEA_MS,
    };
    let r = await ejecutarLatido(redis, sufijo, base);
    if (r.codigo === LATIDO.FALTA_IDENTIDAD) {
      const identidad = await deps.resolverIdentidad();
      if (!identidad) return { estado: 401 };
      r = await ejecutarLatido(redis, sufijo, { ...base, identidad });
      if (r.codigo === LATIDO.FALTA_IDENTIDAD) throw new Error("Redis no guardó la identidad");
    }
    if (r.codigo === LATIDO.LIMITE) return { estado: 429, reintentarEnS: Math.max(1, r.segundos) };
    if (r.codigo === LATIDO.NO_CUENTA) return { estado: 200, guardado: false, motivo: "no-cuenta" };
    return { estado: 200, guardado: true };
  } catch (err) {
    avisarUnaVez(err);
    return { estado: 200, guardado: false, motivo: "error" };
  }
}

// ─────────────────────────── Lo que lee /admin ──────────────────────────────

function aTexto(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

interface Miembro {
  clinicId: string;
  userId: string;
  sufijo: string;
}

/** Los miembros del índice con señal en la ventana (poda de paso lo de > 24 h). 2 comandos. */
async function miembrosEnVentana(redis: RedisMini, ahora: number): Promise<Miembro[]> {
  const corte = ahora - VENTANA_EN_LINEA_MS;
  const r = (await redis
    .pipeline()
    .zremrangebyscore(INDICE, "-inf", ahora - 24 * 60 * 60_000)
    .zrange(INDICE, corte, "+inf", { byScore: true })
    .exec()) as [unknown, unknown];
  const lista = Array.isArray(r[1]) ? r[1].map(aTexto) : [];
  const salida: Miembro[] = [];
  for (const m of lista) {
    const a = m.indexOf("|");
    const b = a < 0 ? -1 : m.indexOf("|", a + 1);
    if (a <= 0 || b < 0) continue;
    salida.push({ clinicId: m.slice(0, a), userId: m.slice(a + 1, b), sufijo: m.slice(b + 1) });
  }
  return salida;
}

/** null = sin dato (sin Redis o Redis falló): la tarjeta dice «sin dato», no «0». */
export async function contarClinicasEnLinea(redis: RedisMini | null, ahora: number): Promise<number | null> {
  if (!redis) return null;
  try {
    return new Set((await miembrosEnVentana(redis, ahora)).map((m) => m.clinicId)).size;
  } catch (e) {
    avisarUnaVez(e);
    return null;
  }
}

/**
 * Clínicas con señal en la ventana, con sus usuarios. null = sin dato.
 * Tres comandos en total, sin importar cuántas clínicas haya: la poda, el
 * índice y un MGET con los registros de todas las sesiones.
 */
export async function leerClinicasEnLinea(redis: RedisMini | null, ahora: number): Promise<FilaEnLinea[] | null> {
  if (!redis) return null;
  const corte = ahora - VENTANA_EN_LINEA_MS;
  try {
    const miembros = await miembrosEnVentana(redis, ahora);
    if (miembros.length === 0) return [];
    const [crudos] = (await redis.pipeline().mget(...miembros.map((m) => llaveRegistro(m.sufijo))).exec()) as [unknown];
    const registros = Array.isArray(crudos) ? crudos : [];

    // Una persona con dos sesiones (dos navegadores) es UN usuario: la primera «desde», la última señal y su pantalla.
    const porClinica = new Map<string, Map<string, UsuarioEnLinea>>();
    miembros.forEach((m, i) => {
      const r = leerRegistro(registros[i]);
      if (!r || !r.cuenta || r.ts < corte || r.clinicId !== m.clinicId) return;
      const usuarios = porClinica.get(m.clinicId) ?? new Map<string, UsuarioEnLinea>();
      const previo = usuarios.get(r.userId);
      if (!previo) {
        usuarios.set(r.userId, { nombre: r.nombre || "Usuario", pantalla: r.pantalla || "Otra pantalla", desde: r.desde, ultimaSenal: r.ts });
      } else {
        previo.desde = Math.min(previo.desde, r.desde);
        if (r.ts > previo.ultimaSenal) { previo.ultimaSenal = r.ts; previo.pantalla = r.pantalla || previo.pantalla; }
      }
      porClinica.set(m.clinicId, usuarios);
    });

    return Array.from(porClinica.entries())
      .slice(0, MAX_CLINICAS_EN_LISTA)
      .map(([clinicId, usuarios]) => ({ clinicId, desde: null, usuarios: Array.from(usuarios.values()) }));
  } catch (e) {
    avisarUnaVez(e);
    return null;
  }
}

/** Conteo con tope de espera: la portada no se cuelga porque Redis tarde. */
export async function contarConEspera(redis: RedisMini | null, ahora: number, esperaMs = 1500): Promise<number | null> {
  if (!redis) return null;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      contarClinicasEnLinea(redis, ahora),
      new Promise<null>((listo) => { reloj = setTimeout(() => listo(null), esperaMs); }),
    ]);
  } finally {
    clearTimeout(reloj);
  }
}
