import { NextResponse, type NextRequest } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import {
  REALTY_FEED_TTL_SECONDS,
  buildRealtyFeed,
  buildRealtyFeedJson,
} from "@/lib/realty/feed";
import { REALTY_FEED_FILES, getRealtyPortalDestination } from "@/lib/realty/portal-adapters";

// ═══════════════════════════════════════════════════════════════════════
// EL FEED PÚBLICO de una inmobiliaria.
//
//   /feeds/realty/<accountId>/propiedades.xml          → XML genérico (LIFULL…)
//   /feeds/realty/<accountId>/propiedades.xml?destino=trovit
//   /feeds/realty/<accountId>/meta.csv                 → catálogo de Meta
//   /feeds/realty/<accountId>/google.jsonld            → JSON-LD de la web propia
//   /feeds/realty/<accountId>/propiedades.json         → modelo canónico (depurar)
//
// SIN SESIÓN, a propósito: el portal que jala esta URL no tiene cuenta con
// nosotros. Por eso TODO el recorte de privacidad vive en feed.ts y no aquí.
//
// `/feeds` es un segmento estático, así que gana sobre el catch-all
// `/[slug]` de las mini-webs dentales. El middleware no lo toca: su matcher
// solo cubre /dashboard, /admin, /api y /proveedores.
//
// 🔴 NUNCA 500. Todo error termina en un documento vacío y bien formado.
// Un portal que recibe un error marca la fuente como rota y a veces deja de
// intentarlo; uno que recibe un feed vacío vuelve mañana.
// ═══════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** JSON del modelo canónico: no lo arma un adaptador, es para depurar. */
const DEBUG_FILE = "propiedades.json";

/** Un id de cuenta es un cuid. Cualquier otra cosa ni llega a Postgres. */
const ACCOUNT_ID = /^[A-Za-z0-9_-]{10,64}$/;

interface Params {
  params: { accountId: string; archivo: string };
}

export async function GET(req: NextRequest, { params }: Params) {
  const accountId = params.accountId ?? "";
  const archivo = params.archivo ?? "";

  if (!ACCOUNT_ID.test(accountId)) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (archivo !== DEBUG_FILE && !REALTY_FEED_FILES[archivo]) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Un portal jala esto una vez por hora; 60 por minuto no le estorba a
  // nadie y evita que la URL se use como fuente de scraping barata. Si el
  // control falla (base caída), el feed sigue sirviendo: NUNCA romper por
  // el guardia de tráfico.
  try {
    const limited = await persistentRateLimit(req, { limit: 60, windowSec: 60 });
    if (limited) return limited;
  } catch {
    /* el feed manda */
  }

  // ?destino= recorta a los inmuebles elegidos para ESE portal y respeta su
  // cupo contratado. Sin destino, sale toda la cartera publicada.
  const raw = new URL(req.url).searchParams.get("destino");
  const destination = raw && getRealtyPortalDestination(raw) ? raw : null;

  const result =
    archivo === DEBUG_FILE
      ? await buildRealtyFeedJson(accountId, destination)
      : await buildRealtyFeed(accountId, archivo, destination);

  return new NextResponse(result.body, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      // Misma receta que /blog/rss.xml: el CDN sirve la copia una hora y
      // sigue sirviendo la vieja mientras revalida. Con eso, mil lecturas de
      // un portal cuestan una consulta a Postgres.
      "Cache-Control": `public, max-age=0, s-maxage=${REALTY_FEED_TTL_SECONDS}, stale-while-revalidate=86400`,
      // Un feed no es una página: que no lo indexen como contenido suelto.
      "X-Robots-Tag": "noindex",
      "X-Realty-Feed-Count": String(result.count),
    },
  });
}
