"use client";

import { useState, useMemo } from "react";
import { Plus, Search, AlertTriangle, Package, ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

// Default dental inventory
const DEFAULT_ITEMS: { name: string; category: string; emoji: string; description: string }[] = [
  // Instrumental básico
  { name:"Espejo dental",         category:"Instrumental básico", emoji:"🔍", description:"Para visualizar áreas de difícil acceso en la boca" },
  { name:"Explorador",            category:"Instrumental básico", emoji:"🔬", description:"Detecta caries y anomalías en el esmalte" },
  { name:"Pinza algodonera",      category:"Instrumental básico", emoji:"🥢", description:"Para colocar y retirar rollos de algodón" },
  { name:"Sonda periodontal",     category:"Instrumental básico", emoji:"📏", description:"Mide la profundidad de bolsas periodontales" },
  { name:"Excavador",             category:"Instrumental básico", emoji:"🪛", description:"Elimina tejido cariado y material blando" },
  { name:"Curetas",               category:"Instrumental básico", emoji:"🔧", description:"Raspado y alisado radicular" },
  { name:"Elevadores",            category:"Instrumental básico", emoji:"⬆️", description:"Para luxar piezas dentales antes de extracción" },
  { name:"Fórceps de extracción", category:"Instrumental básico", emoji:"🦷", description:"Extracción de piezas dentales" },
  { name:"Porta agujas",          category:"Instrumental básico", emoji:"🧵", description:"Para suturar tejidos" },
  { name:"Tijeras quirúrgicas",   category:"Instrumental básico", emoji:"✂️", description:"Corte de suturas y tejidos blandos" },
  { name:"Separadores",           category:"Instrumental básico", emoji:"↔️", description:"Separar tejidos blandos durante procedimientos" },
  { name:"Retractores",           category:"Instrumental básico", emoji:"↩️", description:"Retracción de labios y mejillas" },
  { name:"Espátulas para cemento",category:"Instrumental básico", emoji:"🥄", description:"Mezcla y aplicación de cementos dentales" },
  { name:"Jeringa carpule",       category:"Instrumental básico", emoji:"💉", description:"Aplicación de anestesia local" },
  { name:"Limas endodónticas",    category:"Instrumental básico", emoji:"📎", description:"Limpieza y conformación de conductos radiculares" },
  { name:"Localizador de ápice",  category:"Instrumental básico", emoji:"📡", description:"Determina la longitud del conducto radicular" },
  // Fresas
  { name:"Fresa redonda de carburo",  category:"Fresas dentales", emoji:"⚙️", description:"Remoción de tejido cariado" },
  { name:"Fresa redonda diamantada",  category:"Fresas dentales", emoji:"💎", description:"Desgaste de estructuras dentales duras" },
  { name:"Fresa pera",                category:"Fresas dentales", emoji:"🍐", description:"Preparación de cavidades clase I y II" },
  { name:"Fresa cilíndrica",          category:"Fresas dentales", emoji:"🔩", description:"Preparación de paredes paralelas" },
  { name:"Fresa troncocónica",        category:"Fresas dentales", emoji:"🔺", description:"Preparación de cavidades en boca" },
  { name:"Fresa de fisura recta",     category:"Fresas dentales", emoji:"➡️", description:"Corte de esmalte y dentina" },
  { name:"Fresa de fisura cruzada",   category:"Fresas dentales", emoji:"❌", description:"Retención en preparaciones cavitarias" },
  { name:"Fresa llama",               category:"Fresas dentales", emoji:"🔥", description:"Acabado de márgenes en coronas" },
  { name:"Fresa cono invertido",      category:"Fresas dentales", emoji:"🔻", description:"Preparación de cajas proximales" },
  { name:"Fresa de acabado",          category:"Fresas dentales", emoji:"✨", description:"Alisado superficial de restauraciones" },
  { name:"Fresa de pulido",           category:"Fresas dentales", emoji:"🪞", description:"Pulido final de resinas y acrílicos" },
  { name:"Fresa para zirconia",       category:"Fresas dentales", emoji:"💠", description:"Desgaste de coronas de zirconia" },
  { name:"Fresa para metal",          category:"Fresas dentales", emoji:"⚒️", description:"Ajuste de restauraciones metálicas" },
  { name:"Fresa para resina",         category:"Fresas dentales", emoji:"🔵", description:"Acabado de restauraciones en resina" },
  { name:"Fresa para acrílico",       category:"Fresas dentales", emoji:"🟣", description:"Ajuste de prótesis acrílicas" },
  { name:"Fresa quirúrgica larga",    category:"Fresas dentales", emoji:"📌", description:"Cirugías de implantes y extracciones complejas" },
  { name:"Fresa Gates",               category:"Fresas dentales", emoji:"🚪", description:"Apertura cameral en endodoncia" },
  { name:"Fresa Peeso",               category:"Fresas dentales", emoji:"🔑", description:"Desgaste intracanal para postes" },
  { name:"Fresa multilaminada",       category:"Fresas dentales", emoji:"📋", description:"Acabado y alisado de metal y resina" },
  // Materiales
  { name:"Resina compuesta A1",   category:"Materiales de restauración", emoji:"🧴", description:"Color A1 para restauraciones anteriores" },
  { name:"Resina compuesta A2",   category:"Materiales de restauración", emoji:"🧴", description:"Color A2 estándar más utilizado" },
  { name:"Resina compuesta A3",   category:"Materiales de restauración", emoji:"🧴", description:"Color A3 para dientes más oscuros" },
  { name:"Resina compuesta B2",   category:"Materiales de restauración", emoji:"🧴", description:"Color B2 para tonos amarillentos" },
  { name:"Ionómero de vidrio",    category:"Materiales de restauración", emoji:"🔶", description:"Restauraciones temporales y cementación" },
  { name:"Cemento temporal",      category:"Materiales de restauración", emoji:"🪨", description:"Cementación provisional de coronas" },
  { name:"Cemento definitivo",    category:"Materiales de restauración", emoji:"🏗️", description:"Cementación permanente de restauraciones" },
  { name:"Cemento para brackets", category:"Materiales de restauración", emoji:"📎", description:"Adhesión de brackets al esmalte" },
  { name:"Selladores",            category:"Materiales de restauración", emoji:"🔐", description:"Prevención de caries en fosas y fisuras" },
  { name:"Adhesivo dental",       category:"Materiales de restauración", emoji:"🔗", description:"Unión de resina a estructura dental" },
  { name:"Ácido grabador",        category:"Materiales de restauración", emoji:"⚗️", description:"Acondicionamiento del esmalte antes de restaurar" },
  { name:"Composite fluido",      category:"Materiales de restauración", emoji:"💧", description:"Restauraciones de baja tensión y sellado" },
  { name:"Composite bulk fill",   category:"Materiales de restauración", emoji:"📦", description:"Relleno en masa para cavidades profundas" },
  { name:"Acrílico autocurable",  category:"Materiales de restauración", emoji:"🧪", description:"Provisionales y reparaciones de prótesis" },
  // Ortodoncia
  { name:"Brackets metálicos",   category:"Ortodoncia", emoji:"📐", description:"Brackets de acero inoxidable estándar" },
  { name:"Brackets cerámicos",   category:"Ortodoncia", emoji:"🤍", description:"Brackets estéticos color diente" },
  { name:"Brackets autoligables",category:"Ortodoncia", emoji:"🔒", description:"Sin necesidad de ligaduras, menor fricción" },
  { name:"Tubos molares",        category:"Ortodoncia", emoji:"🔲", description:"Para molares en tratamiento de ortodoncia" },
  { name:"Arcos NiTi",           category:"Ortodoncia", emoji:"〰️", description:"Arcos de níquel titanio, fase inicial" },
  { name:"Arcos acero",          category:"Ortodoncia", emoji:"➖", description:"Arcos de acero para fase de detallado" },
  { name:"Ligaduras metálicas",  category:"Ortodoncia", emoji:"🔗", description:"Sujeción de arco al bracket" },
  { name:"Ligaduras elásticas",  category:"Ortodoncia", emoji:"🔴", description:"Ligaduras de colores para brackets" },
  { name:"Cadenas elásticas",    category:"Ortodoncia", emoji:"⛓️", description:"Cierre de espacios en ortodoncia" },
  { name:"Microtornillos",       category:"Ortodoncia", emoji:"🔩", description:"Anclaje óseo temporal para movimientos complejos" },
  { name:"Cera ortodóntica",     category:"Ortodoncia", emoji:"🕯️", description:"Protección de mucosa ante irritación por brackets" },
  // Endodoncia
  { name:"Limas manuales",      category:"Endodoncia", emoji:"📎", description:"Instrumentación manual de conductos" },
  { name:"Limas rotatorias",    category:"Endodoncia", emoji:"🔄", description:"Instrumentación mecanizada de conductos" },
  { name:"Conos de gutapercha", category:"Endodoncia", emoji:"🔴", description:"Obturación de conductos radiculares" },
  { name:"Sellador endodóntico",category:"Endodoncia", emoji:"🛡️", description:"Sello hermético del sistema de conductos" },
  { name:"Hipoclorito",         category:"Endodoncia", emoji:"🧼", description:"Irrigación y desinfección de conductos" },
  { name:"EDTA",                category:"Endodoncia", emoji:"⚗️", description:"Quelación para remoción de barro dentinario" },
  { name:"Clorhexidina",        category:"Endodoncia", emoji:"💊", description:"Desinfectante endodóntico" },
  { name:"Puntas de papel",     category:"Endodoncia", emoji:"📄", description:"Secado de conductos radiculares" },
  { name:"Motor endodóntico",   category:"Endodoncia", emoji:"⚙️", description:"Accionamiento de limas rotatorias" },
  // Cirugía
  { name:"Suturas absorbibles",     category:"Cirugía e implantes", emoji:"🧵", description:"Para tejidos internos, se reabsorben solas" },
  { name:"Suturas no absorbibles",  category:"Cirugía e implantes", emoji:"🪡", description:"Para tejidos externos, se retiran a los 7 días" },
  { name:"Implantes dentales",      category:"Cirugía e implantes", emoji:"🦷", description:"Titanio para rehabilitación de piezas perdidas" },
  { name:"Tornillos de cicatrización",category:"Cirugía e implantes",emoji:"🔩", description:"Cierre de implante durante osteointegración" },
  { name:"Membranas",               category:"Cirugía e implantes", emoji:"🫧", description:"Regeneración ósea guiada" },
  { name:"Injerto óseo",            category:"Cirugía e implantes", emoji:"🦴", description:"Relleno de defectos óseos" },
  { name:"Kit de implantes",        category:"Cirugía e implantes", emoji:"🧰", description:"Instrumental quirúrgico para colocación de implantes" },
  // Consumibles
  { name:"Guantes",                    category:"Consumibles", emoji:"🧤", description:"Protección para el profesional y el paciente" },
  { name:"Cubrebocas",                 category:"Consumibles", emoji:"😷", description:"Barrera contra aerosoles y salpicaduras" },
  { name:"Gasas",                      category:"Consumibles", emoji:"🩹", description:"Control de sangrado y limpieza del campo" },
  { name:"Algodón",                    category:"Consumibles", emoji:"☁️", description:"Aislamiento y limpieza" },
  { name:"Rollos de algodón",          category:"Consumibles", emoji:"🌀", description:"Aislamiento de cuadrantes" },
  { name:"Baberos",                    category:"Consumibles", emoji:"🧣", description:"Protección de ropa del paciente" },
  { name:"Vasos desechables",          category:"Consumibles", emoji:"🥤", description:"Para enjuagues del paciente" },
  { name:"Jeringas",                   category:"Consumibles", emoji:"💉", description:"Administración de medicamentos e irrigación" },
  { name:"Agujas cortas",              category:"Consumibles", emoji:"📌", description:"Anestesia infiltrativa en paladar" },
  { name:"Agujas largas",              category:"Consumibles", emoji:"📍", description:"Bloqueos mandibulares" },
  { name:"Bolsas de esterilización",   category:"Consumibles", emoji:"🫙", description:"Empaque de instrumental para autoclave" },
  { name:"Indicadores de esterilización",category:"Consumibles",emoji:"✅", description:"Verifican el correcto proceso de esterilización" },
];

const CATEGORY_ICONS: Record<string, string> = {
  "Instrumental básico":        "🔧",
  "Fresas dentales":            "⚙️",
  "Materiales de restauración": "🧴",
  "Ortodoncia":                 "📐",
  "Endodoncia":                 "🔬",
  "Cirugía e implantes":        "🏥",
  "Consumibles":                "📦",
};

interface Item {
  id: string;
  name: string;
  description: string | null;
  category: string;
  emoji: string;
  quantity: number;
  minQuantity: number;
  unit: string;
  price: number | null;
}

interface Props { initialItems: Item[]; specialty: string }

export function InventoryClient({ initialItems, specialty }: Props) {
  const [items,       setItems]       = useState<Item[]>(initialItems);
  const [search,      setSearch]      = useState("");
  const [collapsed,   setCollapsed]   = useState<Record<string, boolean>>({});
  const [showAdd,     setShowAdd]     = useState(false);
  const [loadingIds,  setLoadingIds]  = useState<Set<string>>(new Set());
  const [seeding,     setSeeding]     = useState(false);
  const [newItem,     setNewItem]     = useState({ name:"", description:"", category:"Instrumental básico", emoji:"📦", quantity:0, minQuantity:5, unit:"pza", price:"" });

  const filtered = useMemo(() => {
    if (!search) return items;
    return items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || i.category.toLowerCase().includes(search.toLowerCase()));
  }, [items, search]);

  const byCategory = useMemo(() => {
    const map: Record<string, Item[]> = {};
    for (const item of filtered) {
      if (!map[item.category]) map[item.category] = [];
      map[item.category].push(item);
    }
    return map;
  }, [filtered]);

  const lowStock = items.filter(i => i.quantity <= i.minQuantity && i.quantity > 0);
  const outStock  = items.filter(i => i.quantity === 0);

  async function changeQty(id: string, delta: number) {
    setLoadingIds(s => new Set(s).add(id));
    try {
      const res = await fetch(`/api/inventory/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change: delta }),
      });
      const updated = await res.json();
      setItems(prev => prev.map(i => i.id === id ? { ...i, quantity: updated.quantity } : i));
    } catch { toast.error("Error al actualizar"); } finally {
      setLoadingIds(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  async function addItem() {
    if (!newItem.name) { toast.error("El nombre es requerido"); return; }
    try {
      const res = await fetch("/api/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newItem, price: newItem.price ? parseFloat(newItem.price) : null }),
      });
      const created = await res.json();
      setItems(prev => [...prev, created]);
      setShowAdd(false);
      setNewItem({ name:"", description:"", category:"Instrumental básico", emoji:"📦", quantity:0, minQuantity:5, unit:"pza", price:"" });
      toast.success("Artículo agregado");
    } catch { toast.error("Error al agregar"); }
  }

  async function seedInventory() {
    if (!confirm(`¿Cargar el inventario predeterminado de odontología? (${DEFAULT_ITEMS.length} artículos)\n\nSolo se agregarán artículos que no existan.`)) return;
    setSeeding(true);
    let added = 0;
    for (const item of DEFAULT_ITEMS) {
      const exists = items.some(i => i.name === item.name);
      if (exists) continue;
      try {
        const res = await fetch("/api/inventory", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...item, quantity: 0, minQuantity: 5, unit: "pza" }),
        });
        const created = await res.json();
        setItems(prev => [...prev, created]);
        added++;
      } catch {}
    }
    setSeeding(false);
    toast.success(`✅ ${added} artículos cargados`);
  }

  async function deleteItem(id: string) {
    if (!confirm("¿Eliminar este artículo?")) return;
    await fetch(`/api/inventory/${id}`, { method: "DELETE" });
    setItems(prev => prev.filter(i => i.id !== id));
    toast.success("Artículo eliminado");
  }

  const categories = Object.keys(CATEGORY_ICONS);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold">📦 Inventario</h1>
          <p className="text-sm text-muted-foreground">{items.length} artículos registrados</p>
        </div>
        <div className="flex gap-2">
          {items.length === 0 && specialty === "Odontología" && (
            <Button variant="outline" onClick={seedInventory} disabled={seeding} size="sm">
              {seeding ? "Cargando…" : "⚡ Cargar inventario dental"}
            </Button>
          )}
          <Button onClick={() => setShowAdd(true)} size="sm">
            <Plus className="w-4 h-4 mr-1.5" /> Agregar artículo
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {(lowStock.length > 0 || outStock.length > 0) && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          {outStock.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0" />
              <div>
                <div className="text-xs font-bold text-rose-700">{outStock.length} artículo{outStock.length > 1 ? "s" : ""} sin stock</div>
                <div className="text-xs text-rose-500 truncate">{outStock.slice(0,2).map(i=>i.name).join(", ")}{outStock.length > 2 ? "…" : ""}</div>
              </div>
            </div>
          )}
          {lowStock.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <div>
                <div className="text-xs font-bold text-amber-700">{lowStock.length} artículo{lowStock.length > 1 ? "s" : ""} con stock bajo</div>
                <div className="text-xs text-amber-500 truncate">{lowStock.slice(0,2).map(i=>i.name).join(", ")}{lowStock.length > 2 ? "…" : ""}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input className="flex h-10 w-full rounded-xl border border-border bg-white pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          placeholder="Buscar artículo o categoría…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <div className="font-semibold mb-1">Sin artículos en inventario</div>
          <p className="text-sm mb-4">Agrega artículos manualmente o carga el inventario predeterminado.</p>
          {specialty === "Odontología" && (
            <Button variant="outline" onClick={seedInventory} disabled={seeding}>
              {seeding ? "Cargando…" : "⚡ Cargar inventario dental"}
            </Button>
          )}
        </div>
      )}

      {/* Categories */}
      <div className="space-y-3">
        {Object.entries(byCategory).map(([cat, catItems]) => {
          const icon = CATEGORY_ICONS[cat] ?? "📦";
          const isCollapsed = collapsed[cat];
          const catLow = catItems.filter(i => i.quantity <= i.minQuantity).length;
          return (
            <div key={cat} className="bg-white border border-border rounded-xl overflow-hidden shadow-card">
              <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                onClick={() => setCollapsed(c => ({ ...c, [cat]: !c[cat] }))}>
                <span className="text-lg">{icon}</span>
                <span className="font-bold text-sm flex-1 text-left">{cat}</span>
                <span className="text-xs text-muted-foreground">{catItems.length} artículos</span>
                {catLow > 0 && <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">{catLow} bajo stock</span>}
                {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
              </button>

              {!isCollapsed && (
                <div className="border-t border-border divide-y divide-border/60">
                  {catItems.map(item => {
                    const isLow  = item.quantity <= item.minQuantity && item.quantity > 0;
                    const isOut  = item.quantity === 0;
                    const isLoad = loadingIds.has(item.id);
                    return (
                      <div key={item.id} className={`flex items-center gap-3 px-4 py-3 group ${isOut ? "bg-rose-50/50" : isLow ? "bg-amber-50/50" : ""}`}>
                        <span className="text-xl w-8 text-center flex-shrink-0">{item.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{item.name}</div>
                          {item.description && <div className="text-xs text-muted-foreground truncate">{item.description}</div>}
                        </div>
                        {/* Stock badge */}
                        <div className="flex-shrink-0 text-center w-16">
                          <div className={`text-lg font-extrabold ${isOut ? "text-rose-600" : isLow ? "text-amber-600" : "text-foreground"}`}>
                            {item.quantity}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{item.unit}</div>
                        </div>
                        {/* +/- buttons */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button disabled={isLoad}
                            onClick={() => changeQty(item.id, -1)}
                            className="w-8 h-8 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-bold text-lg flex items-center justify-center transition-colors disabled:opacity-50">
                            −
                          </button>
                          <button disabled={isLoad}
                            onClick={() => changeQty(item.id, 1)}
                            className="w-8 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-lg flex items-center justify-center transition-colors disabled:opacity-50">
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
              )}
            </div>
          );
        })}
      </div>

      {/* Add Item Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-bold">Agregar artículo</h2>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Emoji</Label>
                  <input className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-xl text-center focus:outline-none"
                    value={newItem.emoji} onChange={e => setNewItem(n => ({ ...n, emoji: e.target.value }))} maxLength={2} />
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Nombre del artículo *</Label>
                  <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder="Ej: Resina A2" value={newItem.name} onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Descripción (para qué sirve)</Label>
                <textarea className="flex min-h-[60px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                  placeholder="Ej: Para restauraciones del sector anterior, color más utilizado"
                  value={newItem.description} onChange={e => setNewItem(n => ({ ...n, description: e.target.value }))} />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Categoría</Label>
                <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                  value={newItem.category} onChange={e => setNewItem(n => ({ ...n, category: e.target.value }))}>
                  {categories.map(c => <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>)}
                  <option value="Otro">📦 Otro</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Cantidad inicial</Label>
                  <input type="number" min="0"
                    className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                    value={newItem.quantity} onChange={e => setNewItem(n => ({ ...n, quantity: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Alerta mínima</Label>
                  <input type="number" min="0"
                    className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                    value={newItem.minQuantity} onChange={e => setNewItem(n => ({ ...n, minQuantity: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Unidad</Label>
                  <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                    value={newItem.unit} onChange={e => setNewItem(n => ({ ...n, unit: e.target.value }))}>
                    {["pza","cja","frasco","rollo","par","paquete","kit","ml","mg","uni"].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Precio unitario (opcional)</Label>
                <input type="number" min="0" step="0.01"
                  className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                  placeholder="0.00" value={newItem.price} onChange={e => setNewItem(n => ({ ...n, price: e.target.value }))} />
              </div>
            </div>
            <div className="px-5 pb-4 flex gap-2">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1">Cancelar</Button>
              <Button onClick={addItem} className="flex-1">✅ Agregar artículo</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
