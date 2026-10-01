// «Clínicas en línea» para /admin: el conteo de la tarjeta y, con ?detalle=1, la
// lista (clínica, usuarios, desde cuándo, en qué pantalla).
//
// El conteo habla solo con Redis. El detalle hace UNA consulta a la base, por el
// nombre de las clínicas que Redis dice que están en línea (y solo cuando el
// admin abre la lista). Sin Redis: {disponible:false, clinicas:null} → «sin dato».

import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import {
  armarClinicasEnLinea,
  type RespuestaEnLinea,
} from "@/lib/presencia/presencia-core";
import { contarClinicasEnLinea, leerClinicasEnLinea, obtenerRedis } from "@/lib/presencia/presencia-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: SIN_CACHE });

  const ahora = Date.now();
  const redis = obtenerRedis();
  const conDetalle = req.nextUrl.searchParams.get("detalle") === "1";

  if (!conDetalle) {
    const n = await contarClinicasEnLinea(redis, ahora);
    const cuerpo: RespuestaEnLinea = { disponible: n !== null, clinicas: n, ahora };
    return NextResponse.json(cuerpo, { headers: SIN_CACHE });
  }

  const filas = await leerClinicasEnLinea(redis, ahora);
  if (filas === null) {
    const cuerpo: RespuestaEnLinea = { disponible: false, clinicas: null, ahora, detalle: [] };
    return NextResponse.json(cuerpo, { headers: SIN_CACHE });
  }

  const ids = filas.filter((f) => f.usuarios.length > 0).map((f) => f.clinicId);
  const nombres = new Map<string, string>();
  if (ids.length > 0) {
    try {
      const clinicas = await prisma.clinic.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      for (const c of clinicas) nombres.set(c.id, c.name);
    } catch (e) {
      console.error("[admin/en-linea] nombres de clínicas:", e instanceof Error ? e.message : e);
    }
  }

  const detalle = armarClinicasEnLinea(filas, nombres, ahora);
  const cuerpo: RespuestaEnLinea = { disponible: true, clinicas: detalle.length, ahora, detalle };
  return NextResponse.json(cuerpo, { headers: SIN_CACHE });
}
