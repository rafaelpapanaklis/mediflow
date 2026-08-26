// GET /api/realty/pld/expedientes/[id] — EL DETALLE de un expediente.
//
// ── 🔴 POR QUÉ EL DETALLE NO VIAJA CON LA PANTALLA ────────────────────
// La pantalla baja una LISTA de cientos de personas y solo pinta nombre,
// estado y riesgo. Mandar en esa lista el RFC, la CURP, el domicilio y los
// beneficiarios de toda la cartera sería la fuga de "la fila entera al
// navegador": nadie los ve, viajan en el HTML y quedan en la caché del
// navegador de quien tenga la sesión abierta.
//
// Por eso `pantalla.ts` recorta (ExpedienteResumen) y el detalle se pide
// aquí, de uno en uno. Y esa es la segunda razón —la que de verdad manda—:
// LA BÓVEDA. La conservación de diez años exige poder decir quién consultó
// qué expediente y cuándo. Si el detalle bajara con la pantalla, TODOS
// habrían consultado TODO con solo entrar, y la bitácora no diría nada.
//
// ── EL RIESGO SE RECALCULA CON LAS SEÑALES DE ESA PERSONA ─────────────
// `riesgoDeExpediente` sube a ALTO cuando el cliente tiene una operación
// con efectivo por encima del tope, y a MEDIO cuando rebasa el umbral con
// el expediente a medias. Esas dos señales salen de sus OPERACIONES, así
// que se cargan acotadas a su contactId. Devolver el riesgo "del expediente
// solo" haría que el detalle contradijera a la lista, y de las dos cifras
// la más tranquila sería la equivocada.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registrarAcceso } from "@/lib/realty/pld/bitacora";
import { leerExpediente } from "@/lib/realty/pld/expedientes";
import { cargarOperaciones } from "@/lib/realty/pld/operaciones";
import { getPldParams } from "@/lib/realty/pld/parametros";
import { errorPld, gatePld, noEncontrado } from "../../_guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  // pld.view basta: leer un expediente es exactamente lo que hace un
  // auditor, y un auditor no debería poder escribir nada.
  const gate = await gatePld("pld.view");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    // El contactId se saca de la fila —recortada a la cuenta— y NUNCA del
    // query: así el filtro de las operaciones no lo puede elegir quien llama.
    const cabecera = await prisma.realtyPldFile.findFirst({
      where: { id: params.id, accountId: ctx.accountId },
      select: { contactId: true },
    });
    if (!cabecera) return noEncontrado("Ese expediente ya no existe.");

    // Sin parámetros vigentes no hay umbral contra el que comparar, así que
    // las señales van apagadas y el riesgo pintado es el del expediente
    // solo. Es la misma degradación honesta del resto del módulo: nunca se
    // inventa una alerta a partir de un umbral que nadie capturó.
    const resueltos = await getPldParams();
    const { rebasa, efectivo } = await cargarOperaciones(
      ctx,
      resueltos.ok ? resueltos.params : null,
      { contactId: cabecera.contactId, take: 200 },
    );

    const expediente = await leerExpediente(
      ctx,
      params.id,
      {
        rebasaUmbral: rebasa.has(cabecera.contactId),
        efectivoProhibido: efectivo.has(cabecera.contactId),
      },
      new Date(),
    );
    if (!expediente) return noEncontrado("Ese expediente ya no existe.");

    // 🔴 Se registra ANTES de devolver los datos, y registrarAcceso nunca
    // lanza: un fallo de bitácora no deja al usuario sin su expediente,
    // pero no se entrega un expediente sin intentar dejar constancia.
    await registrarAcceso(ctx, { action: "VER_EXPEDIENTE", fileId: expediente.id }, req);

    return NextResponse.json(
      { expediente },
      {
        // Datos personales de terceros: ni el navegador ni un proxy deben
        // quedarse con una copia.
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  } catch (e) {
    return errorPld("expedientes/detalle", e);
  }
}
