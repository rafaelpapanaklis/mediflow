// ═══════════════════════════════════════════════════════════════════════
// GET /api/barber/whatsapp/media/[messageId]
//   → sirve por PROXY lo que el cliente mandó por WhatsApp (foto, nota de
//     voz, video, PDF). CERO archivos en Storage.
//
// POR QUÉ UN PROXY Y NO UN ENLACE: la URL que da Meta (lookaside.fbsbx.com)
// SOLO abre mandando el token de la barbería en la cabecera. En un <img src>
// saldría rota — y el token JAMÁS sale al navegador.
//
// POR QUÉ SE INDEXA POR messageId Y NO POR mediaId: con el mediaId en la
// URL, cualquiera con un id ajeno sacaría el archivo de OTRA barbería
// usando nuestro token. Con el messageId, el filtro por el barbershopId de
// la SESIÓN lo impide de raíz.
//
// POR QUÉ NO SE GUARDA NADA: Meta borra los archivos a los ~30 días. Un
// adjunto viejo no es un error, es que caducó — y la UI tiene que decirlo
// (410) en vez de pintar un ícono roto.
// ═══════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from "next/server";
import { isBarberMediaOk, resolveBarberMedia } from "@/lib/barber/whatsapp";
import { openWaGate, WA_INBOX_FEATURE } from "../../_server";

export const dynamic = "force-dynamic";
// Se transmiten videos: 10 s no alcanzan.
export const maxDuration = 60;

/** Cabeceras que se copian de Meta tal cual: son las que hacen andar el Range. */
const PASS_THROUGH = ["content-type", "content-length", "content-range", "accept-ranges"] as const;

/**
 * Tipos que el navegador puede pintar EN LÍNEA sin riesgo. Todo lo demás
 * (un .html o un .svg mandado "como documento") se sirve como descarga: si
 * se pintara como página, correría con las cookies de nuestro origen.
 */
function canInline(mime: string): boolean {
  const m = mime.toLowerCase();
  if (m === "application/pdf") return true;
  if (m.startsWith("image/")) return !m.includes("svg");
  return m.startsWith("video/") || m.startsWith("audio/");
}

function contentDisposition(kind: "inline" | "attachment", filename: string | null): string {
  if (!filename) return kind;
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_").slice(0, 150);
  const utf8 = encodeURIComponent(filename.slice(0, 150)).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function GET(req: NextRequest, { params }: { params: { messageId: string } }) {
  const gate = await openWaGate({
    permission: "whatsapp.view",
    feature: WA_INBOX_FEATURE,
    branchId: req.nextUrl.searchParams.get("branchId"),
  });
  if (gate.response) return gate.response;

  try {
    const found = await resolveBarberMedia(gate.gate.shopId, params.messageId);
    if (!isBarberMediaOk(found)) {
      const status =
        found.reason === "expired"
          ? 410
          : found.reason === "not_connected"
            ? 503
            : found.reason === "upstream"
              ? 502
              : 404;
      return NextResponse.json({ error: found.reason }, { status });
    }

    // Descarga desde Meta REENVIANDO el Range del navegador: un <video>
    // pide rangos para poder adelantar y sin eso Safari (o sea, todos los
    // iPhone del mostrador) directamente no reproduce.
    const range = req.headers.get("range");
    const upstream = await fetch(found.url, {
      headers: {
        Authorization: `Bearer ${found.token}`,
        // A undici el CDN de Meta le devuelve HTML si no lleva User-Agent;
        // el de curl es el del ejemplo oficial de descarga.
        "User-Agent": "curl/8.4.0",
        ...(range ? { Range: range } : {}),
      },
    });

    if (!upstream.ok) {
      // La URL de descarga es efímera (~5 min): puede haber caducado entre
      // que se pidió y ahora. Mismo 410 para la UI.
      if (upstream.status === 404 || upstream.status === 410) {
        return NextResponse.json({ error: "expired" }, { status: 410 });
      }
      console.error(`[barber/whatsapp/media] Meta respondió ${upstream.status}`);
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }

    const headers = new Headers();
    for (const name of PASS_THROUGH) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    // undici ya descomprimió el cuerpo si venía comprimido: el
    // Content-Length de Meta sería el del comprimido y cortaría la respuesta.
    if (upstream.headers.get("content-encoding")) headers.delete("content-length");
    const contentType = headers.get("content-type") ?? found.mimeType;
    headers.set("content-type", contentType);
    headers.set(
      "content-disposition",
      contentDisposition(canInline(contentType) ? "inline" : "attachment", found.filename),
    );
    headers.set("x-content-type-options", "nosniff");
    // private: es la conversación de un cliente, nunca en cachés compartidas.
    headers.set("cache-control", "private, max-age=3600");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    console.error("[GET barber/whatsapp/media]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
