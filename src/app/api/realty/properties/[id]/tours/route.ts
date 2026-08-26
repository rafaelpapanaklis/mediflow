import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOwnedProperty } from "@/lib/realty/properties";
import { checkRealtyTourUrl } from "@/lib/realty/tours";
import { gateRealty, notFound, readJson, realtyApiError } from "../../_helpers";

export const dynamic = "force-dynamic";

/** Un inmueble con veinte recorridos no es una ficha, es un problema. */
const MAX_TOURS = 12;

/**
 * POST — dar de alta un recorrido PEGANDO LA LIGA (cero storage).
 *
 * 🔴 LA VALIDACIÓN ES LA MISMA ALLOWLIST QUE ARMA EL CSP. No se comprueba
 * "que parezca una URL": se pregunta a checkRealtyTourUrl, que sale de
 * src/lib/realty/tour-hosts.json — el mismo archivo que next.config.mjs
 * lee para el frame-src. Si aceptáramos aquí un dominio que la CSP no
 * permite, el asesor guardaría su recorrido y luego vería un MARCO EN
 * BLANCO, sin un solo error en consola. Ese bug se diagnostica siempre mal
 * ("Matterport está caído"), y por eso las dos puertas usan la misma lista.
 *
 * 🔴 Y SON DOS PREGUNTAS, NO UNA. Antes aquí solo se preguntaba por el
 * DOMINIO (`detectRealtyTourProvider`). Matterport destapó que eso no
 * alcanza: `matterport.com` entero está permitido, así que una liga de
 * `/discover/space/…` pasaba, se guardaba con 201, y en la ficha salía el
 * marco gris con el icono de recurso roto. Estar en la allowlist dice que
 * la CSP lo deja pasar; NO dice que el proveedor acepte que ESA liga en
 * concreto se meta en un iframe. `checkRealtyTourUrl` responde las dos, y
 * es la MISMA función que usa la pantalla para deshabilitar el botón: si
 * los dos lados no comparten criterio, uno de los dos miente.
 *
 * Vale más rechazarla al pegarla —y enseñar qué copiar— que guardar algo
 * que se va a ver roto.
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

    // Normaliza ANTES de validar (el youtu.be del botón "Compartir" se
    // reescribe a youtube.com, que sí está en la allowlist y en el CSP; la
    // de Matterport se reescribe a /show/?m=<id>) y además comprueba que se
    // pueda EMBEBER. `check.error` ya viene redactado para el asesor: dice
    // qué liga hay que copiar, no "URL inválida".
    const check = checkRealtyTourUrl(raw);
    if (!check.ok || !check.url || !check.provider) {
      return NextResponse.json(
        { error: check.error, code: "BAD_TOUR_URL" },
        { status: 400 },
      );
    }
    const url = check.url;
    const provider = check.provider;

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
