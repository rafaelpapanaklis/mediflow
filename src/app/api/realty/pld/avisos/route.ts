// POST /api/realty/pld/avisos — marcar un periodo como PRESENTADO.
//
// 🔴 ESTA RUTA NO PRESENTA NADA. Registra que una PERSONA subió el archivo
// en el portal del SAT y guarda su acuse. DaleControl no tiene forma de
// saberlo por su cuenta y no lo finge: no hay cron que marque periodos, y
// descargar el archivo NO marca nada.
//
// Deshacer la marca también se permite: alguien marca el mes equivocado y
// tiene que poder corregirlo. Lo que queda es la bitácora.
import { NextResponse } from "next/server";
import { marcarAviso, periodoValido } from "@/lib/realty/pld/avisos";
import { cargarOperaciones } from "@/lib/realty/pld/operaciones";
import { getPldParams } from "@/lib/realty/pld/parametros";
import { errorPld, gatePld, leerJson, malaPeticion } from "../_guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await gatePld("pld.manage");
  if ("response" in gate) return gate.response;
  const { ctx, nombreUsuario } = gate;

  try {
    const body = await leerJson(req);
    const periodMonth = periodoValido(body.periodMonth);
    if (!periodMonth) return malaPeticion("Ese periodo no se entiende. Va como AAAA-MM.");

    const resueltos = await getPldParams();
    if (!resueltos.ok) {
      return NextResponse.json(
        {
          error:
            "No podemos calcular la fecha límite del aviso: falta capturar el día de corte en el " +
            "panel de DaleControl (Inmobiliarias → Parámetros).",
          code: "PARAM_MISSING",
          faltantes: resueltos.faltantes,
        },
        { status: 409 },
      );
    }

    // El TIPO del aviso lo manda la realidad del mes, no lo que diga el
    // cliente: si el periodo no tiene operaciones que avisar, es un informe
    // EN CEROS aunque el navegador mande otra cosa.
    const { operaciones } = await cargarOperaciones(ctx, resueltos.params, { periodMonth });
    const conAviso = operaciones.filter((o) => o.requiereAviso).length;

    const res = await marcarAviso(
      ctx,
      periodMonth,
      {
        presentado: body.presentado !== false,
        acuse: typeof body.acuse === "string" ? body.acuse : null,
        notas: typeof body.notas === "string" ? body.notas : null,
      },
      resueltos.params,
      conAviso > 0 ? "NORMAL" : "EN_CEROS",
      nombreUsuario,
    );
    if ("error" in res) return malaPeticion(res.error);

    return NextResponse.json({ ok: true, noticeId: res.noticeId });
  } catch (e) {
    return errorPld("avisos", e);
  }
}
