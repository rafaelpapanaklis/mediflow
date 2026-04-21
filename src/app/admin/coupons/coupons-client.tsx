"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Trash2, Plus, Copy, X, Ticket, CheckCircle2, XCircle } from "lucide-react";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { fmtMXN, formatRelativeDate } from "@/lib/format";

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
  const [showModal, setShowModal] = useState(false);
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

  function openCreate() {
    setForm({ code: "", type: "percentage", value: "", appliesTo: "all", maxUses: "", validUntil: "" });
    setShowModal(true);
  }

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
      setShowModal(false);
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
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Cupones y descuentos
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
            Aplícalos al registrar pagos de suscripción en /admin/payments.
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={openCreate}>
          Nuevo cupón
        </ButtonNew>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label="Activos" value={String(stats.active)} icon={CheckCircle2}
          delta={{ value: `${list.length} total`, direction: "up" }} />
        <KpiCard label="Canjeados" value={String(stats.redeemed)} icon={Ticket}
          delta={{ value: "Total acumulado", direction: "up" }} />
        <KpiCard label="Expirados" value={String(stats.expired)} icon={XCircle}
          delta={{ value: "Sin uso", direction: "down" }} />
      </div>

      {/* Table */}
      <CardNew noPad title={`Cupones (${list.length})`}>
        {list.length === 0 ? (
          <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            Sin cupones
          </div>
        ) : (
          <table className="table-new">
            <thead>
              <tr>
                <th>Código</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Usos</th>
                <th>Válido hasta</th>
                <th>Aplica</th>
                <th>Estado</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {list.map(c => {
                const expired = !!(c.validUntil && new Date(c.validUntil) < new Date());
                const isActive = c.active && !expired;
                return (
                  <tr key={c.id}>
                    <td>
                      <button
                        type="button"
                        onClick={() => copyCode(c.code)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        <span className="mono" style={{ fontWeight: 600, color: "var(--brand)" }}>{c.code}</span>
                        <Copy size={12} style={{ color: "var(--text-3)" }} />
                      </button>
                    </td>
                    <td>
                      <BadgeNew tone={c.type === "percentage" ? "info" : "brand"}>
                        {c.type === "percentage" ? "%" : "$ fijo"}
                      </BadgeNew>
                    </td>
                    <td className="mono" style={{ color: "var(--text-1)", fontWeight: 500 }}>
                      {c.type === "percentage" ? `${c.value}%` : fmtMXN(c.value)}
                    </td>
                    <td className="mono" style={{ color: "var(--text-2)" }}>
                      {c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : " / ∞"}
                    </td>
                    <td className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>
                      {c.validUntil ? formatRelativeDate(c.validUntil) : "Sin fin"}
                    </td>
                    <td>
                      <BadgeNew tone="neutral">
                        {c.appliesTo === "all" ? "Todos" : c.appliesTo}
                      </BadgeNew>
                    </td>
                    <td>
                      <BadgeNew tone={expired ? "neutral" : isActive ? "success" : "warning"} dot>
                        {expired ? "Expirado" : isActive ? "Activo" : "Pausado"}
                      </BadgeNew>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <ButtonNew size="sm" variant="ghost" onClick={() => toggleActive(c)}>
                          {c.active ? "Pausar" : "Activar"}
                        </ButtonNew>
                        <ButtonNew
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 size={13} />}
                          onClick={() => remove(c.id)}
                          style={{ color: "var(--danger)" }}
                          aria-label="Eliminar"
                        >
                          Eliminar
                        </ButtonNew>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardNew>

      {/* Create modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Nuevo cupón</div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="btn-new btn-new--ghost btn-new--sm"
                aria-label="Cerrar"
              >
                <X size={14} />
              </button>
            </div>

            <div className="modal__body">
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <div className="form-section__title">
                    Código y descuento
                    <span className="form-section__rule" />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="field-new">
                      <label className="field-new__label">
                        Código <span className="req">*</span>
                      </label>
                      <input
                        className="input-new mono"
                        placeholder="LANZAMIENTO20"
                        value={form.code}
                        onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                        style={{ textTransform: "uppercase" }}
                      />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div className="field-new">
                        <label className="field-new__label">Tipo</label>
                        <select
                          className="input-new"
                          value={form.type}
                          onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}
                        >
                          <option value="percentage">% descuento</option>
                          <option value="fixed">$ fijo</option>
                        </select>
                      </div>
                      <div className="field-new">
                        <label className="field-new__label">
                          Valor <span className="req">*</span>
                        </label>
                        <input
                          type="number"
                          className="input-new"
                          placeholder={form.type === "percentage" ? "20" : "100"}
                          value={form.value}
                          onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="form-section__title">
                    Restricciones
                    <span className="form-section__rule" />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="field-new">
                      <label className="field-new__label">Aplica a</label>
                      <select
                        className="input-new"
                        value={form.appliesTo}
                        onChange={e => setForm(f => ({ ...f, appliesTo: e.target.value as any }))}
                      >
                        <option value="all">Todos los planes</option>
                        <option value="BASIC">Solo BASIC</option>
                        <option value="PRO">Solo PRO</option>
                        <option value="CLINIC">Solo CLINIC</option>
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div className="field-new">
                        <label className="field-new__label">Usos máximos</label>
                        <input
                          type="number"
                          className="input-new"
                          placeholder="Ilimitado"
                          value={form.maxUses}
                          onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}
                        />
                      </div>
                      <div className="field-new">
                        <label className="field-new__label">Válido hasta</label>
                        <input
                          type="date"
                          className="input-new"
                          value={form.validUntil}
                          onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal__footer">
              <ButtonNew variant="ghost" onClick={() => setShowModal(false)}>
                Cancelar
              </ButtonNew>
              <ButtonNew variant="primary" onClick={create} disabled={saving}>
                {saving ? "Creando…" : "Crear cupón"}
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
