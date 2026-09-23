// La cuenta de Mercado Pago de la clínica (WS1-T5): guardar, leer, renovar y
// desconectar. Es el ÚNICO módulo que toca los tokens.
//
// Los tokens son el permiso para cobrar a nombre de la clínica. Reglas:
//   · se guardan CIFRADOS (AES-256-GCM, src/lib/crypto/envelope.ts). Sin
//     DATA_ENCRYPTION_KEY no se guardan: la conexión se niega, y la pantalla
//     lo dice. A diferencia de la llave de Facturapi —que cae a texto plano con
//     un aviso—, un token que mueve dinero de pacientes no se deja en claro;
//     mismo criterio que el token de WhatsApp del instituto (edu/whatsapp.ts).
//   · jamás salen de aquí hacia la pantalla ni la API: `estadoDeLaCuenta`
//     devuelve apodo, correo y fechas, nunca el token ni un trozo.
//   · jamás se escriben en un log.

import { prisma } from "@/lib/prisma";
import { decryptField, encryptField } from "@/lib/crypto/envelope";
import { renovarTokens, type ConfigOAuth, type CuentaMp, type TokensMp } from "./mp-oauth";

type Db = typeof prisma;

/** Vida de un token de MP si la respuesta no la trae (180 días). */
const VIDA_DEFAULT_S = 180 * 24 * 60 * 60;
/** Se renueva cuando le queda menos de esto. */
const RENOVAR_ANTES_MS = 7 * 24 * 60 * 60 * 1000;

export function urlBaseApp(): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  return base ? base.replace(/\/+$/, "") : null;
}

export function cifradoDisponible(): boolean {
  const hex = process.env.DATA_ENCRYPTION_KEY ?? "";
  return /^[0-9a-fA-F]{64}$/.test(hex);
}

/** Credenciales de la APLICACIÓN de DaleControl en Mercado Pago (las pone Rafael). */
export function configOAuth(): ConfigOAuth | null {
  const clientId = process.env.MERCADOPAGO_CLIENT_ID?.trim();
  const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET?.trim();
  const base = urlBaseApp();
  if (!clientId || !clientSecret || !base) return null;
  const redirectUri =
    process.env.MERCADOPAGO_OAUTH_REDIRECT_URI?.trim() || `${base}/api/mercadopago/oauth/callback`;
  return { clientId, clientSecret, redirectUri };
}

export interface PlataformaAnticipos {
  lista: boolean;
  /** Nombres de las variables de entorno que faltan (para la pantalla y el reporte). */
  falta: string[];
}

/** ¿DaleControl ya puede conectar cuentas? Sin esto, la función entera está apagada. */
export function plataformaAnticipos(): PlataformaAnticipos {
  const falta: string[] = [];
  if (!process.env.MERCADOPAGO_CLIENT_ID?.trim()) falta.push("MERCADOPAGO_CLIENT_ID");
  if (!process.env.MERCADOPAGO_CLIENT_SECRET?.trim()) falta.push("MERCADOPAGO_CLIENT_SECRET");
  if (!cifradoDisponible()) falta.push("DATA_ENCRYPTION_KEY");
  if (!urlBaseApp()) falta.push("NEXT_PUBLIC_APP_URL");
  return { lista: falta.length === 0, falta };
}

function vence(tokens: TokensMp, ahora: Date): Date {
  const s = tokens.expiresIn > 0 ? tokens.expiresIn : VIDA_DEFAULT_S;
  return new Date(ahora.getTime() + s * 1000);
}

/** Descifra; null si falta la llave, cambió o el dato está roto (se loguea SIN el dato). */
function abrir(valor: string | null | undefined, clinicId: string): string | null {
  if (!valor) return null;
  try {
    return decryptField(valor);
  } catch {
    console.error(`[anticipos] token de Mercado Pago ilegible (clínica ${clinicId}): ¿DATA_ENCRYPTION_KEY rotada?`);
    return null;
  }
}

/**
 * Guarda la conexión recién autorizada. LANZA si no hay llave de cifrado
 * (encryptField tira): el callback lo convierte en «no se pudo conectar».
 */
