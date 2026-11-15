// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — Mercado Pago de la tienda: base y red (ws6-t5).
//
// Es el ÚNICO módulo de barber que toca los tokens de Mercado Pago. Reglas
// (las mismas del dental, src/lib/anticipos/cuenta.server.ts):
//   · los tokens se guardan CIFRADOS (AES-256-GCM, src/lib/crypto/envelope.ts);
//     sin DATA_ENCRYPTION_KEY no se guardan, y uno que no se puede abrir se
//     trata como «vuelve a conectar», nunca como un error de la página;
//   · jamás salen hacia la pantalla ni la API (el estado lleva apodo, correo
//     y la cuenta enmascarada), y jamás se escriben en un log.
//
// La conexión es de la CADENA: una fila por matriz en
// barber_mercadopago_accounts (sql/barber_mercadopago.sql); las sucursales
// cobran con la cuenta de su matriz. Los pedidos viven en la tabla de la
// tienda de ws6-t1 (barber_product_orders): aquí solo se LEEN y, del webhook,
// se escriben status, paid_at y mp_payment_id (y mp_preference_id al hacer
// el link). Nada más.
//
// SQL crudo y sin `import "server-only"` a propósito (precedente:
// agenda-comun.ts): así no hay que regenerar Prisma, el código funciona
// ANTES de pegar el SQL (sin tabla = «sin conexión») y las pruebas con tsx lo
// cargan sin trucos. Lo importan solo rutas de API y páginas de servidor.
// ═══════════════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptField, encryptField } from "@/lib/crypto/envelope";
import {
  createPreference,
  expirePreference,
  getPayment,
  type CreatePreferenceOptions,
  type CreatePreferenceResult,
  type MercadoPagoPayment,
} from "@/lib/mercadopago";
import { renovarTokens, type ConfigOAuth, type CuentaMp, type TokensMp } from "@/lib/anticipos/mp-oauth";
import { isMissingTableError, isSchemaBehindError } from "@/lib/barber/db-errors";
import {
  BARBER_MP_CALLBACK_PATH,
  BARBER_MP_EXCLUDED_PAYMENT_TYPES,
  BARBER_MP_WEBHOOK_PATH,
  comisionDelPedido,
  enmascararCuenta,
  evaluarPagoDePedido,
  motivoSinCobro,
  renglonesDelPedido,
  venceElPedido,
  vueltaSegura,
  type MotivoSinCobro,
} from "@/lib/barber/mercadopago-core";

type Db = typeof prisma;

/** Vida de un token de MP si la respuesta no la trae (180 días). */
const VIDA_DEFAULT_S = 180 * 24 * 60 * 60;
/** Se renueva cuando le queda menos de esto. */
const RENOVAR_ANTES_MS = 7 * 24 * 60 * 60 * 1000;

// ── Plataforma (las variables las pone Rafael en Vercel) ────────────────

export function urlBaseApp(): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  return base ? base.replace(/\/+$/, "") : null;
}

export function cifradoDisponible(): boolean {
  return /^[0-9a-fA-F]{64}$/.test(process.env.DATA_ENCRYPTION_KEY ?? "");
}

/**
 * Credenciales de la aplicación de DaleControl con la redirect URI de BARBER.
 * MERCADOPAGO_OAUTH_REDIRECT_URI es del dental y aquí NO se lee: si estuviera
 * puesta, mandaría a las barberías al callback de las clínicas.
 */
