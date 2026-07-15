"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Package, Users, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";

interface ServicePkg {
  id: string;
  name: string;
  description: string | null;
  totalSessions: number;
  price: number;
  validDays: number;
  bodyZone: string | null;
  isActive: boolean;
  _count: { redemptions: number };
}

interface Redemption {
  id: string;
  sessionsUsed: number;
  totalSessions: number;
  status: string;
  purchasedAt: string;
  expiresAt: string;
  patient: { id: string; firstName: string; lastName: string };
  package: { id: string; name: string };
}

type Tab = "paquetes" | "clientes";

export function PackagesClient({ initialPackages, initialRedemptions }: { initialPackages: ServicePkg[]; initialRedemptions: Redemption[] }) {
  const t = useT();
  const router = useRouter();
  const askConfirm = useConfirm();
  const [tab, setTab] = useState<Tab>("paquetes");
  const [packages, setPackages] = useState<ServicePkg[]>(initialPackages);
  const [redemptions, setRedemptions] = useState<Redemption[]>(initialRedemptions);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", totalSessions: 10, price: 0, validDays: 365, bodyZone: "" });

  async function handleCreatePackage() {
    if (!form.name.trim()) { toast.error(t("pages.packages.nameRequired")); return; }
    try {
      const res = await fetch("/api/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setPackages(prev => [...prev, { ...created, _count: { redemptions: 0 } }]);
      setShowAdd(false);
      setForm({ name: "", description: "", totalSessions: 10, price: 0, validDays: 365, bodyZone: "" });
      toast.success(t("pages.packages.packageCreated"));
      router.refresh();
    } catch {
      toast.error(t("pages.packages.packageCreateError"));
    }
  }

  async function handleDeletePackage(id: string) {
    if (!(await askConfirm({
      title: t("pages.packages.deletePackageTitle"),
      description: t("pages.packages.deletePackageDescription"),
      variant: "danger",
      confirmText: t("common.delete"),
    }))) return;
    try {
      const res = await fetch(`/api/packages/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      setPackages(prev => prev.filter(p => p.id !== id));
      toast.success(t("pages.packages.packageDeleted"));
      router.refresh();
    } catch {
      toast.error(t("common.genericError"));
    }
  }

  async function handleMarkSession(redemptionId: string) {
    try {
      const res = await fetch(`/api/packages/redemptions/${redemptionId}/use-session`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setRedemptions(prev => prev.map(r => r.id === redemptionId ? { ...r, sessionsUsed: updated.sessionsUsed, status: updated.status } : r));
      toast.success(t("pages.packages.sessionRecorded"));
      router.refresh();
    } catch {
      toast.error(t("pages.packages.sessionRecordError"));
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--text-1)" }}>{t("pages.packages.title")}</h1>
          <p className="text-[12.5px] mt-0.5" style={{ color: "var(--text-3)" }}>{t("pages.packages.registeredCount", { count: packages.length })}</p>
        </div>
        {tab === "paquetes" && (
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="w-[18px] h-[18px] mr-2" strokeWidth={1.75} aria-hidden="true" /> {t("pages.packages.newPackage")}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="segment-new mb-6">
        <button
          aria-pressed={tab === "paquetes"}
          onClick={() => setTab("paquetes")}
          className={`segment-new__btn inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:[box-shadow:var(--ring)] ${tab === "paquetes" ? "segment-new__btn--active" : ""}`}
        >
          <Package size={16} strokeWidth={1.75} aria-hidden="true" /> {t("pages.packages.tabPackages")}
        </button>
        <button
          aria-pressed={tab === "clientes"}
          onClick={() => setTab("clientes")}
          className={`segment-new__btn inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:[box-shadow:var(--ring)] ${tab === "clientes" ? "segment-new__btn--active" : ""}`}
        >
          <Users size={16} strokeWidth={1.75} aria-hidden="true" /> {t("pages.packages.tabClients")}
        </button>
      </div>

      {/* Paquetes tab */}
      {tab === "paquetes" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map(pkg => (
            <div
              key={pkg.id}
              className="p-5 flex flex-col"
              style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-1)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center"
                    style={{ background: "var(--brand-soft)", color: "var(--brand)", borderRadius: "var(--radius)" }}
                    aria-hidden="true"
                  >
                    <Package size={18} strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold leading-snug" style={{ color: "var(--text-1)" }}>{pkg.name}</h3>
                    {pkg.description && <p className="text-[12.5px] mt-0.5" style={{ color: "var(--text-3)" }}>{pkg.description}</p>}
                  </div>
                </div>
                <button
                  onClick={() => handleDeletePackage(pkg.id)}
                  aria-label={t("common.delete")}
                  className="inline-flex h-10 w-10 -mr-2 -mt-2 shrink-0 items-center justify-center transition-colors duration-150 hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:[box-shadow:var(--ring)] active:scale-[.98]"
                  style={{ color: "var(--text-3)", borderRadius: "var(--radius-sm)" }}
                >
                  <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
              <div className="flex-1">
                <p className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-xs font-medium" style={{ color: "var(--text-3)" }}>{t("pages.packages.priceLabel")}</span>
                  <span className="text-[26px] font-bold leading-none tabular-nums" style={{ color: "var(--text-1)" }}>${pkg.price.toLocaleString("es-MX")}</span>
                </p>
                <ul className="mt-4 space-y-2">
                  <li className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-2)" }}>
                    <Check size={16} strokeWidth={1.75} className="shrink-0" style={{ color: "var(--success)" }} aria-hidden="true" />
                    <span>{t("pages.packages.sessionsLabel")} <span className="font-semibold tabular-nums" style={{ color: "var(--text-1)" }}>{pkg.totalSessions}</span></span>
                  </li>
                  <li className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-2)" }}>
                    <Check size={16} strokeWidth={1.75} className="shrink-0" style={{ color: "var(--success)" }} aria-hidden="true" />
                    <span>{t("pages.packages.validityLabel")} <span className="font-semibold tabular-nums" style={{ color: "var(--text-1)" }}>{t("pages.packages.daysCount", { count: pkg.validDays })}</span></span>
                  </li>
                  {pkg.bodyZone && (
                    <li className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-2)" }}>
                      <Check size={16} strokeWidth={1.75} className="shrink-0" style={{ color: "var(--success)" }} aria-hidden="true" />
                      <span>{t("pages.packages.zoneLabel")} <span className="font-semibold" style={{ color: "var(--text-1)" }}>{pkg.bodyZone}</span></span>
                    </li>
                  )}
                </ul>
              </div>
              <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border-soft)" }}>
                <span
                  className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full text-xs font-semibold tabular-nums"
                  style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
                >
                  <Users size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t("pages.packages.activeClientsLabel")} {pkg._count.redemptions}
                </span>
              </div>
            </div>
          ))}
          {packages.length === 0 && (
            <div
              className="col-span-full flex flex-col items-center justify-center px-6 py-14 text-center"
              style={{ background: "var(--bg-elev)", border: "1px dashed var(--border-soft)", borderRadius: "var(--radius-lg)" }}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full mb-3" style={{ background: "var(--brand-soft)", color: "var(--brand)" }} aria-hidden="true">
                <Package size={20} strokeWidth={1.75} />
              </span>
              <p className="text-sm font-medium" style={{ color: "var(--text-3)" }}>{t("pages.packages.noPackages")}</p>
              <button type="button" onClick={() => setShowAdd(true)} className="btn-new btn-new--primary mt-4">
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" /> {t("pages.packages.newPackage")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Clientes tab */}
      {tab === "clientes" && (
        <div className="space-y-3">
          {redemptions.map(r => {
            const pct = r.totalSessions > 0 ? (r.sessionsUsed / r.totalSessions) * 100 : 0;
            return (
              <div
                key={r.id}
                className="p-5"
                style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-1)" }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                      style={{ background: "var(--violet-100)", color: "var(--violet-700)" }}
                      aria-hidden="true"
                    >
                      {(r.patient.firstName || "").charAt(0).toUpperCase()}{(r.patient.lastName || "").charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>{r.patient.firstName} {r.patient.lastName}</p>
                      <p className="text-[12.5px] truncate" style={{ color: "var(--text-3)" }}>{r.package.name}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={r.sessionsUsed >= r.totalSessions}
                    onClick={() => handleMarkSession(r.id)}
                  >
                    <Check className="w-4 h-4 mr-1.5" strokeWidth={1.75} aria-hidden="true" />
                    {t("pages.packages.markSession")}
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-elev-2)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(pct, 100)}%`, background: "var(--brand-grad)" }}
                    />
                  </div>
                  <span
                    className="text-[13px] font-bold whitespace-nowrap tabular-nums"
                    style={{ color: r.sessionsUsed >= r.totalSessions ? "var(--success-strong)" : "var(--text-1)" }}
                  >
                    {r.sessionsUsed}/{r.totalSessions}
                  </span>
                </div>
                <p className="text-xs mt-2" style={{ color: "var(--text-3)" }}>
                  {t("pages.packages.expires")} <span className="tabular-nums">{new Date(r.expiresAt).toLocaleDateString("es-MX")}</span>
                </p>
              </div>
            );
          })}
          {redemptions.length === 0 && (
            <div
              className="flex flex-col items-center justify-center px-6 py-14 text-center"
              style={{ background: "var(--bg-elev)", border: "1px dashed var(--border-soft)", borderRadius: "var(--radius-lg)" }}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full mb-3" style={{ background: "var(--brand-soft)", color: "var(--brand)" }} aria-hidden="true">
                <Users size={20} strokeWidth={1.75} />
              </span>
              <p className="text-sm font-medium" style={{ color: "var(--text-3)" }}>{t("pages.packages.noActiveClients")}</p>
              <button type="button" onClick={() => setTab("paquetes")} className="btn-new btn-new--secondary mt-4">
                <Package size={16} strokeWidth={1.75} aria-hidden="true" /> {t("pages.packages.tabPackages")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add Package Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
          <div
            className="w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200"
            style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-3)" }}
          >
            <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--border-soft)" }}>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>{t("pages.packages.newPackageModalTitle")}</h2>
              <button
                onClick={() => setShowAdd(false)}
                aria-label={t("common.close")}
                className="inline-flex h-10 w-10 -mr-2 shrink-0 items-center justify-center transition-colors duration-150 hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:[box-shadow:var(--ring)] active:scale-[.98]"
                style={{ color: "var(--text-3)", borderRadius: "var(--radius-sm)" }}
              >
                <X size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto min-h-0">
              <div className="space-y-1.5">
                <Label className="text-sm">{t("pages.packages.nameLabel")}</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder={t("pages.packages.namePlaceholder")}
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">{t("common.description")}</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder={t("pages.packages.optionalPlaceholder")}
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm">{t("pages.packages.sessionsField")}</Label>
                  <input type="number" min="1"
                    className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                    value={form.totalSessions} onChange={e => setForm(f => ({ ...f, totalSessions: parseInt(e.target.value) || 1 }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">{t("pages.packages.priceField")}</Label>
                  <input type="number" min="0"
                    className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                    value={form.price} onChange={e => setForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">{t("pages.packages.validityField")}</Label>
                  <input type="number" min="1"
                    className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                    value={form.validDays} onChange={e => setForm(f => ({ ...f, validDays: parseInt(e.target.value) || 365 }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">{t("pages.packages.bodyZoneLabel")}</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder={t("pages.packages.bodyZonePlaceholder")}
                  value={form.bodyZone} onChange={e => setForm(f => ({ ...f, bodyZone: e.target.value }))} />
              </div>
            </div>
            <div className="px-6 py-4 flex gap-3 shrink-0 border-t border-border">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11 text-base">{t("common.cancel")}</Button>
              <Button onClick={handleCreatePackage} className="flex-1 h-11 text-base">{t("pages.packages.createPackage")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
