// Multi-links con campaña del afiliado logueado.
// GET  → { links: ToolLink[] } (clicks + conversiones por campaña)
// POST { name } → crea link; campaign = slug del name (inmutable después).
// Identidad SIEMPRE de getAffiliateContext() (status APPROVED), NUNCA del
// request. Si las tablas nuevas no existen (SQL sin correr) → 503
// { error: "tools_not_ready" } sin reventar.
//
// La URL pública sale SIEMPRE de affiliateLinkUrl() (src/lib/affiliates/link-url.ts):
// corta /r/<publicCode> cuando el link ya tiene código, histórica
// /socio/<slug>?c=<campaign> cuando es anterior a la migración. Antes se armaba
// a mano aquí y otra vez en la page SSR, así que la misma pantalla podía
// mostrar dos formatos distintos para el mismo tipo de link.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { affiliateLinkUrl, generateLinkPublicCode } from "@/lib/affiliates/link-url";

// Tope de links por afiliado: bajó de 20 a 15. Quien ya tuviera más los
// CONSERVA — la comparación es `>=` al crear, así que solo deja de poder crear
// nuevos; nada se borra ni se oculta.
const MAX_LINKS = 15;

export type ToolLink = {
  id: string;
  /** Título que escribe el afiliado ("Facebook", "Expo dental"): lo que ve en su panel. */
  name: string;
  /** Slug inmutable: LLAVE de las estadísticas y de la atribución. No se toca. */
  campaign: string;
  /** Código opaco de la URL corta /r/<code>. null = link anterior a la migración. */
  publicCode: string | null;
  clicks: number;
  conversions: number;
  /** Ya resuelta: `/r/<publicCode>` o, si no hay código, `/socio/<slug>?c=<campaign>`. */
  url: string;
};

/** Fila mínima que necesita el DTO. Se pide con select explícito por el fallback de abajo. */
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
// la BD (SQL sin correr) el SELECT revienta. En vez de tumbar toda la pantalla
// a "tools_not_ready" reintentamos sin esa columna: los links siguen listándose
// y copiándose con su URL histórica. Si lo que falta es la TABLA entera, el
// segundo intento también falla y sube al catch de siempre → 503.
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

// ¿El P2002 fue por el publicCode (único GLOBAL) o por la campaign (única por
// afiliado)? Solo el primero se arregla solo generando otro código; el segundo
// es un nombre repetido del afiliado y hay que avisarle. `meta.target` llega
// como array de columnas o como nombre del índice según el driver, así que se
// lee de forma defensiva: si no se puede distinguir devolvemos false y se
// conserva el comportamiento anterior (409 "ya tienes una campaña así").
function isPublicCodeConflict(e: any): boolean {
  const target = e?.meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : typeof target === "string" ? target : "";
  return asText.toLowerCase().includes("publiccode");
}

// El código opaco se genera aquí y no en la BD porque debe ser aleatorio y
// único global. Si generateLinkPublicCode() devuelve null (columna ausente) el
// link se crea igual, sin código, y se mostrará con su URL histórica.
async function createLinkRow(affiliateId: string, name: string, campaign: string) {
  const publicCode = await generateLinkPublicCode();
  const data: any = { affiliateId, name, campaign };
  if (publicCode) data.publicCode = publicCode;
  return prisma.affiliateLink.create({ data });
}

export async function GET() {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const affiliateId = ctx.affiliateId;

  try {
    const [rows, convGroups] = await Promise.all([
      findLinkRows({ affiliateId }),
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
      publicCode: r.publicCode,
      clicks: r.clicks,
      conversions: convByCampaign.get(r.campaign) ?? 0,
      url: affiliateLinkUrl(r, ctx.affiliate.slug),
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

    let created;
    try {
      created = await createLinkRow(affiliateId, name, campaign);
    } catch (e: any) {
      // Colisión del código opaco: 1 entre 36^8. Un reintento con otro código
      // basta; si vuelve a chocar sube al catch de abajo.
      if (e?.code === "P2002" && isPublicCodeConflict(e)) {
        created = await createLinkRow(affiliateId, name, campaign);
      } else {
        throw e;
      }
    }

    const link: ToolLink = {
      id: created.id,
      name: created.name,
      campaign: created.campaign,
      publicCode: created.publicCode ?? null,
      clicks: created.clicks,
      conversions: 0,
      url: affiliateLinkUrl(created, ctx.affiliate.slug),
    };
    return NextResponse.json({ link }, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") {
      // Dos códigos opacos seguidos colisionaron (irreal) o la carrera es de
      // otra cosa: no le decimos al afiliado que repitió el nombre si no fue eso.
      if (isPublicCodeConflict(e)) {
        return NextResponse.json(
          { error: "No se pudo crear el link. Inténtalo de nuevo." },
          { status: 409 }
        );
      }
      // Carrera: otro create simultáneo del mismo afiliado tomó la campaign.
      return NextResponse.json(
        { error: "Ya tienes una campaña con ese nombre." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "tools_not_ready" }, { status: 503 });
  }
}