export function configOAuthBarber(): ConfigOAuth | null {
  const clientId = process.env.MERCADOPAGO_CLIENT_ID?.trim();
  const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET?.trim();
  const base = urlBaseApp();
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}${BARBER_MP_CALLBACK_PATH}` };
}

export interface PlataformaMp {
  lista: boolean;
  /** Nombres de las variables que faltan (para la pantalla y el reporte). */
  falta: string[];
}

/** ¿DaleControl ya puede conectar cuentas y recibir los avisos de pago? */
export function plataformaMpBarber(): PlataformaMp {
  const falta: string[] = [];
  if (!process.env.MERCADOPAGO_CLIENT_ID?.trim()) falta.push("MERCADOPAGO_CLIENT_ID");
  if (!process.env.MERCADOPAGO_CLIENT_SECRET?.trim()) falta.push("MERCADOPAGO_CLIENT_SECRET");
  // Sin el secreto el webhook rechaza todo aviso (falla cerrado, como el
  // dental): un pago se cobraría y el pedido nunca quedaría pagado.
  if (!process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim()) falta.push("MERCADOPAGO_WEBHOOK_SECRET");
  if (!cifradoDisponible()) falta.push("DATA_ENCRYPTION_KEY");
  if (!urlBaseApp()) falta.push("NEXT_PUBLIC_APP_URL");
  return { lista: falta.length === 0, falta };
}

// ── Dependencias (las pruebas cambian red, reloj y base) ────────────────

export interface DepsMpBarber {
  db: Db;
  ahora: () => Date;
  baseUrl: () => string | null;
  plataformaLista: () => boolean;
  consultarPago: (token: string, paymentId: string) => Promise<MercadoPagoPayment | null>;
  crearPreferencia: (token: string, opts: CreatePreferenceOptions) => Promise<CreatePreferenceResult>;
  expirarPreferencia: (token: string, preferenceId: string) => Promise<void>;
  renovar: (refreshToken: string) => Promise<TokensMp>;
}

export const depsReales: DepsMpBarber = {
  db: prisma,
  ahora: () => new Date(),
  baseUrl: urlBaseApp,
  plataformaLista: () => plataformaMpBarber().lista,
  consultarPago: (token, paymentId) => getPayment(token, paymentId, { throwOnAuthError: true }),
  crearPreferencia: createPreference,
  expirarPreferencia: (token, id) => expirePreference(token, id),
  renovar: (refreshToken) => {
    const cfg = configOAuthBarber();
    if (!cfg) return Promise.reject(new Error("Mercado Pago sin configurar"));
    return renovarTokens(cfg, refreshToken);
  },
};

function deps(over?: Partial<DepsMpBarber>): DepsMpBarber {
  return over ? { ...depsReales, ...over } : depsReales;
}

/** La tabla (o una columna) que todavía no existe: el SQL va por detrás del deploy. */
export function faltaTabla(e: unknown): boolean {
  return isMissingTableError(e) || isSchemaBehindError(e);
}

// ── La cadena ───────────────────────────────────────────────────────────

/** Matriz de la cadena de una barbería (ella misma si no es sucursal). null = no existe. */
export async function matrizDe(barbershopId: string, db: Db = prisma): Promise<{ id: string; slug: string } | null> {
  if (!barbershopId) return null;
  const shop = await db.barbershop.findUnique({
    where: { id: barbershopId },
    select: { id: true, slug: true, parentId: true },
  });
  if (!shop) return null;
  if (!shop.parentId) return { id: shop.id, slug: shop.slug };
  const raiz = await db.barbershop.findUnique({ where: { id: shop.parentId }, select: { id: true, slug: true } });
  return raiz ?? { id: shop.id, slug: shop.slug };
}

// ── La fila de la conexión ──────────────────────────────────────────────

interface FilaCuenta {
  mp_user_id: string | null;
  mp_nickname: string | null;
  mp_email: string | null;
  live_mode: boolean | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: Date | null;
  connected_at: Date | null;
  disconnected_at: Date | null;
  marketplace_fee_mode: string;
  marketplace_fee_value: number;
}

/** La fila, o null si no hay; `sinTabla` si el SQL aún no se pega. */
async function leerFila(db: Db, rootId: string): Promise<{ fila: FilaCuenta | null; sinTabla: boolean }> {
  if (!rootId) return { fila: null, sinTabla: false };
  try {
    const filas = await db.$queryRaw<FilaCuenta[]>(Prisma.sql`
      SELECT mp_user_id, mp_nickname, mp_email, live_mode, access_token, refresh_token,
             token_expires_at, connected_at, disconnected_at,
             marketplace_fee_mode, marketplace_fee_value::float8 AS marketplace_fee_value
        FROM barber_mercadopago_accounts
       WHERE barbershop_id = ${rootId}
    `);
    return { fila: filas[0] ?? null, sinTabla: false };
  } catch (e) {
    if (faltaTabla(e)) return { fila: null, sinTabla: true };
    throw e;
  }
}

/** Descifra; null si falta la llave, cambió o el dato está roto (se loguea SIN el dato). */
function abrir(valor: string | null | undefined, rootId: string): string | null {
  if (!valor) return null;
  try {
    return decryptField(valor);
  } catch {
    console.error(`[barber-mp] token de Mercado Pago ilegible (barbería ${rootId}): ¿falta o cambió DATA_ENCRYPTION_KEY?`);
    return null;
  }
}

function vence(tokens: TokensMp, ahora: Date): Date {
  const s = tokens.expiresIn > 0 ? tokens.expiresIn : VIDA_DEFAULT_S;
  return new Date(ahora.getTime() + s * 1000);
}

export class BarberMpStorageError extends Error {
  constructor() {
    super("Falta aplicar sql/barber_mercadopago.sql en la base de datos.");
    this.name = "BarberMpStorageError";
  }
}

/**
 * Guarda la conexión recién autorizada. LANZA si no hay llave de cifrado o
 * falta la tabla: el callback lo convierte en «no se pudo conectar».
 * Reconectar con OTRA cuenta reemplaza la anterior (los links viejos se
 * dejan de poder verificar: el webhook reintenta hasta que vuelva la original).
 */
export async function guardarConexion(
  args: { rootId: string; barberUserId: string; tokens: TokensMp; cuenta: CuentaMp | null },
  db: Db = prisma,
  ahora: Date = new Date(),
): Promise<void> {
  if (!args.rootId) throw new Error("barbería requerida");
  if (!cifradoDisponible()) throw new Error("DATA_ENCRYPTION_KEY no configurada: el token no se guarda sin cifrar");
  const access = encryptField(args.tokens.accessToken);
  const refresh = args.tokens.refreshToken ? encryptField(args.tokens.refreshToken) : null;
  try {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO barber_mercadopago_accounts
        (barbershop_id, mp_user_id, mp_nickname, mp_email, live_mode, access_token, refresh_token,
         token_expires_at, connected_at, connected_by_id, disconnected_at, updated_at)
      VALUES
        (${args.rootId}, ${args.tokens.userId}, ${args.cuenta?.nickname ?? null}, ${args.cuenta?.email ?? null},
         ${args.tokens.liveMode}, ${access}, ${refresh}, ${vence(args.tokens, ahora)}, ${ahora},
         ${args.barberUserId}, NULL, ${ahora})
      ON CONFLICT (barbershop_id) DO UPDATE SET
        mp_user_id       = EXCLUDED.mp_user_id,
        mp_nickname      = EXCLUDED.mp_nickname,
        mp_email         = EXCLUDED.mp_email,
        live_mode        = EXCLUDED.live_mode,
        access_token     = EXCLUDED.access_token,
        refresh_token    = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        connected_at     = EXCLUDED.connected_at,
        connected_by_id  = EXCLUDED.connected_by_id,
        disconnected_at  = NULL,
        updated_at       = EXCLUDED.updated_at
    `);
    // La comisión NO va en el UPDATE: reconectar no la cambia.
  } catch (e) {
    if (faltaTabla(e)) throw new BarberMpStorageError();
    throw e;
  }
}

