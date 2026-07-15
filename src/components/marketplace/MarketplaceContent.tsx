"use client";
/**
 * Wrapper Client Component del marketplace. Recibe data del Server
 * Component (modules + clinicModules + trial + cart inicial) y maneja:
 *   - estado optimista del carrito con useTransition
 *   - filtro por categoría y búsqueda
 *   - cómputo del estado por módulo (purchased/trial/available/locked)
 *   - rollback con react-hot-toast en error
 *
 * Polish dark-mode (post-Sprint 2):
 *   - Migrado a CSS vars (--text-1, --text-2, --text-3, --bg-elev, ...).
 *   - Tabs con ARIA roles (tablist + tab + aria-selected) para SR.
 *   - Search input con label sr-only.
 *   - Focus rings consistentes con --brand color.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, SearchX } from "lucide-react";
import toast from "react-hot-toast";
import type { Module, ClinicModule } from "@prisma/client";
import { addToCart, removeFromCart } from "@/app/actions/cart";
import type { BillingCycle } from "@/lib/marketplace/pricing";
import type { TrialStatus } from "@/lib/marketplace/access-control";
import { ModuleCard, type ModuleStatus } from "./ModuleCard";
import { DiscountTiersBar } from "./DiscountTiersBar";
import { FloatingCart } from "./FloatingCart";
import { useT } from "@/i18n/i18n-provider";

interface MarketplaceContentProps {
  modules: Module[];
  clinicModules: ClinicModule[];
  trialStatus: TrialStatus | null;
  initialCart: string[];
}

const TABS = ["Todos", "Dental", "Pediatría", "Cardiología", "Dermatología", "Ginecología", "Nutrición", "Estética"] as const;
type Tab = (typeof TABS)[number];

// Map de categoría (valor de DB, no traducir el valor) -> llave de traducción para
// la etiqueta visible del tab. La llave se resuelve con t() en render, nunca aquí.
const TAB_LABEL_KEYS: Record<Tab, string> = {
  "Todos":        "common.all",
  "Dental":       "pages.marketplace.tabDental",
  "Pediatría":    "pages.marketplace.tabPediatria",
  "Cardiología":  "pages.marketplace.tabCardiologia",
  "Dermatología": "pages.marketplace.tabDermatologia",
  "Ginecología":  "pages.marketplace.tabGinecologia",
  "Nutrición":    "pages.marketplace.tabNutricion",
  "Estética":     "pages.marketplace.tabEstetica",
};

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
  const t = useT();
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
          toast.error(res.error ?? t("pages.marketplace.addError"));
        } else if (res.moduleIds) {
          setCart(res.moduleIds);
        }
      } catch (err) {
        setCart((prev) => prev.filter((id) => id !== moduleId));
        toast.error(t("pages.marketplace.addError"));
        console.error("[marketplace.add]", err);
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
          setCart((prev) => [...prev, moduleId]); // rollback
          toast.error(res.error ?? t("pages.marketplace.removeError"));
        } else if (res.moduleIds) {
          setCart(res.moduleIds);
        }
      } catch (err) {
        setCart((prev) => [...prev, moduleId]);
        toast.error(t("pages.marketplace.removeError"));
        console.error("[marketplace.remove]", err);
      } finally {
        markPending(moduleId, false);
      }
    });
  };

  return (
    <div className="px-2 sm:px-4 lg:px-6 max-w-[1400px]">
      <header className="mb-6">
        <h1 className="text-[22px] font-bold text-[var(--text-1)] tracking-tight leading-tight">
          {t("pages.marketplace.title")}
        </h1>
        <p className="text-[var(--text-3)] mt-1 text-[13.5px]">
          {trialStatus?.isExpired
            ? t("pages.marketplace.subtitleExpired")
            : trialStatus
              ? t("pages.marketplace.subtitleTrial")
              : t("pages.marketplace.subtitleDefault")}
        </p>
      </header>

      <DiscountTiersBar cartCount={cart.length} />

      <div className="mb-5 flex items-center justify-between gap-4 flex-wrap">
        <div
          role="tablist"
          aria-label={t("pages.marketplace.filterByCategory")}
          className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 py-0.5"
        >
          {TABS.map((tab) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab)}
                className={`inline-flex items-center h-[30px] px-3 rounded-full text-[12.5px] whitespace-nowrap border transition-[background-color,border-color,color] duration-150 ease-[cubic-bezier(.2,.8,.4,1)] focus-visible:outline-none focus-visible:[box-shadow:var(--ring)] ${
                  active
                    ? "bg-[var(--brand-soft)] border-[var(--border-brand)] text-[var(--brand)] font-semibold"
                    : "bg-[var(--bg-elev)] border-[var(--border-soft)] text-[var(--text-2)] font-medium hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]"
                }`}
              >
                {t(TAB_LABEL_KEYS[tab])}
              </button>
            );
          })}
        </div>
        <div className="relative flex-shrink-0">
          <Search className="w-4 h-4 text-[var(--text-3)] absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.75} aria-hidden />
          <label htmlFor="mp-search" className="sr-only">
            {t("pages.marketplace.searchLabel")}
          </label>
          <input
            id="mp-search"
            type="search"
            placeholder={t("pages.marketplace.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-9 pr-4 bg-[var(--bg-elev)] border border-[var(--border-soft)] text-[var(--text-1)] placeholder:text-[var(--text-3)] rounded-[var(--radius)] text-sm w-64 max-w-full shadow-[var(--shadow-1)] focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-soft)]"
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
          <div className="col-span-full flex flex-col items-center justify-center text-center py-16 px-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-full mb-3 bg-[var(--bg-elev-2)] text-[var(--text-3)]" aria-hidden>
              <SearchX size={20} strokeWidth={1.75} />
            </span>
            <p className="text-sm font-medium text-[var(--text-3)]">{t("pages.marketplace.noModulesMatch")}</p>
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
