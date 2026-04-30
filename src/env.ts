/**
 * Validación de variables de entorno con zod.
 *
 * Importa este módulo desde un archivo que se carga al boot del server
 * (ej. src/lib/prisma.ts) para que el proceso falle FAST con un mensaje
 * legible si falta una variable crítica o tiene formato incorrecto.
 *
 * Cómo usar:
 *   import { env } from "@/env";
 *   const key = env.STRIPE_SECRET_KEY; // tipado, validado al primer access
 *
 * Estrategia: lazy via Proxy. La validación corre la PRIMERA vez que se
 * lee `env.<algo>`, no al import. Esto evita que un build local (que
 * legítimamente puede no tener todas las vars) falle con env incompleta;
 * en producción/runtime, el primer request a un handler que importe `env`
 * dispara la validación y, si falla, devuelve 500 con mensaje claro vía
 * el error en logs.
 *
 * No reemplazamos TODOS los process.env del proyecto de golpe — solo los
 * de seguridad crítica (auth, supabase, prisma, cron handlers). El resto
 * puede migrar gradualmente.
 */

import { z } from "zod";

const envSchema = z.object({
  // ── Núcleo (siempre requeridas) ───────────────────────────────────
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // ── Supabase ──────────────────────────────────────────────────────
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // ── IA ────────────────────────────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // ── Crons & secretos administrativos ──────────────────────────────
  CRON_SECRET: z.string().min(32, "CRON_SECRET debe tener al menos 32 caracteres"),
  ADMIN_SECRET_TOKEN: z.string().min(16).optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_TOTP_SECRET: z.string().optional(),

  // ── Cifrado en reposo (firma electrónica + backups cifrados) ──────
  // Hex de 64 chars = 32 bytes (clave AES-256). Permite también una
  // base64url más larga.
  SIGNATURE_MASTER_KEY: z.string().min(32).optional(),
  DATA_ENCRYPTION_KEY: z.string().min(32).optional(),

  // ── Pagos ─────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID_BASIC: z.string().optional(),
  STRIPE_PRICE_ID_PRO: z.string().optional(),
  STRIPE_PRICE_ID_CLINIC: z.string().optional(),
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),

  // ── Email & mensajería ────────────────────────────────────────────
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
  MEDIFLOW_EMAIL_FROM: z.string().email().optional(),
  POSTMARK_INBOUND_SECRET: z.string().optional(),
  PRIVACY_INBOX_EMAIL: z.string().email().optional(),

  // ── WhatsApp ──────────────────────────────────────────────────────
  MEDIFLOW_WHATSAPP_PHONE_ID: z.string().optional(),
  MEDIFLOW_WHATSAPP_TOKEN: z.string().optional(),
  WA_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),

  // ── Integraciones varias ──────────────────────────────────────────
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  DAILY_API_KEY: z.string().optional(),
  FACTURAPI_USER_KEY: z.string().optional(),
  FACTURAMA_USER: z.string().optional(),
  FACTURAMA_PASS: z.string().optional(),
  COOKIE_SECRET: z.string().min(16).optional(),

  // ── App URLs ──────────────────────────────────────────────────────
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),

  // ── Flags ─────────────────────────────────────────────────────────
  ALLOW_SEED_IN_PROD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

function load(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  · ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    const msg = `[env] Variables de entorno inválidas:\n${issues}`;
    // En cualquier ambiente: tira con mensaje claro la primera vez que
    // alguien lee env.<algo>. Build estático (que importa pero no usa
    // env en tiempo de collect) no se ve afectado.
    throw new Error(msg);
  }
  cached = parsed.data;
  return cached;
}

export const env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return load()[prop as keyof Env];
  },
}) as Env;
