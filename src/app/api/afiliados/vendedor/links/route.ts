// Multi-links con campaña del VENDEDOR logueado (equipo de afiliados).
// GET  → { links: SellerLink[] } (solo clics; sin conversiones por campaña).
// POST { name } → crea link; campaign = slug del name (inmutable después).
// Identidad SIEMPRE de getAffiliateSellerContext() (padre APPROVED), NUNCA del
// request. El link cuelga del afiliado PADRE (affiliateId) marcado con sellerId
// del vendedor; la URL pública sale de affiliateLinkUrl() —corta /r/<publicCode>
// o, para los links previos a la migración, /socio/<slugDelPadre>?c=<campaign>—.
//
// OJO unicidad: @@unique([affiliateId, campaign]) es COMPARTIDA con el padre y
// con los demás vendedores del mismo equipo. El set "taken" consulta TODOS los
// AffiliateLink del afiliado, no solo los del vendedor. El tope MAX_LINKS, en
// cambio, cuenta SOLO los del vendedor.
// Si las tablas nuevas no existen (SQL sin correr) → 503 { error: "tools_not_ready" }.
//
// URL corta: estos links también reciben publicCode y se muestran como
// /r/<publicCode>. La atribución al VENDEDOR no cambia — se sigue resolviendo
// por affiliateId_campaign en el alta —, y la campaña viaja igual dentro de la
// URL corta. Se hace por la misma razón que en el afiliado: un ?c=facebook
// adivinable deja que cualquiera manipule las campañas ajenas.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateSellerContext } from "@/lib/affiliate-seller-auth";
import { affiliateLinkUrl, generateLinkPublicCode } from "@/lib/affiliates/link-url";

// A propósito sigue en 20: el tope que bajó a 15 es el del AFILIADO. El
// vendedor tiene su propio cupo, contado solo sobre sus links.
const MAX_LINKS = 20;

export type SellerLink = {
  id: string;
  /** Título que escribe el vendedor: lo que ve en su panel junto a los clics. */
  name: string;
  /** Slug inmutable: llave de la atribución (affiliateId_campaign). No se toca. */
  campaign: string;
  /** Código opaco de la URL corta /r/<code>. null = link anterior a la migración. */
  publicCode: string | null;
  clicks: number;
  /** Ya resuelta: `/r/<publicCode>` o `/socio/<parentSlug>?c=<campaign>`. */
  url: string;
};

/** Fila mínima que necesita el DTO. Select explícito por el fallback de abajo. */
type LinkRow = {
  id: string;
  name: string;
  campaign: string;
  clicks: number;
  publicCode: string | null;
};

// Slug de campaña: minúsculas, sin acentos (normalize NFD), espacios/raros →
// "-", solo [a-z0-9-], guiones colapsados, recorte a 40. Vacío → "campana".
// Local a propósito: una route de Next solo puede exportar handlers HTTP.
function toCampaignSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug === "" ? "campana" : slug;
}

// Lectura defensiva de la columna nueva: si `publicCode` todavía no existe en
// la BD (SQL sin correr) el SELECT revienta. Reintentamos sin ella para que la
// pantalla siga viva con las URLs históricas en vez de caer entera a
// "tools_not_ready". Si falta la TABLA, el segundo intento también falla y
// sube al catch de siempre → 503.
async function findLinkRows(where: any): Promise<LinkRow[]> {
  try {
    return await prisma.affiliateLink.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, campaign: true, clicks: true, publicCode: true },
    });
  } catch {
    const rows = await prisma.affiliateLink.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, campaign: true, clicks: true },
    });
    return rows.map((r) => ({ ...r, publicCode: null }));
  }
}

// ¿El P2002 vino del publicCode (único GLOBAL) o de la campaign (única por
// afiliado)? Solo el primero se resuelve solo con otro código. `meta.target`
// llega como array de columnas o como nombre de índice según el driver; si no
// se puede distinguir devolvemos false y se conserva el 409 de campaña.
function isPublicCodeConflict(e: any): boolean {
  const target = e?.meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : typeof target === "string" ? target : "";
  return asText.toLowerCase().includes("publiccode");
}

