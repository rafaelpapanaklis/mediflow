// ═══════════════════════════════════════════════════════════════════
// Publicación en Meta (Facebook / Instagram) — WS-MKT-T4.
// Implementa el contrato publishToMeta() de foundation con la Graph API y el
// token de Página descifrado (crypto.ts). Multi-tenant: SIEMPRE por clinicId.
// SSRF: image_url solo desde nuestro Supabase Storage. Nunca se loguea el token.
// ═══════════════════════════════════════════════════════════════════
import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "./crypto";
import { graphPost, isOwnStorageUrl } from "./meta-graph";
import type { Provider, PublishInput, PublishResult } from "./types";

interface LoadedAccount {
  externalId: string;
  token: string;
}

/** Carga una cuenta conectada de la clínica y descifra su token de Página. */
async function loadAccount(clinicId: string, provider: Provider): Promise<LoadedAccount> {
  const acc = await prisma.socialAccount.findFirst({
    where: { clinicId, provider, connected: true },
    select: { externalId: true, accessTokenEnc: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!acc) {
    throw new Error(
      provider === "FACEBOOK"
        ? "No hay una Página de Facebook conectada. Conéctala en Marketing › Conexiones."
        : "No hay una cuenta de Instagram conectada. Conéctala en Marketing › Conexiones.",
    );
  }
  return { externalId: acc.externalId, token: decryptToken(acc.accessTokenEnc) };
}

/** Primera imagen válida, exigiendo que sea de nuestro Storage (anti-SSRF). */
function firstSafeImage(mediaUrls: string[]): string | null {
  const url = (mediaUrls ?? []).find((u) => typeof u === "string" && u.length > 0);
  if (!url) return null;
  if (!isOwnStorageUrl(url)) {
    throw new Error("La imagen debe estar alojada en el almacenamiento de DaleControl.");
  }
  return url;
}

/** Publica en la Página de Facebook. Con imagen → /photos; solo texto → /feed. */
async function publishFacebook(clinicId: string, input: PublishInput): Promise<string> {
  const { externalId: pageId, token } = await loadAccount(clinicId, "FACEBOOK");
  const image = firstSafeImage(input.mediaUrls);
  if (image) {
    const r = await graphPost(`${pageId}/photos`, {
      url: image,
      caption: input.caption ?? "",
      access_token: token,
    });
    return String(r?.post_id ?? r?.id ?? "");
  }
  const r = await graphPost(`${pageId}/feed`, {
    message: input.caption ?? "",
    access_token: token,
  });
  return String(r?.id ?? "");
}

/** Publica en Instagram (2 pasos: crea el contenedor de media y lo publica). */
async function publishInstagram(clinicId: string, input: PublishInput): Promise<string> {
  const { externalId: igId, token } = await loadAccount(clinicId, "INSTAGRAM");
  const image = firstSafeImage(input.mediaUrls);
  if (!image) {
    throw new Error("Instagram requiere una imagen para publicar.");
  }
  const container = await graphPost(`${igId}/media`, {
    image_url: image,
    caption: input.caption ?? "",
    access_token: token,
  });
  const creationId = container?.id;
  if (!creationId) throw new Error("Instagram no devolvió el id del contenedor de media.");
  const published = await graphPost(`${igId}/media_publish`, {
    creation_id: String(creationId),
    access_token: token,
  });
  return String(published?.id ?? "");
}

/**
 * Publica un post en las redes de la clínica. channel decide el destino; BOTH
 * publica en ambos y devuelve los dos ids. Los errores de Graph se propagan con
 * su mensaje legible (sin el token). En BOTH, si Facebook ya publicó pero
 * Instagram falla, el error lo deja explícito para no perder el rastro.
 */
export async function publishToMeta(
  clinicId: string,
  input: PublishInput,
): Promise<PublishResult> {
  if (!clinicId) throw new Error("clinicId requerido");
  const hasText = !!input?.caption && input.caption.trim().length > 0;
  const hasMedia = Array.isArray(input?.mediaUrls) && input.mediaUrls.length > 0;
  if (!hasText && !hasMedia) {
    throw new Error("El post necesita texto o una imagen.");
  }

  const result: PublishResult = {};
  if (input.channel === "FACEBOOK") {
    result.facebook = await publishFacebook(clinicId, input);
  } else if (input.channel === "INSTAGRAM") {
    result.instagram = await publishInstagram(clinicId, input);
  } else {
    // BOTH
    result.facebook = await publishFacebook(clinicId, input);
    try {
      result.instagram = await publishInstagram(clinicId, input);
    } catch (e: any) {
      throw new Error(
        `Facebook publicado (id ${result.facebook}); Instagram falló: ${e?.message ?? "error"}`,
      );
    }
  }
  return result;
}