/**
 * Desconecta: borra los dos tokens (quedan en NULL). La fila se queda: dice
 * con qué cuenta estuvo conectada y cuándo se desconectó. Devuelve si había
 * algo que desconectar.
 */
export async function desconectarCuenta(rootId: string, db: Db = prisma, ahora: Date = new Date()): Promise<boolean> {
  if (!rootId) return false;
  try {
    const n = await db.$executeRaw(Prisma.sql`
      UPDATE barber_mercadopago_accounts
         SET access_token = NULL, refresh_token = NULL, token_expires_at = NULL,
             disconnected_at = ${ahora}, updated_at = ${ahora}
       WHERE barbershop_id = ${rootId} AND access_token IS NOT NULL
    `);
    return n > 0;
  } catch (e) {
    if (faltaTabla(e)) return false;
    throw e;
  }
}

export interface CredencialDeCobro {
  accessToken: string;
  /** user_id de MP de la cuenta conectada: el collector de los pagos. */
  mpUserId: string;
  feeMode: string;
  feeValue: number;
}

/**
 * El token con el que se cobra y se verifica, renovado si le queda poco.
 * null = sin cuenta conectada, sin tabla, o token ilegible/vencido.
 */
export async function credencialDeCobro(
  rootId: string,
  over?: Partial<DepsMpBarber>,
): Promise<CredencialDeCobro | null> {
  const d = deps(over);
  const { fila } = await leerFila(d.db, rootId);
  if (!fila?.access_token || !fila.mp_user_id) return null;
  let token = abrir(fila.access_token, rootId);
  if (!token) return null;
  const ahora = d.ahora();

  const venceMs = fila.token_expires_at?.getTime() ?? 0;
  if (venceMs - ahora.getTime() < RENOVAR_ANTES_MS) {
    const refresh = abrir(fila.refresh_token, rootId);
    if (refresh) {
      try {
        const nuevos = await d.renovar(refresh);
        // Solo gana quien renovó sobre el refresh token que leyó: si otro
        // proceso renovó a la vez, su token ya está guardado y se usa ese.
        const escrito = await d.db.$executeRaw(Prisma.sql`
          UPDATE barber_mercadopago_accounts
             SET access_token = ${encryptField(nuevos.accessToken)},
                 refresh_token = ${nuevos.refreshToken ? encryptField(nuevos.refreshToken) : fila.refresh_token},
                 token_expires_at = ${vence(nuevos, ahora)},
                 updated_at = ${ahora}
           WHERE barbershop_id = ${rootId} AND refresh_token = ${fila.refresh_token}
        `);
        if (escrito === 1) {
          token = nuevos.accessToken;
        } else {
          const otra = await leerFila(d.db, rootId);
          token = abrir(otra.fila?.access_token, rootId) ?? token;
        }
      } catch (e) {
        console.error(`[barber-mp] no se pudo renovar el token (barbería ${rootId}): ${(e as Error).message}`);
        if (venceMs <= ahora.getTime()) return null;
      }
    } else if (venceMs <= ahora.getTime()) {
      return null;
    }
  }
  return {
    accessToken: token,
    mpUserId: fila.mp_user_id,
    feeMode: fila.marketplace_fee_mode,
    feeValue: Number(fila.marketplace_fee_value) || 0,
  };
}

