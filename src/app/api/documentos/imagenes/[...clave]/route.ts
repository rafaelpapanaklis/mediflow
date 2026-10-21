// GET /api/documentos/imagenes/<clave codificada>  → 302 a una URL firmada de 300 s
//
// Es el `src` con el que el editor y el visor pintan una imagen guardada
// (`rutaDeImagen(clave)`). La clave sale del HTML del documento; lo que la
// protege es que su prefijo `documentos/<clinicId>/` sea la clínica de la
// SESIÓN. Clave de otra clínica, mal formada (`../`, `%2F` doble, otra
// extensión) o que no existe: el mismo 404, sin detalles.
//
// La redirección se deja en caché del navegador 4 min (la URL firmada dura 5):
// una hoja con 40 imágenes no pide 40 firmas nuevas en cada repintado.

import { NextRequest, NextResponse } from "next/server";
import { claveDesdeSegmentos } from "@/lib/documentos/imagenes";
import { ImagenNoEncontrada, almacenConfigurado, urlFirmadaDeImagen } from "@/lib/documentos/imagenes.server";
import { LIMITES, entrar, noEncontrada } from "../_lib/entrada";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ clave: string[] }> }) {
  const e = await entrar(req, "ver", LIMITES.ver);
  if (e.res) return e.res;

  const clave = claveDesdeSegmentos((await props.params).clave);
  if (!clave || !almacenConfigurado()) return noEncontrada();

  try {
    const firmada = await urlFirmadaDeImagen(e.ctx.clinicId, clave);
    const res = NextResponse.redirect(firmada, 302);
    res.headers.set("Cache-Control", "private, max-age=240");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  } catch (err) {
    if (!(err instanceof ImagenNoEncontrada)) console.error("[documentos/imagenes] firmar lectura:", err);
    return noEncontrada();
  }
}
