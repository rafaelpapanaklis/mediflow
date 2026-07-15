"use client";

import { useState, useMemo, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Plus, Search, Package, X, Trash2, Minus, Check,
  AlertTriangle, PackageX, PackageOpen, SearchX, Banknote,
  Wrench, Cog, FlaskConical, Ruler, Microscope, Syringe,
  type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXN }    from "@/lib/format";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";

const DENTAL_ICONS = [
  { id: "implante-plateado",  src: "/icons/dental/implante-plateado.png",  labelKey: "procurement.inventoryClient.iconImplantePlateado"  },
  { id: "implante-azul",      src: "/icons/dental/implante-azul.png",      labelKey: "procurement.inventoryClient.iconImplanteAzul"      },
  { id: "implante-dorado",    src: "/icons/dental/implante-dorado.png",    labelKey: "procurement.inventoryClient.iconImplanteDorado"    },
  { id: "gasas",              src: "/icons/dental/gasas.png",              labelKey: "procurement.inventoryClient.iconGasas"  },
  { id: "algodon",            src: "/icons/dental/algodon.png",            labelKey: "procurement.inventoryClient.iconAlgodon"     },
  { id: "jeringa-verde",      src: "/icons/dental/jeringa-verde.png",      labelKey: "procurement.inventoryClient.iconJeringa"  },
  { id: "fresa-jeringa",      src: "/icons/dental/fresa-jeringa.png",      labelKey: "procurement.inventoryClient.iconFresa" },
  { id: "frasco-azul",        src: "/icons/dental/frasco-azul.png",        labelKey: "procurement.inventoryClient.iconFrasco"    },
  { id: "cemento",            src: "/icons/dental/cemento.png",            labelKey: "procurement.inventoryClient.iconCemento"   },
  { id: "brackets",           src: "/icons/dental/brackets.png",           labelKey: "procurement.inventoryClient.iconBrackets"           },
  { id: "cadenas",            src: "/icons/dental/cadenas.png",            labelKey: "procurement.inventoryClient.iconCadenas"  },
  { id: "implante-solo",      src: "/icons/dental/implante-solo.png",      labelKey: "procurement.inventoryClient.iconImplante"           },
  { id: "limas",              src: "/icons/dental/limas.png",              labelKey: "procurement.inventoryClient.iconLimas"   },
  { id: "tijeras",            src: "/icons/dental/tijeras.png",            labelKey: "procurement.inventoryClient.iconTijeras"    },
  { id: "esterilizacion",     src: "/icons/dental/esterilizacion.png",     labelKey: "procurement.inventoryClient.iconEsterilizacion"     },
  { id: "guantes-cubrebocas", src: "/icons/dental/guantes-cubrebocas.png", labelKey: "procurement.inventoryClient.iconGuantes" },
];

const CATEGORY_FALLBACK_ICON: Record<string, LucideIcon> = {
  "Instrumental básico":        Wrench,
  "Fresas dentales":            Cog,
  "Materiales de restauración": FlaskConical,
  "Ortodoncia":                 Ruler,
  "Endodoncia":                 Microscope,
  "Cirugía e implantes":        Syringe,
  "Consumibles":                Package,
  "Otro":                       Package,
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

const STATUS_FILTERS: { id: StatusTab; labelKey: string }[] = [
  { id: "todos",      labelKey: "common.all" },
  { id: "disponible", labelKey: "procurement.inventoryClient.filterAvailable" },
  { id: "poco",       labelKey: "procurement.inventoryClient.filterLowStock" },
  { id: "sin",        labelKey: "procurement.inventoryClient.filterOutOfStock" },
];

function getStatus(item: Item): StatusTab {
  if (item.quantity === 0) return "sin";
  if (item.quantity <= item.minQuantity) return "poco";
  return "disponible";
}

const statusPillBase: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5,
  minHeight: 24, padding: "3px 10px", borderRadius: 999,
  fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
};