// ── Estado para la pantalla y la tienda (sin secretos) ──────────────────

export interface EstadoMpBarber {
  /** La barbería PUEDE cobrar en línea ahora: plataforma lista + cuenta con token legible. */
  connected: boolean;
  /** Hay una conexión guardada cuyo token ya no sirve (llave, vencido): «vuelve a conectar». */
  needsReconnect: boolean;
  /** false = sql/barber_mercadopago.sql aún no está pegado. */
  storageReady: boolean;
  /** DaleControl tiene las variables de entorno puestas. */
  platformReady: boolean;
  account: { nickname: string | null; email: string | null; id: string | null; testMode: boolean } | null;
  connectedAt: string | null;
}

const ESTADO_VACIO: EstadoMpBarber = {
  connected: false,
  needsReconnect: false,
  storageReady: true,
  platformReady: false,
  account: null,
  connectedAt: null,
};

/**
 * El estado de la cuenta de la cadena. NUNCA lanza por la conexión: un token
 * ilegible es `needsReconnect`, una tabla que falta es `storageReady: false`.
 */
export async function estadoCuentaMp(rootId: string, over?: Partial<DepsMpBarber>): Promise<EstadoMpBarber> {
  const d = deps(over);
  const platformReady = d.plataformaLista();
  if (!rootId) return { ...ESTADO_VACIO, platformReady };
  let leida: { fila: FilaCuenta | null; sinTabla: boolean };
  try {
    leida = await leerFila(d.db, rootId);
  } catch (e) {
    console.error(`[barber-mp] no se pudo leer la conexión (barbería ${rootId}): ${(e as Error).message}`);
    return { ...ESTADO_VACIO, platformReady };
  }
  if (leida.sinTabla) return { ...ESTADO_VACIO, storageReady: false, platformReady };
  const fila = leida.fila;
  if (!fila?.access_token || !fila.mp_user_id) return { ...ESTADO_VACIO, platformReady };

  const ahora = d.ahora().getTime();
  const legible = abrir(fila.access_token, rootId) != null;
  // Vencido sin refresh token: ya no hay cómo renovarlo.
  const vencido = (fila.token_expires_at?.getTime() ?? 0) <= ahora && !fila.refresh_token;
  const sirve = legible && !vencido;
  return {
    connected: sirve && platformReady,
    needsReconnect: !sirve,
    storageReady: true,
    platformReady,
    account: {
      nickname: fila.mp_nickname,
      email: fila.mp_email,
      id: enmascararCuenta(fila.mp_user_id),
      testMode: fila.live_mode === false,
    },
    connectedAt: fila.connected_at ? fila.connected_at.toISOString() : null,
  };
}

