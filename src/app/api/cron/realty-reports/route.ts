// ═══════════════════════════════════════════════════════════════════════
// GET /api/cron/realty-reports → el reporte SEMANAL al propietario
//
// Recorre las cuentas activas, junta los inmuebles con EXCLUSIVA VIGENTE y
// le manda a cada propietario cómo van sus últimos 30 días: WhatsApp si la
// ventana de 24 h está abierta, correo si no, y nada si no hay ni teléfono
// ni correo capturados.
//
// ── POR QUÉ LA EXCLUSIVA ES EL INTERRUPTOR ─────────────────────────────
// Porque es el que YA existe y además es el correcto: es literalmente el
// papel que obliga a informarle al propietario, es por inmueble Y por
// propietario, el asesor ya lo da de alta y lo quita desde la ficha, y es
// lo que este reporte sirve para renovar. Un inmueble sin exclusiva no le
// genera correo automático a nadie.
//
// Lo que falta —y va en el reporte de la ola— es UNA columna booleana para
// poder apagarlo por inmueble sin cancelar la exclusiva. No se inventa aquí
// una tabla que viva solo en un .sql sin modelo de Prisma: esa es la deuda
// que barber ya pagó dos veces (P2022 en una base sin las columnas).
//
// ── IDEMPOTENCIA ───────────────────────────────────────────────────────
// La llave de reclamo es `ownerReport:<propertyId>:<semana ISO>`. Si Vercel
// dispara el cron dos veces el mismo lunes, el segundo choca contra el
// único del hilo y NO manda nada. Correrlo a mano tampoco duplica.
//
// ⚠️ EL CRON NO ESTÁ DADO DE ALTA TODAVÍA: `vercel.json` está FUERA del
// vertical (el guardia lo marca como prohibido) y no se toca desde aquí. El
// bloque exacto que hay que pegar va en el reporte de ORQUESTA.md.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { runWeeklyOwnerReports } from "@/lib/realty/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Un barrido de hasta 500 envíos con una llamada a Meta cada uno. Es el
// mismo techo que el barrido de la renta.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Fail-closed: sin CRON_SECRET en el entorno, un "Bearer undefined"
  // pasaría y dejaría abierto un endpoint que le escribe a los clientes de
  // nuestros clientes. Mismo criterio que /api/cron/realty-rent.
  if (!process.env.CRON_SECRET) {
    console.error("[cron/realty-reports] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runWeeklyOwnerReports();

  // AuditLog NO sirve aquí: sus columnas clinicId y userId son FK NOT NULL
  // a las tablas del dental y un cron no tiene usuario. La traza es este
  // log estructurado, que sí queda en los logs de Vercel — y `reasons` es
  // lo que permite leer de un vistazo si lo que falló fue la ventana de
  // Meta, el cupo o que a media cartera le falta el teléfono del dueño.
  console.log("[cron/realty-reports]", JSON.stringify(summary));

  return NextResponse.json(summary);
}
