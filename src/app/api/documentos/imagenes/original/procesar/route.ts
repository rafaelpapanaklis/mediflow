// POST /api/documentos/imagenes/original/procesar   body: { id, nombre? }
//   → 201 { clave, ancho, alto }
//
// Paso final del camino de respaldo: el original ya está en el bucket (lo subió
// el navegador con la URL firmada de …/original). El servidor lo baja
// servidor→servidor —sin el techo de 4.5 MB—, mide su tamaño REAL en Storage
// antes de bajarlo, lo valida por los bytes, lo comprime a webp ≤ 1600 px y
// borra el original pase lo que pase.
//
// El cliente solo manda el id: la ruta del original se arma con el clinicId de
// la sesión, así que el id de otra clínica no encuentra nada (404).

import { NextRequest, NextResponse } from "next/server";
import { esIdDeImagen } from "@/lib/documentos/imagenes";
import {
  almacenConfigurado,
  procesarOriginal,
  registrarImagenGuardada,
  registrarImagenRechazada,
} from "@/lib/documentos/imagenes.server";
import { LIMITES, entrar, leerJson, quienSube, respuestaDeCodigo } from "../../_lib/entrada";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Bajar 40 MB y decodificar una foto de 200 MP tarda unos segundos.
export const maxDuration = 120;

const RUTA = "/api/documentos/imagenes/original/procesar";

const noLlego = () =>
  NextResponse.json(
    { error: "La imagen no llegó al almacenamiento. Inténtalo otra vez.", code: "no_esta" },
    { status: 404 },
  );

export async function POST(req: NextRequest) {
  const e = await entrar(req, "editar", LIMITES.original);
  if (e.res) return e.res;
  const { ctx } = e;
  const quien = quienSube(ctx, req);

  if (!almacenConfigurado()) return NextResponse.json({ error: "Almacenamiento no configurado" }, { status: 500 });

  const body = await leerJson(req);
  const nombre = String(body.nombre ?? "").trim().slice(0, 120);
  if (!esIdDeImagen(body.id)) return noLlego();

  let r: Awaited<ReturnType<typeof procesarOriginal>>;
  try {
    r = await procesarOriginal(ctx.clinicId, body.id);
  } catch (err) {
    console.error("[documentos/imagenes/original/procesar]:", err);
    return NextResponse.json({ error: "No se pudo guardar la imagen. Inténtalo otra vez." }, { status: 502 });
  }

  if (!r.ok) {
    if (r.codigo === "no_esta") return noLlego();
    await registrarImagenRechazada(quien, RUTA, r.codigo, nombre);
    return respuestaDeCodigo(r.codigo);
  }

  await registrarImagenGuardada(quien, {
    id: r.id,
    clave: r.clave,
    camino: "original",
    bytesRecibidos: r.bytesOriginal,
    bytesGuardados: r.bytesGuardados,
    ancho: r.ancho,
    alto: r.alto,
  });

  return NextResponse.json({ clave: r.clave, ancho: r.ancho, alto: r.alto }, { status: 201 });
}
