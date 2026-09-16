import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { folioObligatorioActivo } from "@/lib/clinical/cofepris";

export const dynamic = "force-dynamic";

/**
 * GET /api/prescriptions/reglas — qué reglas de controlados están encendidas.
 *
 * Existe por una razón concreta: el folio obligatorio de los grupos I y II vive
 * detrás de `RECETAS_FOLIO_OBLIGATORIO`, que se puede apagar sin desplegar. Si
 * el modal llevara esa decisión cableada, apagar el interruptor en el servidor
 * dejaría la pantalla bloqueando recetas que el servidor ya acepta. Preguntando
 * aquí, el interruptor manda en las dos capas a la vez.
 *
 * No devuelve nada sensible: es un booleano de configuración, y aun así pide
 * sesión porque solo lo consume el modal de recetas del panel.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ folioObligatorio: folioObligatorioActivo() });
}