export async function guardarConexion(
  args: { clinicId: string; userId: string; tokens: TokensMp; cuenta: CuentaMp | null },
  db: Db = prisma,
  ahora: Date = new Date(),
): Promise<void> {
  if (!cifradoDisponible()) throw new Error("DATA_ENCRYPTION_KEY no configurada: el token no se guarda sin cifrar");
  const datos = {
    mpUserId: args.tokens.userId,
    mpNickname: args.cuenta?.nickname ?? null,
    mpEmail: args.cuenta?.email ?? null,
    liveMode: args.tokens.liveMode,
    accessToken: encryptField(args.tokens.accessToken),
    refreshToken: args.tokens.refreshToken ? encryptField(args.tokens.refreshToken) : null,
    tokenExpiresAt: vence(args.tokens, ahora),
    connectedAt: ahora,
    connectedById: args.userId,
    disconnectedAt: null,
    // Conectar ya es decir «quiero cobrar en línea»: el pago del portal se
    // enciende (también al reconectar después de haberlo apagado).
    portalPaymentsEnabled: true,
  };
  await db.clinicMercadoPago.upsert({
    where: { clinicId: args.clinicId },
    create: { clinicId: args.clinicId, ...datos },
    update: datos,
  });
}

/**
 * Desconecta: borra los dos tokens (quedan en NULL) y APAGA el anticipo, porque
 * sin cuenta no hay a dónde cobrar. La fila se queda: dice con qué cuenta
 * estuvo conectada y cuándo se desconectó.
 */
export async function desconectarCuenta(clinicId: string, db: Db = prisma, ahora: Date = new Date()): Promise<void> {
  await db.clinicMercadoPago.updateMany({
    where: { clinicId },
    data: {
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      depositEnabled: false,
      disconnectedAt: ahora,
    },
  });
}

export interface CredencialDeCobro {
  accessToken: string;
  /** user_id de MP de la cuenta conectada: el collector de los pagos. */
  mpUserId: string;
}

/**
 * El token con el que se cobra y se verifica, renovado si le queda poco.
 * null = la clínica no tiene cuenta conectada (o el token es ilegible).
 */
export async function credencialDeCobro(
  clinicId: string,
  db: Db = prisma,
  ahora: Date = new Date(),
): Promise<CredencialDeCobro | null> {
  const fila = await db.clinicMercadoPago.findUnique({
    where: { clinicId },
    select: { accessToken: true, refreshToken: true, tokenExpiresAt: true, mpUserId: true },
  });
  if (!fila?.accessToken || !fila.mpUserId) return null;
  let token = abrir(fila.accessToken, clinicId);
  if (!token) return null;

  const venceMs = fila.tokenExpiresAt?.getTime() ?? 0;
  if (fila.refreshToken && venceMs - ahora.getTime() < RENOVAR_ANTES_MS) {
    const cfg = configOAuth();
    const refresh = abrir(fila.refreshToken, clinicId);
    if (cfg && refresh) {
      try {
        const nuevos = await renovarTokens(cfg, refresh);
        // Solo gana quien renovó sobre el refresh token que leyó: si otro
        // proceso renovó a la vez, su token ya está guardado y se usa ese.
        const escrito = await db.clinicMercadoPago.updateMany({
          where: { clinicId, refreshToken: fila.refreshToken },
          data: {
            accessToken: encryptField(nuevos.accessToken),
            refreshToken: nuevos.refreshToken ? encryptField(nuevos.refreshToken) : fila.refreshToken,
            tokenExpiresAt: vence(nuevos, ahora),
          },
        });
        if (escrito.count === 1) {
          token = nuevos.accessToken;
        } else {
          const otra = await db.clinicMercadoPago.findUnique({
            where: { clinicId },
            select: { accessToken: true },
          });
          token = abrir(otra?.accessToken, clinicId) ?? token;
        }
      } catch (e) {
        console.error(
          `[anticipos] no se pudo renovar el token de Mercado Pago (clínica ${clinicId}): ${(e as Error).message}`,
        );
        // Mientras no haya vencido, el de siempre sigue sirviendo.
        if (venceMs <= ahora.getTime()) return null;
      }
    } else if (venceMs <= ahora.getTime()) {
      return null;
    }
  }
  return { accessToken: token, mpUserId: fila.mpUserId };
}

/** Lo que la pantalla de Configuración puede saber de la cuenta. Sin secretos. */
export interface EstadoCuentaMp {
  conectada: boolean;
  apodo: string | null;
  correo: string | null;
  /** user_id de MP enmascarado («••••1234»), para distinguir cuentas sin exponerlo. */
  cuentaId: string | null;
  modoPruebas: boolean;
  conectadaEl: string | null;
  desconectadaEl: string | null;
}

export function enmascarar(id: string | null | undefined): string | null {
  if (!id) return null;
  return `••••${id.slice(-4)}`;
}
