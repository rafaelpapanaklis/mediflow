"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertTriangle, Package, PackagePlus, Search, ShoppingBag, TrendingUp } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { InventoryStats, ProductRow } from "@/lib/barber/inventory";
import type { ProductExtras } from "@/lib/barber/tienda";
import { rutaProductoTienda, waMeLink } from "@/lib/barber/tienda-core";
import { CardNew } from "@/components/ui/design-system/card-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { PeriodNav } from "@/components/barber/cash/period-nav";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import { fmtMoney, fmtPct, fmtPeriod } from "@/components/barber/cash/money";
import { HistoryModal, MovementModal, ProductFormModal } from "./product-modals";
import { ProductCard, type ProductCardAction } from "./product-card";
import { PedidosTab } from "./pedidos";

type ModalState =
  | { kind: "none" }
  | { kind: "form"; product: ProductRow | null }
  | { kind: "movement"; product: ProductRow }
  | { kind: "history"; product: ProductRow };

/** Lo de la tienda que la página resuelve en el servidor. */
export interface TiendaPanelProps {
  /** false = falta sql/barber_tienda.sql: tarjetas sí, foto/categoría/tienda no. */
  ready: boolean;
  ordersReady: boolean;
  extras: Record<string, ProductExtras>;
  reserved: Record<string, number>;
  newCount: number;
  /** Slug de la sede en sesión (su tienda es /b/<slug>/tienda). */
  slug: string;
  siteUrl: string;
  shopName: string;
  /** Ver + cobrar: «Listo», «Entregar y cobrar», «Cancelar». */
  canHandleOrders: boolean;
  canOpenSession: boolean;
  timezone: string;
  initialTab: "catalog" | "orders";
}

const ALL = "__all__";

