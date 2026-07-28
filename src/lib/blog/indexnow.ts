import { SITE_URL } from "@/lib/seo";

// ─────────────────────────────────────────────────────────────────────────────
// IndexNow — ping gratuito a Bing/Yandex cuando el cron publica artículos.
//
// La clave es PÚBLICA POR DISEÑO: el protocolo exige servirla en
// https://<host>/<key>.txt para probar que controlas el dominio. No es un
// secreto, no va en env vars, y por eso vive aquí como constante junto al
// archivo public/<key>.txt que la expone. Cambiarla obliga a renombrar ese
// archivo también.
//
// Google NO usa IndexNow: para Google basta el sitemap con <lastmod>, que ya
// emitimos en src/app/sitemap.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const INDEXNOW_KEY = "b3f7a1c25e8d4a069c14f2d873be560a";

export const INDEXNOW_KEY_FILE = `${INDEXNOW_KEY}.txt`;

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** Máximo por request según el protocolo (10 000); acotamos más por prudencia. */
const MAX_URLS = 1000;

export interface IndexNowResult {
  ok: boolean;
  submitted: number;
  status?: number;
  error?: string;
}

/**
 * Notifica un lote de URLs absolutas. FALLA EN SILENCIO (log + `ok:false`):
 * el cron de publicación no debe romperse porque un buscador esté caído o
 * rechace la clave.
 */
export async function pingIndexNow(urls: string[]): Promise<IndexNowResult> {
  const urlList = (urls ?? []).filter(Boolean).slice(0, MAX_URLS);
  if (urlList.length === 0) return { ok: true, submitted: 0 };

  let host: string;
  try {
    host = new URL(SITE_URL).host;
  } catch {
    console.warn("[blog/indexnow] SITE_URL inválida, se omite el ping");
    return { ok: false, submitted: 0, error: "SITE_URL inválida" };
  }

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_URL}/${INDEXNOW_KEY_FILE}`,
        urlList,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(`[blog/indexnow] respuesta ${res.status} para ${urlList.length} URLs`);
      return { ok: false, submitted: urlList.length, status: res.status };
    }
    console.info(`[blog/indexnow] ${urlList.length} URLs notificadas (${res.status})`);
    return { ok: true, submitted: urlList.length, status: res.status };
  } catch (e: any) {
    console.warn("[blog/indexnow] ping falló:", e?.message ?? e);
    return { ok: false, submitted: 0, error: e?.message ?? "error de red" };
  }
}
