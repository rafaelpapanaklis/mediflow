import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOwnedProperty } from "@/lib/realty/properties";
import {
  REALTY_TOUR_URL_ERROR,
  detectRealtyTourProvider,
  normalizeRealtyTourUrl,
} from "@/lib/realty/tours";
import { gateRealty, notFound, readJson, realtyApiError } from "../../_helpers";

export const dynamic = "force-dynamic";

/** Un inmueble con veinte recorridos no es una ficha, es un problema. */
const MAX_TOURS = 12;

/**
 * POST — dar de alta un recorrido PEGANDO LA LIGA (cero storage).
 *
 * 🔴 LA VALIDACIÓN ES LA MISMA ALLOWLIST QUE ARMA EL CSP. No se comprueba
 * "que parezca una URL": se pregunta a detectRealtyTourProvider, que sale
 * de src/lib/realty/tour-hosts.json — el mismo archivo que next.config.mjs
 * lee para el frame-src. Si aceptáramos aquí un dominio que la CSP no
 * permite, el asesor guardaría su recorrido y luego vería un MARCO EN
 * BLANCO, sin un solo error en consola. Ese bug se diagnostica siempre mal
 * ("Matterport está caído"), y por eso las dos puertas usan la misma lista.
 *
 * El `kind` y el `provider` NO se le preguntan al asesor: se deducen de la
 * propia liga. Un desplegable ahí solo serviría para que se equivoque.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const property = await assertOwnedProperty(ctx, params.id);
    if (!property) return notFound();

    const body = await readJson(req);
    const raw = typeof body.externalUrl === "string" ? body.externalUrl.trim() : "";
    if (!raw) {
      return NextResponse.json({ error: "Pega la liga del recorrido." }, { status: 400 });
    }

    // Se normaliza ANTES de validar (el youtu.be del botón "Compartir" se
    // reescribe a youtube.com, que sí está en la allowlist y en el CSP).
    const url = normalizeRealtyTourUrl(raw);
    const provider = detectRealtyTourProvider(url);
    if (!provider) {
      return NextResponse.json(
        { error: REALTY_TOUR_URL_ERROR, code: "BAD_TOUR_URL" },
        { status: 400 },
      );
    }

    const count = await prisma.realtyPropertyTour.count({
      where: { accountId: ctx.accountId, propertyId: property.id },
    });
    if (count >= MAX_TOURS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_TOURS} recorridos por inmueble.` },
        { status: 400 },
      );
    }

    // La misma liga dos veces no aporta nada y confunde en la ficha.
    const already = await prisma.realtyPropertyTour.findFirst({
      where: { accountId: ctx.accountId, propertyId: property.id, externalUrl: url },
      select: { id: true },
    });
    if (already) {
      return NextResponse.json({ error: "Ese recorrido ya está agregado." }, { status: 409 });
    }

    const tour = await prisma.realtyPropertyTour.create({
      data: {
        accountId: ctx.accountId,
        propertyId: property.id,
        kind: provider.kind,
        provider: provider.key,
        externalUrl: url,
        // Una liga externa no ocupa cupo: el archivo vive en el proveedor.
        bytes: 0,
        sortOrder: count,
      },
      select: { id: true, kind: true, provider: true, externalUrl: true, sortOrder: true },
    });

    return NextResponse.json({ tour }, { status: 201 });
  } catch (e) {
    return realtyApiError("properties/[id]/tours:POST", e);
  }
}
