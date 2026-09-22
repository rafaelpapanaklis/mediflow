import { NextResponse, type NextRequest } from "next/server";
import {
  contextoDeBloqueos,
  cuerpoJson,
  extractAuditMeta,
  respuestaDeError,
} from "@/lib/agenda-bloqueos/ruta.server";
import { aplicarFestivos, festivosDelAnio } from "@/lib/agenda-bloqueos/service";
import { FESTIVOS_ANIO_MAX, FESTIVOS_ANIO_MIN } from "@/lib/agenda-bloqueos/festivos-mx";

export const dynamic = "force-dynamic";

function anioDe(raw: unknown, timezone: string): number {
  if (raw === null || raw === undefined || raw === "") {
    // El año EN CURSO en la zona de la CLÍNICA, no la del servidor: en Vercel
    // el proceso corre en UTC y el 31 de diciembre por la noche en México el
    // catálogo saldría ya del año siguiente.
    return Number(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(new Date()),
    );
  }
  return Number(raw);
}

/**
 * GET /api/settings/bloqueos/festivos?anio= → el catálogo del año MÁS cuáles
 * ya están aplicados.
 *
 * El «ya aplicados» sale de `holidayKey`, no de comparar fechas: si alguien
 * mueve el bloqueo de Navidad una hora o lo deja de medio día, sigue siendo la
 * Navidad de 2026 y la casilla tiene que seguir marcada.
 *
 * Es de lectura (`agenda.view`): ver qué festivos hay y cuáles están puestos
 * no cierra nada.
 */
export async function GET(req: NextRequest) {
  const r = await contextoDeBloqueos({ soloLectura: true });
  if (r instanceof NextResponse) return r;

  const anio = anioDe(req.nextUrl.searchParams.get("anio"), r.ctx.timezone);
  if (!Number.isInteger(anio) || anio < FESTIVOS_ANIO_MIN || anio > FESTIVOS_ANIO_MAX) {
    return NextResponse.json(
      { error: "ANIO_INVALIDO", mensaje: `El año tiene que estar entre ${FESTIVOS_ANIO_MIN} y ${FESTIVOS_ANIO_MAX}.` },
      { status: 400 },
    );
  }

  try {
    const festivos = await festivosDelAnio(r.ctx, anio);
    return NextResponse.json(
      { anio, festivos, puedeAplicar: r.ctx.puedeGestionar },
      { headers: { "Cache-Control": "no-store, must-revalidate" } },
    );
  } catch (err) {
    return respuestaDeError(err);
  }
}

/**
 * POST /api/settings/bloqueos/festivos → `{ anio, keys: [...] }` aplica los
 * marcados de golpe.
 *
 * 🔴 NO FALLA EN BLOQUE. Devuelve `creados` y `conChoque` POR SEPARADO:
 * aplicar diciembre entero no puede caerse porque el 24 haya una limpieza
 * agendada. La pantalla puede decir «se pusieron 4 de 5; el 24 tiene 2 citas»
 * en vez de un «no se pudo» que obliga a adivinar cuál estorbaba. Por eso sale
 * 200 aunque alguno choque: la operación hizo lo que podía hacer.
 */
export async function POST(req: NextRequest) {
  const r = await contextoDeBloqueos();
  if (r instanceof NextResponse) return r;

  const body = await cuerpoJson(req);
  const anio = anioDe(body?.anio, r.ctx.timezone);
  if (!Number.isInteger(anio) || anio < FESTIVOS_ANIO_MIN || anio > FESTIVOS_ANIO_MAX) {
    return NextResponse.json(
      { error: "ANIO_INVALIDO", mensaje: `El año tiene que estar entre ${FESTIVOS_ANIO_MIN} y ${FESTIVOS_ANIO_MAX}.` },
      { status: 400 },
    );
  }
  const keys = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === "string") : [];

  try {
    const res = await aplicarFestivos(
      r.ctx,
      { anio, keys, doctorId: body?.doctorId },
      extractAuditMeta(req),
    );
    return NextResponse.json({ anio, ...res });
  } catch (err) {
    return respuestaDeError(err);
  }
}
