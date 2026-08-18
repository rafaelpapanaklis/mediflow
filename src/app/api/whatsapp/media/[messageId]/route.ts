import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { decryptField } from "@/lib/crypto/envelope";
import { getWhatsAppMediaMeta } from "@/lib/whatsapp";
import { WhatsAppApiError } from "@/lib/whatsapp/errors";

// Proxy para VER en el panel lo que el paciente mandó por WhatsApp (foto, nota
// de voz, video, PDF), SIN guardar nada en Supabase: se lee de Meta y se
// transmite tal cual.
//
// POR QUÉ un proxy y no un enlace directo: la URL que da Meta
// (lookaside.fbsbx.com) SOLO abre si mandas el token de la clínica en la
// cabecera. En un `<img src>` saldría rota — y el token NUNCA sale al navegador.
//
// POR QUÉ se indexa por messageId y NO por mediaId: con el mediaId en la URL,
// cualquiera con un id ajeno sacaría el archivo de OTRA clínica usando nuestro
// token; con el messageId el filtro por clinicId (de la sesión) lo impide de
// raíz, y encima pasa por la visibilidad del paciente del hilo.

export const dynamic = "force-dynamic";
// Se transmiten videos: 10 s no alcanzan.
export const maxDuration = 60;

interface Params { params: { messageId: string } }

/** Cabeceras que se copian de Meta tal cual: son las que hacen funcionar el `Range`. */
const PASS_THROUGH_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges"] as const;

/**
 * Tipos que el navegador puede pintar EN LÍNEA sin riesgo. Todo lo demás
 * (un .html o un .svg mandado "como documento") se sirve como descarga: si se
 * pintara como página, correría con las cookies de nuestro origen. SVG queda
 * fuera a propósito: como `<img>` es inofensivo, abierto en pestaña no.
 */
function canInline(mime: string): boolean {
  const m = mime.toLowerCase();
  if (m === "application/pdf") return true;
  if (m.startsWith("image/")) return !m.includes("svg");
  return m.startsWith("video/") || m.startsWith("audio/");
}

/** Nombre de archivo seguro para Content-Disposition (sin comillas ni saltos, con la variante UTF-8). */
function contentDisposition(kind: "inline" | "attachment", filename: string | null): string {
  if (!filename) return kind;
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_").slice(0, 150);
  // RFC 5987: encodeURIComponent deja pasar ' ( ) * y ahí no valen.
  const utf8 = encodeURIComponent(filename.slice(0, 150)).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    // 1) Sesión. El clinicId sale SIEMPRE de aquí, nunca de la URL.
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // 2) Mismo permiso que leer el hilo.
    const denied = denyIfMissingPermission(ctx, "inbox.view");
    if (denied) return denied;

    // 3) El mensaje, POR SU ID y acotado a la clínica de la sesión.
    const message = await prisma.inboxMessage.findFirst({
      where: { id: params.messageId, thread: { clinicId: ctx.clinicId } },
      select: {
        id: true,
        attachments: true,
        thread: {
          select: {
            patientId: true,
            clinic: { select: { waPhoneNumberId: true, waAccessToken: true } },
          },
        },
      },
    });
    if (!message) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // 4) Visibilidad por paciente: 404 si está oculto (no revela que existe).
    if (message.thread.patientId) {
      const hidden = await assertPatientVisible(message.thread.patientId, {
        userId: ctx.userId,
        role: ctx.role,
        clinicId: ctx.clinicId,
      });
      if (hidden) return hidden;
    }

    // 5) El adjunto pedido (?i=, 0 por defecto). Sin mediaId no hay nada que
    //    servir: los adjuntos que manda el panel llevan `url`, no `mediaId`.
    const rawIndex = req.nextUrl.searchParams.get("i");
    const index = rawIndex === null || rawIndex === "" ? 0 : Number(rawIndex);
    const list = Array.isArray(message.attachments) ? message.attachments : [];
    const att = Number.isInteger(index) && index >= 0 ? list[index] : undefined;
    const rec = att && typeof att === "object" && !Array.isArray(att)
      ? (att as { mediaId?: unknown; filename?: unknown })
      : null;
    const mediaId = rec && typeof rec.mediaId === "string" && rec.mediaId.length > 0 ? rec.mediaId : null;
    if (!mediaId) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const filename = rec && typeof rec.filename === "string" && rec.filename.trim() ? rec.filename.trim() : null;

    const accessToken = message.thread.clinic.waAccessToken;
    if (!accessToken) {
      // La clínica se desconectó de WhatsApp: sin token no hay forma de pedirle
      // el archivo a Meta. No es "caducó", es "no se puede ahora".
      return NextResponse.json({ error: "whatsapp_not_connected" }, { status: 503 });
    }

    // 6) URL de descarga. null = el archivo ya no existe en Meta (los borra a
    //    los ~30 días): 410 Gone, para que la UI lo diga en vez de pintar un
    //    ícono roto.
    const meta = await getWhatsAppMediaMeta(accessToken, mediaId);
    if (!meta) return NextResponse.json({ error: "expired" }, { status: 410 });

    // 7) Descarga desde Meta con el token (descifrado igual que en lib/whatsapp)
    //    y REENVIANDO el `Range` del navegador. El Range no es opcional: un
    //    `<video>` pide rangos para poder adelantar; si se respondiera siempre
    //    200 con el archivo entero, adelantar no funcionaría y Safari (o sea,
    //    todos los iPhone de la clínica) directamente no reproduce.
    //    Sin timeout a propósito: una señal abortaría la transmisión de un video
    //    largo a la mitad; el techo real es maxDuration.
    const token = decryptField(accessToken) ?? accessToken;
    const range = req.headers.get("range");
    const upstream = await fetch(meta.url, {
      headers: {
        Authorization: `Bearer ${token}`,
        // User-Agent explícito: a algunos clientes HTTP (undici entre ellos) el
        // CDN de Meta les devuelve una página HTML en vez del archivo si no
        // llevan uno; el de curl es el del ejemplo oficial de descarga.
        "User-Agent": "curl/8.4.0",
        ...(range ? { Range: range } : {}),
      },
    });

    if (!upstream.ok) {
      // La URL de descarga es efímera (~5 min) y el archivo puede haber caducado
      // entre el paso 6 y este: mismo 410 para la UI.
      if (upstream.status === 404 || upstream.status === 410) {
        return NextResponse.json({ error: "expired" }, { status: 410 });
      }
      console.error(`[whatsapp/media] Meta respondió ${upstream.status} al descargar ${mediaId}`);
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }

    // 8) Se propaga el status tal cual (200 o 206 con su Content-Range) y se
    //    copian solo las cabeceras que hacen falta. private: es PHI, nunca en
    //    cachés compartidas.
    const headers = new Headers();
    for (const name of PASS_THROUGH_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    // undici ya descomprimió el cuerpo si venía con Content-Encoding: el
    // Content-Length de Meta sería el del comprimido y cortaría la respuesta.
    if (upstream.headers.get("content-encoding")) headers.delete("content-length");
    const contentType = headers.get("content-type") ?? meta.mimeType;
    headers.set("content-type", contentType);
    headers.set(
      "content-disposition",
      contentDisposition(canInline(contentType) ? "inline" : "attachment", filename),
    );
    headers.set("x-content-type-options", "nosniff");
    headers.set("cache-control", "private, max-age=3600");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    if (err instanceof WhatsAppApiError) {
      // Token revocado, 5xx de Meta…: no es culpa del archivo ni del usuario.
      console.error("[whatsapp/media] Meta rechazó la consulta:", err.message);
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }
    console.error("[GET whatsapp/media/:messageId]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
