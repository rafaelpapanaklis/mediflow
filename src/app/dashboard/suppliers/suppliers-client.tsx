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
} from "lucide-react";
import { BadgeNew, KpiCard } from "@/components/ui/design-system";

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
        background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
        border: "1px solid var(--border-brand)",
        boxShadow: "0 6px 16px -8px rgba(124,58,237,0.55)",
        display: "grid",
        placeItems: "center",
        color: "#fff",
        fontWeight: 700,
        fontSize: 20,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function SupplierCard({ supplier }: { supplier: Supplier }) {
  const [hover, setHover] = useState(false);
  const location = [supplier.city, supplier.state].filter(Boolean).join(", ");

  return (
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
            "transform .14s ease, box-shadow .14s ease, border-color .14s ease",
          borderColor: hover ? "var(--border-brand)" : undefined,
          transform: hover ? "translateY(-2px)" : undefined,
          boxShadow: hover ? "0 12px 28px -16px rgba(124,58,237,0.55)" : undefined,
        }}
      >
        {/* Acento superior de la card */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
            opacity: hover ? 1 : 0.85,
            transition: "opacity .14s ease",
          }}
        />

        <div
          className="card__body"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                  <MapPin size={12} style={{ color: "var(--violet-400)", flexShrink: 0 }} />
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
              <Package size={12} style={{ color: "var(--violet-400)" }} />
              {supplier.productCount}{" "}
              {supplier.productCount === 1 ? "producto" : "productos"}
            </span>
            {/* CTA visual: <span> (no <button>) para no anidar interactivos
                dentro del <Link> que envuelve la card; la navegación la
                resuelve ese Link a /dashboard/suppliers/[id]. */}
            <span
              className={`btn-new btn-new--${hover ? "primary" : "secondary"} btn-new--sm`}
              style={{ flexShrink: 0 }}
            >
              Ver proveedor
              <ChevronRight size={14} />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function SuppliersClient({ initialSuppliers }: { initialSuppliers: Supplier[] }) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of initialSuppliers) {
      for (const c of s.categories) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [initialSuppliers]);

  // KPIs derivados solo de datos ya disponibles (sin queries nuevas).
  const kpis = useMemo(() => {
    let productTotal = 0;
    for (const s of initialSuppliers) productTotal += s.productCount;
    return {
      total: initialSuppliers.length,
      categories: categories.length,
      products: productTotal,
    };
  }, [initialSuppliers, categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialSuppliers.filter((s) => {
      if (activeCategory && !s.categories.includes(activeCategory)) return false;
      if (!q) return true;
      const haystack = [s.businessName, s.city ?? "", s.state ?? "", ...s.categories]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [initialSuppliers, search, activeCategory]);

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* HERO */}
      <div style={{ position: "relative", marginBottom: 22 }}>
        {/* Glow violeta de fondo */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -40,
            left: -20,
            width: 320,
            height: 180,
            borderRadius: "50%",
            pointerEvents: "none",
            background:
              "radial-gradient(closest-side, rgba(124,58,237,0.16), transparent)",
            filter: "blur(8px)",
            zIndex: 0,
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 1,
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
              color: "#fff",
              background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
              boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
            }}
          >
            <Store size={22} />
          </div>
          <div>
            <h1
              style={{
                fontSize: 22,
                color: "var(--text-1)",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              Proveedores
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 14, marginTop: 4 }}>
              Explora proveedores y abastece tu clínica con su catálogo.
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
          <KpiCard label="Proveedores" value={String(kpis.total)} icon={Building2} />
          <KpiCard label="Categorías" value={String(kpis.categories)} icon={Layers} />
          <KpiCard label="Productos" value={String(kpis.products)} icon={Boxes} />
        </div>
      )}

      {/* Filtros */}
      {initialSuppliers.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="search-field" style={{ maxWidth: 380 }}>
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar proveedor…"
            />
          </div>

          {categories.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <CategoryChip
                label="Todas"
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
          title="Aún no hay proveedores disponibles"
          text="En cuanto haya proveedores dados de alta aparecerán aquí para que puedas explorar su catálogo y abastecer tu clínica."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={26} />}
          title="Sin resultados"
          text="No encontramos proveedores con esos criterios. Prueba con otra búsqueda o quita los filtros de categoría."
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
            <SupplierCard key={s.id} supplier={s} />
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