/** Para la tienda (ws6-t1): ¿ofrezco «Pagar ahora en línea» para esta barbería o sucursal? */
export async function tiendaAceptaMercadoPago(barbershopId: string, over?: Partial<DepsMpBarber>): Promise<boolean> {
  const d = deps(over);
  try {
    const raiz = await matrizDe(barbershopId, d.db);
    if (!raiz) return false;
    return (await estadoCuentaMp(raiz.id, d)).connected;
  } catch (e) {
    console.error(`[barber-mp] no se pudo saber si ${barbershopId} cobra en línea: ${(e as Error).message}`);
    return false;
  }
}

// ── El pedido de la tienda (tabla de ws6-t1) ────────────────────────────

interface FilaPedido {
  id: string;
  barbershop_id: string;
  status: string;
  total: number;
  items: unknown;
  created_at: Date;
  mp_preference_id: string | null;
  mp_payment_id: string | null;
  paid_at: Date | null;
}

/**
 * Lee un pedido por id (cast a texto: funciona si ws6-t1 lo hizo text o
 * uuid). null si no existe o si la tabla de la tienda todavía no está.
 */
async function leerPedido(db: Db, orderId: string): Promise<FilaPedido | null> {
  if (!orderId || orderId.length > 64) return null;
  try {
    const filas = await db.$queryRaw<FilaPedido[]>(Prisma.sql`
      SELECT id::text AS id, barbershop_id::text AS barbershop_id, status::text AS status,
             total::float8 AS total, items, created_at, mp_preference_id, mp_payment_id, paid_at
        FROM barber_product_orders
       WHERE id::text = ${orderId}
    `);
    return filas[0] ?? null;
  } catch (e) {
    if (faltaTabla(e)) return null;
    throw e;
  }
}

export type ErrorLinkPedido =
  | "no_encontrado"
  | "sin_mp"
  | MotivoSinCobro
  | "mp_fallo";

export type ResultadoLinkPedido = { ok: true; initPoint: string } | { ok: false; error: ErrorLinkPedido };

/**
 * El link de Mercado Pago para pagar un pedido de la tienda.
 *
 * · Cobra la cuenta de la cadena del pedido; los renglones y el total salen
 *   del pedido (precio congelado), nunca del navegador.
 * · external_reference = id del pedido; el aviso llega al webhook de BARBER
 *   con `?pedido=<id>&cta=<cuenta>`.
 * · Vence a la misma hora que el pedido (created_at + 72 h), sin OXXO ni
 *   transferencias (tardan; el pedido aparta existencias) y binario
 *   (aprobado o rechazado, nunca «pendiente»).
 * · Dos clics a la vez se forman (candado por pedido): la segunda
 *   preferencia reemplaza a la primera y la vieja se cierra en Mercado Pago.
 */
