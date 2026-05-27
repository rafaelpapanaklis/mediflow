"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  MessageCircle,
  MapPin,
  Phone,
  Mail,
  Plus,
  Minus,
  ShoppingCart,
  Package,
  Search,
} from "lucide-react";
import { CardNew, ButtonNew, BadgeNew } from "@/components/ui/design-system";
import { fmtMXN } from "@/lib/format";

interface SupplierData {
  id: string;
  businessName: string;
  logoUrl: string | null;
  description: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  email: string;
  categories: string[];
  paymentMethods: string[];
}

interface ProductImage {
  id: string;
  url: string;
}

interface ProductData {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sku: string | null;
  price: number;
  unit: string;
  stock: number;
  images: ProductImage[];
}

interface SupplierDetailClientProps {
  supplier: SupplierData;
  products: ProductData[];
}

const clamp2: React.CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

function ImageFallback({ size = 40 }: { size?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-elev-2)",
        color: "var(--text-4)",
      }}
    >
      <Package size={size} />
    </div>
  );
}

function ProductCard({
  product,
  qty,
  onQty,
  onAdd,
  loading,
}: {
  product: ProductData;
  qty: number;
  onQty: (next: number) => void;
  onAdd: () => void;
  loading: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const outOfStock = product.stock === 0;
  const firstImage = product.images[0]?.url;
  const showImg = !!firstImage && !imgError;

  return (
    <div
      className="card"
      style={{ display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          background: "var(--bg-elev-2)",
        }}
      >
        {showImg ? (
          <img
            src={firstImage}
            alt={product.name}
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <ImageFallback />
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, flex: 1 }}>
        <div
          style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14, lineHeight: 1.3, ...clamp2 }}
          title={product.name}
        >
          {product.name}
        </div>

        {product.category && (
          <div style={{ color: "var(--text-3)", fontSize: 12 }}>{product.category}</div>
        )}

        {product.description && (
          <div style={{ color: "var(--text-3)", fontSize: 12, lineHeight: 1.4, ...clamp2 }}>
            {product.description}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: "auto" }}>
          <span style={{ color: "var(--text-1)", fontWeight: 700, fontSize: 18 }}>
            {fmtMXN(product.price)}
          </span>
          <span style={{ color: "var(--text-3)", fontSize: 12 }}>/ {product.unit}</span>
        </div>

        <div>
          {outOfStock ? (
            <BadgeNew tone="danger">Sin stock</BadgeNew>
          ) : product.stock <= 5 ? (
            <BadgeNew tone="warning">Pocas piezas</BadgeNew>
          ) : (
            <BadgeNew tone="success">Disponible</BadgeNew>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid var(--border-soft)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              aria-label="Disminuir cantidad"
              disabled={outOfStock || qty <= 1}
              onClick={() => onQty(Math.max(1, qty - 1))}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                background: "transparent",
                border: "none",
                color: "var(--text-2)",
                cursor: outOfStock || qty <= 1 ? "not-allowed" : "pointer",
                opacity: outOfStock || qty <= 1 ? 0.5 : 1,
              }}
            >
              <Minus size={14} />
            </button>
            <span
              style={{
                minWidth: 28,
                textAlign: "center",
                fontSize: 13,
                color: "var(--text-1)",
                fontWeight: 600,
              }}
            >
              {qty}
            </span>
            <button
              type="button"
              aria-label="Aumentar cantidad"
              disabled={outOfStock || qty >= product.stock}
              onClick={() => onQty(Math.min(product.stock, qty + 1))}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                background: "transparent",
                border: "none",
                color: "var(--text-2)",
                cursor: outOfStock || qty >= product.stock ? "not-allowed" : "pointer",
                opacity: outOfStock || qty >= product.stock ? 0.5 : 1,
              }}
            >
              <Plus size={14} />
            </button>
          </div>

          <div style={{ flex: 1 }}>
            <ButtonNew
              variant="primary"
              size="sm"
              icon={<ShoppingCart size={14} />}
              disabled={outOfStock || loading}
              onClick={onAdd}
              style={{ width: "100%" }}
            >
              Agregar
            </ButtonNew>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SupplierDetailClient({ supplier, products }: SupplierDetailClientProps) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = p.category?.trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCategory && p.category?.trim() !== activeCategory) return false;
      if (!q) return true;
      const haystack = [p.name, p.description ?? "", p.sku ?? "", p.category ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [products, search, activeCategory]);

  const locationLabel = [supplier.city, supplier.state].filter(Boolean).join(", ");
  const showLogo = !!supplier.logoUrl && !logoError;

  async function addToCart(productId: string) {
    setLoadingId(productId);
    try {
      const res = await fetch("/api/compras/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: qty[productId] ?? 1 }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "No se pudo agregar al carrito");
      }
      toast.success("Agregado al carrito");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error al agregar al carrito";
      toast.error(msg || "Error al agregar al carrito");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div style={{ padding: "clamp(14px,1.6vw,28px)", maxWidth: 1200, margin: "0 auto" }}>
      {/* Volver */}
      <Link
        href="/dashboard/suppliers"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text-3)",
          fontSize: 13,
          textDecoration: "none",
          marginBottom: 16,
        }}
      >
        <ArrowLeft size={14} />
        Proveedores
      </Link>

      {/* Encabezado de la ficha */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div
            style={{
              position: "relative",
              width: 64,
              height: 64,
              borderRadius: 12,
              overflow: "hidden",
              flexShrink: 0,
              background: "var(--bg-elev-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {showLogo ? (
              <img
                src={supplier.logoUrl as string}
                alt={supplier.businessName}
                onError={() => setLogoError(true)}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <span style={{ color: "var(--text-2)", fontWeight: 700, fontSize: 24 }}>
                {supplier.businessName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                color: "var(--text-1)",
                fontWeight: 600,
                fontSize: "clamp(18px,1.6vw,24px)",
                margin: 0,
              }}
            >
              {supplier.businessName}
            </h1>
            {locationLabel && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  color: "var(--text-3)",
                  fontSize: 13,
                  marginTop: 4,
                }}
              >
                <MapPin size={13} />
                {locationLabel}
              </div>
            )}
            {supplier.categories.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {supplier.categories.map((c) => (
                  <BadgeNew key={c} tone="brand">
                    {c}
                  </BadgeNew>
                ))}
              </div>
            )}
          </div>
        </div>

        <Link
          href={`/dashboard/proveedor-chat/${supplier.id}`}
          className="btn-new btn-new--primary"
          style={{ textDecoration: "none", flexShrink: 0 }}
        >
          <MessageCircle size={14} />
          Chatear
        </Link>
      </div>

      {/* Datos de contacto / compra */}
      <CardNew>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {supplier.description && (
            <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              {supplier.description}
            </p>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
            {supplier.phone && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--text-2)",
                  fontSize: 13,
                }}
              >
                <Phone size={14} style={{ color: "var(--text-3)" }} />
                {supplier.phone}
              </div>
            )}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--text-2)",
                fontSize: 13,
              }}
            >
              <Mail size={14} style={{ color: "var(--text-3)" }} />
              {supplier.email}
            </div>
            {supplier.address && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--text-2)",
                  fontSize: 13,
                }}
              >
                <MapPin size={14} style={{ color: "var(--text-3)" }} />
                {supplier.address}
              </div>
            )}
          </div>

          {supplier.paymentMethods.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span style={{ color: "var(--text-3)", fontSize: 13 }}>Métodos de pago:</span>
              {supplier.paymentMethods.map((m) => (
                <BadgeNew key={m} tone="neutral">
                  {m}
                </BadgeNew>
              ))}
            </div>
          )}
        </div>
      </CardNew>

      {/* Productos */}
      <div style={{ marginTop: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 18, margin: 0 }}>
              Productos
            </h2>
            <span style={{ color: "var(--text-3)", fontSize: 13 }}>({filtered.length})</span>
          </div>

          <div className="search-field" style={{ maxWidth: 360 }}>
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto…"
            />
          </div>
        </div>

        {categories.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
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

        {products.length === 0 ? (
          <CardNew>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--text-3)",
              }}
            >
              <Package size={36} style={{ color: "var(--text-4)" }} />
              <span style={{ fontSize: 14 }}>
                Este proveedor aún no tiene productos publicados
              </span>
            </div>
          </CardNew>
        ) : filtered.length === 0 ? (
          <CardNew>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--text-3)",
              }}
            >
              <Search size={36} style={{ color: "var(--text-4)" }} />
              <span style={{ fontSize: 14 }}>Sin resultados</span>
            </div>
          </CardNew>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            {filtered.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                qty={qty[p.id] ?? 1}
                onQty={(next) => setQty((prev) => ({ ...prev, [p.id]: next }))}
                onAdd={() => addToCart(p.id)}
                loading={loadingId === p.id}
              />
            ))}
          </div>
        )}
      </div>
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
