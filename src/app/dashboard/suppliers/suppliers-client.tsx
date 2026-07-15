"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Store,
  MapPin,
  Package,
  Building2,
  Layers,
  Boxes,
  ChevronRight,
  Star,
  Heart,
} from "lucide-react";
import { BadgeNew, KpiCard } from "@/components/ui/design-system";
import { useT } from "@/i18n/i18n-provider";

interface Supplier {
  id: string;
  businessName: string;
  slug: string;
  logoUrl: string | null;
  city: string | null;
  state: string | null;
  categories: string[];
  description: string | null;
  productCount: number;
  rating: number;
  ratingCount: number;
  isFavorite: boolean;
}

type SortKey = "rating" | "name";

const STAR_COLOR = "#f5b301";

/** Estrellas de calificación + "(nº reseñas)". Sin reseñas → texto atenuado. */
function StarRating({ rating, count }: { rating: number; count: number }) {
  const t = useT();
  const rounded = Math.round(rating);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{ display: "inline-flex", gap: 1 }}
        aria-label={count > 0 ? t("procurement.suppliersClient.starsOf5", { rating: rating.toFixed(1) }) : t("procurement.suppliersClient.noReviews")}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const on = count > 0 && i < rounded;
          return (
            <Star
              key={i}
              size={14}
              strokeWidth={1.75}
              fill={on ? STAR_COLOR : "none"}
              style={{ color: on ? STAR_COLOR : "var(--text-3)", flexShrink: 0 }}
            />
          );
        })}
      </span>
      {count > 0 ? (
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          <strong style={{ color: "var(--text-2)", fontWeight: 600 }}>{rating.toFixed(1)}</strong>{" "}
          ({count})
        </span>
      ) : (
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("procurement.suppliersClient.noReviews")}</span>
      )}
    </div>
  );
}

function SupplierLogo({ supplier }: { supplier: Supplier }) {
  const [err, setErr] = useState(false);
  const initial = supplier.businessName.trim().charAt(0).toUpperCase() || "?";

  if (supplier.logoUrl && !err) {
    return (
      <img
        src={supplier.logoUrl}
        alt={supplier.businessName}
        onError={() => setErr(true)}
        style={{
          width: 52,
          height: 52,
          borderRadius: 12,
          objectFit: "cover",
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: 52,
        height: 52,
        borderRadius: 12,
        background: "var(--violet-100)",
        border: "1px solid var(--border-soft)",
        display: "grid",
        placeItems: "center",
        color: "var(--violet-600)",
        fontWeight: 700,
        fontSize: 20,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function SupplierCard({
  supplier,
  onToggleFavorite,
  busy,
}: {
  supplier: Supplier;
  onToggleFavorite: (id: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const [hover, setHover] = useState(false);
  const location = [supplier.city, supplier.state].filter(Boolean).join(", ");

  return (
    <div style={{ position: "relative", height: "100%" }}>
      {/* Botón de favorito — hermano del <Link> (no se anidan interactivos:
          el corazón vive fuera del ancla que envuelve la tarjeta). */}
      <button
        type="button"
        aria-label={supplier.isFavorite ? t("procurement.suppliersClient.removeFavorite") : t("procurement.suppliersClient.addFavorite")}
        aria-pressed={supplier.isFavorite}
        disabled={busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(supplier.id);
        }}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 2,
          width: 40,
          height: 40,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          cursor: busy ? "default" : "pointer",
          border: `1px solid ${supplier.isFavorite ? "var(--border-brand)" : "var(--border-soft)"}`,
          background: supplier.isFavorite ? "var(--brand-soft)" : "var(--bg-elev)",
          color: supplier.isFavorite ? "var(--brand)" : "var(--text-3)",
          opacity: busy ? 0.55 : 1,
          transition:
            "background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)",
        }}
      >
        <Heart size={16} strokeWidth={1.75} fill={supplier.isFavorite ? "currentColor" : "none"} />
      </button>

      <Link
        href={`/dashboard/suppliers/${supplier.id}`}
        style={{ textDecoration: "none", color: "inherit" }}
      >
        <div
          className="card"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            cursor: "pointer",
            height: "100%",
            position: "relative",
            overflow: "hidden",
            transition:
              "transform var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)",
            borderColor: hover ? "var(--border-brand)" : undefined,
            transform: hover ? "translateY(-2px)" : undefined,
            boxShadow: hover ? "var(--shadow-2)" : undefined,
          }}
        >
          <div
            className="card__body"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {/* paddingRight reserva el hueco del corazón superpuesto */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, paddingRight: 40 }}>
              <SupplierLogo supplier={supplier} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    color: "var(--text-1)",
                    fontWeight: 600,
                    fontSize: 15,
                    letterSpacing: "-0.01em",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {supplier.businessName}
                </div>
                {location && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      marginTop: 3,
                      color: "var(--text-3)",
                      fontSize: 12,
                    }}
                  >
                    <MapPin size={16} strokeWidth={1.75} style={{ color: "var(--brand)", flexShrink: 0 }} />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {location}
                    </span>
                  </div>
                )}
                <div style={{ marginTop: 6 }}>
                  <StarRating rating={supplier.rating} count={supplier.ratingCount} />
                </div>
              </div>
            </div>

          {supplier.description && (
            <p
              style={{
                color: "var(--text-3)",
                fontSize: 12,
                margin: 0,
                lineHeight: 1.45,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {supplier.description}
            </p>
          )}

          {supplier.categories.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {supplier.categories.slice(0, 3).map((cat) => (
                <BadgeNew key={cat} tone="brand">
                  {cat}
                </BadgeNew>
              ))}
              {supplier.categories.length > 3 && (
                <BadgeNew tone="neutral">+{supplier.categories.length - 3}</BadgeNew>
              )}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginTop: "auto",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--text-3)",
                fontSize: 12,
              }}
            >
              <Package size={16} strokeWidth={1.75} style={{ color: "var(--brand)" }} />
              {t("procurement.suppliersClient.productCount", { count: supplier.productCount })}
            </span>
            {/* CTA visual: <span> (no <button>) para no anidar interactivos
                dentro del <Link> que envuelve la card; la navegación la
                resuelve ese Link a /dashboard/suppliers/[id]. */}
            <span
              className={`btn-new btn-new--${hover ? "primary" : "secondary"} btn-new--sm`}
              style={{ flexShrink: 0 }}
            >
              {t("procurement.suppliersClient.viewSupplier")}
              <ChevronRight size={16} strokeWidth={1.75} />
            </span>
          </div>
        </div>
      </div>
      </Link>
    </div>
  );
}

