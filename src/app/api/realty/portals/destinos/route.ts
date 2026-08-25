import { NextResponse } from "next/server";
import { configureDestination, getPortalsOverview } from "@/lib/realty/portals";
import { readJson, requirePortalsAccess, serverError } from "@/app/api/realty/portals/_server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/realty/portals/destinos
 * body: { portal, active?, maxListings?, externalAccountId? }
 *
 * Enciende un destino y guarda CUÁNTOS ANUNCIOS tiene contratados ahí. Ese
 * número es el que hace que la pantalla pueda decir "te quedan 3": el
 * portal le cobra al cliente por anuncio y nadie más sabe cuántos pagó.
 *
 * 🔴 La apiKey NO se toca desde aquí. Ningún destino de hoy la usa (no hay
 * conexión por API con ninguno), y una API de panel que acepte credenciales
 * por JSON es justo lo que después se filtra en un log.
 */
export async function POST(req: Request) {
  const guard = await requirePortalsAccess();
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await readJson(req);
    const portal = typeof body.portal === "string" ? body.portal.trim() : "";
    if (!portal) {
      return NextResponse.json({ error: "Falta el destino." }, { status: 400 });
    }

    const maxListings =
      body.maxListings === undefined || body.maxListings === null
        ? undefined
        : Number(body.maxListings);
    if (maxListings !== undefined && (!Number.isFinite(maxListings) || maxListings < 0)) {
      return NextResponse.json(
        { error: "El número de anuncios contratados no es válido." },
        { status: 400 },
      );
    }
    if (maxListings !== undefined && maxListings > 100000) {
      return NextResponse.json(
        { error: "Ese número de anuncios no puede ser correcto." },
        { status: 400 },
      );
    }

    const externalAccountId =
      body.externalAccountId === undefined
        ? undefined
        : typeof body.externalAccountId === "string"
          ? body.externalAccountId.trim().slice(0, 120) || null
          : null;

    const result = await configureDestination(guard.accountId, {
      portal,
      active: typeof body.active === "boolean" ? body.active : undefined,
      maxListings,
      externalAccountId,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "No se pudo guardar." }, { status: 400 });
    }

    return NextResponse.json(await getPortalsOverview(guard.accountId));
  } catch (err) {
    return serverError("POST destinos", err);
  }
}
