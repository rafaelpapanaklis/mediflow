import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { rateLimitKey } from "@/lib/rate-limit";

/**
 * Fail-ban persistente: rate-limit por ventana deslizante (punto 2) + lockout
 * por intentos FALLIDOS por IP y por cuenta con backoff progresivo (punto 3).
 *
 * Backend con FALLBACK:
 *  - Si UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN existen → Upstash
 *    Redis: persistente y COMPARTIDO entre instancias serverless.
 *  - Si NO existen → cae al rate-limit EN MEMORIA (modo degradado; warn una
 *    vez). No persiste ni se comparte entre instancias, pero la app compila y
 *    funciona igual SIN las envs.
 *  - Si Redis FALLA en runtime → fail-OPEN en disponibilidad (NO tumba logins):
 *    esa operación se degrada a la red en memoria y se hace warn una vez.
 *
 * Mensajes SIEMPRE genéricos (no revela si la cuenta existe). 429 + Retry-After.
 */

// ─────────────────────────── Política de lockout ───────────────────────────
export interface LockoutPolicy {
  /** Fallos dentro de la ventana antes del primer bloqueo. */
  threshold: number;
  /** Ventana de conteo de fallos, en segundos. */
  windowSec: number;
  /** Duración del primer bloqueo, en segundos. */
  baseLockSec: number;
  /** Tope del bloqueo (backoff exponencial), en segundos. */
  maxLockSec: number;
}

const DEFAULT_POLICY: LockoutPolicy = {
  threshold: 5,
  windowSec: 15 * 60,
  baseLockSec: 60,
  maxLockSec: 30 * 60,
};

export interface LockoutTarget {
  /** Espacio de nombres del endpoint, ej. "paciente-login". */
  scope: string;
  /** Identificador de cuenta (email/id). Si falta, solo se usa la IP. */
  account?: string | null;
  /** Sobrescribe la política por defecto (parcial). */
  policy?: Partial<LockoutPolicy>;
}

function resolvePolicy(p?: Partial<LockoutPolicy>): LockoutPolicy {
  return { ...DEFAULT_POLICY, ...(p ?? {}) };
}

// ─────────────────────────── Upstash (lazy, seguro) ────────────────────────
let redisClient: Redis | null | undefined;
let warnedNoRedis = false;
let warnedRuntimeFail = false;

/** Cliente Redis o null si faltan envs (warn una sola vez). */
function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warnedNoRedis) {
      console.warn(
        "[failban] UPSTASH_REDIS_REST_URL/TOKEN no configuradas — fail-ban en memoria " +
          "(degradado: no persiste ni se comparte entre instancias serverless).",
      );
      warnedNoRedis = true;
    }
    redisClient = null;
    return null;
  }
  try {
    redisClient = new Redis({ url, token });
  } catch (err) {
    console.warn("[failban] No se pudo inicializar Upstash Redis; usando memoria:", err);
    redisClient = null;
  }
  return redisClient;
}

/** true si el backend persistente (Upstash) está activo. */
export function isPersistentFailbanEnabled(): boolean {
  return getRedis() !== null;
}

function warnRuntime(err: unknown): void {
  if (!warnedRuntimeFail) {
    console.warn("[failban] Error de Redis en runtime — fail-open (red en memoria):", err);
    warnedRuntimeFail = true;
  }
}

// ─────────────────────────── Estado en memoria (fallback) ──────────────────
interface Counter {
  n: number;
  resetAt: number;
}
const memCounters = new Map<string, Counter>();
const memLocks = new Map<string, number>(); // key → lockedUntil (epoch ms)

let lastSweep = Date.now();
function sweep(): void {
  const now = Date.now();
  if (now - lastSweep < 5 * 60 * 1000) return;
  lastSweep = now;
  memCounters.forEach((c, k) => {
    if (c.resetAt < now) memCounters.delete(k);
  });
  memLocks.forEach((until, k) => {
    if (until < now) memLocks.delete(k);
  });
}

// ─────────────────────────── Ratelimit cache (sliding) ─────────────────────
const limiterCache = new Map<string, Ratelimit>();
function getLimiter(redis: Redis, limit: number, windowSec: number): Ratelimit {
  const cacheKey = `${limit}:${windowSec}`;
  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    // `${number} s` es asignable al tipo Duration de @upstash/ratelimit.
    const window = `${windowSec} s` as `${number} s`;
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix: "fb:rl",
      analytics: false,
    });
    limiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

