"use client";

import { useState, useMemo } from "react";
import { Plus, Search, Package, X, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

// Icons from the uploaded image mapped to categories/items
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

// Fallback emoji icons for items without custom icon
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

// Auto-assigned icon per category for display
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

type StatusTab = "todos" | "disponible" | "poco" | "sin" | "inactivo";

const TABS: { id: StatusTab; label: string; activeClass: string }[] = [
  { id:"todos",      label:"📋 Todos",       activeClass:"bg-brand-600 text-white border-brand-600"     },
  { id:"disponible", label:"✅ Disponible",  activeClass:"bg-emerald-500 text-white border-emerald-500" },
  { id:"poco",       label:"⚠️ Poco stock",  activeClass:"bg-amber-500 text-white border-amber-500"    },
  { id:"sin",        label:"🔴 Sin stock",   activeClass:"bg-rose-500 text-white border-rose-500"      },
  { id:"inactivo",   label:"⚫ No activos",  activeClass:"bg-slate-500 text-white border-slate-500"    },
];

function getStatus(item: Item): StatusTab {
  if (item.quantity === 0 && item.minQuantity === 5) return "inactivo";
  if (item.quantity === 0) return "sin";
  if (item.quantity <= item.minQuantity) return "poco";
  return "disponible";
}

// Icon component — tries custom image, falls back to emoji
function ItemIcon({ iconId, category, size = 44 }: { iconId: string; category: string; size?: number }) {
  const [err, setErr] = useState(false);
  const icon = DENTAL_ICONS.find(i => i.id === iconId);

  if (icon && !err) {
    return (
      <img src={icon.src} alt={icon.label} onError={() => setErr(true)}
        style={{ width: size, height: size }}
        className="rounded-xl object-contain flex-shrink-0 bg-card p-1 border border-border" />
    );
  }
  return (
    <div style={{ width: size, height: size }}
      className="rounded-xl bg-muted flex items-center justify-center flex-shrink-0 border border-border text-2xl">
      {CATEGORY_EMOJI[category] ?? "📦"}
    </div>
  );
}

// Icon picker modal
function IconPicker({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div>
      <Label className="text-sm mb-2 block">Ícono del artículo</Label>
      <div className="grid grid-cols-8 gap-2 p-3 bg-muted rounded-xl border border-border">
        {DENTAL_ICONS.map(icon => (
          <button key={icon.id} type="button"
            onClick={() => onSelect(icon.id)}
            title={icon.label}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all border-2 bg-card hover:scale-110 ${selected === icon.id ? "border-brand-500 ring-2 ring-brand-300" : "border-transparent"}`}>
            <img src={icon.src} alt={icon.label}
              className="w-9 h-9 object-contain"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function InventoryClient({ initialItems, specialty }: { initialItems: Item[]; specialty: string }) {
  const [items,      setItems]      = useState<Item[]>(initialItems);
  const [tab,        setTab]        = useState<StatusTab>("todos");
  const [search,     setSearch]     = useState("");
  const [showAdd,    setShowAdd]    = useState(false);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [editQty,    setEditQty]    = useState<Record<string, string>>({});
  const [customCat,  setCustomCat]  = useState("");
  const [newItem, setNewItem] = useState({
    name: "", description: "", category: "Instrumental básico",
    customCategory: "", quantity: 0, minQuantity: 5, unit: "pza", iconId: "fresa-jeringa",
  });

  const counts = useMemo(() => {
    const c: Record<StatusTab, number> = { todos:0, disponible:0, poco:0, sin:0, inactivo:0 };
    for (const item of items) { c[getStatus(item)]++; c.todos++; }
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    return items
      .filter(i => tab === "todos" || getStatus(i) === tab)
      .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.category.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        if (tab === "todos") {
          const order: Record<string, number> = { disponible:0, poco:1, sin:2, inactivo:3 };
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
        method: "PATCH", headers: { "Content-Type": "application/json" },
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
        method: "PATCH", headers: { "Content-Type": "application/json" },
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
      method: "PATCH", headers: { "Content-Type": "application/json" },
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newItem.name, description: newItem.description,
          category: finalCategory, emoji: newItem.iconId,
          quantity: newItem.quantity, minQuantity: newItem.minQuantity, unit: newItem.unit,
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
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">📦 Inventario</h1>
          <p className="text-base text-muted-foreground mt-0.5">{items.length} artículos registrados</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="w-5 h-5 mr-2" /> Agregar artículo
        </Button>
      </div>

      {/* Status tabs */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-2xl border-2 p-4 text-left transition-all ${tab === t.id ? t.activeClass : "bg-card border-border hover:border-slate-400"}`}>
            <div className={`text-3xl font-extrabold leading-none mb-1 ${tab !== t.id ? "text-foreground" : ""}`}>{counts[t.id]}</div>
            <div className={`text-sm font-bold ${tab !== t.id ? "text-muted-foreground" : ""}`}>{t.label}</div>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          className="flex h-12 w-full rounded-xl border border-border bg-card pl-11 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          placeholder="Buscar artículo o categoría…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <div className="text-base font-semibold">
            {tab === "inactivo" ? "Todos los artículos tienen stock registrado" :
             tab === "disponible" ? "No hay artículos con stock suficiente" :
             tab === "poco" ? "No hay artículos con stock bajo" :
             "No hay artículos sin stock"}
          </div>
        </div>
      )}

      {/* Items list */}
      {filtered.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-card">
          {filtered.map((item, idx) => {
            const isLoad    = loadingIds.has(item.id);
            const isEditing = editQty[item.id] !== undefined;
            const status    = getStatus(item);
            const iconId    = item.emoji && DENTAL_ICONS.find(i => i.id === item.emoji) ? item.emoji : (CATEGORY_DEFAULT_ICON[item.category] ?? "fresa-jeringa");

            return (
              <div key={item.id}
                className={`flex items-center gap-4 px-5 py-4 group transition-colors ${idx > 0 ? "border-t border-border/50" : ""} hover:bg-muted/10`}>
                <ItemIcon iconId={iconId} category={item.category} size={48} />

                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold truncate">{item.name}</div>
                  <div className="text-sm text-muted-foreground mt-0.5">{item.category}</div>
                  {item.description && (
                    <div className="text-sm text-muted-foreground/70 truncate mt-0.5">{item.description}</div>
                  )}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-xs text-muted-foreground">Alerta si baja de</span>
                    <input type="number" min="0"
                      className="w-12 h-5 text-xs border border-border rounded-md px-1.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-brand-600/30"
                      defaultValue={item.minQuantity}
                      onBlur={e => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v !== item.minQuantity) updateMinQty(item.id, v);
                      }} />
                    <span className="text-xs text-muted-foreground">{item.unit}</span>
                  </div>
                </div>

                {/* Quantity */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <input type="number" min="0" autoFocus
                        className="w-20 h-11 text-center text-lg font-bold border-2 border-brand-500 rounded-xl bg-card focus:outline-none"
                        value={editQty[item.id]}
                        onChange={e => setEditQty(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === "Enter") setQuantityDirect(item.id, editQty[item.id]);
                          if (e.key === "Escape") setEditQty(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                        }} />
                      <button onClick={() => setQuantityDirect(item.id, editQty[item.id])} disabled={isLoad}
                        className="h-11 px-3 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition-colors disabled:opacity-50 text-sm">
                        ✓
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setEditQty(prev => ({ ...prev, [item.id]: String(item.quantity) }))}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 transition-colors hover:border-brand-400 group/qty ${
                        status === "sin"      ? "border-rose-300 bg-rose-50 dark:bg-rose-950/30" :
                        status === "poco"     ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" :
                        status === "inactivo" ? "border-border bg-muted" :
                        "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
                      }`}>
                      <span className={`text-2xl font-extrabold leading-none ${
                        status === "sin"      ? "text-rose-600" :
                        status === "poco"     ? "text-amber-600" :
                        status === "inactivo" ? "text-muted-foreground" :
                        "text-emerald-600"
                      }`}>{item.quantity}</span>
                      <span className="text-sm text-muted-foreground">{item.unit}</span>
                      <Edit3 className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover/qty:opacity-100 ml-1" />
                    </button>
                  )}

                  <button disabled={isLoad || item.quantity === 0} onClick={() => changeQty(item.id, -1)}
                    className="w-11 h-11 rounded-xl bg-rose-500 hover:bg-rose-600 active:scale-95 text-white font-bold text-2xl flex items-center justify-center transition-all disabled:opacity-30 shadow-sm">
                    −
                  </button>
                  <button disabled={isLoad} onClick={() => changeQty(item.id, 1)}
                    className="w-11 h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-bold text-2xl flex items-center justify-center transition-all shadow-sm">
                    +
                  </button>
                  <button onClick={() => deleteItem(item.id)}
                    className="w-9 h-9 rounded-lg text-muted-foreground hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center ml-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Item Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card">
              <h2 className="text-lg font-bold">Agregar artículo</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">

              {/* Icon picker */}
              <IconPicker
                selected={newItem.iconId}
                onSelect={id => setNewItem(n => ({ ...n, iconId: id }))} />

              <div className="space-y-1.5">
                <Label className="text-sm">Nombre del artículo *</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ej: Resina compuesta A2"
                  value={newItem.name} onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Para qué sirve</Label>
                <textarea className="flex min-h-[70px] w-full rounded-xl border border-border bg-card px-4 py-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                  placeholder="Ej: Para restauraciones del sector anterior, color más utilizado"
                  value={newItem.description} onChange={e => setNewItem(n => ({ ...n, description: e.target.value }))} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Categoría</Label>
                <select className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                  value={newItem.category}
                  onChange={e => {
                    setNewItem(n => ({ ...n, category: e.target.value }));
                    if (e.target.value !== "Otro") setCustomCat("");
                  }}>
                  <option>Instrumental básico</option>
                  <option>Fresas dentales</option>
                  <option>Materiales de restauración</option>
                  <option>Ortodoncia</option>
                  <option>Endodoncia</option>
                  <option>Cirugía e implantes</option>
                  <option>Consumibles</option>
                  <option>Otro</option>
                </select>
                {/* Custom category input when Otro is selected */}
                {newItem.category === "Otro" && (
                  <input
                    className="flex h-11 w-full rounded-xl border border-brand-400 bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20 mt-2"
                    placeholder="Escribe el nombre de la categoría (o deja en blanco para usar 'Otro')"
                    value={newItem.customCategory}
                    onChange={e => setNewItem(n => ({ ...n, customCategory: e.target.value }))} />
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm">Cantidad inicial</Label>
                  <input type="number" min="0"
                    className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                    value={newItem.quantity} onChange={e => setNewItem(n => ({ ...n, quantity: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Alerta si baja de</Label>
                  <input type="number" min="0"
                    className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                    value={newItem.minQuantity} onChange={e => setNewItem(n => ({ ...n, minQuantity: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Unidad</Label>
                  <select className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                    value={newItem.unit} onChange={e => setNewItem(n => ({ ...n, unit: e.target.value }))}>
                    {["pza","cja","frasco","rollo","par","paquete","kit","ml","mg","uni"].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11 text-base">Cancelar</Button>
              <Button onClick={addItem} className="flex-1 h-11 text-base">✅ Agregar artículo</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
