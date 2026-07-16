"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Package, Trash2, Pencil, Eye, EyeOff, Tag, DollarSign, PackageOpen } from "lucide-react";
import toast from "react-hot-toast";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fmtMXN, fmtMXNdec } from "@/lib/format";
import type { SupplierProductDTO } from "@/lib/suppliers/types";

type Tab = "todos" | "activos" | "inactivos";

const TABS: { id: Tab; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "activos", label: "Activos" },
  { id: "inactivos", label: "Inactivos" },
];

export function ProductosClient({ initialProducts }: { initialProducts: SupplierProductDTO[] }) {
  const router = useRouter();
  const askConfirm = useConfirm();
  const [products, setProducts] = useState<SupplierProductDTO[]>(initialProducts);
  const [tab, setTab] = useState<Tab>("todos");
  const [search, setSearch] = useState("");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [hoverId, setHoverId] = useState<string | null>(null);

  const kpis = useMemo(() => {
    const activos = products.filter((p) => p.isActive).length;
    const sinStock = products.filter((p) => p.stock === 0).length;
    const valor = products.reduce((s, p) => s + p.price * p.stock, 0);
    return { total: products.length, activos, sinStock, valor };
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => tab === "todos" || (tab === "activos" ? p.isActive : !p.isActive))
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase().includes(q) ||
          (p.category ?? "").toLowerCase().includes(q),
      );
  }, [products, tab, search]);

  async function toggleActive(p: SupplierProductDTO) {
    setBusyIds((s) => new Set(s).add(p.id));
    try {
      const res = await fetch(`/api/proveedores/products/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !p.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "No se pudo actualizar el producto.");
        return;
      }
      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: !p.isActive } : x)));
      toast.success(!p.isActive ? "Producto activado" : "Producto desactivado");
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(p.id);
        return n;
      });
    }
  }

  async function remove(p: SupplierProductDTO) {
    const ok = await askConfirm({
      title: `¿Eliminar "${p.name}"?`,
      description: "El producto y sus imágenes se eliminarán. Esta acción no se puede deshacer.",
      variant: "danger",
      confirmText: "Eliminar",
    });
    if (!ok) return;
    setBusyIds((s) => new Set(s).add(p.id));
    try {
      const res = await fetch(`/api/proveedores/products/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d?.error ?? "No se pudo eliminar el producto.");
        return;
      }
      setProducts((prev) => prev.filter((x) => x.id !== p.id));
      toast.success("Producto eliminado");
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(p.id);
        return n;
      });
    }
  }

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto", position: "relative" }}>
      {/* Glow violeta de fondo */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -40,
          left: -20,
          width: 360,
          height: 220,
          pointerEvents: "none",
          background: "radial-gradient(closest-side, rgba(124,58,237,0.16), transparent 70%)",
          filter: "blur(8px)",
          zIndex: 0,
        }}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 22,
          gap: 24,
          flexWrap: "wrap",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              color: "#fff",
              background: "var(--brand-grad)",
              boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
            }}
          >
            <Package size={20} />
          </div>
          <div>
            <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
              Productos
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 14, marginTop: 4 }}>
              {products.length === 0
                ? "Tu catálogo está vacío"
                : `${products.length} ${products.length === 1 ? "producto" : "productos"} en tu catálogo`}
            </p>
          </div>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={() => router.push("/proveedores/productos/nuevo")}>
          Nuevo producto
        </ButtonNew>
      </div>

      {/* KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 14,
          marginBottom: 20,
          position: "relative",
          zIndex: 1,
        }}
      >
        <KpiCard label="Total productos" value={String(kpis.total)} icon={Package} />
        <KpiCard label="Activos" value={String(kpis.activos)} icon={Eye} />
        <KpiCard label="Sin stock" value={String(kpis.sinStock)} icon={PackageOpen} />
        <KpiCard label="Valor inventario" value={fmtMXN(kpis.valor)} icon={DollarSign} />
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center", position: "relative", zIndex: 1 }}>
        <div className="search-field">
          <Search size={14} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, SKU o categoría…"
          />
        </div>
        <div className="segment-new">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`segment-new__btn ${tab === t.id ? "segment-new__btn--active" : ""}`}
              style={tab === t.id ? { color: "var(--text-1)", fontWeight: 600 } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <CardNew noPad>
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
              zIndex: 1,
            }}
          />
          {filtered.length === 0 ? (
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
                  color: "var(--brand)",
                }}
              >
                <Package size={26} />
              </div>
              <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
                {search
                  ? "Sin resultados"
                  : tab === "todos"
                    ? "Aún no tienes productos"
                    : "Nada por aquí todavía"}
              </div>
              <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
                {search
                  ? "Prueba con otro nombre, SKU o categoría para encontrar lo que buscas."
                  : tab === "todos"
                    ? "Agrega tu primer producto para empezar a recibir pedidos de las clínicas."
                    : "No hay productos en este estado por ahora."}
              </p>
              {products.length === 0 && (
                <div style={{ marginTop: 4 }}>
                  <ButtonNew variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => router.push("/proveedores/productos/nuevo")}>
                    Agregar primer producto
                  </ButtonNew>
                </div>
              )}
            </div>
          ) : (
            <table className="table-new">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th style={{ textAlign: "right" }}>Precio</th>
                  <th style={{ textAlign: "right" }}>Stock</th>
                  <th>Estado</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const busy = busyIds.has(p.id);
                  const hovered = hoverId === p.id;
                  const thumb = p.images[0]?.url;
                  return (
                    <tr
                      key={p.id}
                      onMouseEnter={() => setHoverId(p.id)}
                      onMouseLeave={() => setHoverId((id) => (id === p.id ? null : id))}
                      style={{
                        background: hovered ? "var(--brand-soft)" : undefined,
                        boxShadow: hovered ? "inset 3px 0 0 var(--brand)" : "inset 3px 0 0 transparent",
                        transition: "background .14s ease, box-shadow .14s ease",
                      }}
                    >
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {thumb ? (
                            <img
                              src={thumb}
                              alt=""
                              style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", border: "1px solid var(--border-soft)", flexShrink: 0 }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                background: "var(--brand-soft)",
                                border: "1px solid var(--border-brand)",
                                display: "grid",
                                placeItems: "center",
                                flexShrink: 0,
                              }}
                            >
                              <Package size={16} style={{ color: "var(--brand)" }} />
                            </div>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <button
                              type="button"
                              onClick={() => router.push(`/proveedores/productos/${p.id}`)}
                              style={{
                                fontWeight: 500,
                                color: "var(--text-1)",
                                background: "transparent",
                                border: "none",
                                padding: 0,
                                cursor: "pointer",
                                textAlign: "left",
                                fontFamily: "inherit",
                                fontSize: 12,
                              }}
                              title="Editar producto"
                            >
                              {p.name}
                            </button>
                            {p.sku && (
                              <div style={{ fontSize: 11, color: "var(--text-3)" }}>SKU: {p.sku}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        {p.category ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "3px 9px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 500,
                              color: "var(--brand)",
                              background: "var(--brand-soft)",
                              border: "1px solid var(--border-brand)",
                            }}
                          >
                            <Tag size={11} />
                            {p.category}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-4)" }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {fmtMXNdec(p.price)}
                        <span style={{ color: "var(--text-4)", fontSize: 11 }}> /{p.unit}</span>
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">
                        <span style={{ color: p.stock === 0 ? "var(--danger)" : "var(--text-1)", fontWeight: 600 }}>
                          {p.stock}
                        </span>
                      </td>
                      <td>
                        <BadgeNew tone={p.isActive ? "success" : "neutral"} dot>
                          {p.isActive ? "Activo" : "Inactivo"}
                        </BadgeNew>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 4 }}>
                          <button
                            type="button"
                            onClick={() => router.push(`/proveedores/productos/${p.id}`)}
                            className="btn-new btn-new--ghost btn-new--sm"
                            style={{ padding: 0, width: 28 }}
                            aria-label="Editar"
                            title="Editar"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => toggleActive(p)}
                            className="btn-new btn-new--ghost btn-new--sm"
                            style={{ padding: 0, width: 28 }}
                            aria-label={p.isActive ? "Desactivar" : "Activar"}
                            title={p.isActive ? "Desactivar" : "Activar"}
                          >
                            {p.isActive ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => remove(p)}
                            className="btn-new btn-new--ghost btn-new--sm"
                            style={{ padding: 0, width: 28, color: "var(--danger)" }}
                            aria-label="Eliminar"
                            title="Eliminar"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardNew>
      </div>
    </div>
  );
}
