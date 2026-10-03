// GET /api/indicaciones/disponible — ¿ya existe la biblioteca de hojas (SQL de
// ws1-t10 pegado)? Lo pregunta el panel de la cita una vez por carga de página
// para no enseñar «Indicaciones» antes de tiempo. No toca la tabla: to_regclass,
// con la respuesta recordada en el servidor.

import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { tablaHojasExiste } from "@/lib/indicaciones/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ disponible: await tablaHojasExiste() });
}
