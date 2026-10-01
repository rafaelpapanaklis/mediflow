/**
 * «Clínicas en línea» — el almacén en Redis (Upstash) y la lógica de la señal.
 *
 * 🔴 SIN BASE DE DATOS en el camino de la señal. El 1-oct hubo un incidente de
 * conexiones (pooler lleno); esto manda una señal por minuto y por pestaña, así
 * que NO abre ni una conexión de Prisma por señal:
 *   · quién es el usuario (clínica, id, nombre, si cuenta) se resuelve UNA vez
 *     y queda en Redis 10 min con la llave sesión + clínica de la cookie;
 *   · las señales siguientes solo hablan con Redis (2 viajes: leer identidad +
 *     límite, y escribir).
 *
 * Sin Redis (UPSTASH_REDIS_REST_URL/TOKEN sin poner: panel.108, dev.108) nada
 * falla: la señal contesta «no se guarda» sin tocar nada, y la tarjeta dice
 * «sin dato». Un error de Redis en runtime hace lo mismo (fail-open, un warn).
 *
 * ── Qué hay en Redis (todo con caducidad) ────────────────────────────────
 *   pres:u:<clínica>:<usuario>   hash  desde · ts · ruta · nombre      TTL 5 min
 *        `desde` solo lo pone HSETNX: mientras haya señales cada <5 min el hash
 *        no caduca y `desde` se conserva = «en línea desde» de la sesión continua.
 *   pres:c:<clínica>             zset  usuario → última señal           TTL 10 min
 *   pres:cs:<clínica>            hash  desde (sesión continua de la clínica) TTL 5 min
 *   pres:clinicas                zset  clínica → última señal de cualquiera
 *        Índice global: «cuántas clínicas en línea» es UN ZCOUNT. No lleva TTL
 *        propio (un miembro por clínica, acotado); la ventana lo ignora y el
 *        detalle lo poda.
 *   pres:id:<sesión>:<clínica>   JSON  identidad resuelta                TTL 10 min
 *   pres:rl:<usuario>:<minuto>   int   límite por usuario                TTL 2 min
 *
 * Una nota de coste: cada señal son ~11 comandos de Upstash (3 + 8). Con un
 * EVAL de Lua serían 2, pero no hay un Redis local con el que probar el script
 * antes de ponerlo en producción; es una mejora fácil si el coste importa.
 */
import { Redis } from "@upstash/redis";
import {
  MAX_CLINICAS_EN_LISTA,
  MAX_LATIDOS_POR_MINUTO,
  VENTANA_EN_LINEA_MS,
  etiquetaDePantalla,
  type FilaEnLinea,
  type UsuarioEnLinea,
} from "./presencia-core";

// ─────────────────────────── Cliente (mínimo, inyectable) ───────────────────

/** Lo que se usa de un pipeline de Upstash. Lo cumple `redis.pipeline()` y el falso de las pruebas. */
export interface PipelineMini {
  get(k: string): PipelineMini;
  set(k: string, v: unknown, opts?: { ex?: number }): PipelineMini;
  incr(k: string): PipelineMini;
  expire(k: string, segundos: number): PipelineMini;
  hset(k: string, kv: Record<string, unknown>): PipelineMini;
  hsetnx(k: string, campo: string, v: unknown): PipelineMini;
  hgetall(k: string): PipelineMini;
  zadd(k: string, sm: { score: number; member: string }): PipelineMini;
  zcount(k: string, min: number, max: number | "+inf"): PipelineMini;
  zrange(k: string, min: number, max: number | "+inf", opts: { byScore: true }): PipelineMini;
  zremrangebyscore(k: string, min: number | "-inf", max: number): PipelineMini;
  exec(): Promise<unknown[]>;
}
export interface RedisMini {
  pipeline(): PipelineMini;
}

let cliente: RedisMini | null | undefined;
let avisoRuntime = false;

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

