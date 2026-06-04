"use client";

import { useEffect, useMemo, useState } from "react";
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
  Boxes,
  Store,
  Tag,
  DollarSign,
  CheckCircle2,
  Navigation,
  Globe,
  Heart,
  Star,
  Truck,
  Send,
  Loader2,
} from "lucide-react";
import { CardNew, ButtonNew, BadgeNew, KpiCard } from "@/components/ui/design-system";
import { fmtMXN } from "@/lib/format";
import { useT } from "@/i18n/i18n-provider";

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
  // Perfil extendido + reputación (columnas del proveedor, vía SSR).
  whatsapp: string | null;
  website: string | null;
  mapsUrl: string | null;
  minOrderAmount: number | null;
  shippingNote: string | null;
  rating: number;
  ratingCount: number;
}

// Reseña tal como la entrega GET /api/suppliers/[id] (toSupplierReviewDTO).
interface ReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  clinicName?: string;
  createdAt: string;
}

// Datos por-clínica + reputación que la ficha carga desde la ruta GET.
interface DetailInfo {
  isFavorite: boolean;
  rating: number;
  ratingCount: number;
  reviews: ReviewItem[];
  canReview: boolean;
  reviewableOrderId: string | null;
}

/** Fila de 5 estrellas (relleno hasta el redondeo del valor). */
function StarRow({ value, size = 15 }: { value: number; size?: number }) {
  const t = useT();
  const rounded = Math.round(value);
  return (
    <span
      style={{ display: "inline-flex", gap: 2, lineHeight: 0 }}
      aria-label={t("procurement.supplierDetail.starsOf5", { rating: value.toFixed(1) })}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          style={{ color: "#f5b301" }}
          fill={i <= rounded ? "#f5b301" : "none"}
          strokeWidth={1.75}
        />
      ))}
    </span>
  );
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

const contactItemStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "var(--text-2)",
  fontSize: 13,
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
  const t = useT();
  const [imgError, setImgError] = useState(false);
  const [hover, setHover] = useState(false);
  const outOfStock = product.stock === 0;
  const firstImage = product.images[0]?.url;
  const showImg = !!firstImage && !imgError;

  return (
    <div
      className="card"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        padding: 0,
        height: "100%",
        position: "relative",
        borderColor: hover ? "var(--border-brand)" : undefined,
        transform: hover ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hover ? "0 12px 28px -16px rgba(124,58,237,0.55)" : undefined,
        transition: "transform .14s ease, box-shadow .14s ease, border-color .14s ease",
      }}
    >
      {/* Acento superior revelado en hover (consistente con la card destacada) */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          zIndex: 1,
          background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
          opacity: hover ? 1 : 0,
          transition: "opacity .14s ease",
          pointerEvents: "none",
        }}
      />
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
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "var(--text-3)",
              fontSize: 12,
            }}
          >
            <Tag size={12} />
            {product.category}
          </div>
        )}

        {product.description && (
          <div style={{ color: "var(--text-3)", fontSize: 12, lineHeight: 1.4, ...clamp2 }}>
            {product.description}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: "auto" }}>
          <span style={{ color: "var(--text-3)", fontSize: 12 }}>{t("procurement.supplierDetail.priceFrom")}</span>
          <span style={{ color: "var(--text-1)", fontWeight: 700, fontSize: 18 }}>
            {fmtMXN(product.price)}
          </span>
          <span style={{ color: "var(--text-3)", fontSize: 12 }}>/ {product.unit}</span>
        </div>

        <div>
          {outOfStock ? (
            <BadgeNew tone="danger" dot>
              {t("procurement.supplierDetail.stockOut")}
            </BadgeNew>
          ) : product.stock <= 5 ? (
            <BadgeNew tone="warning" dot>
              {t("procurement.supplierDetail.stockLow")}
            </BadgeNew>
          ) : (
            <BadgeNew tone="success" dot>
              {t("procurement.supplierDetail.stockAvailable")}
            </BadgeNew>
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
              aria-label={t("procurement.supplierDetail.decreaseQty")}
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
              aria-label={t("procurement.supplierDetail.increaseQty")}
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
              variant={hover && !outOfStock ? "primary" : "secondary"}
              size="sm"
              icon={<ShoppingCart size={14} />}
              disabled={outOfStock || loading}
              onClick={onAdd}
              style={{ width: "100%" }}
            >
              {t("common.add")}
            </ButtonNew>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SupplierDetailClient({ supplier, products }: SupplierDetailClientProps) {
  const t = useT();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  // Datos por-clínica (favorito, reseñas, canReview) + reputación fresca:
  // los trae la ruta GET (clinicId SIEMPRE de sesión, server-side).
  const [info, setInfo] = useState<DetailInfo | null>(null);
  const [favBusy, setFavBusy] = useState(false);
  const [revRating, setRevRating] = useState(5);
  const [revHover, setRevHover] = useState(0);
  const [revComment, setRevComment] = useState("");
  const [revSubmitting, setRevSubmitting] = useState(false);

  async function loadInfo() {
    try {
      const res = await fetch(`/api/suppliers/${supplier.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      setInfo({
        isFavorite: !!j.supplier?.isFavorite,
        rating: typeof j.supplier?.rating === "number" ? j.supplier.rating : supplier.rating,
        ratingCount:
          typeof j.supplier?.ratingCount === "number" ? j.supplier.ratingCount : supplier.ratingCount,
        reviews: Array.isArray(j.reviews) ? j.reviews : [],
        canReview: !!j.canReview,
        reviewableOrderId: j.reviewableOrderId ?? null,
      });
    } catch {
      /* la ficha ya muestra los datos SSR; el bloque dinámico simplemente no carga */
    }
  }

  useEffect(() => {
    loadInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier.id]);

  // Reputación: SSR como base, refrescada por la ruta GET (y tras dejar reseña).
  const rating = info ? info.rating : supplier.rating;
  const ratingCount = info ? info.ratingCount : supplier.ratingCount;
  const isFavorite = info?.isFavorite ?? false;

  async function toggleFavorite() {
    if (favBusy || !info) return;
    setFavBusy(true);
    const prev = info.isFavorite;
    setInfo({ ...info, isFavorite: !prev }); // optimista
    try {
      const res = await fetch(`/api/suppliers/${supplier.id}/favorite`, { method: "POST" });
      if (!res.ok) throw new Error();
      const j = await res.json().catch(() => ({}));
      const next = typeof j.isFavorite === "boolean" ? j.isFavorite : !prev;
      setInfo((cur) => (cur ? { ...cur, isFavorite: next } : cur));
      toast.success(next ? t("procurement.supplierDetail.toastFavAdded") : t("procurement.supplierDetail.toastFavRemoved"));
    } catch {
      setInfo((cur) => (cur ? { ...cur, isFavorite: prev } : cur)); // revertir
      toast.error(t("procurement.supplierDetail.toastFavError"));
    } finally {
      setFavBusy(false);
    }
  }

  async function submitReview() {
    if (revSubmitting || !info?.reviewableOrderId) return;
    setRevSubmitting(true);
    try {
      const res = await fetch(`/api/suppliers/${supplier.id}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: revRating,
          comment: revComment.trim() || null,
          orderId: info.reviewableOrderId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || t("procurement.supplierDetail.toastReviewError"));
      }
      toast.success(t("procurement.supplierDetail.toastReviewThanks"));
      setRevComment("");
      setRevRating(5);
      await loadInfo(); // refresca reseñas + canReview + reputación
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("procurement.supplierDetail.toastReviewErrorGeneric");
      toast.error(msg);
    } finally {
      setRevSubmitting(false);
    }
  }

  const locationLabel = [supplier.city, supplier.state].filter(Boolean).join(", ");
  const showLogo = !!supplier.logoUrl && !logoError;

  // KPIs derivados de los datos que la página YA carga (sin queries nuevas).
  const availableCount = useMemo(
    () => products.filter((p) => p.stock > 0).length,
    [products],
  );
  const minPrice = useMemo(
    () => (products.length ? Math.min(...products.map((p) => p.price)) : null),
    [products],
  );

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
        throw new Error(j.error || t("procurement.supplierDetail.toastCartError"));
      }
      toast.success(t("procurement.supplierDetail.toastCartAdded"));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("procurement.supplierDetail.toastCartErrorGeneric");
      toast.error(msg || t("procurement.supplierDetail.toastCartErrorGeneric"));
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
        {t("procurement.supplierDetail.backToSuppliers")}
      </Link>

      {/* Encabezado de la ficha (hero con glow violeta) */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        {/* Glow violeta de fondo (decorativo) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -40,
            left: -30,
            width: 260,
            height: 160,
            pointerEvents: "none",
            background:
              "radial-gradient(closest-side, color-mix(in srgb, var(--brand) 16%, transparent), transparent)",
            filter: "blur(6px)",
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
            minWidth: 0,
          }}
        >
          <div
            style={{
              position: "relative",
              width: 64,
              height: 64,
              borderRadius: 12,
              overflow: "hidden",
              flexShrink: 0,
              background: showLogo
                ? "var(--bg-elev-2)"
                : "linear-gradient(135deg, var(--violet-400), var(--brand))",
              boxShadow: showLogo ? undefined : "0 8px 20px -10px rgba(124,58,237,0.6)",
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
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 24 }}>
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
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              {supplier.businessName}
            </h1>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "4px 14px",
                marginTop: 4,
                color: "var(--text-3)",
                fontSize: 13,
              }}
            >
              {locationLabel && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <MapPin size={13} />
                  {locationLabel}
                </span>
              )}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Boxes size={13} />
                {t("procurement.supplierDetail.productCount", { count: products.length })}
              </span>
              {ratingCount > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <StarRow value={rating} size={14} />
                  <span style={{ fontWeight: 600, color: "var(--text-2)" }}>{rating.toFixed(1)}</span>
                  <span style={{ color: "var(--text-4)" }}>({ratingCount})</span>
                </span>
              )}
            </div>

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

        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={toggleFavorite}
            disabled={favBusy || !info}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? t("procurement.supplierDetail.removeFavorite") : t("procurement.supplierDetail.addFavorite")}
            className="btn-new btn-new--secondary"
            style={{ color: isFavorite ? "#e11d48" : undefined, opacity: favBusy || !info ? 0.6 : 1 }}
          >
            <Heart size={14} fill={isFavorite ? "#e11d48" : "none"} />
            {isFavorite ? t("procurement.supplierDetail.inFavorites") : t("procurement.supplierDetail.favorite")}
          </button>
          <Link
            href={`/dashboard/proveedor-chat/${supplier.id}`}
            className="btn-new btn-new--secondary"
            style={{ textDecoration: "none" }}
          >
            <MessageCircle size={14} />
            {t("procurement.supplierDetail.chat")}
          </Link>
          <Link
            href="/dashboard/compras"
            className="btn-new btn-new--primary"
            style={{ textDecoration: "none" }}
          >
            <ShoppingCart size={14} />
            {t("procurement.supplierDetail.viewCart")}
          </Link>
        </div>
      </div>

      {/* KPIs del proveedor (solo datos ya cargados) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 14,
          marginBottom: 16,
        }}
      >
        <KpiCard label={t("procurement.supplierDetail.kpiProducts")} value={String(products.length)} icon={Boxes} />
        <KpiCard label={t("procurement.supplierDetail.kpiAvailable")} value={String(availableCount)} icon={CheckCircle2} />
        <KpiCard
          label={t("procurement.supplierDetail.kpiFrom")}
          value={minPrice != null ? fmtMXN(minPrice) : "—"}
          icon={DollarSign}
        />
      </div>

      {/* Datos de contacto / compra */}
      <CardNew>
        {/* Acento superior — única card destacada del bloque de contacto */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            insetInline: 0,
            top: 0,
            height: 3,
            background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
            pointerEvents: "none",
          }}
        />
        <div
          className="form-section__title"
          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
              color: "var(--violet-400)",
            }}
          >
            <Store size={15} />
          </span>
          {t("procurement.supplierDetail.contactInfo")}
          <span className="form-section__rule" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {supplier.description && (
            <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              {supplier.description}
            </p>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
            {supplier.phone && (
              <span style={contactItemStyle}>
                <Phone size={14} style={{ color: "var(--text-3)" }} />
                {supplier.phone}
              </span>
            )}
            <span style={contactItemStyle}>
              <Mail size={14} style={{ color: "var(--text-3)" }} />
              {supplier.email}
            </span>
            {supplier.address && (
              <span style={contactItemStyle}>
                <MapPin size={14} style={{ color: "var(--text-3)" }} />
                {supplier.address}
              </span>
            )}
          </div>

          {/* Ubicación + canales (espejo del bloque del laboratorio) */}
          {(supplier.mapsUrl || supplier.whatsapp || supplier.website) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
              {supplier.mapsUrl && (
                <a
                  href={supplier.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...contactItemStyle, color: "var(--brand)", textDecoration: "none" }}
                >
                  <Navigation size={14} />
                  {t("procurement.supplierDetail.viewOnMaps")}
                </a>
              )}
              {supplier.whatsapp && (
                <a
                  href={`https://wa.me/${supplier.whatsapp.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...contactItemStyle, color: "var(--brand)", textDecoration: "none" }}
                >
                  <MessageCircle size={14} />
                  WhatsApp
                </a>
              )}
              {supplier.website && (
                <a
                  href={supplier.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...contactItemStyle, color: "var(--brand)", textDecoration: "none" }}
                >
                  <Globe size={14} />
                  {t("procurement.supplierDetail.website")}
                </a>
              )}
            </div>
          )}

          {/* Pedido mínimo + nota de envío */}
          {(supplier.minOrderAmount != null || supplier.shippingNote) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {supplier.minOrderAmount != null && (
                <span style={contactItemStyle}>
                  <DollarSign size={14} style={{ color: "var(--text-3)" }} />
                  {t("procurement.supplierDetail.minOrder")}&nbsp;
                  <strong style={{ color: "var(--text-1)", fontWeight: 600 }}>
                    {fmtMXN(supplier.minOrderAmount)}
                  </strong>
                </span>
              )}
              {supplier.shippingNote && (
                <span style={{ ...contactItemStyle, alignItems: "flex-start" }}>
                  <Truck size={14} style={{ color: "var(--text-3)", marginTop: 2, flexShrink: 0 }} />
                  {supplier.shippingNote}
                </span>
              )}
            </div>
          )}

          {supplier.paymentMethods.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span style={{ color: "var(--text-3)", fontSize: 13 }}>{t("procurement.supplierDetail.paymentMethods")}</span>
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
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
              color: "var(--violet-400)",
            }}
          >
            <Boxes size={15} />
          </span>
          <h2
            style={{
              color: "var(--text-1)",
              fontWeight: 600,
              fontSize: 18,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            {t("procurement.supplierDetail.productsHeading")}
          </h2>
          <span style={{ color: "var(--text-3)", fontSize: 13 }}>({products.length})</span>
        </div>

        {products.length === 0 ? (
          <CardNew>
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
                <Package size={26} />
              </div>
              <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
                {t("procurement.supplierDetail.emptyProductsTitle")}
              </div>
              <p
                style={{
                  color: "var(--text-3)",
                  fontSize: 13,
                  margin: 0,
                  maxWidth: 340,
                  lineHeight: 1.5,
                }}
              >
                {t("procurement.supplierDetail.emptyProductsText")}
              </p>
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
            {products.map((p) => (
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

      {/* Reseñas */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
              color: "var(--violet-400)",
            }}
          >
            <Star size={15} />
          </span>
          <h2
            style={{
              color: "var(--text-1)",
              fontWeight: 600,
              fontSize: 18,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            {t("procurement.supplierDetail.reviewsHeading")}
          </h2>
          {ratingCount > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--text-3)",
                fontSize: 13,
              }}
            >
              <StarRow value={rating} size={14} />
              <span style={{ fontWeight: 600, color: "var(--text-2)" }}>{rating.toFixed(1)}</span>
              <span>({ratingCount})</span>
            </span>
          )}
        </div>

        {/* Formulario: solo si la clínica tiene un pedido entregado sin reseñar */}
        {info?.canReview && (
          <div style={{ marginBottom: 14 }}>
            <CardNew>
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  insetInline: 0,
                  top: 0,
                  height: 3,
                  background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
                  pointerEvents: "none",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>{t("procurement.supplierDetail.reviewFormTitle")}</div>
                <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                  {t("procurement.supplierDetail.reviewFormSubtitle")}
                </p>
                <div style={{ display: "inline-flex", gap: 4 }} role="radiogroup" aria-label={t("procurement.supplierDetail.ratingLabel")}>
                  {[1, 2, 3, 4, 5].map((i) => {
                    const on = (revHover || revRating) >= i;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setRevRating(i)}
                        onMouseEnter={() => setRevHover(i)}
                        onMouseLeave={() => setRevHover(0)}
                        role="radio"
                        aria-label={t("procurement.supplierDetail.starCount", { count: i })}
                        aria-checked={revRating === i}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          padding: 2,
                          lineHeight: 0,
                          color: "#f5b301",
                        }}
                      >
                        <Star size={26} fill={on ? "#f5b301" : "none"} strokeWidth={1.75} />
                      </button>
                    );
                  })}
                </div>
                <textarea
                  value={revComment}
                  onChange={(e) => setRevComment(e.target.value)}
                  aria-label={t("procurement.supplierDetail.reviewTextareaLabel")}
                  placeholder={t("procurement.supplierDetail.reviewTextareaPlaceholder")}
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border-soft)",
                    background: "var(--bg-elev)",
                    color: "var(--text-1)",
                    fontSize: 13,
                    outline: "none",
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
                <div>
                  <ButtonNew
                    variant="primary"
                    size="sm"
                    icon={revSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    disabled={revSubmitting}
                    onClick={submitReview}
                  >
                    {revSubmitting ? t("procurement.supplierDetail.reviewSending") : t("procurement.supplierDetail.reviewSubmit")}
                  </ButtonNew>
                </div>
              </div>
            </CardNew>
          </div>
        )}

        {/* Lista de reseñas */}
        {info && info.reviews.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {info.reviews.map((r) => (
              <CardNew key={r.id}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        flexShrink: 0,
                        display: "grid",
                        placeItems: "center",
                        background: "var(--brand-soft)",
                        border: "1px solid var(--border-brand)",
                        color: "var(--violet-400)",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {(r.clinicName ?? "C").charAt(0).toUpperCase()}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
                        {r.clinicName ?? t("procurement.supplierDetail.clinicFallback")}
                      </div>
                      <StarRow value={r.rating} size={13} />
                    </div>
                  </div>
                  <span style={{ color: "var(--text-4)", fontSize: 12 }}>
                    {new Date(r.createdAt).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
                {r.comment && (
                  <p style={{ color: "var(--text-2)", fontSize: 13, lineHeight: 1.5, margin: "10px 0 0" }}>
                    {r.comment}
                  </p>
                )}
              </CardNew>
            ))}
          </div>
        ) : (
          <CardNew>
            <div
              style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}
            >
              {info ? t("procurement.supplierDetail.noReviewsYet") : t("procurement.supplierDetail.loadingReviews")}
            </div>
          </CardNew>
        )}
      </div>
    </div>
  );
}
