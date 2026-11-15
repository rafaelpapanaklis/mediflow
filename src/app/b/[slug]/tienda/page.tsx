import type { Metadata } from "next";
import Link from "next/link";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { isTiendaGateOk, loadTienda, resolveTienda } from "@/lib/barber/tienda";
import { rutaTienda } from "@/lib/barber/tienda-core";
import { TiendaShell } from "@/components/barber/tienda/tienda-shell";
import { TiendaGrid, branchLabel } from "@/components/barber/tienda/tienda-grid";
import "@/app/barber/barber-theme.css";
import "@/components/barber/booking/barber-public.css";
import "@/components/barber/tienda/tienda-publica.css";

/* ═══════════════════════════════════════════════════════════════════════
   /b/[slug]/tienda — la tienda de la barbería (ws6-t1).

   SIN sesión. La barbería sale del slug; se ven los productos que la
   barbería marcó «Mostrar en mi página», de TODAS sus sedes (con filtro por
   sucursal si hay más de una con productos) y por categoría. Dinámica: las
   existencias cambian con cada venta y cada apartado.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sucursal?: string; categoria?: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const gate = await resolveTienda(params.slug);
  if (!isTiendaGateOk(gate)) return { title: "Tienda no disponible", robots: { index: false, follow: false } };
  const t = getBarberT(gate.shop.locale);
  const products = await loadTienda(gate);
  const title = t("barber.tienda.meta.title", { shop: gate.shop.name });
  const description = t("barber.tienda.meta.description", { shop: gate.shop.name });
  const image = products.find((p) => p.photoUrl)?.photoUrl ?? gate.shop.logoUrl;
  const url = `${SITE_URL}${rutaTienda(gate.shop.slug)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", locale: "es_MX", url, siteName: gate.shop.name, title, description, images: image ? [image] : [] },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image] : [] },
  };
}

export default async function TiendaPage(props: Props) {
  const params = await props.params;
  const sp = await props.searchParams;
  const gate = await resolveTienda(params.slug);
  if (!isTiendaGateOk(gate)) {
    const t = getBarberT("es");
    return (
      <TiendaShell shop={null}>
        <div className="dcb-card" style={{ marginTop: 32, textAlign: "center" }}>
          <h1 className="dcb-title" style={{ marginTop: 0 }}>{t("barber.tienda.noEncontrada")}</h1>
        </div>
      </TiendaShell>
    );
  }
  const tg = getBarberT(gate.shop.locale);
  const t = (k: string, v?: Record<string, string | number>) => tg(`barber.tienda.${k}`, v);
  const all = await loadTienda(gate);

  // Sucursales que SÍ tienen algo en la tienda.
  const withProducts = gate.branches.filter((b) => all.some((p) => p.branchId === b.id));
  const multi = withProducts.length > 1;
  const branchId = multi && typeof sp.sucursal === "string" && withProducts.some((b) => b.id === sp.sucursal) ? sp.sucursal : null;
  const byBranch = branchId ? all.filter((p) => p.branchId === branchId) : all;
  const categories = Array.from(new Set(byBranch.map((p) => p.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b, "es"));
  const category = typeof sp.categoria === "string" && categories.includes(sp.categoria) ? sp.categoria : null;
  const shown = category ? byBranch.filter((p) => p.category === category) : byBranch;

  const base = rutaTienda(gate.shop.slug);
  const href = (q: { sucursal?: string | null; categoria?: string | null }) => {
    const u = new URLSearchParams();
    if (q.sucursal) u.set("sucursal", q.sucursal);
    if (q.categoria) u.set("categoria", q.categoria);
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <TiendaShell shop={gate.shop}>
      <div className="dct-head">
        <Link href={`/b/${encodeURIComponent(gate.shop.slug)}`} className="dct-back">← {t("back")}</Link>
        <h1 className="dct-title">{t("title")}</h1>
        <p className="dct-sub">{t("sub")}</p>
      </div>

      {multi ? (
        <nav className="dct-chips" aria-label={t("branch")}>
          <Link className="dct-chip" aria-current={branchId === null ? "true" : undefined} href={href({ categoria: category })}>{t("branchAll")}</Link>
          {withProducts.map((b) => (
            <Link key={b.id} className="dct-chip" aria-current={branchId === b.id ? "true" : undefined} href={href({ sucursal: b.id, categoria: category })}>{branchLabel(b)}</Link>
          ))}
        </nav>
      ) : null}
      {categories.length > 1 ? (
        <nav className="dct-chips" aria-label={t("all")}>
          <Link className="dct-chip" aria-current={category === null ? "true" : undefined} href={href({ sucursal: branchId })}>{t("all")}</Link>
          {categories.map((c) => (
            <Link key={c} className="dct-chip" aria-current={category === c ? "true" : undefined} href={href({ sucursal: branchId, categoria: c })}>{c}</Link>
          ))}
        </nav>
      ) : null}

      {shown.length === 0 ? (
        <div className="dcb-card" style={{ textAlign: "center" }}><p className="dcb-sub" style={{ margin: 0 }}>{t("empty")}</p></div>
      ) : (
        <TiendaGrid products={shown} slug={gate.shop.slug} branches={gate.branches} showBranch={multi && !branchId} t={t} />
      )}
    </TiendaShell>
  );
}