export function ProductosClient({
  dict,
  locale,
  products,
  stats,
  maxPeriod,
  canInventory,
  canManage = true,
  tienda,
}: {
  dict: Dictionary;
  locale: string;
  products: ProductRow[];
  stats: InventoryStats;
  maxPeriod: string;
  canInventory: boolean;
  /**
   * products.manage: alta, edición, precio y costo. Sin él (Recepción) la
   * pantalla es de consulta: catálogo, existencias y lo más vendido, sin
   * costo ni margen (el servidor ya no los manda).
   */
  canManage?: boolean;
  tienda: TiendaPanelProps;
}) {
  const t = useBarberT(dict);
  const router = useRouter();
  const [tab, setTab] = useState<"catalog" | "orders">(tienda.initialTab);
  const [newCount, setNewCount] = useState(tienda.newCount);
  const [showInactive, setShowInactive] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const close = () => setModal({ kind: "none" });
  const done = () => {
    close();
    router.refresh();
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = tienda.extras[p.id]?.category;
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, locale));
  }, [products, tienda.extras, locale]);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    return products.filter((p) => {
      if (!showInactive && !p.isActive) return false;
      const ex = tienda.extras[p.id];
      if (category !== ALL && (ex?.category ?? "") !== category) return false;
      if (!q) return true;
      return [p.name, p.sku ?? "", ex?.category ?? ""].some((s) => s.toLocaleLowerCase(locale).includes(q));
    });
  }, [products, showInactive, category, query, tienda.extras, locale]);

  const actions: ProductCardAction[] = [
    ...(canManage ? (["edit"] as const) : []),
    ...(canInventory ? (["movement"] as const) : []),
    ...(canManage || canInventory ? (["history"] as const) : []),
    ...(tienda.ready ? (["copyLink", "share"] as const) : []),
    ...(canManage && tienda.ready ? (["toggleWeb"] as const) : []),
    ...(canManage ? (["toggleActive"] as const) : []),
  ];

  const linkOf = (p: ProductRow) => `${tienda.siteUrl}${rutaProductoTienda(tienda.slug, p.id)}`;

  async function patch(url: string, body: unknown): Promise<boolean> {
    try {
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? t("common.error"));
        return false;
      }
      return true;
    } catch {
      toast.error(t("common.error"));
      return false;
    }
  }

  async function onAction(p: ProductRow, a: ProductCardAction) {
    if (a === "edit") return setModal({ kind: "form", product: p });
    if (a === "movement") return setModal({ kind: "movement", product: p });
    if (a === "history") return setModal({ kind: "history", product: p });
    if (a === "copyLink") {
      try {
        await navigator.clipboard.writeText(linkOf(p));
        toast.success(t("productos.linkCopied"));
      } catch {
        window.prompt(t("productos.copyLink"), linkOf(p));
      }
      return;
    }
    if (a === "share") {
      const text = t("productos.shareText", { name: p.name, price: fmtMoney(p.price), shop: tienda.shopName, url: linkOf(p) });
      window.open(waMeLink(text), "_blank", "noopener,noreferrer");
      return;
    }
    if (a === "toggleWeb") {
      const show = !(tienda.extras[p.id]?.showOnWeb ?? false);
      if (await patch(`/api/barber/products/${p.id}/tienda`, { showOnWeb: show })) {
        toast.success(show ? t("productos.nowOnWeb") : t("productos.nowHidden"));
        router.refresh();
      }
      return;
    }
    if (a === "toggleActive") {
      if (p.isActive && !window.confirm(t("productos.deactivateConfirm", { name: p.name }))) return;
      if (await patch(`/api/barber/products/${p.id}`, { isActive: !p.isActive })) {
        toast.success(t("productos.saved"));
        router.refresh();
      }
    }
  }

  return (
    <div className="bcaja-page bd-page">
      <div className="bcaja-head">
        <div>
          <h1 className="bcaja-head__title">{t("productos.title")}</h1>
          <p className="bcaja-head__sub">{t("productos.subtitle")}</p>
        </div>
        <div className="bcaja-head__actions">
          {tienda.ready ? (
            <a className="btn-new btn-new--secondary" href={`${tienda.siteUrl}/b/${encodeURIComponent(tienda.slug)}/tienda`} target="_blank" rel="noopener noreferrer" data-accion="ver-tienda">
              <ShoppingBag size={15} /> {t("productos.viewStore")}
            </a>
          ) : null}
          {canManage ? (
            <button type="button" className="btn-new barber-btn-primary" onClick={() => setModal({ kind: "form", product: null })}>
              <PackagePlus size={15} /> {t("productos.newProduct")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="btienda-tabs" role="tablist" aria-label={t("productos.title")}>
        <button type="button" role="tab" id="tab-catalogo" aria-selected={tab === "catalog"} aria-controls="panel-catalogo" className="btienda-tab" onClick={() => setTab("catalog")}>
          <Package size={14} /> {t("productos.tabCatalog")}
        </button>
        <button type="button" role="tab" id="tab-pedidos" aria-selected={tab === "orders"} aria-controls="panel-pedidos" className="btienda-tab" onClick={() => setTab("orders")} data-tab="pedidos">
          <ShoppingBag size={14} /> {t("productos.tabOrders")}
          {newCount > 0 ? <span className="btienda-count" aria-label={t("productos.newOrders", { count: newCount })}>{newCount}</span> : null}
        </button>
      </div>

      {tab === "orders" ? (
        <div role="tabpanel" id="panel-pedidos" aria-labelledby="tab-pedidos">
          <PedidosTab
            dict={dict}
            locale={locale}
            ready={tienda.ordersReady}
            canHandle={tienda.canHandleOrders}
            canOpenSession={tienda.canOpenSession}
            timezone={tienda.timezone}
            shopName={tienda.shopName}
            onCount={setNewCount}
            onChanged={() => router.refresh()}
          />
        </div>
      ) : (
        <div role="tabpanel" id="panel-catalogo" aria-labelledby="tab-catalogo" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {canManage ? null : <p className="bcaja-hint" style={{ margin: 0 }}>{t("productos.readOnly")}</p>}
          {tienda.ready ? null : canManage ? <p className="bcaja-hint" style={{ margin: 0 }} data-tienda-sin-sql>{t("productos.storeSqlPending")}</p> : null}

          <div className={canManage ? "bcaja-kpis bcaja-kpis--5 bd-band" : "bcaja-kpis bd-band"}>
            <KpiCard label={t("productos.kpiActive")} value={String(stats.activeCount)} icon={Package} hero />
            <KpiCard label={t("productos.kpiLow")} value={String(stats.lowStock.length)} icon={AlertTriangle} tone={stats.lowStock.length > 0 ? "warning" : undefined} />
            {canManage ? (
              <>
                <KpiCard label={t("productos.kpiValueCost")} value={fmtMoney(stats.stockValueCost ?? 0)} />
                <KpiCard label={t("productos.kpiMargin")} value={fmtPct(stats.avgMarginPct)} />
              </>
            ) : (
              <KpiCard label={t("productos.kpiValuePrice")} value={fmtMoney(stats.stockValuePrice)} />
            )}
            <KpiCard label={t("productos.kpiPeriodRevenue")} value={fmtMoney(stats.periodProductRevenue)} icon={TrendingUp} hint={`${fmtPeriod(stats.periodKey, locale)} · ${t("productos.kpiPeriodUnits", { count: stats.periodProductUnits })}`} />
          </div>

          <CardNew title={t("productos.lowStockTitle")} sub={t("productos.lowStockBody")}>
            {stats.lowStock.length === 0 ? (
              <p className="bcaja-hint" style={{ margin: 0 }}>{t("productos.lowStockEmpty")}</p>
            ) : (
              <div className="bcaja-low">
                {stats.lowStock.map((p) => (
                  <button key={p.id} type="button" className="bcaja-low__item" style={{ cursor: canInventory ? "pointer" : "default", fontFamily: "inherit" }} onClick={() => canInventory && setModal({ kind: "movement", product: p })} title={canInventory ? t("productos.movement") : undefined}>
                    <AlertTriangle size={12} /> {p.name}: {p.stock}/{p.minStock}
                  </button>
                ))}
              </div>
            )}
          </CardNew>

          {products.length === 0 ? (
            // Barbería nueva: que entienda QUÉ se da de alta aquí y dónde se
            // cobra (auditoría 15-nov, punto 3 de ws6-t3).
            <CardNew title={t("productos.tableTitle")}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }} data-productos-vacio>
                {canManage ? (
                  <>
                    <strong style={{ fontSize: 14, color: "var(--text-1)" }}>{t("productos.emptyTitle")}</strong>
                    <p className="bcaja-hint" style={{ margin: 0 }}>{t("productos.emptyBody")}</p>
                    <button type="button" className="btn-new barber-btn-primary" onClick={() => setModal({ kind: "form", product: null })}>
                      <PackagePlus size={15} /> {t("productos.newProduct")}
                    </button>
                  </>
                ) : (
                  <p className="bcaja-hint" style={{ margin: 0 }}>{t("productos.emptyReadOnly")}</p>
                )}
              </div>
            </CardNew>
          ) : (
            <section aria-label={t("productos.tableTitle")} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="btienda-filters">
                <label className="btienda-search" style={{ position: "relative" }}>
                  <span className="btienda-sr">{t("productos.search")}</span>
                  <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} aria-hidden="true" />
                  <input className="input-new" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("productos.search")} style={{ paddingLeft: 30 }} data-buscar-producto />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-2)", cursor: "pointer" }}>
                  <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {t("productos.showInactive")}
                </label>
                {categories.length > 0 ? (
                  <div className="btienda-chips" role="group" aria-label={t("productos.categories")}>
                    <button type="button" className="btienda-chip" aria-pressed={category === ALL} onClick={() => setCategory(ALL)}>{t("productos.allCategories")}</button>
                    {categories.map((c) => (
                      <button key={c} type="button" className="btienda-chip" aria-pressed={category === c} onClick={() => setCategory(c)} data-categoria={c}>{c}</button>
                    ))}
                  </div>
                ) : null}
              </div>
              {visible.length === 0 ? (
                <p className="bcaja-hint" style={{ margin: 0 }}>{query || category !== ALL ? t("productos.noMatch") : t("productos.empty")}</p>
              ) : (
                <div className="btienda-grid" data-rejilla-productos>
                  {visible.map((p) => (
                    <ProductCard
                      key={p.id}
                      p={p}
                      extras={tienda.extras[p.id] ?? null}
                      reserved={tienda.reserved[p.id] ?? 0}
                      t={t}
                      actions={actions}
                      onAction={(a) => void onAction(p, a)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          <CardNew
            title={t("productos.topTitle")}
            noPad
            action={<PeriodNav period={stats.periodKey} onChange={(p) => router.push(`/barber/productos?period=${p}`)} locale={locale} prevLabel={t("common.prevPeriod")} nextLabel={t("common.nextPeriod")} maxPeriod={maxPeriod} />}
          >
            {stats.topSellers.length === 0 ? (
              <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("productos.topEmpty")}</p>
            ) : (
              <div className="bcaja-table-wrap">
                <table className="table-new">
                  <thead>
                    <tr>
                      <th>{t("productos.colName")}</th>
                      <th className="bcaja-num">{t("productos.colQty")}</th>
                      <th className="bcaja-num">{t("productos.colRevenue")}</th>
                      {canManage ? <th className="bcaja-num">{t("productos.colProfit")}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topSellers.map((s) => (
                      <tr key={s.productId}>
                        <td><strong>{s.name}</strong>{s.unit ? <span className="bcaja-muted"> · {s.unit}</span> : null}</td>
                        <td className="bcaja-num">{s.qty}</td>
                        <td className="bcaja-num">{fmtMoney(s.revenue)}</td>
                        {canManage ? <td className="bcaja-num">{s.profit === null ? "—" : fmtMoney(s.profit)}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardNew>
        </div>
      )}

      {modal.kind === "form" && (
        <ProductFormModal
          dict={dict}
          product={modal.product}
          tiendaReady={tienda.ready}
          extras={modal.product ? tienda.extras[modal.product.id] ?? null : null}
          categories={categories}
          onClose={close}
          onDone={done}
        />
      )}
      {modal.kind === "movement" && <MovementModal dict={dict} product={modal.product} onClose={close} onDone={done} />}
      {modal.kind === "history" && <HistoryModal dict={dict} product={modal.product} onClose={close} />}
    </div>
  );
}
