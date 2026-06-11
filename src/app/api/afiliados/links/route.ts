// Multi-links con campaña del afiliado logueado.
// GET  → { links: ToolLink[] } (clicks + conversiones por campaña)
// POST { name } → crea link; campaign = slug del name (inmutable después).
// Identidad SIEMPRE de getAffiliateContext() (status APPROVED), NUNCA del
// request. Si las tablas nuevas no existen (SQL sin correr) → 503
// { error: "tools_not_ready" } sin reventar.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";
const MAX_LINKS = 20;

export type ToolLink = {
  id: string;
  name: string;
  campaign: string;
  clicks: number;
  conversions: number;
  url: string; // `${SITE_URL}/socio/<slug>?c=<campaign>`
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
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const affiliateId = ctx.affiliateId;

  try {
    const [rows, convGroups] = await Promise.all([
      prisma.affiliateLink.findMany({ where: { affiliateId }, orderBy: { createdAt: "asc" } }),
      prisma.affiliateConversion.groupBy({
        by: ["campaign"],
        where: { affiliateId },
        _count: { _all: true },
      }),
    ]);
    const convByCampaign = new Map(convGroups.map((g) => [g.campaign ?? "", g._count._all]));
    const links: ToolLink[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      campaign: r.campaign,
      clicks: r.clicks,
      conversions: convByCampaign.get(r.campaign) ?? 0,
      url: buildUrl(ctx.affiliate.slug, r.campaign),
    }));
    return NextResponse.json({ links });
  } catch {
    return NextResponse.json({ error: "tools_not_ready" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const affiliateId = ctx.affiliateId;

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
    const existing = await prisma.affiliateLink.findMany({
      where: { affiliateId },
      select: { campaign: true },
    });
    if (existing.length >= MAX_LINKS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_LINKS} links. Elimina uno para crear otro.` },
        { status: 400 }
      );
    }

    // campaign es inmutable; si choca con una existente prueba sufijos -2..-9.
    const taken = new Set(existing.map((e) => e.campaign));
    const baseSlug = toCampaignSlug(name);
    let campaign = "";
    for (let i = 1; i <= 9 && !campaign; i++) {
      const candidate = i === 1 ? baseSlug : `${baseSlug.slice(0, 38).replace(/-+$/, "")}-${i}`;
      if (!taken.has(candidate)) campaign = candidate;
    }
    if (!campaign) {
      return NextResponse.json(
        { error: "Ya tienes una campaña con ese nombre." },
        { status: 409 }
      );
    }

    const created = await prisma.affiliateLink.create({
      data: { affiliateId, name, campaign },
    });

    const link: ToolLink = {
      id: created.id,
      name: created.name,
      campaign: created.campaign,
      clicks: created.clicks,
      conversions: 0,
      url: buildUrl(ctx.affiliate.slug, created.campaign),
    };
    return NextResponse.json({ link }, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") {
      // Carrera: otro create simultáneo del mismo afiliado tomó la campaign.
      return NextResponse.json(
        { error: "Ya tienes una campaña con ese nombre." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "tools_not_ready" }, { status: 503 });
  }
}
