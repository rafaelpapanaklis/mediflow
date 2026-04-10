"use client";

import { useState } from "react";
import { Plus, X, Package, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

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
  const [tab, setTab] = useState<Tab>("paquetes");
  const [packages, setPackages] = useState<ServicePkg[]>(initialPackages);
  const [redemptions, setRedemptions] = useState<Redemption[]>(initialRedemptions);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", totalSessions: 10, price: 0, validDays: 365, bodyZone: "" });

  async function handleCreatePackage() {
    if (!form.name.trim()) { toast.error("El nombre es requerido"); return; }
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
      toast.success("Paquete creado");
    } catch {
      toast.error("Error al crear paquete");
    }
  }

  async function handleDeletePackage(id: string) {
    if (!confirm("¿Eliminar este paquete?")) return;
    try {
      const res = await fetch(`/api/packages/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      setPackages(prev => prev.filter(p => p.id !== id));
      toast.success("Paquete eliminado");
    } catch {
      toast.error("Error al eliminar");
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
      toast.success("Sesión registrada");
    } catch {
      toast.error("Error al registrar sesión");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">Paquetes de Servicios</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{packages.length} paquetes registrados</p>
        </div>
        {tab === "paquetes" && (
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="w-5 h-5 mr-2" /> Nuevo paquete
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab("paquetes")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${tab === "paquetes" ? "bg-brand-600 text-white border-brand-600" : "bg-white dark:bg-slate-900 border-border hover:border-slate-400"}`}
        >
          <Package className="w-4 h-4" /> Paquetes
        </button>
        <button
          onClick={() => setTab("clientes")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${tab === "clientes" ? "bg-brand-600 text-white border-brand-600" : "bg-white dark:bg-slate-900 border-border hover:border-slate-400"}`}
        >
          <Users className="w-4 h-4" /> Clientes
        </button>
      </div>

      {/* Paquetes tab */}
      {tab === "paquetes" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map(pkg => (
            <div key={pkg.id} className="bg-white dark:bg-slate-900 border border-border rounded-xl p-5">
              <div className="flex items-start justify-between">
                <h3 className="text-base font-bold">{pkg.name}</h3>
                <button onClick={() => handleDeletePackage(pkg.id)} className="text-muted-foreground hover:text-rose-500">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {pkg.description && <p className="text-sm text-muted-foreground mt-1">{pkg.description}</p>}
              <div className="mt-3 space-y-1">
                <p className="text-sm"><span className="font-medium">Sesiones:</span> {pkg.totalSessions}</p>
                <p className="text-sm"><span className="font-medium">Precio:</span> ${pkg.price.toLocaleString("es-MX")}</p>
                <p className="text-sm"><span className="font-medium">Validez:</span> {pkg.validDays} días</p>
                {pkg.bodyZone && <p className="text-sm"><span className="font-medium">Zona:</span> {pkg.bodyZone}</p>}
                <p className="text-sm"><span className="font-medium">Clientes activos:</span> {pkg._count.redemptions}</p>
              </div>
            </div>
          ))}
          {packages.length === 0 && (
            <div className="col-span-full text-center py-16 text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-base font-semibold">Sin paquetes registrados</p>
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
              <div key={r.id} className="bg-white dark:bg-slate-900 border border-border rounded-xl p-5">
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
                    Marcar sesión
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-brand-600 rounded-full transition-all"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold whitespace-nowrap">{r.sessionsUsed}/{r.totalSessions}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Vence: {new Date(r.expiresAt).toLocaleDateString("es-MX")}
                </p>
              </div>
            );
          })}
          {redemptions.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-base font-semibold">Sin clientes con paquetes activos</p>
            </div>
          )}
        </div>
      )}

      {/* Add Package Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-bold">Nuevo paquete</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Nombre *</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ej: Paquete 10 sesiones láser"
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Descripción</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Opcional"
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm">Sesiones</Label>
                  <input type="number" min="1"
                    className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
                    value={form.totalSessions} onChange={e => setForm(f => ({ ...f, totalSessions: parseInt(e.target.value) || 1 }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Precio</Label>
                  <input type="number" min="0"
                    className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
                    value={form.price} onChange={e => setForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Validez (días)</Label>
                  <input type="number" min="1"
                    className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
                    value={form.validDays} onChange={e => setForm(f => ({ ...f, validDays: parseInt(e.target.value) || 365 }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Zona del cuerpo</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ej: Piernas, Axilas, Rostro"
                  value={form.bodyZone} onChange={e => setForm(f => ({ ...f, bodyZone: e.target.value }))} />
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11 text-base">Cancelar</Button>
              <Button onClick={handleCreatePackage} className="flex-1 h-11 text-base">Crear paquete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
