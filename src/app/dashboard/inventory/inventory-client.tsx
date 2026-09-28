"use client";

import { useState, useMemo, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Plus, Search, Package, X, Trash2, Minus, Check,
  AlertTriangle, PackageX, PackageOpen, SearchX, Banknote,
  Wrench, Cog, FlaskConical, Ruler, Microscope, Syringe,
  CalendarClock,
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
// REDISEÑO DE INVENTARIO — la raíz que trae Instrument Sans y los tokens
// `--inv-*`. Solo se monta con el interruptor `menu-dos-niveles` encendido
// para la clínica; apagado, ni una clase de más.
import { CLASES_REDISENO_INVENTARIO } from "@/components/dashboard/inventario-rediseno/raiz";
import invStyles from "@/components/dashboard/inventario-rediseno/inventario-rediseno.module.css";
// DISEÑO (ws1-t5) — la maqueta de la pantalla y de sus ventanas: tabla que
// cabe, fichas en teléfono, caducidad sin saltos. Solo lee tokens del panel.
import inv from "@/components/dashboard/cobros-inventario-rediseno/inventario.module.css";
import { ropaVentana } from "@/components/dashboard/cobros-inventario-rediseno/ventana";
// WS1-T5 — lotes y caducidad: modal propio y aislado, ver el archivo.
import { LotesModal } from "@/components/dashboard/inventory/lotes-modal";
// ws1-t4 — "Registrar compra": modal propio y aislado, mismo criterio.
import { CompraModal, type ResultadoCompra } from "@/components/dashboard/inventory/compra-modal";
// ws1-t4 (ajuste 1) — "Historial de compras": modal propio y aislado, mismo criterio.
import { HistorialComprasModal } from "@/components/dashboard/inventory/historial-compras-modal";

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
  /** ws1-t4 — costo unitario. Nunca null (0 = "no cuesta nada"). */
  unitCost: number;
  /** ws1-t4 — proveedor propio de la clínica, opcional. */
  providerId: string | null;
}

/** ws1-t4 — proveedor propio de la clínica (no el Supplier del marketplace). */
interface Proveedor {
  id: string;
  name: string;
  rfc: string | null;
  contact: string | null;
}

// WS1-T5 (ajuste 3) — "por_caducar"/"caducado" son tabs de LOTE, no de
// existencias: no los calcula getStatus(item), vienen de /api/inventory/alerts.
type StatusTab = "todos" | "disponible" | "poco" | "sin" | "por_caducar" | "caducado";

const STATUS_FILTERS: { id: StatusTab; labelKey?: string; label?: string }[] = [
  { id: "todos",      labelKey: "common.all" },
  { id: "disponible", labelKey: "procurement.inventoryClient.filterAvailable" },
  { id: "poco",       labelKey: "procurement.inventoryClient.filterLowStock" },
  { id: "sin",        labelKey: "procurement.inventoryClient.filterOutOfStock" },
];

/** Un lote con problema de caducidad, tal como lo entrega GET /api/inventory/alerts. */
interface AvisoLote {
  lotId: string;
  itemId: string;
  itemName: string;
  unit: string;
  lotNumber: string | null;
  expiresAt: string;
  remaining: number;
}

function getStatus(item: Item): StatusTab {
  if (item.quantity === 0) return "sin";
  if (item.quantity <= item.minQuantity) return "poco";
  return "disponible";
}

function statusBadge(s: StatusTab, t: TFunction) {
  if (s === "sin") {
    return (
      <span className={`${inv.pildora} ${inv.pildoraPeligro}`}>
        <PackageX size={13} strokeWidth={1.75} aria-hidden />
        {t("procurement.inventoryClient.badgeOut")}
      </span>
    );
  }
  if (s === "poco") {
    return (
      <span className={`${inv.pildora} ${inv.pildoraAlerta}`}>
        <AlertTriangle size={13} strokeWidth={1.75} aria-hidden />
        {t("procurement.inventoryClient.badgeLow")}
      </span>
    );
  }
  return (
    <span className={`${inv.pildora} ${inv.pildoraExito}`}>
      <span aria-hidden className={inv.pildoraPunto} />
      {t("procurement.inventoryClient.badgeOk")}
    </span>
  );
}

