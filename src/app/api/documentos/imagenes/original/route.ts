// Camino de RESPALDO para fotos que el navegador no pudo abrir (hasta 40 MB).
//
// POST   /api/documentos/imagenes/original   body: { nombre, tamano, tipo, enDocumento? }
//   → { id, signedUrl, token, maxBytes }
// DELETE /api/documentos/imagenes/original?id=<id>   (el navegador canceló o falló el PUT)
//   → 204
//
// El navegador sube el ORIGINAL directo al bucket con la URL firmada (el techo
// de ~4.5 MB de Vercel no entra en juego) y luego llama a …/original/procesar.
// El path lo compone el servidor con el clinicId de la sesión y un id nuevo; el
// cliente solo conoce el id. El tamaño declarado aquí es una pista: el real se
// le pregunta a Storage al procesar, antes de bajar nada.

import { NextRequest, NextResponse } from "next/server";
import { IMAGEN_MAX_BYTES, IMAGEN_MAX_POR_DOCUMENTO } from "@/lib/documentos/limites-imagen";
import { esHeic, esIdDeImagen, revisarArchivo, tipoDeclarado } from "@/lib/documentos/imagenes";
import {
  almacenConfigurado,
  descartarOriginal,
  firmarSubidaDeOriginal,
  registrarImagenRechazada,
} from "@/lib/documentos/imagenes.server";
import { tieneExtensionPeligrosa } from "@/lib/uploads/validar-archivo";
import { LIMITES, entrar, excedeTope, leerJson, quienSube, respuestaDeCodigo } from "../_lib/entrada";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUTA = "/api/documentos/imagenes/original";

export async function POST(req: NextRequest) {
  const e = await entrar(req, "editar", LIMITES.original);
  if (e.res) return e.res;
  const { ctx } = e;
  const quien = quienSube(ctx, req);

  if (!almacenConfigurado()) return NextResponse.json({ error: "Almacenamiento no configurado" }, { status: 500 });

  const body = await leerJson(req);
  const nombre = String(body.nombre ?? "").trim().slice(0, 120);
  const declarado = { name: nombre, type: String(body.tipo ?? ""), size: Number(body.tamano) };

  if (excedeTope(body.enDocumento, IMAGEN_MAX_POR_DOCUMENTO)) return respuestaDeCodigo("tope_por_documento");

  const codigo = tieneExtensionPeligrosa(nombre) ? "tipo_no_permitido" : revisarArchivo(declarado);
  if (codigo) {
    await registrarImagenRechazada(quien, RUTA, codigo, nombre);
    return respuestaDeCodigo(codigo);
  }
  // El servidor no decodifica HEIC (ver imagenes.server.ts): no se le pide al
  // usuario que suba 40 MB para rechazárselos después.
  if (esHeic(tipoDeclarado(declarado))) {
    await registrarImagenRechazada(quien, RUTA, "heic_no_legible", nombre);
    return respuestaDeCodigo("heic_no_legible");
  }

  try {
    const firmada = await firmarSubidaDeOriginal(ctx.clinicId);
    return NextResponse.json({ ...firmada, maxBytes: IMAGEN_MAX_BYTES });
  } catch (err) {
    console.error("[documentos/imagenes/original] firmar:", err);
    return NextResponse.json({ error: "No se pudo preparar la subida. Inténtalo otra vez." }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const e = await entrar(req, "editar", LIMITES.original);
  if (e.res) return e.res;
  const id = new URL(req.url).searchParams.get("id");
  // Solo dentro de la carpeta de la clínica de la sesión: un id ajeno borra nada.
  if (esIdDeImagen(id)) await descartarOriginal(e.ctx.clinicId, id);
  return new NextResponse(null, { status: 204 });
}
