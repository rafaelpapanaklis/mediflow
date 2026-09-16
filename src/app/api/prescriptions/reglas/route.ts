import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { folioObligatorioActivo } from "@/lib/clinical/cofepris";

export const dynamic = "force-dynamic";

/**
 * GET /api/prescriptions/reglas — qué reglas de controlados están encendidas.
 *
 * Existe por una razón concreta: el folio obligatorio de los grupos I y II vive
 * detrás de `RECETAS_FOLIO_OBLIGATORIO`, que se apaga sin tocar el código. Si
 * el modal llevara esa decisión cableada, apagar el interruptor en el servidor
 * dejaría la pantalla bloqueando recetas que el servidor ya acepta. Preguntando
 * aquí, el interruptor manda en las dos capas a la vez.
 *
 * Devuelve además `ahora`, la hora DEL SERVIDOR, y esto tampoco es un adorno:
 * el modal calcula el tope de vigencia de un controlado para no dejar escribir
 * una fecha que el servidor va a rechazar. Si lo calculara con el reloj del
 * dispositivo, una tablet de recepción adelantada unas horas —sin NTP, que es
 * lo normal— correría el día del tope, el médico elegiría una fecha que la
 * pantalla da por buena y el servidor la rechazaría con un 422. Con la hora del
 * servidor, las dos capas cuentan desde el mismo sitio.
 *
 * No devuelve nada sensible: un booleano de configuración y un reloj. Aun así
 * pide sesión, porque solo lo consume el modal de recetas del panel.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    folioObligatorio: folioObligatorioActivo(),
    ahora: new Date().toISOString(),
  });
}