export function SuppliersClient({ initialSuppliers }: { initialSuppliers: Supplier[] }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("rating");
  // Lista mutable local: el corazón actualiza `isFavorite` sin recargar.
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  // IDs con un toggle de favorito en vuelo (evita doble click / parpadeo).
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of suppliers) {
      for (const c of s.categories) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [suppliers]);

  const favoriteCount = useMemo(
    () => suppliers.reduce((n, s) => (s.isFavorite ? n + 1 : n), 0),
    [suppliers],
  );

  // KPIs derivados solo de datos ya disponibles (sin queries nuevas).
  const kpis = useMemo(() => {
    let productTotal = 0;
    for (const s of suppliers) productTotal += s.productCount;
    return {
      total: suppliers.length,
      categories: categories.length,
      products: productTotal,
    };
  }, [suppliers, categories]);

  async function toggleFavorite(id: string) {
    if (pendingIds.includes(id)) return;
    const prev = suppliers.find((s) => s.id === id)?.isFavorite ?? false;
    // Optimista: invierte ya el corazón.
    setSuppliers((list) =>
      list.map((s) => (s.id === id ? { ...s, isFavorite: !s.isFavorite } : s)),
    );
    setPendingIds((p) => p.concat(id));
    try {
      const res = await fetch(`/api/suppliers/${id}/favorite`, { method: "POST" });
      if (!res.ok) throw new Error("favorite failed");
      const data = await res.json().catch(() => null);
      // Si la ruta confirma el estado, alinéalo (por si dos pestañas divergen).
      if (data && typeof data.isFavorite === "boolean") {
        setSuppliers((list) =>
          list.map((s) => (s.id === id ? { ...s, isFavorite: data.isFavorite } : s)),
        );
      }
    } catch {
      // Revierte al estado previo si la red/ruta falla.
      setSuppliers((list) =>
        list.map((s) => (s.id === id ? { ...s, isFavorite: prev } : s)),
      );
    } finally {
      setPendingIds((p) => p.filter((x) => x !== id));
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = suppliers.filter((s) => {
      if (onlyFavorites && !s.isFavorite) return false;
      if (activeCategory && !s.categories.includes(activeCategory)) return false;
      if (!q) return true;
      const haystack = [s.businessName, s.city ?? "", s.state ?? "", ...s.categories]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    const sorted = list.slice();
    if (sortBy === "rating") {
      sorted.sort(
        (a, b) =>
          b.rating - a.rating ||
          b.ratingCount - a.ratingCount ||
          a.businessName.localeCompare(b.businessName),
      );
    } else {
      sorted.sort((a, b) => a.businessName.localeCompare(b.businessName));
    }
    return sorted;
  }, [suppliers, search, activeCategory, onlyFavorites, sortBy]);

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* HERO */}
      <div style={{ position: "relative", marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              color: "var(--brand)",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
            }}
          >
            <Store size={20} strokeWidth={1.75} />
          </div>
          <div>
            <h1
              style={{
                fontSize: 22,
                color: "var(--text-1)",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              {t("procurement.suppliersClient.heroTitle")}
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 14, marginTop: 4 }}>
              {t("procurement.suppliersClient.heroSubtitle")}
            </p>
          </div>
        </div>
      </div>

      {/* KPIs — solo con datos ya disponibles */}
      {initialSuppliers.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 14,
            marginBottom: 20,
          }}
        >
          <KpiCard label={t("procurement.suppliersClient.kpiSuppliers")} value={String(kpis.total)} icon={Building2} />
          <KpiCard label={t("procurement.suppliersClient.kpiCategories")} value={String(kpis.categories)} icon={Layers} />
          <KpiCard label={t("procurement.suppliersClient.kpiProducts")} value={String(kpis.products)} icon={Boxes} />
        </div>
      )}

      {/* Filtros */}
      {initialSuppliers.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              justifyContent: "space-between",
            }}
          >
            <div className="search-field" style={{ maxWidth: 380, flex: "1 1 240px" }}>
              <Search size={16} strokeWidth={1.75} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("procurement.suppliersClient.searchPlaceholder")}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {/* Solo favoritos */}
              <button
                type="button"
                onClick={() => setOnlyFavorites((v) => !v)}
                aria-pressed={onlyFavorites}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: onlyFavorites ? 600 : 500,
                  cursor: "pointer",
                  color: onlyFavorites ? "var(--brand)" : "var(--text-2)",
                  background: onlyFavorites ? "var(--brand-soft)" : "var(--bg-elev)",
                  border: `1px solid ${onlyFavorites ? "var(--border-brand)" : "var(--border-soft)"}`,
                  boxShadow: "var(--shadow-1)",
                  transition:
                    "background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)",
                }}
              >
                <Heart size={16} strokeWidth={1.75} fill={onlyFavorites ? "currentColor" : "none"} />
                {t("procurement.suppliersClient.onlyFavorites")}
                {favoriteCount > 0 ? ` (${favoriteCount})` : ""}
              </button>

              {/* Orden */}
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "var(--text-3)",
                }}
              >
                {t("procurement.suppliersClient.sortLabel")}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    color: "var(--text-1)",
                    background: "var(--bg-elev)",
                    border: "1px solid var(--border-soft)",
                  }}
                >
                  <option value="rating">{t("procurement.suppliersClient.sortRating")}</option>
                  <option value="name">{t("procurement.suppliersClient.sortName")}</option>
                </select>
              </label>
            </div>
          </div>

          {categories.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <CategoryChip
                label={t("procurement.suppliersClient.categoryAll")}
                active={activeCategory === null}
                onClick={() => setActiveCategory(null)}
              />
              {categories.map((cat) => (
                <CategoryChip
                  key={cat}
                  label={cat}
                  active={activeCategory === cat}
                  onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Contenido */}
      {initialSuppliers.length === 0 ? (
        <EmptyState
          icon={<Store size={26} />}
          title={t("procurement.suppliersClient.emptyNoneTitle")}
          text={t("procurement.suppliersClient.emptyNoneText")}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={onlyFavorites ? <Heart size={26} /> : <Search size={26} />}
          title={onlyFavorites ? t("procurement.suppliersClient.emptyFavoritesTitle") : t("common.noResults")}
          text={
            onlyFavorites
              ? t("procurement.suppliersClient.emptyFavoritesText")
              : t("procurement.suppliersClient.emptyFilteredText")
          }
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {filtered.map((s) => (
            <SupplierCard
              key={s.id}
              supplier={s}
              onToggleFavorite={toggleFavorite}
              busy={pendingIds.includes(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        color: active ? "var(--violet-400)" : "var(--text-2)",
        background: active ? "var(--brand-soft)" : "var(--bg-elev)",
        border: `1px solid ${active ? "var(--border-brand)" : "var(--border-soft)"}`,
        boxShadow: active ? "0 0 0 3px var(--brand-softer)" : undefined,
        transition: "all .12s",
      }}
    >
      {label}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div
      style={{
        padding: "48px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          display: "grid",
          placeItems: "center",
          background: "var(--brand-soft)",
          border: "1px solid var(--border-brand)",
          color: "var(--violet-400)",
        }}
      >
        {icon}
      </div>
      <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>{title}</div>
      <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
        {text}
      </p>
    </div>
  );
}
