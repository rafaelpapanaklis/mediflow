"use client";

import { useState, useMemo } from "react";
import { Plus, Search, Package, X, Trash2, Minus, Check } from "lucide-react";
import toast from "react-hot-toast";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXN }    from "@/lib/format";

const DENTAL_ICONS = [
  { id: "implante-plateado",  src: "/icons/dental/implante-plateado.png",  label: "Implante plateado"  },
  { id: "implante-azul",      src: "/icons/dental/implante-azul.png",      label: "Implante azul"      },
  { id: "implante-dorado",    src: "/icons/dental/implante-dorado.png",    label: "Implante dorado"    },
  { id: "gasas",              src: "/icons/dental/gasas.png",              label: "Gasas/consumibles"  },
  { id: "algodon",            src: "/icons/dental/algodon.png",            label: "Algodón/rollos"     },
  { id: "jeringa-verde",      src: "/icons/dental/jeringa-verde.png",      label: "Jeringa/anestesia"  },
  { id: "fresa-jeringa",      src: "/icons/dental/fresa-jeringa.png",      label: "Fresa/instrumental" },
  { id: "frasco-azul",        src: "/icons/dental/frasco-azul.png",        label: "Frasco/solución"    },
  { id: "cemento",            src: "/icons/dental/cemento.png",            label: "Cemento/material"   },
  { id: "brackets",           src: "/icons/dental/brackets.png",           label: "Brackets"           },
  { id: "cadenas",            src: "/icons/dental/cadenas.png",            label: "Cadenas elásticas"  },
  { id: "implante-solo",      src: "/icons/dental/implante-solo.png",      label: "Implante"           },
  { id: "limas",              src: "/icons/dental/limas.png",              label: "Limas/endodoncia"   },
  { id: "tijeras",            src: "/icons/dental/tijeras.png",            label: "Tijeras/cirugía"    },
  { id: "esterilizacion",     src: "/icons/dental/esterilizacion.png",     label: "Esterilización"     },
  { id: "guantes-cubrebocas", src: "/icons/dental/guantes-cubrebocas.png", label: "Guantes/cubrebocas" },
];

const CATEGORY_EMOJI: Record<string, string> = {
  "Instrumental básico":        "🔧",
  "Fresas dentales":            "⚙️",
  "Materiales de restauración": "🧴",
  "Ortodoncia":                 "📐",
  "Endodoncia":                 "🔬",
  "Cirugía e implantes":        "🏥",
  "Consumibles":                "📦",
  "Otro":                       "📦",
};

const CATEGORY_DEFAULT_ICON: Record<string, string> = {
  "Instrumental básico":        "fresa-jeringa",
  "Fresas dentales":            "fresa-jeringa",
  "Materiales de restauración": "cemento",
  "Ortodoncia":                 "brackets",
  "Endodoncia":                 "limas",
  "Cirugía e implantes":        "implante-solo",
  "Consumibles":                "guantes-cubrebocas",
};

interface Item {
  id: string; name: string; description: string | null;
  category: string; emoji: string; quantity: number;
  minQuantity: number; unit: string; price: number | null;
}

type StatusTab = "todos" | "disponible" | "poco" | "sin";

const STATUS_FILTERS: { id: StatusTab; label: string }[] = [
  { id: "todos",      label: "Todos" },
  { id: "disponible", label: "Disponibles" },
  { id: "poco",       label: "Stock bajo" },
  { id: "sin",        label: "Agotados" },
];

function getStatus(item: Item): StatusTab {
  if (item.quantity === 0) return "sin";
  if (item.quantity <= item.minQuantity) return "poco";
  return "disponible";
}

function statusBadge(s: StatusTab) {
  if (s === "sin")        return <BadgeNew tone="danger"  dot>Agotado</BadgeNew>;
  if (s === "poco")       return <BadgeNew tone="warning" dot>Bajo</BadgeNew>;
  return <BadgeNew tone="success" dot>OK</BadgeNew>;
}

