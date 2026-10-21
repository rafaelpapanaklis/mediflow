// POST /api/documentos/imagenes — una imagen del editor de documentos.
//
// multipart: archivo (la foto, normalmente ya comprimida por el navegador),
//            nombre (el nombre original, solo para la bitácora),
//            enDocumento (cuántas imágenes lleva ya el documento; opcional)
//   → 201 { clave, ancho, alto }
//
// El navegador manda aquí la foto YA comprimida (subir-imagen.client.ts): pesa
// < 1 MB y cabe en los ~4.5 MB que Vercel deja pasar por una ruta. Una foto de
// 40 MB que el navegador no pudo abrir va por el camino del original
// (…/original → PUT directo al bucket → …/original/procesar).
//
// Lo que se guarda lo recodifica el servidor (webp ≤ 1600 px, sin metadatos):
// nunca se guarda tal cual lo que mandó el cliente. El tipo se decide por los
// BYTES, no por el nombre ni el Content-Type.

import { NextRequest, NextResponse } from "next/server";
import { IMAGEN_MAX_BYTES, IMAGEN_MAX_POR_DOCUMENTO } from "@/lib/documentos/limites-imagen";
import {
  almacenConfigurado,
  comprimirImagen,
  guardarImagenComprimida,
  registrarImagenGuardada,
  registrarImagenRechazada,
} from "@/lib/documentos/imagenes.server";
import { LIMITES, entrar, excedeTope, quienSube, respuestaDeCodigo } from "./_lib/entrada";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RUTA = "/api/documentos/imagenes";
/** Holgura del multipart (cabeceras y campos) sobre el tope del archivo. */
const MARGEN_MULTIPART = 64 * 1024;

export async function POST(req: NextRequest) {
  const e = await entrar(req, "editar", LIMITES.subir);
  if (e.res) return e.res;
  const { ctx } = e;
  const quien = quienSube(ctx, req);

  if (!almacenConfigurado()) return NextResponse.json({ error: "Almacenamiento no configurado" }, { status: 500 });

  // Antes de leer el cuerpo: un POST de 2 GB no se mete en memoria para rechazarlo después.
  const largo = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(largo) && largo > IMAGEN_MAX_BYTES + MARGEN_MULTIPART) {
    await registrarImagenRechazada(quien, RUTA, "muy_pesada", "imagen");
    return respuestaDeCodigo("muy_pesada");
  }

  const form = await req.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!form || !(archivo instanceof Blob)) {
    return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
  }
  const nombre = String(form.get("nombre") ?? (archivo as File).name ?? "imagen").slice(0, 120);

  if (excedeTope(form.get("enDocumento"), IMAGEN_MAX_POR_DOCUMENTO)) return respuestaDeCodigo("tope_por_documento");

  if (archivo.size > IMAGEN_MAX_BYTES) {
    await registrarImagenRechazada(quien, RUTA, "muy_pesada", nombre);
    return respuestaDeCodigo("muy_pesada");
  }

  const bytes = Buffer.from(await archivo.arrayBuffer());
  const r = await comprimirImagen(bytes);
  if (!r.ok) {
    await registrarImagenRechazada(quien, RUTA, r.codigo, nombre);
    return respuestaDeCodigo(r.codigo);
  }

  let guardada: { id: string; clave: string };
  try {
    guardada = await guardarImagenComprimida(ctx.clinicId, r.webp);
  } catch (err) {
    console.error("[documentos/imagenes] subida al bucket:", err);
    return NextResponse.json({ error: "No se pudo guardar la imagen. Inténtalo otra vez." }, { status: 502 });
  }

  await registrarImagenGuardada(quien, {
    id: guardada.id,
    clave: guardada.clave,
    camino: "navegador",
    bytesRecibidos: bytes.length,
    bytesGuardados: r.webp.length,
    ancho: r.ancho,
    alto: r.alto,
  });

  return NextResponse.json({ clave: guardada.clave, ancho: r.ancho, alto: r.alto }, { status: 201 });
}
