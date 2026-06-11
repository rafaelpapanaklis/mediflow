// Multi-links con campaña del VENDEDOR logueado (equipo de afiliados).
// GET  → { links: SellerLink[] } (solo clics; sin conversiones por campaña).
// POST { name } → crea link; campaign = slug del name (inmutable después).
// Identidad SIEMPRE de getAffiliateSellerContext() (padre APPROVED), NUNCA del
// request. El link cuelga del afiliado PADRE (affiliateId) marcado con sellerId
// del vendedor; la URL pública es /socio/<slugDelPadre>?c=<campaign>.
//
// OJO unicidad: @@unique([affiliateId, campaign]) es COMPARTIDA con el padre y
// con los demás vendedores del mismo equipo. El set "taken" consulta TODOS los
// AffiliateLink del afiliado, no solo los del vendedor. El tope MAX_LINKS, en
// cambio, cuenta SOLO los del vendedor.
// Si las tablas nuevas no existen (SQL sin correr) → 503 { error: "tools_not_ready" }.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateSellerContext } from "@/lib/affiliate-seller-auth";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";
const MAX_LINKS = 20;

export type SellerLink = {
  id: string;
  name: string;
  campaign: string;
  clicks: number;
  url: string; // `${SITE_URL}/socio/<parentSlug>?c=<campaign>`
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

function buildUrl(slug: string, campaign: string): string {
  const base = SITE_URL.replace(/\/$/, "");
  return `${base}/socio/${slug}?c=${campaign}`;
}

export async function GET() {
  const ctx = await getAffiliateSellerContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.parentStatus !== "APPROVED") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const rows = await prisma.affiliateLink.findMany({
      where: { affiliateId: ctx.affiliateId, sellerId: ctx.sellerId },
      orderBy: { createdAt: "asc" },
    });
    const links: SellerLink[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      campaign: r.campaign,
      clicks: r.clicks,
      url: buildUrl(ctx.parentSlug, r.campaign),
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

    const created = await prisma.affiliateLink.create({
      data: { affiliateId: ctx.affiliateId, sellerId: ctx.sellerId, name, campaign },
    });

    const link: SellerLink = {
      id: created.id,
      name: created.name,
      campaign: created.campaign,
      clicks: created.clicks,
      url: buildUrl(ctx.parentSlug, created.campaign),
    };
    return NextResponse.json({ link }, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") {
      // Carrera: otro create simultáneo (del padre o de otro vendedor) tomó la campaign.
      return NextResponse.json(
        { error: "Ya existe una campaña con ese nombre. Prueba otro." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "tools_not_ready" }, { status: 503 });
  }
}