// Si generateLinkPublicCode() devuelve null (columna ausente) el link se crea
// igual, sin código, y se mostrará con su URL histórica.
async function createLinkRow(affiliateId: string, sellerId: string, name: string, campaign: string) {
  const publicCode = await generateLinkPublicCode();
  const data: any = { affiliateId, sellerId, name, campaign };
  if (publicCode) data.publicCode = publicCode;
  return prisma.affiliateLink.create({ data });
}

export async function GET() {
  const ctx = await getAffiliateSellerContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.parentStatus !== "APPROVED") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const rows = await findLinkRows({ affiliateId: ctx.affiliateId, sellerId: ctx.sellerId });
    const links: SellerLink[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      campaign: r.campaign,
      publicCode: r.publicCode,
      clicks: r.clicks,
      url: affiliateLinkUrl(r, ctx.parentSlug),
    }));
    return NextResponse.json({ links });
  } catch {
    return NextResponse.json({ error: "tools_not_ready" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getAffiliateSellerContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.parentStatus !== "APPROVED") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 40) {
    return NextResponse.json(
      { error: "El nombre debe tener entre 2 y 40 caracteres." },
      { status: 400 }
    );
  }

  try {
    // Tope: SOLO los links del vendedor.
    const own = await prisma.affiliateLink.count({
      where: { affiliateId: ctx.affiliateId, sellerId: ctx.sellerId },
    });
    if (own >= MAX_LINKS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_LINKS} links. Elimina uno para crear otro.` },
        { status: 400 }
      );
    }

    // Unicidad COMPARTIDA: campaign única por afiliado (padre + todos sus
    // vendedores). Consultamos TODAS las campañas del afiliado para evitar
    // chocar con las del padre u otro vendedor.
    const all = await prisma.affiliateLink.findMany({
      where: { affiliateId: ctx.affiliateId },
      select: { campaign: true },
    });
    const taken = new Set(all.map((e) => e.campaign));
    const baseSlug = toCampaignSlug(name);
    let campaign = "";
    for (let i = 1; i <= 9 && !campaign; i++) {
      const candidate = i === 1 ? baseSlug : `${baseSlug.slice(0, 38).replace(/-+$/, "")}-${i}`;
      if (!taken.has(candidate)) campaign = candidate;
    }
    if (!campaign) {
      return NextResponse.json(
        { error: "Ya existe una campaña con ese nombre. Prueba otro." },
        { status: 409 }
      );
    }

    let created;
    try {
      created = await createLinkRow(ctx.affiliateId, ctx.sellerId, name, campaign);
    } catch (e: any) {
      // Colisión del código opaco: 1 entre 36^8. Un reintento con otro código
      // basta; si vuelve a chocar sube al catch de abajo.
      if (e?.code === "P2002" && isPublicCodeConflict(e)) {
        created = await createLinkRow(ctx.affiliateId, ctx.sellerId, name, campaign);
      } else {
        throw e;
      }
    }

    const link: SellerLink = {
      id: created.id,
      name: created.name,
      campaign: created.campaign,
      publicCode: created.publicCode ?? null,
      clicks: created.clicks,
      url: affiliateLinkUrl(created, ctx.parentSlug),
    };
    return NextResponse.json({ link }, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") {
      // Dos códigos opacos seguidos colisionaron (irreal): no le decimos al
      // vendedor que repitió el nombre si no fue eso.
      if (isPublicCodeConflict(e)) {
        return NextResponse.json(
          { error: "No se pudo crear el link. Inténtalo de nuevo." },
          { status: 409 }
        );
      }
      // Carrera: otro create simultáneo (del padre o de otro vendedor) tomó la campaign.
      return NextResponse.json(
        { error: "Ya existe una campaña con ese nombre. Prueba otro." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "tools_not_ready" }, { status: 503 });
  }
}
