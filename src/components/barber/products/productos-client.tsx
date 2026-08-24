"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeftRight, History, Package, PackagePlus, Pencil, TrendingUp } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { InventoryStats, ProductRow } from "@/lib/barber/inventory";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { PeriodNav } from "@/components/barber/cash/period-nav";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import { fmtMoney, fmtPct, fmtPeriod } from "@/components/barber/cash/money";
import { HistoryModal, MovementModal, ProductFormModal } from "./product-modals";

type ModalState =
  | { kind: "none" }
  | { kind: "form"; product: ProductRow | null }
  | { kind: "movement"; product: ProductRow }
  | { kind: "history"; product: ProductRow };

export function ProductosClient({
  dict,
  locale,
  products,
  stats,
  maxPeriod,
  canInventory,
}: {
  dict: Dictionary;
  locale: string;
  products: ProductRow[];
  stats: InventoryStats;
  maxPeriod: string;
  canInventory: boolean;
}) {
  const t = useBarberT(dict);
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const close = () => setModal({ kind: "none" });
  const done = () => {
    close();
    router.refresh();
  };

  const visible = products.filter((p) => showInactive || p.isActive);

  return (
    <div className="bcaja-page">
      <div className="bcaja-head">
        <div>
          <h1 className="bcaja-head__title">{t("productos.title")}</h1>
          <p className="bcaja-head__sub">{t("productos.subtitle")}</p>
        </div>
        <div className="bcaja-head__actions">
          <button type="button" className="btn-new barber-btn-primary" onClick={() => setModal({ kind: "form", product: null })}>
            <PackagePlus size={15} /> {t("productos.newProduct")}
          </button>
        </div>
      </div>

      <div className="bcaja-kpis bcaja-kpis--5">
        <KpiCard label={t("productos.kpiActive")} value={String(stats.activeCount)} icon={Package} hero />
        <KpiCard label={t("productos.kpiLow")} value={String(stats.lowStock.length)} icon={AlertTriangle} tone={stats.lowStock.length > 0 ? "warning" : undefined} />
        <KpiCard label={t("productos.kpiValueCost")} value={fmtMoney(stats.stockValueCost)} />
        <KpiCard label={t("productos.kpiMargin")} value={fmtPct(stats.avgMarginPct)} />
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

      <CardNew
        title={t("productos.tableTitle")}
        noPad
        action={
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {t("productos.showInactive")}
          </label>
        }
      >
        {visible.length === 0 ? (
          <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("productos.empty")}</p>
        ) : (
          <div className="bcaja-table-wrap">
            <table className="table-new">
              <thead>
                <tr>
                  <th>{t("productos.colName")}</th>
                  <th>{t("productos.colSku")}</th>
                  <th className="bcaja-num">{t("productos.colStock")}</th>
                  <th className="bcaja-num">{t("productos.colMin")}</th>
                  <th className="bcaja-num">{t("productos.colPrice")}</th>
                  <th className="bcaja-num">{t("productos.colCost")}</th>
                  <th className="bcaja-num">{t("productos.colMargin")}</th>
                  <th>{t("productos.colUnit")}</th>
                  <th>{t("productos.colStatus")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} style={p.isActive ? undefined : { opacity: 0.6 }}>
                    <td><strong>{p.name}</strong></td>
                    <td className="bcaja-muted">{p.sku ?? "—"}</td>
                    <td className="bcaja-num">
                      {p.lowStock ? <BadgeNew tone={p.stock === 0 ? "danger" : "warning"}>{p.stock}</BadgeNew> : p.stock}
                    </td>
                    <td className="bcaja-num bcaja-muted">{p.minStock ?? "—"}</td>
                    <td className="bcaja-num">{fmtMoney(p.price)}</td>
                    <td className="bcaja-num">{p.cost === null ? "—" : fmtMoney(p.cost)}</td>
                    <td className="bcaja-num">{p.marginAmount === null ? "—" : `${fmtMoney(p.marginAmount)} (${fmtPct(p.marginPct)})`}</td>
                    <td className="bcaja-muted">{p.unit ?? "—"}</td>
                    <td><BadgeNew tone={p.isActive ? "success" : "neutral"} dot>{p.isActive ? t("productos.active") : t("productos.inactive")}</BadgeNew></td>
                    <td>
                      <span className="bcaja-row-actions">
                        <button type="button" className="icon-btn-new" onClick={() => setModal({ kind: "form", product: p })} title={t("productos.edit")} aria-label={t("productos.edit")}><Pencil size={13} /></button>
                        {canInventory && (
                          <button type="button" className="icon-btn-new" onClick={() => setModal({ kind: "movement", product: p })} title={t("productos.movement")} aria-label={t("productos.movement")}><ArrowLeftRight size={13} /></button>
                        )}
                        <button type="button" className="icon-btn-new" onClick={() => setModal({ kind: "history", product: p })} title={t("productos.history")} aria-label={t("productos.history")}><History size={13} /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>

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
                  <th className="bcaja-num">{t("productos.colProfit")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.topSellers.map((s) => (
                  <tr key={s.productId}>
                    <td><strong>{s.name}</strong>{s.unit ? <span className="bcaja-muted"> · {s.unit}</span> : null}</td>
                    <td className="bcaja-num">{s.qty}</td>
                    <td className="bcaja-num">{fmtMoney(s.revenue)}</td>
                    <td className="bcaja-num">{s.profit === null ? "—" : fmtMoney(s.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>

      {modal.kind === "form" && <ProductFormModal dict={dict} product={modal.product} onClose={close} onDone={done} />}
      {modal.kind === "movement" && <MovementModal dict={dict} product={modal.product} onClose={close} onDone={done} />}
      {modal.kind === "history" && <HistoryModal dict={dict} product={modal.product} onClose={close} />}
    </div>
  );
}
