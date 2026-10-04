// Enlace de descarga del CFDI que va por WhatsApp (ws1-t8, F-17).
//
//   /api/cfdi/descarga/<cfdiId>?f=pdf|xml&e=<caduca, segundos unix>&t=<firma>
//   firma = base64url( HMAC-SHA256( secreto, "cfdi-descarga:v1:<cfdiId>:<caduca>" ) )
//
// Mismo esquema que la liga de pago de teleconsulta (lib/teleconsulta/pago-token.ts), con
// caducidad: el CFDI lleva RFC, nombre y domicilio fiscal del paciente, así que un enlace
// reenviado no debe abrir para siempre. Sin columna nueva ni SQL. Sin el secreto (solo en el
// servidor) no se puede fabricar un enlace válido; el id del CFDI solo no basta.

import { createHmac, timingSafeEqual } from "crypto";
import { DIAS_VIGENCIA_ENLACE } from "./envio";

function secreto(): string {
  const s = process.env.CFDI_ENLACE_SECRET || process.env.PAGO_TOKEN_SECRET || process.env.COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (s) return s;
  // Sin secreto en producción no se emite ni se acepta nada (falla cerrado).
  if (process.env.NODE_ENV === "production") throw new Error("cfdi-enlace: sin secreto configurado");
  return "mediflow-cfdi-enlace-dev-only";
}

function firma(cfdiId: string, caduca: number, s: string): string {
  return createHmac("sha256", s).update(`cfdi-descarga:v1:${cfdiId}:${caduca}`).digest("base64url");
}

export function caducidadDesde(ahora: Date, dias = DIAS_VIGENCIA_ENLACE): number {
  return Math.floor(ahora.getTime() / 1000) + dias * 24 * 60 * 60;
}

/** Ruta relativa (el origen lo pone quien la usa). */
export function rutaDescargaCfdi(cfdiId: string, formato: "pdf" | "xml", caduca: number, s: string = secreto()): string {
  return `/api/cfdi/descarga/${encodeURIComponent(cfdiId)}?f=${formato}&e=${caduca}&t=${firma(cfdiId, caduca, s)}`;
}

export type VeredictoEnlace = "ok" | "invalido" | "caducado";

export function verificarEnlaceCfdi(args: {
  cfdiId: string;
  caduca: string | null | undefined;
  token: string | null | undefined;
  ahora: Date;
  secreto?: string;
}): VeredictoEnlace {
  const e = Number(args.caduca);
  if (!args.cfdiId || !Number.isInteger(e) || e <= 0 || typeof args.token !== "string" || !args.token) return "invalido";
  let valida = false;
  try {
    const esperado = Buffer.from(firma(args.cfdiId, e, args.secreto ?? secreto()));
    const recibido = Buffer.from(args.token);
    valida = esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
  } catch {
    return "invalido";
  }
  if (!valida) return "invalido";
  return e * 1000 < args.ahora.getTime() ? "caducado" : "ok";
}

/** Origen público para armar el enlace absoluto (el que ya usan los anticipos). */
export function origenPublico(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
}