function ItemIcon({ iconId, category, size = 40 }: { iconId: string; category: string; size?: number }) {
  const [err, setErr] = useState(false);
  const icon = DENTAL_ICONS.find(i => i.id === iconId);
  if (icon && !err) {
    return (
      <img src={icon.src} alt={icon.label} onError={() => setErr(true)}
        style={{ width: size, height: size, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", padding: 4, borderRadius: 8 }}
        className="object-contain flex-shrink-0" />
    );
  }
  return (
    <div style={{
      width: size, height: size,
      background: "var(--bg-elev-2)",
      border: "1px solid var(--border-soft)",
      borderRadius: 8,
      display: "grid",
      placeItems: "center",
      fontSize: size * 0.5,
    }} className="flex-shrink-0">
      {CATEGORY_EMOJI[category] ?? "📦"}
    </div>
  );
}

function IconPicker({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div>
      <div className="form-section__title">
        Ícono
        <span className="form-section__rule" />
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        gap: 6,
        padding: 8,
        background: "var(--bg-elev-2)",
        borderRadius: 8,
        border: "1px solid var(--border-soft)",
      }}>
        {DENTAL_ICONS.map(icon => (
          <button
            key={icon.id}
            type="button"
            onClick={() => onSelect(icon.id)}
            title={icon.label}
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              background: selected === icon.id ? "var(--brand-soft)" : "var(--bg-elev)",
              border: selected === icon.id ? "1px solid var(--border-brand)" : "1px solid transparent",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              transition: "all .12s",
            }}
          >
            <img src={icon.src} alt={icon.label}
              style={{ width: 26, height: 26, objectFit: "contain" }}
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function InventoryClient({ initialItems }: { initialItems: Item[]; specialty?: string }) {
  const [items, setItems]       = useState<Item[]>(initialItems);
  const [tab, setTab]           = useState<StatusTab>("todos");
  const [search, setSearch]     = useState("");
  const [showAdd, setShowAdd]   = useState(false);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [editQty, setEditQty]   = useState<Record<string, string>>({});
  const [newItem, setNewItem] = useState({
    name: "", description: "", category: "Instrumental básico",
    customCategory: "", quantity: 0, minQuantity: 5, unit: "pza", iconId: "fresa-jeringa",
  });

  const kpis = useMemo(() => {
    const totalQty    = items.reduce((s, i) => s + i.quantity, 0);
    const lowCount    = items.filter(i => i.quantity > 0 && i.quantity <= i.minQuantity).length;
    const outCount    = items.filter(i => i.quantity === 0).length;
    const totalValue  = items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);
    return { total: items.length, totalQty, lowCount, outCount, totalValue };
  }, [items]);

  const filtered = useMemo(() => {
    return items
      .filter(i => tab === "todos" || getStatus(i) === tab)
      .filter(i => !search
        || i.name.toLowerCase().includes(search.toLowerCase())
        || i.category.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        if (tab === "todos") {
          const order: Record<string, number> = { disponible: 0, poco: 1, sin: 2 };
          const sa = order[getStatus(a)] ?? 9;
          const sb = order[getStatus(b)] ?? 9;
          if (sa !== sb) return sa - sb;
        }
        return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
      });
  }, [items, tab, search]);

  async function setQuantityDirect(id: string, qtyStr: string) {
    const qty = parseInt(qtyStr);
    if (isNaN(qty) || qty < 0) return;
    setLoadingIds(s => new Set(s).add(id));
    try {
      const item = items.find(i => i.id === id)!;
      const res = await fetch(`/api/inventory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: qty }),
      });
      const updated = await res.json();
      setItems(prev => prev.map(i => i.id === id ? { ...i, quantity: updated.quantity } : i));
      setEditQty(prev => { const n = { ...prev }; delete n[id]; return n; });
      toast.success(`${item.name}: ${updated.quantity} ${item.unit}`);
    } catch { toast.error("Error"); } finally {
      setLoadingIds(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  async function changeQty(id: string, delta: number) {
    setLoadingIds(s => new Set(s).add(id));
    try {
      const res = await fetch(`/api/inventory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change: delta }),
      });
      const updated = await res.json();
      setItems(prev => prev.map(i => i.id === id ? { ...i, quantity: updated.quantity } : i));
    } catch { toast.error("Error"); } finally {
      setLoadingIds(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  async function updateMinQty(id: string, min: number) {
    await fetch(`/api/inventory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minQuantity: min }),
    });
    setItems(prev => prev.map(i => i.id === id ? { ...i, minQuantity: min } : i));
  }

  async function addItem() {
    if (!newItem.name.trim()) { toast.error("El nombre es requerido"); return; }
    const finalCategory = newItem.category === "Otro"
      ? (newItem.customCategory.trim() || "Otro")
      : newItem.category;
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newItem.name,
          description: newItem.description,
          category: finalCategory,
          emoji: newItem.iconId,
          quantity: newItem.quantity,
          minQuantity: newItem.minQuantity,
          unit: newItem.unit,
        }),
      });
      const created = await res.json();
      setItems(prev => [...prev, created]);
      setShowAdd(false);
      setNewItem({ name:"", description:"", category:"Instrumental básico", customCategory:"", quantity:0, minQuantity:5, unit:"pza", iconId:"fresa-jeringa" });
      toast.success("Artículo agregado");
      setTab(getStatus(created));
    } catch { toast.error("Error"); }
  }

  async function deleteItem(id: string) {
    if (!confirm("¿Eliminar este artículo?")) return;
    await fetch(`/api/inventory/${id}`, { method: "DELETE" });
    setItems(prev => prev.filter(i => i.id !== id));
    toast.success("Eliminado");
  }

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>Inventario</h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            {items.length} artículos registrados · {kpis.totalQty.toLocaleString("es-MX")} unidades en stock
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={() => setShowAdd(true)}>
          Nuevo artículo
        </ButtonNew>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label="Total artículos" value={String(items.length)}       icon={Package} />
        <KpiCard label="Stock bajo"      value={String(kpis.lowCount)}      icon={Package} />
        <KpiCard label="Agotados"        value={String(kpis.outCount)}      icon={Package} />
        <KpiCard label="Valor total"     value={fmtMXN(kpis.totalValue)}    icon={Package} />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <div className="search-field">
          <Search size={14} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar artículo o categoría…"
          />
        </div>
        <div className="segment-new">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setTab(f.id)}
              className={`segment-new__btn ${tab === f.id ? "segment-new__btn--active" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <CardNew noPad>
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <Package size={32} style={{ color: "var(--text-4)", margin: "0 auto 12px" }} />
            <p style={{ color: "var(--text-3)", fontSize: 13 }}>
              {search ? "Sin resultados" : tab === "todos" ? "No hay artículos todavía" : "No hay artículos en este estado"}
            </p>
            {items.length === 0 && (
              <div style={{ marginTop: 12 }}>
                <ButtonNew variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowAdd(true)}>
                  Agregar primer artículo
                </ButtonNew>
              </div>
            )}
          </div>
        ) : (
          <table className="table-new">
            <thead>
              <tr>
                <th>Artículo</th>
                <th>Categoría</th>
                <th style={{ textAlign: "right" }}>Cantidad</th>
                <th style={{ textAlign: "right" }}>Mínimo</th>
                <th>Estado</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const isLoad    = loadingIds.has(item.id);
                const isEditing = editQty[item.id] !== undefined;
                const status    = getStatus(item);
                const iconId    = item.emoji && DENTAL_ICONS.find(i => i.id === item.emoji)
                  ? item.emoji
                  : (CATEGORY_DEFAULT_ICON[item.category] ?? "fresa-jeringa");
                const qtyColor  = status === "sin" ? "var(--danger)" : status === "poco" ? "var(--warning)" : "var(--success)";
                return (
                  <tr key={item.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <ItemIcon iconId={iconId} category={item.category} size={36} />
                        <div>
                          <div style={{ fontWeight: 500, color: "var(--text-1)" }}>{item.name}</div>
                          {item.description && (
                            <div style={{ fontSize: 11, color: "var(--text-3)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ color: "var(--text-2)" }}>{item.category}</td>
                    <td style={{ textAlign: "right" }}>
                      {isEditing ? (
                        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="number" min={0} autoFocus
                            className="input-new mono"
                            style={{ width: 70, height: 28, textAlign: "right" }}
                            value={editQty[item.id]}
                            onChange={e => setEditQty(prev => ({ ...prev, [item.id]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === "Enter") setQuantityDirect(item.id, editQty[item.id]);
                              if (e.key === "Escape") setEditQty(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setQuantityDirect(item.id, editQty[item.id])}
                            disabled={isLoad}
                            className="btn-new btn-new--primary btn-new--sm"
                            style={{ padding: 0, width: 28 }}
                            aria-label="Confirmar"
                          >
                            <Check size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditQty(prev => ({ ...prev, [item.id]: String(item.quantity) }))}
                          className="mono"
                          style={{
                            color: qtyColor, fontWeight: 600, fontSize: 14,
                            background: "transparent", border: "none", cursor: "pointer",
                          }}
                          title="Click para editar"
                        >
                          {item.quantity} {item.unit}
                        </button>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        type="number" min={0}
                        className="input-new mono"
                        style={{ width: 60, height: 28, textAlign: "right", display: "inline-block" }}
                        defaultValue={item.minQuantity}
                        onBlur={e => {
                          const v = parseInt(e.target.value);
                          if (!isNaN(v) && v !== item.minQuantity) updateMinQty(item.id, v);
                        }}
                      />
                    </td>
                    <td>{statusBadge(status)}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        <button
                          type="button"
                          disabled={isLoad || item.quantity === 0}
                          onClick={() => changeQty(item.id, -1)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28, color: "var(--danger)" }}
                          aria-label="Quitar uno"
                        >
                          <Minus size={12} />
                        </button>
                        <button
                          type="button"
                          disabled={isLoad}
                          onClick={() => changeQty(item.id, 1)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28, color: "var(--success)" }}
                          aria-label="Agregar uno"
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteItem(item.id)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28 }}
                          aria-label="Eliminar"
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

      {/* Modal agregar */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Nuevo artículo</div>
              <button
                onClick={() => setShowAdd(false)}
                type="button"
                className="btn-new btn-new--ghost btn-new--sm"
                aria-label="Cerrar"
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal__body">
              <div style={{ marginBottom: 22 }}>
                <IconPicker
                  selected={newItem.iconId}
                  onSelect={id => setNewItem(n => ({ ...n, iconId: id }))}
                />
              </div>

              <div style={{ marginBottom: 22 }}>
                <div className="form-section__title">
                  Información
                  <span className="form-section__rule" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px 14px" }}>
                  <div className="field-new">
                    <label className="field-new__label">Nombre <span className="req">*</span></label>
                    <input
                      className="input-new"
                      placeholder="Ej: Resina compuesta A2"
                      value={newItem.name}
                      onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))}
                    />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Para qué sirve</label>
                    <textarea
                      className="input-new"
                      style={{ height: 60, paddingTop: 8, resize: "vertical" }}
                      placeholder="Ej: Para restauraciones del sector anterior"
                      value={newItem.description}
                      onChange={e => setNewItem(n => ({ ...n, description: e.target.value }))}
                    />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Categoría</label>
                    <select
                      className="input-new"
                      value={newItem.category}
                      onChange={e => setNewItem(n => ({ ...n, category: e.target.value }))}
                    >
                      <option>Instrumental básico</option>
                      <option>Fresas dentales</option>
                      <option>Materiales de restauración</option>
                      <option>Ortodoncia</option>
                      <option>Endodoncia</option>
                      <option>Cirugía e implantes</option>
                      <option>Consumibles</option>
                      <option>Otro</option>
                    </select>
                    {newItem.category === "Otro" && (
                      <input
                        className="input-new"
                        style={{ marginTop: 6 }}
                        placeholder="Escribe el nombre de la categoría"
                        value={newItem.customCategory}
                        onChange={e => setNewItem(n => ({ ...n, customCategory: e.target.value }))}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="form-section__title">
                  Stock inicial
                  <span className="form-section__rule" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
                  <div className="field-new">
                    <label className="field-new__label">Cantidad</label>
                    <input
                      type="number" min={0}
                      className="input-new mono"
                      value={newItem.quantity}
                      onChange={e => setNewItem(n => ({ ...n, quantity: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Alerta si &lt;</label>
                    <input
                      type="number" min={0}
                      className="input-new mono"
                      value={newItem.minQuantity}
                      onChange={e => setNewItem(n => ({ ...n, minQuantity: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Unidad</label>
                    <select
                      className="input-new"
                      value={newItem.unit}
                      onChange={e => setNewItem(n => ({ ...n, unit: e.target.value }))}
                    >
                      {["pza", "cja", "frasco", "rollo", "par", "paquete", "kit", "ml", "mg", "uni"].map(u => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal__footer">
              <ButtonNew variant="ghost" type="button" onClick={() => setShowAdd(false)}>Cancelar</ButtonNew>
              <ButtonNew variant="primary" onClick={addItem}>Agregar artículo</ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
