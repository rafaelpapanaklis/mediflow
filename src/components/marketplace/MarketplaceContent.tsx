"use client";
/**
 * Wrapper Client Component del marketplace. Recibe data del Server
 * Component (modules + clinicModules + trial + cart inicial) y maneja:
 *   - estado optimista del carrito con useTransition
 *   - filtro por categoría y búsqueda
 *   - cómputo del estado por módulo (purchased/trial/available/locked)
 *   - rollback con react-hot-toast en error
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import toast from "react-hot-toast";
import type { Module, ClinicModule } from "@prisma/client";
import { addToCart, removeFromCart } from "@/app/actions/cart";
import type { BillingCycle } from "@/lib/marketplace/pricing";
import type { TrialStatus } from "@/lib/marketplace/access-control";
import { ModuleCard, type ModuleStatus } from "./ModuleCard";
import { DiscountTiersBar } from "./DiscountTiersBar";
import { FloatingCart } from "./FloatingCart";

interface MarketplaceContentProps {
  modules: Module[];
  clinicModules: ClinicModule[];
  trialStatus: TrialStatus | null;
  initialCart: string[];
}

const TABS = ["Todos", "Dental", "Pediatría", "Cardiología", "Dermatología", "Ginecología", "Nutrición", "Estética"] as const;
type Tab = (typeof TABS)[number];

function computeStatus(
  m: Module,
  clinicModules: ClinicModule[],
  trialStatus: TrialStatus | null,
  now: Date,
): ModuleStatus {
  const cm = clinicModules.find((c) => c.moduleId === m.id);
  if (cm && cm.status === "active" && cm.currentPeriodEnd > now) return "purchased";
  if (trialStatus && !trialStatus.isExpired) return "trial";
  return "locked";
}

export function MarketplaceContent({
  modules,
  clinicModules,
  trialStatus,
  initialCart,
}: MarketplaceContentProps) {
  const router = useRouter();
  const [cart, setCart] = useState<string[]>(initialCart);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [billingCycle] = useState<BillingCycle>("monthly"); // toggle anual/mensual vive en cart (Sprint 3)

  const [activeTab, setActiveTab] = useState<Tab>("Todos");
  const [search, setSearch]       = useState("");

  const now = useMemo(() => new Date(), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return modules.filter((m) => {
      if (activeTab !== "Todos" && m.category !== activeTab) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
      );
    });
  }, [modules, activeTab, search]);

  const cartPrices = useMemo(() => {
    return cart
      .map((id) => modules.find((m) => m.id === id)?.priceMxnMonthly ?? 0)
      .filter((p) => p > 0);
  }, [cart, modules]);

  const markPending = (id: string, on: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleAdd = (moduleId: string) => {
    if (cart.includes(moduleId)) return;
    setCart((prev) => [...prev, moduleId]); // optimista
    markPending(moduleId, true);
    startTransition(async () => {
      try {
        const res = await addToCart(moduleId);
        if (!res.ok) {
          setCart((prev) => prev.filter((id) => id !== moduleId)); // rollback
          toast.error(res.error ?? "No se pudo agregar al carrito");
        } else if (res.moduleIds) {
          setCart(res.moduleIds);
        }
      } catch {
        setCart((prev) => prev.filter((id) => id !== moduleId));
        toast.error("Error de conexión al agregar al carrito");
      } finally {
        markPending(moduleId, false);
      }
    });
  };

  const handleRemove = (moduleId: string) => {
    if (!cart.includes(moduleId)) return;
    setCart((prev) => prev.filter((id) => id !== moduleId)); // optimista
    markPending(moduleId, true);
    startTransition(async () => {
      try {
        const res = await removeFromCart(moduleId);
        if (!res.ok) {
          setCart((prev) => (prev.includes(moduleId) ? prev : [...prev, moduleId])); // rollback
          toast.error(res.error ?? "No se pudo quitar del carrito");
        } else if (res.moduleIds) {
          setCart(res.moduleIds);
        }
      } catch {
        setCart((prev) => (prev.includes(moduleId) ? prev : [...prev, moduleId]));
        toast.error("Error de conexión al actualizar el carrito");
      } finally {
        markPending(moduleId, false);
      }
    });
  };

  return (
    <div className="px-2 sm:px-4 lg:px-6 max-w-[1400px]">
      <header className="mb-6">
        <h1 className="text-[28px] font-semibold text-slate-900 tracking-tight leading-tight">
          Marketplace de módulos
        </h1>
        <p className="text-slate-500 mt-1 text-[15px]">
          {trialStatus?.isExpired
            ? "Tu prueba terminó. Activa los módulos que necesitas para continuar."
            : trialStatus
              ? `Estás probando todos los módulos gratis. Compra los que más uses para conservarlos después del día 14.`
              : "Activa los módulos que necesitas para tu clínica."}
        </p>
      </header>

      <DiscountTiersBar cartCount={cart.length} />

      <div className="mb-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-100/70 p-1 rounded-lg overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`px-3.5 py-1.5 text-sm rounded-md whitespace-nowrap transition-all ${
                activeTab === t
                  ? "bg-white text-slate-900 font-medium shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="relative flex-shrink-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            type="search"
            placeholder="Buscar módulo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-md text-sm w-64 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-24">
        {filtered.map((m) => {
          const status = computeStatus(m, clinicModules, trialStatus, now);
          return (
            <ModuleCard
              key={m.id}
              module={m}
              inCart={cart.includes(m.id)}
              status={status}
              pending={pendingIds.has(m.id) || isPending}
              onAddToCart={() => handleAdd(m.id)}
              onRemoveFromCart={() => handleRemove(m.id)}
            />
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-slate-500 py-16 text-sm">
            No hay módulos que coincidan con la búsqueda.
          </div>
        )}
      </div>

      <FloatingCart
        prices={cartPrices}
        billingCycle={billingCycle}
        onClick={() => router.push("/dashboard/marketplace/cart")}
      />
    </div>
  );
}
