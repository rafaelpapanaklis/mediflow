"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Trash2, Plus, Tag, Copy } from "lucide-react";

interface Coupon {
  id: string;
  code: string;
  type: string;
  value: number;
  validFrom: string;
  validUntil: string | null;
  maxUses: number | null;
  usedCount: number;
  appliesTo: string;
  active: boolean;
  createdAt: string;
}

export function CouponsClient({ initial }: { initial: Coupon[] }) {
  const [list, setList] = useState<Coupon[]>(initial);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: "",
    type: "percentage" as "percentage" | "fixed",
    value: "",
    appliesTo: "all" as "all" | "BASIC" | "PRO" | "CLINIC",
    maxUses: "",
    validUntil: "",
  });

  const stats = useMemo(() => ({
    active:   list.filter(c => c.active).length,
    expired:  list.filter(c => c.validUntil && new Date(c.validUntil) < new Date()).length,
    redeemed: list.reduce((s, c) => s + c.usedCount, 0),
  }), [list]);

  async function create() {
    if (!form.code.trim()) { toast.error("Código requerido"); return; }
    const value = Number(form.value);
    if (!Number.isFinite(value) || value <= 0) { toast.error("Valor inválido"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(),
          type: form.type,
          value,
          appliesTo: form.appliesTo,
          maxUses: form.maxUses ? Number(form.maxUses) : null,
          validUntil: form.validUntil || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Error");
      const created = await res.json();
      setList(prev => [created, ...prev]);
      setForm({ code: "", type: "percentage", value: "", appliesTo: "all", maxUses: "", validUntil: "" });
      toast.success("Cupón creado");
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function toggleActive(c: Coupon) {
    try {
      const res = await fetch(`/api/admin/coupons/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !c.active }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setList(prev => prev.map(x => (x.id === c.id ? updated : x)));
    } catch { toast.error("Error al actualizar"); }
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar este cupón?")) return;
    try {
      const res = await fetch(`/api/admin/coupons/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setList(prev => prev.filter(x => x.id !== id));
      toast.success("Cupón eliminado");
    } catch { toast.error("Error al eliminar"); }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).catch(() => {});
    toast.success(`Copiado: ${code}`);
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Cupones y descuentos</h1>
        <p className="text-slate-400 text-sm">Aplícalos al registrar pagos de suscripción en /admin/payments.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-semibold uppercase mb-2">Activos</div>
          <div className="text-3xl font-extrabold text-emerald-400">{stats.active}</div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-semibold uppercase mb-2">Canjeados total</div>
          <div className="text-3xl font-extrabold text-brand-400">{stats.redeemed}</div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-semibold uppercase mb-2">Expirados</div>
          <div className="text-3xl font-extrabold text-slate-400">{stats.expired}</div>
        </div>
      </div>

      {/* Form */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-bold">Nuevo cupón</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <input
            placeholder="LANZAMIENTO20"
            value={form.code}
            onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
            className="bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 font-mono uppercase"
          />
          <select
            value={form.type}
            onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}
            className="bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
          >
            <option value="percentage">% descuento</option>
            <option value="fixed">$ fijo</option>
          </select>
          <input
            type="number"
            placeholder={form.type === "percentage" ? "20" : "100"}
            value={form.value}
            onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
            className="bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
          />
          <select
            value={form.appliesTo}
            onChange={e => setForm(f => ({ ...f, appliesTo: e.target.value as any }))}
            className="bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
          >
            <option value="all">Todos los planes</option>
            <option value="BASIC">Solo BASIC</option>
            <option value="PRO">Solo PRO</option>
            <option value="CLINIC">Solo CLINIC</option>
          </select>
          <input
            type="number"
            placeholder="Usos máx"
            value={form.maxUses}
            onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}
            className="bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
          />
          <input
            type="date"
            value={form.validUntil}
            onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))}
            className="bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
          />
        </div>
        <button
          onClick={create}
          disabled={saving}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-bold px-5 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          {saving ? "Creando…" : "Crear cupón"}
        </button>
      </div>

      {/* List */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700">
          <h2 className="font-bold text-sm">Cupones ({list.length})</h2>
        </div>
        {list.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-sm">Sin cupones</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-xs text-slate-400">
                {["Código", "Descuento", "Aplica a", "Usos", "Válido hasta", "Estado", ""].map(h => (
                  <th key={h} className="px-5 py-3 text-left font-bold uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(c => {
                const expired = c.validUntil && new Date(c.validUntil) < new Date();
                return (
                  <tr key={c.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                    <td className="px-5 py-3">
                      <button onClick={() => copyCode(c.code)} className="inline-flex items-center gap-2 group">
                        <Tag className="w-3 h-3 text-brand-400" />
                        <span className="font-mono font-bold text-brand-400">{c.code}</span>
                        <Copy className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    </td>
                    <td className="px-5 py-3 font-semibold">
                      {c.type === "percentage" ? `${c.value}%` : `$${c.value.toFixed(2)} MXN`}
                    </td>
                    <td className="px-5 py-3 text-slate-300 text-xs">
                      {c.appliesTo === "all" ? "Todos los planes" : `Solo ${c.appliesTo}`}
                    </td>
                    <td className="px-5 py-3 text-slate-300 text-xs">
                      {c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : ""}
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {c.validUntil ? new Date(c.validUntil).toLocaleDateString("es-MX") : "Sin fecha"}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => toggleActive(c)}
                        className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                          expired
                            ? "bg-slate-800 text-slate-400 border-slate-700"
                            : c.active
                              ? "bg-emerald-900/50 text-emerald-400 border-emerald-700"
                              : "bg-slate-800 text-slate-400 border-slate-700"
                        }`}
                      >
                        {expired ? "Expirado" : c.active ? "Activo" : "Pausado"}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => remove(c.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-900/40 text-slate-400 hover:text-rose-400"
                        aria-label="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
