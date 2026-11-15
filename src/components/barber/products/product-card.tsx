"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, Copy, Eye, EyeOff, Globe, History, MoreHorizontal, Pencil, Power, Share2 } from "lucide-react";
import type { ProductRow } from "@/lib/barber/inventory";
import type { ProductExtras } from "@/lib/barber/tienda";
import { stockTag } from "@/lib/barber/tienda-core";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { fmtMoney } from "@/components/barber/cash/money";

export type ProductCardAction = "edit" | "movement" | "history" | "copyLink" | "share" | "toggleWeb" | "toggleActive";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Una tarjeta del catálogo: foto (o marcador), etiqueta de existencias,
 * categoría, nombre, precio y el menú «…». La etiqueta usa el stock REAL y
 * el mínimo de la barbería (lo apartado en la tienda se enseña aparte).
 */
export function ProductCard({
  p,
  extras,
  reserved,
  t,
  actions,
  onAction,
}: {
  p: ProductRow;
  extras: ProductExtras | null;
  reserved: number;
  t: T;
  /** Las acciones que ESTA persona puede hacer (en orden). */
  actions: ProductCardAction[];
  onAction: (a: ProductCardAction) => void;
}) {
  const tag = stockTag(p.stock, p.minStock);
  const tone = tag === "out" ? "danger" : tag === "low" ? "warning" : "success";
  const label = tag === "out" ? t("productos.tagOut") : tag === "low" ? t("productos.tagLow") : t("productos.tagAvailable");
  const initial = (p.name.trim().charAt(0) || "?").toUpperCase();

  return (
    <article className={p.isActive ? "btienda-card" : "btienda-card btienda-card--off"} data-producto={p.id}>
      <div className="btienda-photo">
        {extras?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={extras.photoUrl} alt={p.name} loading="lazy" />
        ) : (
          <div className="btienda-ph" aria-hidden="true">
            <span className="btienda-ph__letter">{initial}</span>
            {p.unit ? <span className="btienda-ph__hint">{p.unit}</span> : null}
          </div>
        )}
        <span className="btienda-tag">
          <BadgeNew tone={p.isActive ? tone : "neutral"} dot>{p.isActive ? label : t("productos.inactive")}</BadgeNew>
        </span>
        {extras?.showOnWeb && p.isActive ? (
          <span className="btienda-web" title={t("productos.onWebHint")}>
            <Globe size={11} /> {t("productos.onWeb")}
          </span>
        ) : null}
      </div>
      {actions.length > 0 ? (
        <CardMenu label={t("productos.menu", { name: p.name })}>
          {(close) =>
            actions.map((a) => {
              const item = menuItem(a, p, extras, t);
              if (!item) return null;
              return (
                <button
                  key={a}
                  type="button"
                  role="menuitem"
                  className={item.danger ? "btienda-menu__item btienda-menu__item--danger" : "btienda-menu__item"}
                  data-accion={a}
                  onClick={() => {
                    close();
                    onAction(a);
                  }}
                >
                  {item.icon} {item.label}
                </button>
              );
            })
          }
        </CardMenu>
      ) : null}
      <div className="btienda-body">
        <span className="btienda-cat">{extras?.category || (p.sku ? `SKU ${p.sku}` : " ")}</span>
        <span className="btienda-name">{p.name}</span>
        <span className="btienda-price">{fmtMoney(p.price)}</span>
        <span className="btienda-meta">
          {t("productos.cardStock", { count: p.stock })}
          {reserved > 0 ? ` · ${t("productos.cardReserved", { count: reserved })}` : ""}
        </span>
      </div>
    </article>
  );
}

function menuItem(a: ProductCardAction, p: ProductRow, extras: ProductExtras | null, t: T): { label: string; icon: ReactNode; danger?: boolean } | null {
  switch (a) {
    case "edit":
      return { label: t("productos.edit"), icon: <Pencil size={14} /> };
    case "movement":
      return { label: t("productos.adjustStock"), icon: <ArrowLeftRight size={14} /> };
    case "history":
      return { label: t("productos.history"), icon: <History size={14} /> };
    case "copyLink":
      return extras?.showOnWeb && p.isActive ? { label: t("productos.copyLink"), icon: <Copy size={14} /> } : null;
    case "share":
      return extras?.showOnWeb && p.isActive ? { label: t("productos.shareWa"), icon: <Share2 size={14} /> } : null;
    case "toggleWeb":
      if (!p.isActive) return null;
      return extras?.showOnWeb
        ? { label: t("productos.hideFromWeb"), icon: <EyeOff size={14} /> }
        : { label: t("productos.showOnWebAction"), icon: <Eye size={14} /> };
    case "toggleActive":
      return p.isActive
        ? { label: t("productos.deactivate"), icon: <Power size={14} />, danger: true }
        : { label: t("productos.activate"), icon: <Power size={14} /> };
    default:
      return null;
  }
}

/** Menú desplegable mínimo: botón «…», Escape y clic fuera lo cierran, flechas lo recorren. */
function CardMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const first = wrap.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    function onDown(e: MouseEvent | TouchEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div className="btienda-menu" ref={wrap} onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        className="btienda-menu__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        data-menu-producto
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div className="btienda-menu__list" role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
