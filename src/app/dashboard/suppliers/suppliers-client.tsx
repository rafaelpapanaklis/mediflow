"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Store, MapPin, Package } from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system";

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
          width: 48,
          height: 48,
          borderRadius: 10,
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
        width: 48,
        height: 48,
        borderRadius: 10,
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border-soft)",
        display: "grid",
        placeItems: "center",
        color: "var(--text-2)",
        fontWeight: 600,
        fontSize: 18,
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
          transition: "border-color .12s, transform .12s",
          borderColor: hover ? "var(--border-brand)" : undefined,
          transform: hover ? "translateY(-1px)" : undefined,
        }}
      >
        <div className="card__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <SupplierLogo supplier={supplier} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  color: "var(--text-1)",
                  fontWeight: 600,
                  fontSize: 14,
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
                    color: "var(--text-3)",
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  <MapPin size={12} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                <BadgeNew key={cat} tone="neutral">
                  {cat}
                </BadgeNew>
              ))}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "var(--text-3)",
              fontSize: 12,
              marginTop: "auto",
            }}
          >
            <Package size={12} />
            <span>
              {supplier.productCount} {supplier.productCount === 1 ? "producto" : "productos"}
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
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1
          style={{
            fontSize: "clamp(16px, 1.4vw, 22px)",
            color: "var(--text-1)",
            fontWeight: 600,
            margin: 0,
          }}
        >
          Proveedores
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
          {initialSuppliers.length}{" "}
          {initialSuppliers.length === 1 ? "proveedor disponible" : "proveedores disponibles"}
        </p>
      </div>

      {/* Filters */}
      {initialSuppliers.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="search-field" style={{ maxWidth: 360 }}>
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

      {/* Content */}
      {initialSuppliers.length === 0 ? (
        <EmptyState
          icon={<Store size={32} style={{ color: "var(--text-4)" }} />}
          text="Aún no hay proveedores disponibles"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={32} style={{ color: "var(--text-4)" }} />}
          text="Sin resultados"
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
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
        fontWeight: 500,
        cursor: "pointer",
        color: active ? "var(--brand)" : "var(--text-2)",
        background: active ? "var(--brand-soft)" : "var(--bg-elev)",
        border: `1px solid ${active ? "var(--border-brand)" : "var(--border-soft)"}`,
        transition: "all .12s",
      }}
    >
      {label}
    </button>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ padding: "64px 24px", textAlign: "center" }}>
      <div style={{ marginBottom: 12 }}>{icon}</div>
      <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0 }}>{text}</p>
    </div>
  );
}