export async function crearLinkDePedido(
  args: { orderId: string; returnPath?: unknown },
  over?: Partial<DepsMpBarber>,
): Promise<ResultadoLinkPedido> {
  const d = deps(over);
  const pedido = await leerPedido(d.db, args.orderId);
  if (!pedido) return { ok: false, error: "no_encontrado" };
  const motivo = motivoSinCobro(
    { id: pedido.id, status: pedido.status, total: Number(pedido.total), items: pedido.items, createdAt: pedido.created_at },
    d.ahora(),
  );
  if (motivo) return { ok: false, error: motivo };

  const base = d.baseUrl();
  const raiz = await matrizDe(pedido.barbershop_id, d.db);
  if (!base || !raiz || !d.plataformaLista()) return { ok: false, error: "sin_mp" };
  const cred = await credencialDeCobro(raiz.id, d);
  if (!cred) return { ok: false, error: "sin_mp" };

  // La página de vuelta es de la barbería DEL PEDIDO (su slug), no de la matriz.
  const tienda = await d.db.barbershop.findUnique({ where: { id: pedido.barbershop_id }, select: { slug: true } });
  const vuelta = `${base}${vueltaSegura(tienda?.slug ?? raiz.slug, pedido.id, args.returnPath)}`;
  const total = Number(pedido.total);
  const renglones = renglonesDelPedido(pedido.items, total);
  if (!renglones.ok) return { ok: false, error: "renglones" };

  let viejo: string | null = null;
  let resultado: ResultadoLinkPedido;
  try {
    resultado = await d.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`barber-mp-pedido:${pedido.id}`}))`;
        const fresco = await leerPedido(tx as unknown as Db, pedido.id);
        if (!fresco) return { ok: false as const, error: "no_encontrado" as const };
        if (fresco.status !== "PENDING") return { ok: false as const, error: "no_pendiente" as const };

        const pref = await d.crearPreferencia(cred.accessToken, {
          items: renglones.items,
          externalReference: pedido.id,
          notificationUrl:
            `${base}${BARBER_MP_WEBHOOK_PATH}?pedido=${encodeURIComponent(pedido.id)}` +
            `&cta=${encodeURIComponent(cred.mpUserId)}`,
          backUrls: { success: vuelta, failure: vuelta, pending: vuelta },
          marketplaceFee: comisionDelPedido(cred.feeMode, cred.feeValue, total),
          expiresAt: venceElPedido(pedido.created_at),
          binaryMode: true,
          excludedPaymentTypes: [...BARBER_MP_EXCLUDED_PAYMENT_TYPES],
        });
        if (!pref?.id || !pref?.initPoint) throw new Error("Mercado Pago no devolvió el link");
        await tx.$executeRaw(Prisma.sql`
          UPDATE barber_product_orders SET mp_preference_id = ${pref.id}
           WHERE id::text = ${pedido.id} AND status::text = 'PENDING'
        `);
        viejo = fresco.mp_preference_id && fresco.mp_preference_id !== pref.id ? fresco.mp_preference_id : null;
        return { ok: true as const, initPoint: pref.initPoint };
      },
      { timeout: 20_000 },
    );
  } catch (e) {
    if (faltaTabla(e)) return { ok: false, error: "no_encontrado" };
    console.error(`[barber-mp] no se pudo crear el link del pedido ${pedido.id}: ${(e as Error).message}`);
    return { ok: false, error: "mp_fallo" };
  }

  // El link anterior deja de aceptar pagos (best-effort: si MP no contesta y
  // alguien lo paga, el webhook lo registra igual y nunca dos veces).
  if (viejo) {
    try {
      await d.expirarPreferencia(cred.accessToken, viejo);
    } catch (e) {
      console.error(`[barber-mp] no se pudo cerrar la preferencia vieja ${viejo}: ${(e as Error).message}`);
    }
  }
  return resultado;
}

// ── El aviso de pago (webhook) ──────────────────────────────────────────

export type ResultadoPagoPedido =
  | { aplicado: true; estado: "PAID_ONLINE" | "READY" }
  | { aplicado: false; motivo: string };

/**
 * Aplica un pago avisado por Mercado Pago a un pedido de la tienda.
 *
 * Nada del aviso se cree: el pago se RELEE en Mercado Pago con el token de la
 * barbería del pedido (un pago de otra cuenta no se ve con ese token) y se
 * exige external_reference, cuenta, aprobado, MXN e importe exacto
 * (evaluarPagoDePedido). Se marca con UN UPDATE condicionado
 * (sin mp_payment_id y en PENDING/READY): dos avisos a la vez, o el mismo
 * repetido, marcan una sola vez.
 *
 * LANZA solo en lo transitorio (red, 5xx de MP, base, cuenta que cambió o
 * token que no abre): el webhook responde 500 y Mercado Pago reintenta.
 */
export async function aplicarPagoDePedido(
  args: { orderId: string; paymentId: string; cuentaDelLink?: string | null },
  over?: Partial<DepsMpBarber>,
): Promise<ResultadoPagoPedido> {
  const d = deps(over);
  if (!args.orderId || !args.paymentId) return { aplicado: false, motivo: "faltan datos" };
  const pedido = await leerPedido(d.db, args.orderId);
  if (!pedido) return { aplicado: false, motivo: "pedido inexistente" };

  const raiz = await matrizDe(pedido.barbershop_id, d.db);
  if (!raiz) return { aplicado: false, motivo: "barbería inexistente" };
  const cred = await credencialDeCobro(raiz.id, d);
  if (!cred) {
    // Igual que el dental: sin token no se puede verificar, y tragarlo con un
    // 200 perdería el pago. Mercado Pago reintenta; al reconectar, se aplica.
    console.error(`[barber-mp] pago ${args.paymentId} del pedido ${pedido.id}: la barbería no tiene cuenta legible; MP reintentará`);
    throw new Error("barbería sin cuenta de Mercado Pago para verificar el pago");
  }
  if (args.cuentaDelLink && args.cuentaDelLink !== cred.mpUserId) {
    console.error(`[barber-mp] pago ${args.paymentId} del pedido ${pedido.id}: la barbería conectó OTRA cuenta; MP reintentará`);
    throw new Error("la barbería conectó otra cuenta de Mercado Pago: el pago no se puede verificar");
  }

  const pago = await d.consultarPago(cred.accessToken, args.paymentId);
  if (!pago) return { aplicado: false, motivo: "Mercado Pago no encuentra el pago en la cuenta de la barbería" };

  const decision = evaluarPagoDePedido(
    {
      id: pedido.id,
      status: pedido.status,
      total: Number(pedido.total),
      mpPaymentId: pedido.mp_payment_id,
      paidAt: pedido.paid_at,
    },
    pago,
    cred.mpUserId,
  );
  if (decision.accion === "ya_marcado") return { aplicado: false, motivo: "pago ya aplicado" };
  if (decision.accion === "ignorar") {
    console.error(`[barber-mp] pago ${pago.id} no marca el pedido ${pedido.id}: ${decision.motivo}`);
    return { aplicado: false, motivo: decision.motivo };
  }

  const ahora = d.ahora();
  // Un solo UPDATE, con las mismas condiciones repetidas en el WHERE: si otro
  // aviso ganó mientras leíamos, este no toca nada.
  const n = await d.db.$executeRaw(Prisma.sql`
    UPDATE barber_product_orders
       SET status = CASE WHEN status::text = 'PENDING' THEN 'PAID_ONLINE' ELSE status END,
           paid_at = ${ahora},
           mp_payment_id = ${pago.id}
     WHERE id::text = ${pedido.id}
       AND mp_payment_id IS NULL
       AND paid_at IS NULL
       AND status::text IN ('PENDING', 'READY')
       AND round(total::numeric, 2) = ${new Prisma.Decimal(Number(pedido.total).toFixed(2))}
  `);
  if (n !== 1) return { aplicado: false, motivo: "pago ya aplicado" };
  return { aplicado: true, estado: decision.nuevoEstado };
}
