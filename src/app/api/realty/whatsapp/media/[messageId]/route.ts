import { NextRequest, NextResponse } from "next/server";
import { isRealtyWaGateOk, openRealtyWaGate } from "../../_server";
import { isRealtyMediaOk, resolveRealtyMedia } from "@/lib/realty/whatsapp";

// Proxy para VER en el panel lo que el prospecto mandó por WhatsApp (foto de
// la casa, nota de voz, PDF del predial), SIN guardar nada en Storage: se lee
// de Meta y se transmite tal cual. Es como lo hace el dental y es lo correcto
// — son archivos de terceros y el bucket no es un basurero.
//
// POR QUÉ un proxy y no un enlace directo: la URL que da Meta
// (lookaside.fbsbx.com) SOLO abre si mandas el token de la cuenta en la
// cabecera. En un `<img src>` saldría rota — y el token NUNCA sale al
// navegador.
//
// POR QUÉ se indexa por messageId y NO por mediaId: con el id del archivo en
// la URL, cualquiera con un id ajeno sacaría el archivo de OTRA inmobiliaria
// usando NUESTRO token; con el messageId, el filtro por el accountId de la
// sesión lo impide de raíz.

export const dynamic = "force-dynamic";
// Se transmiten videos de recorridos: 10 s no alcanzan.
export const maxDuration = 60;

interface Params {
  params: { messageId: string };
}

/** Las que hacen funcionar el `Range` (adelantar un video). */
const PASS_THROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
] as const;

/**
 * Lo que el navegador puede pintar EN LÍNEA sin riesgo. Todo lo demás (un
 * .html o un .svg mandado "como documento") se sirve como descarga: si se
 * pintara como página correría con las cookies de nuestro origen. El SVG
 * queda fuera a propósito: como `<img>` es inofensivo, abierto en pestaña no.
 */
function canInline(mime: string): boolean {
  const m = mime.toLowerCase();
  if (m === "application/pdf") return true;
  if (m.startsWith("image/")) return !m.includes("svg");
  return m.startsWith("video/") || m.startsWith("audio/");
}

/** Nombre seguro para Content-Disposition, con la variante UTF-8 (RFC 5987). */
function contentDisposition(kind: "inline" | "attachment", filename: string | null): string {
  if (!filename) return kind;
  const ascii = filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\;]/g, "_")
    .slice(0, 150);
  const utf8 = encodeURIComponent(filename.slice(0, 150)).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const gate = await openRealtyWaGate("whatsapp.view");
    if (!isRealtyWaGateOk(gate)) return gate.response;

    const media = await resolveRealtyMedia(gate.ctx.accountId, params.messageId);
    if (!isRealtyMediaOk(media)) {
      if (media.reason === "expired") {
        // 410 y no 404: el archivo EXISTIÓ y Meta ya lo borró (los guarda
        // ~30 días). La pantalla lo dice en vez de pintar un ícono roto.
        return NextResponse.json({ error: "expired" }, { status: 410 });
      }
      if (media.reason === "not_connected") {
        return NextResponse.json({ error: "whatsapp_not_connected" }, { status: 503 });
      }
      if (media.reason === "upstream") {
        return NextResponse.json({ error: "upstream" }, { status: 502 });
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // Descarga desde Meta con el token y REENVIANDO el `Range` del navegador.
    // El Range no es opcional: un `<video>` pide rangos para adelantar; si se
    // respondiera siempre 200 con el archivo entero, Safari (o sea, todos los
    // iPhone de la inmobiliaria) no lo reproduce.
    // Sin timeout a propósito: una señal cortaría un video largo a la mitad;
    // el techo real es maxDuration.
    const range = req.headers.get("range");
    const upstream = await fetch(media.url, {
      headers: {
        Authorization: `Bearer ${media.token}`,
        // User-Agent explícito: a undici el CDN de Meta le devuelve una página
        // HTML en vez del archivo si no lleva uno. El de curl es el del
        // ejemplo oficial de descarga.
        "User-Agent": "curl/8.4.0",
        ...(range ? { Range: range } : {}),
      },
    });

    if (!upstream.ok) {
      // La URL de descarga dura ~5 min y el archivo pudo caducar entre que se
      // resolvió y esto: mismo 410 para la pantalla.
      if (upstream.status === 404 || upstream.status === 410) {
        return NextResponse.json({ error: "expired" }, { status: 410 });
      }
      console.error(`[realty/wa/media] Meta respondió ${upstream.status}`);
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }

    const headers = new Headers();
    for (const name of PASS_THROUGH_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    // undici ya descomprimió el cuerpo si venía con Content-Encoding: el
    // Content-Length de Meta sería el del comprimido y cortaría la respuesta.
    if (upstream.headers.get("content-encoding")) headers.delete("content-length");

    const contentType = headers.get("content-type") ?? media.mimeType;
    headers.set("content-type", contentType);
    headers.set(
      "content-disposition",
      contentDisposition(canInline(contentType) ? "inline" : "attachment", media.filename),
    );
    headers.set("x-content-type-options", "nosniff");
    // private: es la conversación de un cliente, nunca en cachés compartidas.
    headers.set("cache-control", "private, max-age=3600");

    // Se propaga el status tal cual (200 o 206 con su Content-Range) y el
    // cuerpo se transmite: nada se guarda en memoria ni en disco.
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    console.error("[GET realty/whatsapp/media/:messageId]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