const TONO_CANTIDAD: Record<string, string> = {
  sin: inv.tonoPeligro,
  poco: inv.tonoAlerta,
  disponible: inv.tonoExito,
};

/**
 * Un renglón de la tarjeta «Caducidad». Siempre se pinta, con o sin lotes:
 * mientras los avisos no llegan enseña una raya, y con cero no es un botón.
 * Así la tarjeta mide lo mismo antes y después, y la pantalla no salta.
 */
function LineaCaducidad({
  cuantos, listo, singular, plural, tono, onVer,
}: {
  cuantos: number;
  listo: boolean;
  singular: string;
  plural: string;
  tono: string;
  onVer: () => void;
}) {
  const rotulo = cuantos === 1 ? singular : plural;
  if (!listo || cuantos === 0) {
    return (
      <span className={inv.caducidadLinea}>
        <strong>{listo ? 0 : "—"}</strong> {rotulo}
      </span>
    );
  }
  return (
    <button type="button" className={`${inv.caducidadLinea} ${tono}`} onClick={onVer} title={`Ver ${rotulo}`}>
      <strong>{cuantos}</strong> {rotulo}
    </button>
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
      <div className={inv.iconos}>
        {DENTAL_ICONS.map(icon => (
          <button
            key={icon.id}
            type="button"
            onClick={() => onSelect(icon.id)}
            title={t(icon.labelKey)}
            aria-pressed={selected === icon.id}
            className={`${inv.iconoOpcion} ${selected === icon.id ? inv.iconoOpcionActiva : ""}`}
          >
            <img src={icon.src} alt={t(icon.labelKey)}
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function InventoryClient({
  initialItems,
  rediseno = false,
}: {
  initialItems: Item[];
  specialty?: string;
  /**
   * ¿La clínica tiene encendido el diseño nuevo? Es el MISMO interruptor del
   * menú de dos niveles (`clinic_feature_flags` → `menu-dos-niveles`). En
   * false la pantalla se pinta exactamente como hoy: las clases del
   * rediseño no se ponen y ninguna regla nueva llega a aplicarse.
   */
  rediseno?: boolean;
}) {
  const t = useT();
  const askConfirm = useConfirm();
  const [items, setItems]       = useState<Item[]>(initialItems);
  const [tab, setTab]           = useState<StatusTab>("todos");
  const [search, setSearch]     = useState("");
  const [showAdd, setShowAdd]   = useState(false);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [editQty, setEditQty]   = useState<Record<string, string>>({});
  // WS1-T5 — lotes y caducidad.
  const [lotesItem, setLotesItem] = useState<Item | null>(null);
  // WS1-T5 (ajuste 3) — avisos de caducidad: la API ya los calculaba
  // (buildAlerts en /api/dashboard/home/admin) pero ninguna pantalla los
  // pedía ni los mostraba (REPORTE-ws1-t2.md, punto 3c).
  const [avisos, setAvisos] = useState<{ porCaducar: AvisoLote[]; caducado: AvisoLote[] }>({ porCaducar: [], caducado: [] });
  // Diseño (ws1-t5): ¿ya contestó la petición de avisos? Solo decide si la
  // tarjeta «Caducidad» enseña «—» o un número; no cambia qué se pide ni cuándo.
  const [avisosListos, setAvisosListos] = useState(false);
  // ws1-t4 — "Registrar compra".
  const [showCompra, setShowCompra] = useState(false);
  // ws1-t4 (ajuste 1) — "Historial de compras".
  const [showHistorial, setShowHistorial] = useState(false);
  const [newItem, setNewItem] = useState({
    name: "", description: "", category: "Instrumental básico",
    customCategory: "", quantity: 0, minQuantity: 5, unit: "pza", iconId: "fresa-jeringa",
    unitCost: 0, providerId: "",
  });
  // ws1-t4: proveedores propios — se cargan una vez y se reutilizan en el
  // alta de artículo y en "Registrar compra".
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [showNuevoProveedor, setShowNuevoProveedor] = useState(false);
  const [nuevoProveedor, setNuevoProveedor] = useState({ name: "", rfc: "", contact: "" });

  useEffect(() => {
    fetch("/api/inventory/providers")
      .then(r => r.ok ? r.json() : [])
      .then(setProveedores)
      .catch(() => {});
  }, []);

  // WS1-T5 (ajuste 3) — avisos de caducidad, mismo patrón que proveedores
  // arriba: se piden una vez al cargar. Silencioso si el SQL de lotes aún
  // no está aplicado (la API ya responde listas vacías en ese caso).
  useEffect(() => {
    fetch("/api/inventory/alerts")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setAvisos({ porCaducar: d.porCaducar ?? [], caducado: d.caducado ?? [] }); })
      .catch(() => {})
      .finally(() => setAvisosListos(true));
  }, []);

  // WS1-T5 (ajuste 3) — el aviso de Hoy enlaza aquí con ?filter=low,
  // ?filter=por-caducar o ?filter=caducado. Antes ninguno hacía nada
  // (REPORTE-ws1-t8.md y ws1-t2.md, 3c): se lee UNA vez al montar, con
  // URLSearchParams directo (sin useSearchParams, para no exigir un
  // <Suspense> nuevo en esta pantalla).
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("filter");
    if (f === "low") setTab("poco");
    else if (f === "por-caducar") setTab("por_caducar");
    else if (f === "caducado") setTab("caducado");
  }, []);

  async function crearProveedorRapido() {
    if (!nuevoProveedor.name.trim()) { toast.error(t("procurement.inventoryClient.providerNameRequired")); return; }
    try {
      const res = await fetch("/api/inventory/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuevoProveedor),
      });
      if (!res.ok) { toast.error((await res.json().catch(() => null))?.error ?? t("common.genericError")); return; }
      const creado: Proveedor = await res.json();
      setProveedores(prev => [...prev, creado].sort((a, b) => a.name.localeCompare(b.name)));
      setNewItem(n => ({ ...n, providerId: creado.id }));
      setShowNuevoProveedor(false);
      setNuevoProveedor({ name: "", rfc: "", contact: "" });
    } catch { toast.error(t("common.genericError")); }
  }

  const kpis = useMemo(() => {
    const totalQty    = items.reduce((s, i) => s + i.quantity, 0);
    const lowCount    = items.filter(i => i.quantity > 0 && i.quantity <= i.minQuantity).length;
    const outCount    = items.filter(i => i.quantity === 0).length;
    // ws1-t4: antes era Σ (price ?? 0) × quantity — price nunca se capturaba
    // y el total siempre daba $0. unitCost sí se captura (alta, edición, y
    // la compra lo actualiza al último costo).
    const totalValue  = items.reduce((s, i) => s + i.unitCost * i.quantity, 0);
    return { total: items.length, totalQty, lowCount, outCount, totalValue };
  }, [items]);

  // WS1-T5 (ajuste 3) — de qué artículos hablan los avisos de caducidad,
  // para los tabs "Por caducar"/"Caducado" (no son estado de existencias).
  const porCaducarIds = useMemo(() => new Set(avisos.porCaducar.map(a => a.itemId)), [avisos.porCaducar]);
  const caducadoIds   = useMemo(() => new Set(avisos.caducado.map(a => a.itemId)), [avisos.caducado]);

  const filtered = useMemo(() => {
    return items
      .filter(i => {
        if (tab === "todos") return true;
        if (tab === "por_caducar") return porCaducarIds.has(i.id);
        if (tab === "caducado") return caducadoIds.has(i.id);
        return getStatus(i) === tab;
      })
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
  }, [items, tab, search, porCaducarIds, caducadoIds]);

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

  // ws1-t4: costo unitario editable en la misma tabla (mismo patrón que
  // updateMinQty — blur guarda). 0 es válido: no se filtra por truthy.
  async function updateUnitCost(id: string, cost: number) {
    const res = await fetch(`/api/inventory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitCost: cost }),
    });
    if (!res.ok) { toast.error(t("common.genericError")); return; }
    setItems(prev => prev.map(i => i.id === id ? { ...i, unitCost: cost } : i));
  }

  // Ajuste 1 — proveedor editable en la misma tabla, un artículo ya creado
  // no tenía forma de cambiar de proveedor sin esto.
  async function updateProvider(id: string, providerId: string) {
    const res = await fetch(`/api/inventory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: providerId || null }),
    });
    if (!res.ok) { toast.error(t("common.genericError")); return; }
    setItems(prev => prev.map(i => i.id === id ? { ...i, providerId: providerId || null } : i));
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
          unitCost: newItem.unitCost,
          providerId: newItem.providerId || null,
        }),
      });
      const created = await res.json();
      setItems(prev => [...prev, created]);
      setShowAdd(false);
      setNewItem({ name:"", description:"", category:"Instrumental básico", customCategory:"", quantity:0, minQuantity:5, unit:"pza", iconId:"fresa-jeringa", unitCost:0, providerId:"" });
      toast.success(t("procurement.inventoryClient.itemAdded"));
      setTab(getStatus(created));
    } catch { toast.error(t("common.genericError")); }
  }

  // ws1-t4: aplica localmente lo que la transacción del servidor ya hizo
  // (existencias + costo). Sin refetch — la respuesta trae los valores
  // finales de cada artículo tocado.
  function aplicarResultadoCompra(r: ResultadoCompra) {
    setItems(prev => prev.map(i => {
      const actualizado = r.items.find(u => u.itemId === i.id);
      return actualizado ? { ...i, quantity: actualizado.quantity, unitCost: actualizado.unitCost } : i;
    }));
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

  // Diseño (ws1-t5): la ropa de las ventanas y los textos del estado vacío.
  const ropa = ropaVentana(rediseno);
  const hayBusqueda = search.trim() !== "";

  return (
    <div
      className={[inv.pagina, rediseno ? `${CLASES_REDISENO_INVENTARIO} ${invStyles.pageRediseno}` : ""].filter(Boolean).join(" ")}
    >
      {/* Cabecera. En teléfono «Nuevo artículo» va arriba y a lo ancho, y las
          otras dos acciones se reparten el renglón de debajo (antes la barra
          medía 471 px fijos y desbordaba la página a 390). */}
      <div className={inv.cabecera}>
        <div>
          <h1 className={inv.titulo}>{t("procurement.inventoryClient.title")}</h1>
          <p className={inv.subtitulo}>
            {t("procurement.inventoryClient.subtitle", { items: items.length, units: kpis.totalQty.toLocaleString("es-MX") })}
          </p>
        </div>
        <div className={inv.acciones}>
          <ButtonNew variant="ghost" onClick={() => setShowHistorial(true)}>
            Historial de compras
          </ButtonNew>
          <ButtonNew variant="secondary" onClick={() => setShowCompra(true)}>
            {t("procurement.inventoryClient.registerPurchase")}
          </ButtonNew>
          <ButtonNew variant="primary" icon={<Plus size={16} strokeWidth={1.75} aria-hidden />} onClick={() => setShowAdd(true)}>
            {t("procurement.inventoryClient.newItem")}
          </ButtonNew>
        </div>
      </div>

      {/* Indicadores. WS1-T5 (ajuste 3) trajo los avisos de caducidad como una
          banda encima de esto; llegaba unos segundos después que el resto y
          empujaba toda la pantalla hacia abajo. Ahora es una tarjeta más, que
          está siempre (con «—» mientras llegan): mismo aviso, mismo filtro al
          pulsarlo, y nada salta. */}
      <div className={inv.kpis}>
        <KpiCard label={t("procurement.inventoryClient.kpiTotalItems")} value={String(items.length)}       icon={Package} hero />
        <KpiCard label={t("procurement.inventoryClient.kpiLowStock")}      value={String(kpis.lowCount)}      icon={AlertTriangle} />
        <KpiCard label={t("procurement.inventoryClient.kpiOutOfStock")}        value={String(kpis.outCount)}      icon={PackageX} />
        <KpiCard label={t("procurement.inventoryClient.kpiTotalValue")}     value={fmtMXN(kpis.totalValue)}    icon={Banknote} />
        <div className={`kpi ${inv.caducidad}`}>
          <div className="kpi__top">
            <span className="kpi__label">Caducidad</span>
            <div className="kpi__icon">
              <CalendarClock size={17} strokeWidth={1.75} aria-hidden />
            </div>
          </div>
          <div className={inv.caducidadLineas}>
            <LineaCaducidad
              cuantos={avisos.caducado.length}
              listo={avisosListos}
              singular="lote caducado"
              plural="lotes caducados"
              tono={inv.caducidadPeligro}
              onVer={() => setTab("caducado")}
            />
            <LineaCaducidad
              cuantos={avisos.porCaducar.length}
              listo={avisosListos}
              singular="lote por caducar"
              plural="lotes por caducar"
              tono={inv.caducidadAlerta}
              onVer={() => setTab("por_caducar")}
            />
          </div>
        </div>
      </div>

      {/* Buscador y filtros */}
      <div className={inv.filtros}>
        <div className="search-field">
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("procurement.inventoryClient.searchPlaceholder")}
            aria-label={t("procurement.inventoryClient.searchPlaceholder")}
          />
        </div>
        {/* WS1-T5 (ajuste 3) — con los de caducidad son hasta seis filtros:
            la barra se desplaza ella (sin tocar la clase global
            .segment-new, que usan otras pantallas) y la página no. */}
        <div className={`segment-new ${inv.segmento}`}>
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setTab(f.id)}
              aria-pressed={tab === f.id}
              className={`segment-new__btn ${tab === f.id ? "segment-new__btn--active" : ""}`}
            >
              {f.labelKey ? t(f.labelKey) : f.label}
            </button>
          ))}
          {/* WS1-T5 (ajuste 3) — solo aparecen si hay algo que filtrar: no
              dejan un filtro muerto en clínicas sin lotes por caducar. */}
          {avisos.porCaducar.length > 0 && (
            <button
              type="button"
              onClick={() => setTab("por_caducar")}
              aria-pressed={tab === "por_caducar"}
              className={`segment-new__btn ${tab === "por_caducar" ? "segment-new__btn--active" : ""}`}
            >
              Por caducar
              <span className={`${inv.cuenta} ${inv.cuentaAlerta}`}>{avisos.porCaducar.length}</span>
            </button>
          )}
          {avisos.caducado.length > 0 && (
            <button
              type="button"
              onClick={() => setTab("caducado")}
              aria-pressed={tab === "caducado"}
              className={`segment-new__btn ${tab === "caducado" ? "segment-new__btn--active" : ""}`}
            >
              Caducado
              <span className={`${inv.cuenta} ${inv.cuentaPeligro}`}>{avisos.caducado.length}</span>
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      <CardNew noPad>
        {filtered.length === 0 ? (
          <div className={inv.vacio}>
            <div className={inv.vacioIcono}>
              {hayBusqueda
                ? <SearchX size={20} strokeWidth={1.75} aria-hidden />
                : <PackageOpen size={20} strokeWidth={1.75} aria-hidden />}
            </div>
            <p className={inv.vacioTitulo}>
              {hayBusqueda ? t("common.noResults") : tab === "todos" ? t("procurement.inventoryClient.emptyNoItems") : t("procurement.inventoryClient.emptyNoItemsInState")}
            </p>
            {/* La pista dice qué hacer a continuación, no solo que no hay nada. */}
            <p className={inv.vacioPista}>
              {items.length === 0
                ? "Da de alta tus insumos para saber cuánto tienes, cuándo pedir más y qué está por caducar."
                : hayBusqueda
                  ? `Nada coincide con «${search.trim()}»${tab === "todos" ? "" : " dentro de este filtro"}. Prueba con otro nombre o con la categoría.`
                  : "Cambia de filtro para ver el resto del inventario."}
            </p>
            <div className={inv.vacioAcciones}>
              {hayBusqueda && (
                <ButtonNew variant="secondary" size="sm" onClick={() => setSearch("")}>
                  Borrar búsqueda
                </ButtonNew>
              )}
              {items.length > 0 && tab !== "todos" && (
                <ButtonNew variant="secondary" size="sm" onClick={() => setTab("todos")}>
                  Ver todos
                </ButtonNew>
              )}
              {items.length === 0 && (
                <ButtonNew variant="primary" size="sm" icon={<Plus size={16} strokeWidth={1.75} aria-hidden />} onClick={() => setShowAdd(true)}>
                  {t("procurement.inventoryClient.addFirstItem")}
                </ButtonNew>
              )}
            </div>
          </div>
        ) : (
          <div className={inv.tablaCaja}>
          {/* En teléfono cada fila es una ficha (la hoja lo decide): los
              `data-rotulo` son el rótulo visible de cada dato ahí, donde la
              cabecera de la tabla no se ve. */}
          <table className={`table-new ${inv.tabla}`}>
            <thead>
              <tr>
                <th>{t("procurement.inventoryClient.colItem")}</th>
                <th>{t("procurement.inventoryClient.colCategory")}</th>
                <th className={inv.num}>{t("procurement.inventoryClient.colQuantity")}</th>
                <th className={inv.num}>{t("procurement.inventoryClient.colMinimum")}</th>
                <th className={inv.num}>{t("procurement.inventoryClient.colUnitCost")}</th>
                <th>{t("procurement.inventoryClient.fieldProvider")}</th>
                <th>{t("common.status")}</th>
                <th className={inv.colAcciones}>{t("common.actions")}</th>
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
                return (
                  <tr key={item.id}>
                    <td className={inv.colArticulo}>
                      <div className={inv.articulo}>
                        <ItemIcon iconId={iconId} category={item.category} size={36} />
                        <div className={inv.articuloTextos}>
                          <div className={inv.articuloNombre}>{item.name}</div>
                          <div className={inv.articuloCategoria}>{item.category}</div>
                          {item.description && (
                            <div className={inv.articuloDetalle} title={item.description}>
                              {item.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={`${inv.colCategoria} ${inv.categoria}`}>{item.category}</td>
                    <td className={`${inv.colCantidad} ${inv.num}`} data-rotulo={t("procurement.inventoryClient.colQuantity")}>
                      {isEditing ? (
                        <div className={inv.edicion}>
                          <input
                            type="number" min={0} autoFocus
                            className={`input-new ${inv.celda} ${inv.celdaCorta}`}
                            aria-label={`${t("procurement.inventoryClient.colQuantity")}: ${item.name}`}
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
                            style={{ padding: 0, width: 30, height: 30, justifyContent: "center", flex: "none" }}
                            aria-label={t("common.confirm")}
                          >
                            <Check size={16} strokeWidth={1.75} aria-hidden />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditQty(prev => ({ ...prev, [item.id]: String(item.quantity) }))}
                          className={`${inv.cantidad} ${TONO_CANTIDAD[status] ?? ""}`}
                          title={t("procurement.inventoryClient.clickToEdit")}
                        >
                          {item.quantity}
                          <span className={inv.cantidadUnidad}>{item.unit}</span>
                        </button>
                      )}
                    </td>
                    <td className={`${inv.colMinimo} ${inv.num}`} data-rotulo={t("procurement.inventoryClient.colMinimum")}>
                      <input
                        type="number" min={0}
                        className={`input-new ${inv.celda} ${inv.celdaCorta}`}
                        aria-label={`${t("procurement.inventoryClient.colMinimum")}: ${item.name}`}
                        defaultValue={item.minQuantity}
                        onBlur={e => {
                          const v = parseInt(e.target.value);
                          if (!isNaN(v) && v !== item.minQuantity) updateMinQty(item.id, v);
                        }}
                      />
                    </td>
                    <td className={`${inv.colCosto} ${inv.num}`} data-rotulo={t("procurement.inventoryClient.colUnitCost")}>
                      <input
                        // Ajuste 1 (QA en vivo): con `defaultValue` a secas este
                        // input no se refrescaba cuando "Registrar compra"
                        // cambiaba item.unitCost desde OTRA acción — el DOM se
                        // quedaba en el valor viejo aunque el KPI y el backend
                        // ya tuvieran el nuevo. `key` fuerza a React a montar
                        // una instancia nueva (con el defaultValue correcto)
                        // cada vez que cambia, sin volverlo controlado (así no
                        // se pierde el "solo blur guarda" del resto de la fila).
                        key={item.unitCost}
                        type="number" min={0} step="0.01"
                        className={`input-new ${inv.celda} ${inv.celdaMedia}`}
                        aria-label={`${t("procurement.inventoryClient.colUnitCost")}: ${item.name}`}
                        defaultValue={item.unitCost}
                        onBlur={e => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v) && v >= 0 && v !== item.unitCost) updateUnitCost(item.id, v);
                        }}
                      />
                    </td>
                    <td className={inv.colProveedor} data-rotulo={t("procurement.inventoryClient.fieldProvider")}>
                      <select
                        // Ajuste 2 (QA 2f, panel.108): el ancho va FIJO (en la
                        // hoja, `.celdaLarga`) y no en `100%`: en una tabla de
                        // layout automático `width:100%` resuelve contra lo
                        // que la columna ya recibió y «Sin proveedor» salía
                        // cortado. Un ancho fijo obliga a la COLUMNA a crecer.
                        className={`input-new ${inv.celda} ${inv.celdaLarga}`}
                        aria-label={`${t("procurement.inventoryClient.fieldProvider")}: ${item.name}`}
                        value={item.providerId ?? ""}
                        onChange={e => updateProvider(item.id, e.target.value)}
                      >
                        <option value="">{t("procurement.inventoryClient.noProvider")}</option>
                        {proveedores.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className={inv.colEstado}>{statusBadge(status, t)}</td>
                    <td className={inv.colAcciones}>
                      <div className={inv.grupoAcciones}>
                        <button
                          type="button"
                          onClick={() => setLotesItem(item)}
                          className={inv.accion}
                          aria-label={`Lotes y caducidad: ${item.name}`}
                          title="Lotes y caducidad"
                        >
                          <CalendarClock size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                        <span className={inv.pasos}>
                          <button
                            type="button"
                            disabled={isLoad || item.quantity === 0}
                            onClick={() => changeQty(item.id, -1)}
                            className={`${inv.accion} ${inv.accionMenos}`}
                            aria-label={`${t("procurement.inventoryClient.removeOne")}: ${item.name}`}
                            title={t("procurement.inventoryClient.removeOne")}
                          >
                            <Minus size={16} strokeWidth={1.75} aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={isLoad}
                            onClick={() => changeQty(item.id, 1)}
                            className={`${inv.accion} ${inv.accionMas}`}
                            aria-label={`${t("procurement.inventoryClient.addOne")}: ${item.name}`}
                            title={t("procurement.inventoryClient.addOne")}
                          >
                            <Plus size={16} strokeWidth={1.75} aria-hidden />
                          </button>
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteItem(item.id)}
                          className={`${inv.accion} ${inv.accionBorrar}`}
                          aria-label={`${t("common.delete")}: ${item.name}`}
                          title={t("common.delete")}
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
          <Dialog.Overlay className={ropa.velo} />
          {/* Diseño (ws1-t5): la caja se viste con `ropaVentana` —la ropa de
              diálogos del rediseño, o `.modal` con el interruptor apagado— y
              su esqueleto (cabecera y pie fijos, cuerpo con scroll) sale de la
              hoja: a 390 el pie con «Agregar artículo» quedaba fuera de la
              pantalla y la rejilla de íconos se salía por la derecha. */}
          <Dialog.Content className={ropa.caja} aria-describedby={undefined}>
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
              <div className={inv.seccion}>
                <IconPicker
                  selected={newItem.iconId}
                  onSelect={id => setNewItem(n => ({ ...n, iconId: id }))}
                />
              </div>

              <div className={inv.seccion}>
                <div className="form-section__title">
                  {t("procurement.inventoryClient.sectionInfo")}
                  <span className="form-section__rule" />
                </div>
                <div className={inv.rejilla1}>
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
                      style={{ height: 64, paddingTop: 8, resize: "vertical" }}
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

              <div className={inv.seccion}>
                <div className="form-section__title">
                  {t("procurement.inventoryClient.sectionInitialStock")}
                  <span className="form-section__rule" />
                </div>
                <div className={inv.rejilla4}>
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
                  <div className="field-new">
                    <label className="field-new__label">{t("procurement.inventoryClient.fieldUnitCost")}</label>
                    <input
                      type="number" min={0} step="0.01"
                      className="input-new mono"
                      value={newItem.unitCost}
                      onChange={e => setNewItem(n => ({ ...n, unitCost: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
              </div>

              {/* ws1-t4: proveedor propio, opcional. */}
              <div className={inv.seccion}>
                <div className="form-section__title">
                  {t("procurement.inventoryClient.fieldProvider")}
                  <span className="form-section__rule" />
                </div>
                {showNuevoProveedor ? (
                  <div className={inv.formLote}>
                    <div className="field-new">
                      <label className="field-new__label">{t("procurement.inventoryClient.fieldName")}</label>
                      <input className="input-new" value={nuevoProveedor.name}
                        onChange={e => setNuevoProveedor(p => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label">RFC</label>
                      <input className="input-new" value={nuevoProveedor.rfc}
                        onChange={e => setNuevoProveedor(p => ({ ...p, rfc: e.target.value }))} />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label">{t("procurement.inventoryClient.fieldContact")}</label>
                      <input className="input-new" value={nuevoProveedor.contact}
                        onChange={e => setNuevoProveedor(p => ({ ...p, contact: e.target.value }))} />
                    </div>
                    <ButtonNew variant="primary" type="button" onClick={crearProveedorRapido}>
                      {t("common.confirm")}
                    </ButtonNew>
                  </div>
                ) : (
                  <div className={inv.enLinea}>
                    <select
                      className="input-new"
                      aria-label={t("procurement.inventoryClient.fieldProvider")}
                      value={newItem.providerId}
                      onChange={e => setNewItem(n => ({ ...n, providerId: e.target.value }))}
                    >
                      <option value="">{t("procurement.inventoryClient.noProvider")}</option>
                      {proveedores.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <ButtonNew variant="secondary" type="button" onClick={() => setShowNuevoProveedor(true)}>
                      {t("procurement.inventoryClient.newProvider")}
                    </ButtonNew>
                  </div>
                )}
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

      {/* WS1-T5 — lotes y caducidad del artículo. */}
      {lotesItem && (
        <LotesModal
          itemId={lotesItem.id}
          itemName={lotesItem.name}
          unit={lotesItem.unit}
          rediseno={rediseno}
          onClose={() => setLotesItem(null)}
        />
      )}

      {/* ws1-t4 — "Registrar compra": suma existencias + costo + gasto ligado. */}
      {showCompra && (
        <CompraModal
          items={items.map(i => ({ id: i.id, name: i.name, unit: i.unit }))}
          proveedores={proveedores}
          onRegistrada={aplicarResultadoCompra}
          rediseno={rediseno}
          onClose={() => setShowCompra(false)}
        />
      )}

      {/* ws1-t4 (ajuste 1) — "Historial de compras". */}
      {showHistorial && <HistorialComprasModal rediseno={rediseno} onClose={() => setShowHistorial(false)} />}
    </div>
  );
}