/** Solo para pruebas: fija (o limpia con undefined) el cliente. */
export function _fijarRedisParaPruebas(r: RedisMini | null | undefined): void {
  cliente = r;
  avisoRuntime = false;
}

function avisarUnaVez(e: unknown): void {
  if (avisoRuntime) return;
  avisoRuntime = true;
  console.warn("[presencia] error de Redis; «en línea» sin dato hasta que vuelva:", e instanceof Error ? e.message : e);
}

// ─────────────────────────── Llaves ─────────────────────────────────────────

const K = {
  usuario: (clinicId: string, userId: string) => `pres:u:${clinicId}:${userId}`,
  clinica: (clinicId: string) => `pres:c:${clinicId}`,
  clinicaSesion: (clinicId: string) => `pres:cs:${clinicId}`,
  global: "pres:clinicas",
  identidad: (sesion: string, clinicaCookie: string | null) => `pres:id:${sesion}:${clinicaCookie ?? "-"}`,
  limite: (userId: string, minuto: number) => `pres:rl:${userId}:${minuto}`,
};

const TTL_VENTANA_S = Math.round(VENTANA_EN_LINEA_MS / 1000);
const TTL_IDENTIDAD_S = 10 * 60;

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
  /** Id de usuario de Supabase, ya validado con getUser(). */
  supabaseId: string;
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