// ─────────────────────────── IP del cliente ────────────────────────────────
/** Misma estrategia que extractAuditMeta: XFF → x-real-ip → cf-connecting-ip. */
export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  const fromXff = xff ? xff.split(",")[0]?.trim() : "";
  return (
    fromXff ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

// ─────────────────────────── 429 genérico ──────────────────────────────────
function tooMany(retryAfterSec: number): NextResponse {
  const retry = Math.max(1, Math.ceil(retryAfterSec));
  return NextResponse.json(
    { error: "Demasiados intentos. Intenta de nuevo más tarde." },
    { status: 429, headers: { "Retry-After": String(retry) } },
  );
}

// ─────────────────────────── Sliding window (punto 2) ──────────────────────
export interface RateLimitOptions {
  /** Identificador (por defecto la IP). */
  id?: string;
  limit: number;
  windowSec?: number;
}

/**
 * Rate-limit por ventana deslizante. Upstash si está configurado; si no,
 * memoria. Fail-open ante error de Redis. Devuelve 429 (con Retry-After) si se
 * excede el límite, o null si la petición pasa.
 */
export async function persistentRateLimit(
  req: NextRequest,
  opts: RateLimitOptions,
): Promise<NextResponse | null> {
  sweep();
  const windowSec = opts.windowSec ?? 60;
  const id = opts.id ?? getClientIp(req);
  const key = `${req.nextUrl.pathname}:${id}`;

  const redis = getRedis();
  if (redis) {
    try {
      const limiter = getLimiter(redis, opts.limit, windowSec);
      const res = await limiter.limit(key);
      if (res.success) return null;
      const retry = (res.reset - Date.now()) / 1000;
      return tooMany(retry > 0 ? retry : windowSec);
    } catch (err) {
      warnRuntime(err);
      // fall-through a memoria
    }
  }
  const allowed = rateLimitKey(`fb:rl:${key}`, opts.limit, windowSec * 1000);
  return allowed ? null : tooMany(windowSec);
}

// ─────────────────────────── Lockout (punto 3) ─────────────────────────────
function subjectsFor(req: NextRequest, target: LockoutTarget): string[] {
  const ip = getClientIp(req);
  const subjects = [`${target.scope}:ip:${ip}`];
  const acct = target.account?.trim().toLowerCase();
  if (acct) subjects.push(`${target.scope}:acct:${acct}`);
  return subjects;
}

/** Segundos de bloqueo para `count` fallos: backoff exponencial con tope. */
function lockSecondsFor(count: number, p: LockoutPolicy): number {
  if (count < p.threshold) return 0;
  const over = count - p.threshold; // 0 justo en el umbral
  const sec = p.baseLockSec * Math.pow(2, over);
  return Math.min(sec, p.maxLockSec);
}

/** Segundos restantes de bloqueo para un subject (0 = no bloqueado). */
async function getLockRetry(subject: string): Promise<number> {
  const lockKey = `fb:lock:${subject}`;
  const redis = getRedis();
  if (redis) {
    try {
      const ttl = await redis.pttl(lockKey); // ms; -2 sin clave, -1 sin expiry
      return ttl && ttl > 0 ? ttl / 1000 : 0;
    } catch (err) {
      warnRuntime(err);
    }
  }
  const until = memLocks.get(lockKey);
  if (until && until > Date.now()) return (until - Date.now()) / 1000;
  return 0;
}

/** Suma un fallo a un subject y aplica el bloqueo con backoff si toca. */
async function bumpFailure(subject: string, p: LockoutPolicy): Promise<void> {
  const cntKey = `fb:cnt:${subject}`;
  const lockKey = `fb:lock:${subject}`;
  const redis = getRedis();
  if (redis) {
    try {
      const n = await redis.incr(cntKey);
      if (n === 1) await redis.expire(cntKey, p.windowSec);
      const lockSec = lockSecondsFor(n, p);
      if (lockSec > 0) await redis.set(lockKey, n, { ex: lockSec });
      return;
    } catch (err) {
      warnRuntime(err);
    }
  }
  const now = Date.now();
  const cur = memCounters.get(cntKey);
  let n: number;
  if (!cur || cur.resetAt < now) {
    n = 1;
    memCounters.set(cntKey, { n: 1, resetAt: now + p.windowSec * 1000 });
  } else {
    cur.n += 1;
    n = cur.n;
  }
  const lockSec = lockSecondsFor(n, p);
  if (lockSec > 0) memLocks.set(lockKey, now + lockSec * 1000);
}

/** Borra contador + bloqueo de un subject (reset tras éxito). */
async function clearSubject(subject: string): Promise<void> {
  const cntKey = `fb:cnt:${subject}`;
  const lockKey = `fb:lock:${subject}`;
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(cntKey, lockKey);
      return;
    } catch (err) {
      warnRuntime(err);
    }
  }
  memCounters.delete(cntKey);
  memLocks.delete(lockKey);
}

/**
 * Guard de lockout: 429 (con Retry-After) si la IP o la cuenta están
 * bloqueadas por exceso de fallos; null si puede continuar. Llamar al inicio
 * del handler, ANTES de validar credenciales.
 */
export async function failbanGuard(
  req: NextRequest,
  target: LockoutTarget,
): Promise<NextResponse | null> {
  sweep();
  const subjects = subjectsFor(req, target); // máx 2 → Promise.all seguro (<7)
  const retries = await Promise.all(subjects.map((s) => getLockRetry(s)));
  const worst = Math.max(0, ...retries);
  return worst > 0 ? tooMany(worst) : null;
}

/** Registra un intento FALLIDO (IP + cuenta) con backoff progresivo. */
export async function recordAuthFailure(
  req: NextRequest,
  target: LockoutTarget,
): Promise<void> {
  const p = resolvePolicy(target.policy);
  const subjects = subjectsFor(req, target); // máx 2 → Promise.all seguro (<7)
  await Promise.all(subjects.map((s) => bumpFailure(s, p)));
}

/** Reinicia contadores y bloqueos (IP + cuenta) tras un login EXITOSO. */
export async function recordAuthSuccess(
  req: NextRequest,
  target: LockoutTarget,
): Promise<void> {
  const subjects = subjectsFor(req, target); // máx 2 → Promise.all seguro (<7)
  await Promise.all(subjects.map((s) => clearSubject(s)));
}
