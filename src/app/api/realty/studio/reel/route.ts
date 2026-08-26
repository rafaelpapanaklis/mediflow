import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pathBelongsToAccount, signRealtyUrl, signRealtyUrls } from "@/lib/realty/media";
import { isStudioGateOk, openStudioGate, studioServerError } from "../_server";
import { buildReelPlan } from "@/lib/realty/studio/reel-plan";
import { REALTY_REEL_TEMPLATES, type RealtyReelTemplate } from "@/lib/realty/studio/types";

export const dynamic = "force-dynamic";

/**
 * A. El PLAN del reel. No devuelve un video: devuelve las escenas, sus
 * tiempos y sus textos, y el navegador lo pinta y lo graba.
 *
 * 🔴 ESTA GENERACIÓN NO CUESTA IA Y POR ESO NO TOCA EL TOPE. El reel se
 * arma con las fotos que ya están en la ficha y con los datos del inmueble:
 * no hay modelo de por medio. Cobrarle al tope una operación que no le
 * cuesta nada a nadie sería quitarle a la cuenta presupuesto que sí
 * necesita para el staging y los textos.
 */
export async function GET(req: NextRequest) {
  const gate = await openStudioGate();
  if (!isStudioGateOk(gate)) return gate.response;
  const { ctx } = gate;

  try {
    const propertyId = req.nextUrl.searchParams.get("propertyId") ?? "";
    const rawTemplate = req.nextUrl.searchParams.get("template") ?? "recorrido";
    const template: RealtyReelTemplate = REALTY_REEL_TEMPLATES.includes(
      rawTemplate as RealtyReelTemplate,
    )
      ? (rawTemplate as RealtyReelTemplate)
      : "recorrido";

    if (!propertyId) {
      return NextResponse.json({ error: "Falta el inmueble.", code: "invalid" }, { status: 400 });
    }

    const property = await prisma.realtyProperty.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
      select: {
        id: true,
        title: true,
        operation: true,
        price: true,
        rentPrice: true,
        currency: true,
        bedrooms: true,
        bathrooms: true,
        parking: true,
        builtM2: true,
        colonia: true,
        city: true,
        photos: {
          select: { url: true },
          orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
          take: 12,
        },
      },
    });
    if (!property) {
      return NextResponse.json(
        { error: "Inmueble no encontrado.", code: "not_found" },
        { status: 404 },
      );
    }

    // Las fotos viven en un bucket PRIVADO: hay que firmarlas para que el
    // navegador pueda dibujarlas en el canvas.
    const photoUrls = (await signRealtyUrls(property.photos.map((f) => f.url))).filter(Boolean);
    if (photoUrls.length === 0) {
      return NextResponse.json(
        {
          error: "Este inmueble todavía no tiene fotos. Sube al menos una para armar el reel.",
          code: "no_photos",
        },
        { status: 400 },
      );
    }

    const precioNum = Number(
      property.operation === "RENTA" ? (property.rentPrice ?? property.price) : property.price,
    );

    // El logo de la cuenta, para la esquina del video.
    //
    // 🔴 Solo se acepta un path DEL PROPIO BUCKET, y de ESTA cuenta. Dos
    // razones, y ninguna es paranoia de más:
    //   · la reja de dueño es la misma que ya aplica `loadAccountLogo` — un
    //     logoUrl con el path de otro inquilino traería su archivo;
    //   · un logo en un dominio ajeno MANCHA el canvas (CORS), y un canvas
    //     manchado hace que `captureStream` truene. El reel se quedaría sin
    //     grabar por adornarlo. Sin logo se graba igual.
    const rawLogo = ctx.account.logoUrl;
    const logoUrl =
      rawLogo && !rawLogo.startsWith("http") && pathBelongsToAccount(rawLogo, ctx.accountId)
        ? (await signRealtyUrl(rawLogo)) || null
        : null;

    const plan = buildReelPlan({
      property: {
        title: property.title,
        price: `$${precioNum.toLocaleString("es-MX", { maximumFractionDigits: 0 })} ${property.currency}`,
        operation: String(property.operation),
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        parking: property.parking,
        builtM2: property.builtM2 == null ? null : Number(property.builtM2),
        colonia: property.colonia,
        city: property.city,
        photoUrls,
      },
      template,
      accountName: ctx.account.name,
      logoUrl,
      cta: ctx.account.phone ? `Escríbenos: ${ctx.account.phone}` : ctx.account.name,
    });

    if (!plan) {
      return NextResponse.json(
        { error: "No se pudo armar el reel.", code: "no_photos" },
        { status: 400 },
      );
    }

    return NextResponse.json({ plan });
  } catch (err) {
    return studioServerError("reel", err);
  }
}
