"use client";

import { useState, useMemo } from "react";
import { Plus, Search, AlertTriangle, Package, X, CheckCircle, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const CATEGORY_ICONS: Record<string, string> = {
  "Instrumental básico":        "🔧",
  "Fresas dentales":            "⚙️",
  "Materiales de restauración": "🧴",
  "Ortodoncia":                 "📐",
  "Endodoncia":                 "🔬",
  "Cirugía e implantes":        "🏥",
  "Consumibles":                "📦",
};

// Unsplash images per category
const CATEGORY_IMAGES: Record<string, string> = {
  "Instrumental básico":        "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?w=56&h=56&fit=crop&auto=format",
  "Fresas dentales":            "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=56&h=56&fit=crop&auto=format",
  "Materiales de restauración": "https://images.unsplash.com/photo-1584515933487-779824d29309?w=56&h=56&fit=crop&auto=format",
  "Ortodoncia":                 "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?w=56&h=56&fit=crop&auto=format",
  "Endodoncia":                 "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=56&h=56&fit=crop&auto=format",
  "Cirugía e implantes":        "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=56&h=56&fit=crop&auto=format",
  "Consumibles":                "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=56&h=56&fit=crop&auto=format",
};

interface Item {
  id: string; name: string; description: string | null;
  category: string; emoji: string; quantity: number;
  minQuantity: number; unit: string; price: number | null;
}

type StatusTab = "disponible" | "poco" | "sin" | "inactivo";

const TABS: { id: StatusTab; label: string; color: string; bg: string; border: string }[] = [
  { id:"disponible", label:"Disponible",  color:"text-emerald-700 dark:text-emerald-400", bg:"bg-emerald-50 dark:bg-emerald-950/40",  border:"border-emerald-300 dark:border-emerald-700" },
  { id:"poco",       label:"Poco stock",  color:"text-amber-700 dark:text-amber-400",    bg:"bg-amber-50 dark:bg-amber-950/40",       border:"border-amber-300 dark:border-amber-700"    },
  { id:"sin",        label:"Sin stock",   color:"text-rose-700 dark:text-rose-400",      bg:"bg-rose-50 dark:bg-rose-950/40",         border:"border-rose-300 dark:border-rose-700"      },
  { id:"inactivo",   label:"No activos",  color:"text-slate-500 dark:text-slate-400",    bg:"bg-slate-50 dark:bg-slate-800/40",       border:"border-slate-300 dark:border-slate-600"    },
];

function getStatus(item: Item): StatusTab {
  if (item.quantity === 0 && item.minQuantity === 5) {
    // Never had stock — check if it was always 0 (default seed)
    // We use minQuantity=5 as default — items with qty=0 and never edited = inactivo
    return "inactivo";
  }
  if (item.quantity === 0) return "sin";
  if (item.quantity <= item.minQuantity) return "poco";
  return "disponible";
}

function ItemImage({ category }: { category: string }) {
  const [err, setErr] = useState(false);
  const src = CATEGORY_IMAGES[category];
  if (!src || err) {
    return (
      <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-lg flex-shrink-0">
        {CATEGORY_ICONS[category] ?? "📦"}
      </div>
    );
  }
  return (
    <img src={src} alt={category} onError={() => setErr(true)}
      className="w-11 h-11 rounded-xl object-cover flex-shrink-0 border border-border" />
  );
}

export function InventoryClient({ initialItems, specialty }: { initialItems: Item[]; specialty: string }) {
  const [items,      setItems]      = useState<Item[]>(initialItems);
  const [tab,        setTab]        = useState<StatusTab>("inactivo");
  const [search,     setSearch]     = useState("");
  const [showAdd,    setShowAdd]    = useState(false);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [editQty,    setEditQty]    = useState<Record<string, string>>({});
  const [newItem,    setNewItem]    = useState({ name:"", description:"", category:"Instrumental básico", quantity:0, minQuantity:5, unit:"pza" });

  // Count per tab
  const counts = useMemo(() => {
    const c: Record<StatusTab, number> = { disponible:0, poco:0, sin:0, inactivo:0 };
    for (const item of items) c[getStatus(item)]++;
    return c;
  }, [items]);

  // Filtered items for current tab
  const filtered = useMemo(() => {
    return items
      .filter(i => getStatus(i) === tab)
      .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.category.toLowerCase().includes(search.toLowerCase()));
  }, [items, tab, search]);

  async function setQuantityDirect(id: string, qty: number) {
    if (isNaN(qty) || qty < 0) return;
    setLoadingIds(s => new Set(s).add(id));
    try {
      const item = items.find(i => i.id === id);
      if (!item) return;
      const change = qty - item.quantity;
      const res = await fetch(`/api/inventory/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change }),
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

  async function updateMinQty(id: string, minQty: number) {
    await fetch(`/api/inventory/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minQuantity: minQty }),
    });
    setItems(prev => prev.map(i => i.id === id ? { ...i, minQuantity: minQty } : i));
  }

  async function addItem() {
    if (!newItem.name) { toast.error("El nombre es requerido"); return; }
    try {
      const res = await fetch("/api/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newItem, emoji: "📦" }),
      });
      const created = await res.json();
      setItems(prev => [...prev, created]);
      setShowAdd(false);
      setNewItem({ name:"", description:"", category:"Instrumental básico", quantity:0, minQuantity:5, unit:"pza" });
      toast.success("Artículo agregado");
      setTab(created.quantity === 0 ? "inactivo" : created.quantity <= created.minQuantity ? "poco" : "disponible");
    } catch { toast.error("Error"); }
  }

  async function deleteItem(id: string) {
    if (!confirm("¿Eliminar este artículo?")) return;
    await fetch(`/api/inventory/${id}`, { method: "DELETE" });
    setItems(prev => prev.filter(i => i.id !== id));
    toast.success("Eliminado");
  }

  const currentTab = TABS.find(t => t.id === tab)!;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-extrabold">📦 Inventario</h1>
          <p className="text-sm text-muted-foreground">{items.length} artículos registrados</p>
        </div>
        <Button onClick={() => setShowAdd(true)} size="sm">
          <Plus className="w-4 h-4 mr-1.5" /> Agregar artículo
        </Button>
      </div>

      {/* Status tabs */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-xl border p-3 text-left transition-all ${tab === t.id ? `${t.bg} ${t.border}` : "bg-white dark:bg-slate-900 border-border hover:border-slate-400"}`}>
            <div className={`text-2xl font-extrabold leading-none mb-0.5 ${tab === t.id ? t.color : "text-foreground"}`}>
              {counts[t.id]}
            </div>
            <div className={`text-xs font-semibold ${tab === t.id ? t.color : "text-muted-foreground"}`}>{t.label}</div>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input className="flex h-10 w-full rounded-xl border border-border bg-white dark:bg-slate-900 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          placeholder={`Buscar en ${currentTab.label.toLowerCase()}…`}
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <div className="font-semibold text-sm">
            {tab === "inactivo" ? "Todos los artículos tienen stock registrado" :
             tab === "disponible" ? "No hay artículos con stock suficiente aún" :
             tab === "poco" ? "No hay artículos con stock bajo" :
             "No hay artículos sin stock"}
          </div>
        </div>
      )}

      {/* Items list */}
      <div className="bg-white dark:bg-slate-900 border border-border rounded-xl overflow-hidden shadow-card">
        {filtered.map((item, idx) => {
          const isLoad = loadingIds.has(item.id);
          const isEditing = editQty[item.id] !== undefined;
          const status = getStatus(item);
          return (
            <div key={item.id}
              className={`flex items-center gap-3 px-4 py-3 group transition-colors ${idx > 0 ? "border-t border-border/50" : ""} hover:bg-muted/10`}>
              <ItemImage category={item.category} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{item.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">{item.category}</span>
                  {item.description && <span className="text-xs text-muted-foreground truncate hidden sm:block">· {item.description}</span>}
                </div>
                {/* Alert threshold */}
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[10px] text-muted-foreground">Alerta si baja de:</span>
                  <input type="number" min="0"
                    className="w-10 h-4 text-[10px] border border-border rounded px-1 bg-transparent focus:outline-none focus:ring-1 focus:ring-brand-600/30"
                    defaultValue={item.minQuantity}
                    onBlur={e => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v) && v !== item.minQuantity) updateMinQty(item.id, v);
                    }} />
                  <span className="text-[10px] text-muted-foreground">{item.unit}</span>
                </div>
              </div>

              {/* Quantity section */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Direct input */}
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <input type="number" min="0" autoFocus
                      className="w-16 h-9 text-center text-sm font-bold border-2 border-brand-500 rounded-lg bg-white dark:bg-slate-800 focus:outline-none"
                      value={editQty[item.id]}
                      onChange={e => setEditQty(prev => ({ ...prev, [item.id]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === "Enter") setQuantityDirect(item.id, parseInt(editQty[item.id]));
                        if (e.key === "Escape") setEditQty(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                      }} />
                    <button onClick={() => setQuantityDirect(item.id, parseInt(editQty[item.id] || "0"))}
                      disabled={isLoad}
                      className="w-8 h-9 bg-brand-600 text-white rounded-lg flex items-center justify-center text-xs font-bold hover:bg-brand-700 transition-colors disabled:opacity-50">
                      ✓
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setEditQty(prev => ({ ...prev, [item.id]: String(item.quantity) }))}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-colors hover:border-brand-400 group/qty ${
                      status === "sin" ? "border-rose-300 bg-rose-50 dark:bg-rose-950/30" :
                      status === "poco" ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" :
                      status === "inactivo" ? "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" :
                      "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
                    }`}>
                    <span className={`text-lg font-extrabold leading-none ${
                      status === "sin" ? "text-rose-600" :
                      status === "poco" ? "text-amber-600" :
                      status === "inactivo" ? "text-slate-400" :
                      "text-emerald-600"
                    }`}>{item.quantity}</span>
                    <span className="text-[10px] text-muted-foreground">{item.unit}</span>
                    <Edit3 className="w-3 h-3 text-muted-foreground opacity-0 group-hover/qty:opacity-100 transition-opacity" />
                  </button>
                )}

                {/* +/- buttons */}
                <button disabled={isLoad || item.quantity === 0} onClick={() => changeQty(item.id, -1)}
                  className="w-9 h-9 rounded-xl bg-rose-500 hover:bg-rose-600 active:scale-95 text-white font-bold text-xl flex items-center justify-center transition-all disabled:opacity-30 shadow-sm">
                  −
                </button>
                <button disabled={isLoad} onClick={() => changeQty(item.id, 1)}
                  className="w-9 h-9 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-bold text-xl flex items-center justify-center transition-all disabled:opacity-50 shadow-sm">
                  +
                </button>
                <button onClick={() => deleteItem(item.id)}
                  className="w-7 h-7 rounded-lg text-muted-foreground hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-bold">Agregar artículo</h2>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Nombre *</Label>
                <input className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ej: Resina A2" value={newItem.name} onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Para qué sirve</Label>
                <textarea className="flex min-h-[55px] w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                  placeholder="Ej: Para restauraciones del sector anterior"
                  value={newItem.description} onChange={e => setNewItem(n => ({ ...n, description: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Categoría</Label>
                <select className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                  value={newItem.category} onChange={e => setNewItem(n => ({ ...n, category: e.target.value }))}>
                  {Object.keys(CATEGORY_ICONS).map(c => <option key={c}>{c}</option>)}
                  <option value="Otro">Otro</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Cantidad inicial</Label>
                  <input type="number" min="0"
                    className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                    value={newItem.quantity} onChange={e => setNewItem(n => ({ ...n, quantity: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Alerta si baja de</Label>
                  <input type="number" min="0"
                    className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                    value={newItem.minQuantity} onChange={e => setNewItem(n => ({ ...n, minQuantity: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Unidad</Label>
                  <select className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                    value={newItem.unit} onChange={e => setNewItem(n => ({ ...n, unit: e.target.value }))}>
                    {["pza","cja","frasco","rollo","par","paquete","kit","ml","mg","uni"].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1">Cancelar</Button>
              <Button onClick={addItem} className="flex-1">✅ Agregar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
