"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Package, Users } from "lucide-react";
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">{t("pages.packages.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("pages.packages.registeredCount", { count: packages.length })}</p>
        </div>
        {tab === "paquetes" && (
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="w-5 h-5 mr-2" /> {t("pages.packages.newPackage")}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab("paquetes")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${tab === "paquetes" ? "bg-brand-600 text-white border-brand-600" : "bg-card border-border hover:border-slate-400"}`}
        >
          <Package className="w-4 h-4" /> {t("pages.packages.tabPackages")}
        </button>
        <button
          onClick={() => setTab("clientes")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${tab === "clientes" ? "bg-brand-600 text-white border-brand-600" : "bg-card border-border hover:border-slate-400"}`}
        >
          <Users className="w-4 h-4" /> {t("pages.packages.tabClients")}
        </button>
      </div>

      {/* Paquetes tab */}
      {tab === "paquetes" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map(pkg => (
            <div key={pkg.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-start justify-between">
                <h3 className="text-base font-bold">{pkg.name}</h3>
                <button onClick={() => handleDeletePackage(pkg.id)} className="text-muted-foreground hover:text-rose-500">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {pkg.description && <p className="text-sm text-muted-foreground mt-1">{pkg.description}</p>}
              <div className="mt-3 space-y-1">
                <p className="text-sm"><span className="font-medium">{t("pages.packages.sessionsLabel")}</span> {pkg.totalSessions}</p>
                <p className="text-sm"><span className="font-medium">{t("pages.packages.priceLabel")}</span> ${pkg.price.toLocaleString("es-MX")}</p>
                <p className="text-sm"><span className="font-medium">{t("pages.packages.validityLabel")}</span> {t("pages.packages.daysCount", { count: pkg.validDays })}</p>
                {pkg.bodyZone && <p className="text-sm"><span className="font-medium">{t("pages.packages.zoneLabel")}</span> {pkg.bodyZone}</p>}
                <p className="text-sm"><span className="font-medium">{t("pages.packages.activeClientsLabel")}</span> {pkg._count.redemptions}</p>
              </div>
            </div>
          ))}
          {packages.length === 0 && (
            <div className="col-span-full text-center py-16 text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-base font-semibold">{t("pages.packages.noPackages")}</p>
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
              <div key={r.id} className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-base font-bold">{r.patient.firstName} {r.patient.lastName}</p>
                    <p className="text-sm text-muted-foreground">{r.package.name}</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={r.sessionsUsed >= r.totalSessions}
                    onClick={() => handleMarkSession(r.id)}
                  >
                    {t("pages.packages.markSession")}
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-brand-600 rounded-full transition-all"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold whitespace-nowrap">{r.sessionsUsed}/{r.totalSessions}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {t("pages.packages.expires")} {new Date(r.expiresAt).toLocaleDateString("es-MX")}
                </p>
              </div>
            );
          })}
          {redemptions.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-base font-semibold">{t("pages.packages.noActiveClients")}</p>
            </div>
          )}
        </div>
      )}

      {/* Add Package Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-bold">{t("pages.packages.newPackageModalTitle")}</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
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
            <div className="px-6 pb-6 flex gap-3">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11 text-base">{t("common.cancel")}</Button>
              <Button onClick={handleCreatePackage} className="flex-1 h-11 text-base">{t("pages.packages.createPackage")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
