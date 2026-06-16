// ═══════════════════════════════════════════════════════════════════
// Helpers compartidos del CRUD de MarketingPost (WS-MKT-T3).
// Archivo "privado" (prefijo _) → App Router NO lo trata como ruta.
// Lo consumen ./route.ts y ./[id]/route.ts. Aislamiento por clinicId
// siempre en el handler; aquí van validación (zod), anti-SSRF y errores.
// ═══════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Channel } from "@/lib/marketing/types";

export const CHANNELS = ["FACEBOOK", "INSTAGRAM", "BOTH"] as const;
export const CAPTION_HARD_MAX = 5000; // tope duro anti-abuso (cualquier canal)
export const IG_CAPTION_MAX = 2200; // límite real de Instagram (IG y BOTH)
export const MAX_MEDIA = 10;

/** Estados sobre los que SÍ se puede editar / borrar. Nunca PUBLISHED ni PUBLISHING. */
export const EDITABLE_STATUSES = ["DRAFT", "SCHEDULED", "FAILED"] as const;
export function isEditable(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Acepta SOLO URLs públicas de NUESTRO Supabase Storage (bucket clinic-public).
 * Verifica protocolo + host + path → evita SSRF / inyección de URLs externas
 * en mediaUrls. El host se compara contra NEXT_PUBLIC_SUPABASE_URL.
 */
export function isOurStorageUrl(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  let u: URL;
  let b: URL;
  try {
    u = new URL(url);
    b = new URL(base);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.host !== b.host) return false;
  return u.pathname.startsWith("/storage/v1/object/public/clinic-public/");
}

/** Caption base + límite específico de Instagram según el canal. */
function captionIssues(
  ctx: z.RefinementCtx,
  caption: string | undefined,
  channel: Channel | undefined,
) {
  if (caption !== undefined && channel && channel !== "FACEBOOK" && caption.length > IG_CAPTION_MAX) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["caption"],
      message: `Instagram permite máximo ${IG_CAPTION_MAX} caracteres`,
    });
  }
}

/** Valida que cada media sea de nuestro Storage (anti-SSRF). */
function mediaIssues(ctx: z.RefinementCtx, urls: string[] | undefined) {
  if (!urls) return;
  urls.forEach((u, i) => {
    if (!isOurStorageUrl(u)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaUrls", i],
        message: "Solo se permiten imágenes subidas a la clínica",
      });
    }
  });
}

// ── Crear post ──────────────────────────────────────────────────────
export const CreateSchema = z
  .object({
    channel: z.enum(CHANNELS),
    caption: z.string().trim().min(1, "Escribe el texto de la publicación").max(CAPTION_HARD_MAX),
    mediaUrls: z.array(z.string().url().max(2048)).max(MAX_MEDIA).optional().default([]),
    status: z.enum(["DRAFT", "SCHEDULED"]).optional().default("DRAFT"),
    scheduledFor: z.string().datetime().nullable().optional(),
    aiGenerated: z.boolean().optional().default(false),
    publishNow: z.boolean().optional().default(false),
  })
  .superRefine((val, ctx) => {
    mediaIssues(ctx, val.mediaUrls);
    captionIssues(ctx, val.caption, val.channel);

    const willGoLive = val.publishNow || val.status === "SCHEDULED";
    // Instagram (IG y BOTH) exige al menos una imagen para publicar.
    if (willGoLive && val.channel !== "FACEBOOK" && (val.mediaUrls ?? []).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaUrls"],
        message: "Instagram requiere al menos una imagen",
      });
    }
    // SCHEDULED necesita fecha futura (en publishNow la fija el servidor = ahora).
    if (!val.publishNow && val.status === "SCHEDULED") {
      const t = val.scheduledFor ? new Date(val.scheduledFor).getTime() : NaN;
      if (!val.scheduledFor || isNaN(t)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scheduledFor"], message: "Programa una fecha y hora" });
      } else if (t <= Date.now()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scheduledFor"], message: "La fecha debe ser futura" });
      }
    }
  });
export type CreateInput = z.infer<typeof CreateSchema>;

// ── Editar post ─────────────────────────────────────────────────────
export const PatchSchema = z
  .object({
    channel: z.enum(CHANNELS).optional(),
    caption: z.string().trim().min(1).max(CAPTION_HARD_MAX).optional(),
    mediaUrls: z.array(z.string().url().max(2048)).max(MAX_MEDIA).optional(),
    status: z.enum(["DRAFT", "SCHEDULED"]).optional(),
    scheduledFor: z.string().datetime().nullable().optional(),
    publishNow: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (Object.keys(val).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "No hay cambios que guardar" });
    }
    mediaIssues(ctx, val.mediaUrls);
    captionIssues(ctx, val.caption, val.channel);
  });
export type PatchInput = z.infer<typeof PatchSchema>;

/**
 * 409 si el canal pedido no tiene conexión activa (SocialAccount.connected).
 * BOTH exige Facebook E Instagram. Devuelve null si todo conectado.
 */
export async function assertChannelConnected(
  clinicId: string,
  channel: Channel,
): Promise<NextResponse | null> {
  const accounts = await prisma.socialAccount.findMany({
    where: { clinicId, connected: true },
    select: { provider: true },
  });
  const need: string[] = channel === "BOTH" ? ["FACEBOOK", "INSTAGRAM"] : [channel];
  const missing = need.filter((p) => !accounts.some((a) => a.provider === p));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "not_connected", missing, hint: "Conecta Facebook/Instagram en Marketing → Conexiones." },
      { status: 409 },
    );
  }
  return null;
}

/** Detecta que las tablas de Marketing aún no se migraron (sql/marketing.sql). */
export function isSchemaMissing(e: any): boolean {
  const code = e?.code;
  if (code === "P2021" || code === "P2022") return true;
  const msg = String(e?.message ?? "");
  return /does not exist|relation .* does not exist|column .* does not exist/i.test(msg);
}

/** Respuesta de error uniforme: 503 si falta el schema, 500 si es inesperado. */
export function errorResponse(e: any): NextResponse {
  if (isSchemaMissing(e)) {
    return NextResponse.json(
      { error: "schema_not_migrated", hint: "Aplica sql/marketing.sql en Supabase para activar Marketing." },
      { status: 503 },
    );
  }
  console.error("[marketing/posts] error:", e);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