function leerIdentidad(v: unknown): IdentidadLatido | null {
  let o: unknown = v;
  if (typeof v === "string") {
    try { o = JSON.parse(v); } catch { return null; }
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (typeof r.clinicId !== "string" || typeof r.userId !== "string") return null;
  return {
    clinicId: r.clinicId,
    userId: r.userId,
    nombre: typeof r.nombre === "string" ? r.nombre : "",
    cuenta: r.cuenta === true,
  };
}

/**
 * Procesa UNA señal. Orden pensado para gastar lo menos posible:
 *   1. sin Redis → nada (ni siquiera se pregunta quién es);
 *   2. un viaje: identidad en caché + contador de límite del usuario;
 *   3. límite superado → 429, sin tocar nada más;
 *   4. identidad desconocida → UNA resolución con la base y se guarda 10 min;
 *   5. si no cuenta → fuera; si cuenta → un viaje que escribe todo.
 */
export async function procesarLatido(deps: DepsLatido, e: EntradaLatido): Promise<ResultadoLatido> {
  const redis = deps.redis;
  if (!redis) return { estado: 200, guardado: false, motivo: "sin-redis" };

  try {
    const minuto = Math.floor(e.ahora / 60_000);
    const llaveId = K.identidad(e.sesion, e.clinicaCookie);
    const llaveRl = K.limite(e.supabaseId, minuto);

    const [crudaId, usados] = (await redis
      .pipeline()
      .get(llaveId)
      .incr(llaveRl)
      .expire(llaveRl, 120)
      .exec()) as [unknown, number, unknown];

    if (typeof usados === "number" && usados > MAX_LATIDOS_POR_MINUTO) {
      return { estado: 429, reintentarEnS: Math.max(1, 60 - Math.floor((e.ahora % 60_000) / 1000)) };
    }

    let identidad = leerIdentidad(crudaId);
    if (!identidad) {
      identidad = await deps.resolverIdentidad();
      if (!identidad) return { estado: 401 };
      await redis.pipeline().set(llaveId, JSON.stringify(identidad), { ex: TTL_IDENTIDAD_S }).exec();
    }
    if (!identidad.cuenta) return { estado: 200, guardado: false, motivo: "no-cuenta" };

    const { clinicId, userId } = identidad;
    const u = K.usuario(clinicId, userId);
    const cs = K.clinicaSesion(clinicId);
    const c = K.clinica(clinicId);
    await redis
      .pipeline()
      .hsetnx(u, "desde", e.ahora)
      .hset(u, { ts: e.ahora, ruta: etiquetaDePantalla(e.ruta), nombre: identidad.nombre })
      .expire(u, TTL_VENTANA_S)
      .zadd(c, { score: e.ahora, member: userId })
      .expire(c, 2 * TTL_VENTANA_S)
      .zadd(K.global, { score: e.ahora, member: clinicId })
      .hsetnx(cs, "desde", e.ahora)
      .expire(cs, TTL_VENTANA_S)
      .exec();
    return { estado: 200, guardado: true };
  } catch (err) {
    avisarUnaVez(err);
    return { estado: 200, guardado: false, motivo: "error" };
  }
}

// ─────────────────────────── Lo que lee /admin ──────────────────────────────

/** null = sin dato (sin Redis o Redis falló): la tarjeta dice «sin dato», no «0». */
export async function contarClinicasEnLinea(redis: RedisMini | null, ahora: number): Promise<number | null> {
  if (!redis) return null;
  try {
    const [n] = (await redis.pipeline().zcount(K.global, ahora - VENTANA_EN_LINEA_MS, "+inf").exec()) as [number];
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch (e) {
    avisarUnaVez(e);
    return null;
  }
}

function aTexto(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}
function aNumero(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function lista(v: unknown): string[] {
  return Array.isArray(v) ? v.map(aTexto).filter(Boolean) : [];
}

/**
 * Clínicas con señal en la ventana, con sus usuarios. null = sin dato.
 * Tres viajes en total, sin importar cuántas clínicas haya: el índice global,
 * los usuarios de todas, y el detalle de todos.
 */
export async function leerClinicasEnLinea(redis: RedisMini | null, ahora: number): Promise<FilaEnLinea[] | null> {
  if (!redis) return null;
  const corte = ahora - VENTANA_EN_LINEA_MS;
  try {
    // 1) El índice (y de paso se poda lo que lleva más de un día sin señal).
    const r1 = (await redis
      .pipeline()
      .zremrangebyscore(K.global, "-inf", ahora - 24 * 60 * 60_000)
      .zrange(K.global, corte, "+inf", { byScore: true })
      .exec()) as [unknown, unknown];
    const clinicas = lista(r1[1]).slice(0, MAX_CLINICAS_EN_LISTA);
    if (clinicas.length === 0) return [];

    // 2) Los usuarios con señal en la ventana y el «desde» de cada clínica.
    const p2 = redis.pipeline();
    for (const id of clinicas) p2.zrange(K.clinica(id), corte, "+inf", { byScore: true }).hgetall(K.clinicaSesion(id));
    const r2 = (await p2.exec()) as unknown[];

    const pares: Array<{ clinicId: string; userId: string }> = [];
    const desdeClinica = new Map<string, number | null>();
    clinicas.forEach((id, i) => {
      for (const userId of lista(r2[i * 2])) pares.push({ clinicId: id, userId });
      const h = r2[i * 2 + 1] as Record<string, unknown> | null;
      desdeClinica.set(id, h ? aNumero(h.desde) : null);
    });

    // 3) El detalle de cada usuario.
    const p3 = redis.pipeline();
    for (const p of pares) p3.hgetall(K.usuario(p.clinicId, p.userId));
    const r3 = pares.length ? ((await p3.exec()) as unknown[]) : [];

    const porClinica = new Map<string, UsuarioEnLinea[]>();
    pares.forEach((p, i) => {
      const h = r3[i] as Record<string, unknown> | null;
      if (!h) return; // su hash ya caducó: no está en línea
      const ts = aNumero(h.ts);
      if (ts === null) return;
      const desde = aNumero(h.desde) ?? ts;
      const u: UsuarioEnLinea = {
        nombre: aTexto(h.nombre) || "Usuario",
        pantalla: aTexto(h.ruta) || "Otra pantalla",
        desde,
        ultimaSenal: ts,
      };
      const lst = porClinica.get(p.clinicId);
      if (lst) lst.push(u); else porClinica.set(p.clinicId, [u]);
    });

    return clinicas.map((id) => ({
      clinicId: id,
      desde: desdeClinica.get(id) ?? null,
      usuarios: porClinica.get(id) ?? [],
    }));
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