function statusBadge(s: StatusTab, t: TFunction) {
  if (s === "sin") {
    return (
      <span style={{ ...statusPillBase, background: "var(--danger-soft)", color: "var(--danger)" }}>
        <PackageX size={16} strokeWidth={1.75} aria-hidden />
        {t("procurement.inventoryClient.badgeOut")}
      </span>
    );
  }
  if (s === "poco") {
    return (
      <span style={{ ...statusPillBase, background: "var(--warning-soft)", color: "var(--warning-strong)" }}>
        <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
        {t("procurement.inventoryClient.badgeLow")}
      </span>
    );
  }
  return (
    <span style={{ ...statusPillBase, background: "var(--success-soft)", color: "var(--success-strong)" }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", flexShrink: 0 }} />
      {t("procurement.inventoryClient.badgeOk")}
    </span>
  );
}

function ItemIcon({ iconId, category, size = 40 }: { iconId: string; category: string; size?: number }) {
  const t = useT();
  const [err, setErr] = useState(false);
  const icon = DENTAL_ICONS.find(i => i.id === iconId);
  if (icon && !err) {
    return (
      <img src={icon.src} alt={t(icon.labelKey)} onError={() => setErr(true)}
        style={{ width: size, height: size, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", padding: 4, borderRadius: 8 }}
        className="object-contain flex-shrink-0" />
    );
  }
  const FallbackIcon = CATEGORY_FALLBACK_ICON[category] ?? Package;
  return (
    <div style={{
      width: size, height: size,
      background: "var(--bg-elev-2)",
      border: "1px solid var(--border-soft)",
      borderRadius: 8,
      display: "grid",
      placeItems: "center",
      color: "var(--text-3)",
    }} className="flex-shrink-0">
      <FallbackIcon size={20} strokeWidth={1.75} aria-hidden />
    </div>
  );
}

function IconPicker({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const t = useT();
  return (
    <div>
      <div className="form-section__title">
        {t("procurement.inventoryClient.icon")}
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
            title={t(icon.labelKey)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              background: selected === icon.id ? "var(--brand-soft)" : "var(--bg-elev)",
              border: selected === icon.id ? "1px solid var(--border-brand)" : "1px solid transparent",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              transition: "background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)",
            }}
          >
            <img src={icon.src} alt={t(icon.labelKey)}
              style={{ width: 26, height: 26, objectFit: "contain" }}
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function InventoryClient({ initialItems }: { initialItems: Item[]; specialty?: string }) {
  const t = useT();
  const askConfirm = useConfirm();
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
    } catch { toast.error(t("common.genericError")); } finally {
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
    } catch { toast.error(t("common.genericError")); } finally {
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
    if (!newItem.name.trim()) { toast.error(t("procurement.inventoryClient.nameRequired")); return; }
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
      toast.success(t("procurement.inventoryClient.itemAdded"));
      setTab(getStatus(created));
    } catch { toast.error(t("common.genericError")); }
  }

  async function deleteItem(id: string) {
    const item = items.find(i => i.id === id);
    if (!(await askConfirm({
      title: t("procurement.inventoryClient.deleteTitle", { name: item?.name ?? t("procurement.inventoryClient.itemFallback") }),
      description: t("procurement.inventoryClient.deleteDesc"),
      variant: "danger",
      confirmText: t("common.delete"),
    }))) return;
    await fetch(`/api/inventory/${id}`, { method: "DELETE" });
    setItems(prev => prev.filter(i => i.id !== id));
    toast.success(t("procurement.inventoryClient.deleted"));
  }

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "clamp(18px, 1.6vw, 22px)", letterSpacing: "-0.01em", color: "var(--text-1)", fontWeight: 700, margin: 0 }}>{t("procurement.inventoryClient.title")}</h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            {t("procurement.inventoryClient.subtitle", { items: items.length, units: kpis.totalQty.toLocaleString("es-MX") })}
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setShowAdd(true)}>
          {t("procurement.inventoryClient.newItem")}
        </ButtonNew>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 24 }}>
        <KpiCard label={t("procurement.inventoryClient.kpiTotalItems")} value={String(items.length)}       icon={Package} hero />
        <KpiCard label={t("procurement.inventoryClient.kpiLowStock")}      value={String(kpis.lowCount)}      icon={AlertTriangle} />
        <KpiCard label={t("procurement.inventoryClient.kpiOutOfStock")}        value={String(kpis.outCount)}      icon={PackageX} />
        <KpiCard label={t("procurement.inventoryClient.kpiTotalValue")}     value={fmtMXN(kpis.totalValue)}    icon={Banknote} />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <div className="search-field">
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("procurement.inventoryClient.searchPlaceholder")}
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
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <CardNew noPad>
        {filtered.length === 0 ? (
          <div style={{ padding: "56px 24px", textAlign: "center" }}>
            <div style={{
              width: 48, height: 48, margin: "0 auto 14px", borderRadius: 999,
              background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)",
              display: "grid", placeItems: "center", color: "var(--text-3)",
            }}>
              {search
                ? <SearchX size={20} strokeWidth={1.75} aria-hidden />
                : <PackageOpen size={20} strokeWidth={1.75} aria-hidden />}
            </div>
            <p style={{ color: "var(--text-3)", fontSize: 13.5, margin: 0 }}>
              {search ? t("common.noResults") : tab === "todos" ? t("procurement.inventoryClient.emptyNoItems") : t("procurement.inventoryClient.emptyNoItemsInState")}
            </p>
            {items.length === 0 && (
              <div style={{ marginTop: 14 }}>
                <ButtonNew variant="primary" size="sm" icon={<Plus size={16} strokeWidth={1.75} aria-hidden />} onClick={() => setShowAdd(true)}>
                  {t("procurement.inventoryClient.addFirstItem")}
                </ButtonNew>
              </div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table className="table-new">
            <thead>
              <tr>
                <th>{t("procurement.inventoryClient.colItem")}</th>
                <th>{t("procurement.inventoryClient.colCategory")}</th>
                <th style={{ textAlign: "right" }}>{t("procurement.inventoryClient.colQuantity")}</th>
                <th style={{ textAlign: "right" }}>{t("procurement.inventoryClient.colMinimum")}</th>
                <th>{t("common.status")}</th>
                <th style={{ textAlign: "right" }}>{t("common.actions")}</th>
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
                const qtyColor  = status === "sin" ? "var(--danger)" : status === "poco" ? "var(--warning-strong)" : "var(--success-strong)";
                return (
                  <tr key={item.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <ItemIcon iconId={iconId} category={item.category} size={36} />
                        <div>
                          <div style={{ fontWeight: 500, color: "var(--text-1)" }}>{item.name}</div>
                          {item.description && (
                            <div style={{ fontSize: 12, color: "var(--text-3)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                            aria-label={t("common.confirm")}
                          >
                            <Check size={16} strokeWidth={1.75} aria-hidden />
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
                          title={t("procurement.inventoryClient.clickToEdit")}
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
                    <td>{statusBadge(status, t)}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        <button
                          type="button"
                          disabled={isLoad || item.quantity === 0}
                          onClick={() => changeQty(item.id, -1)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28, color: "var(--danger)" }}
                          aria-label={t("procurement.inventoryClient.removeOne")}
                        >
                          <Minus size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                        <button
                          type="button"
                          disabled={isLoad}
                          onClick={() => changeQty(item.id, 1)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28, color: "var(--success-strong)" }}
                          aria-label={t("procurement.inventoryClient.addOne")}
                        >
                          <Plus size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteItem(item.id)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28 }}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </CardNew>

      {/* Modal agregar — Radix Dialog. ROOT CAUSE del bug auto-close:
          el modal anterior usaba un <div className="modal-overlay"> inline
          dentro del JSX de InventoryClient. Esto significa que vivía
          dentro del árbol de componentes que re-renderiza cuando el
          ActiveConsultProvider (en dashboard/layout.tsx) actualiza
          `elapsedSeconds` cada 1s vía setInterval (cuando hay consulta
          activa). El context value object no estaba memoizado, lo que
          dispara re-render en consumidores; el JSX inline del modal se
          re-evalúa, los handlers se recrean, y la combinación con el
          <select> nativo + focus/blur del form provocaba que el evento
          de mouseup llegara al overlay y disparara onClose.

          Radix Dialog renderiza dentro de un Portal (fuera del árbol),
          maneja focus trap + Esc + click outside con event handlers
          que escuchan a nivel document con stopPropagation correcto, y
          su estado interno está aislado de re-renders del padre.
          Inmune al problema. */}
      <Dialog.Root open={showAdd} onOpenChange={setShowAdd}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay" />
          <Dialog.Content
            className="modal"
            aria-describedby={undefined}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              maxWidth: 540,
              width: "calc(100vw - 32px)",
              maxHeight: "90vh",
              zIndex: 101,
            }}
          >
            <div className="modal__header">
              <Dialog.Title className="modal__title">{t("procurement.inventoryClient.newItem")}</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="btn-new btn-new--ghost btn-new--sm"
                  aria-label={t("common.close")}
                >
                  <X size={16} strokeWidth={1.75} aria-hidden />
                </button>
              </Dialog.Close>
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
                  {t("procurement.inventoryClient.sectionInfo")}
                  <span className="form-section__rule" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px 14px" }}>
                  <div className="field-new">
                    <label className="field-new__label">{t("procurement.inventoryClient.fieldName")} <span className="req">*</span></label>
                    <input
                      className="input-new"
                      placeholder={t("procurement.inventoryClient.namePlaceholder")}
                      value={newItem.name}
                      onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))}
                    />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">{t("procurement.inventoryClient.fieldPurpose")}</label>
                    <textarea
                      className="input-new"
                      style={{ height: 60, paddingTop: 8, resize: "vertical" }}
                      placeholder={t("procurement.inventoryClient.purposePlaceholder")}
                      value={newItem.description}
                      onChange={e => setNewItem(n => ({ ...n, description: e.target.value }))}
                    />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">{t("procurement.inventoryClient.fieldCategory")}</label>
                    <select
                      className="input-new"
                      value={newItem.category}
                      onChange={e => setNewItem(n => ({ ...n, category: e.target.value }))}
                    >
                      <option value="Instrumental básico">{t("procurement.inventoryClient.catBasicInstruments")}</option>
                      <option value="Fresas dentales">{t("procurement.inventoryClient.catDentalBurs")}</option>
                      <option value="Materiales de restauración">{t("procurement.inventoryClient.catRestorativeMaterials")}</option>
                      <option value="Ortodoncia">{t("procurement.inventoryClient.catOrthodontics")}</option>
                      <option value="Endodoncia">{t("procurement.inventoryClient.catEndodontics")}</option>
                      <option value="Cirugía e implantes">{t("procurement.inventoryClient.catSurgeryImplants")}</option>
                      <option value="Consumibles">{t("procurement.inventoryClient.catConsumables")}</option>
                      <option value="Otro">{t("procurement.inventoryClient.catOther")}</option>
                    </select>
                    {newItem.category === "Otro" && (
                      <input
                        className="input-new"
                        style={{ marginTop: 6 }}
                        placeholder={t("procurement.inventoryClient.customCategoryPlaceholder")}
                        value={newItem.customCategory}
                        onChange={e => setNewItem(n => ({ ...n, customCategory: e.target.value }))}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="form-section__title">
                  {t("procurement.inventoryClient.sectionInitialStock")}
                  <span className="form-section__rule" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
                  <div className="field-new">
                    <label className="field-new__label">{t("procurement.inventoryClient.fieldQuantity")}</label>
                    <input
                      type="number" min={0}
                      className="input-new mono"
                      value={newItem.quantity}
                      onChange={e => setNewItem(n => ({ ...n, quantity: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">{t("procurement.inventoryClient.fieldAlertIfBelow")}</label>
                    <input
                      type="number" min={0}
                      className="input-new mono"
                      value={newItem.minQuantity}
                      onChange={e => setNewItem(n => ({ ...n, minQuantity: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">{t("procurement.inventoryClient.fieldUnit")}</label>
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
              <Dialog.Close asChild>
                <ButtonNew variant="ghost" type="button">{t("common.cancel")}</ButtonNew>
              </Dialog.Close>
              <ButtonNew variant="primary" onClick={addItem}>{t("procurement.inventoryClient.addItem")}</ButtonNew>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
