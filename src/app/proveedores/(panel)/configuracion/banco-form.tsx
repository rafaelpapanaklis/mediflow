"use client";

import { useState } from "react";
import { Plus, Trash2, Loader2, Landmark, X, CreditCard } from "lucide-react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { SupplierBankAccountDTO } from "@/lib/suppliers/types";

function blank() {
  return { bank: "", clabe: "", accountNumber: "", holderName: "", isPrimary: false };
}

export function BancoForm({
  canEdit,
  initial,
}: {
  canEdit: boolean;
  initial: SupplierBankAccountDTO[];
}) {
  const askConfirm = useConfirm();
  const [accounts, setAccounts] = useState<SupplierBankAccountDTO[]>(initial);
  const [showForm, setShowForm] = useState(false);
  const [fields, setFields] = useState(blank());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  async function reload() {
    const res = await fetch("/api/proveedores/bank-accounts");
    if (res.ok) {
      const data = (await res.json().catch(() => [])) as SupplierBankAccountDTO[];
      setAccounts(Array.isArray(data) ? data : []);
    }
  }

  function openCreate() {
    setFields(blank());
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setFields(blank());
  }

  async function save() {
    if (!fields.bank.trim()) return toast.error("El banco es requerido.");
    if (!fields.holderName.trim()) return toast.error("El titular de la cuenta es requerido.");
    if (!/^\d{18}$/.test(fields.clabe.trim())) return toast.error("La CLABE debe tener 18 dígitos.");

    setSaving(true);
    try {
      const res = await fetch("/api/proveedores/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank: fields.bank.trim(),
          clabe: fields.clabe.trim(),
          accountNumber: fields.accountNumber.trim() || null,
          holderName: fields.holderName.trim(),
          isPrimary: fields.isPrimary,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "No se pudo guardar la cuenta.");
      }
      toast.success("Cuenta agregada");
      await reload();
      closeForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: SupplierBankAccountDTO) {
    const ok = await askConfirm({
      title: "¿Eliminar esta cuenta?",
      description: `La cuenta de ${a.bank} (${a.holderName}) se eliminará. Esta acción no se puede deshacer.`,
      variant: "danger",
      confirmText: "Eliminar",
    });
    if (!ok) return;
    setBusyId(a.id);
    try {
      const res = await fetch(`/api/proveedores/bank-accounts?id=${encodeURIComponent(a.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d?.error ?? "No se pudo eliminar la cuenta.");
        return;
      }
      toast.success("Cuenta eliminada");
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <CardNew>
      <span
        aria-hidden
        style={{
          position: "absolute",
          insetInline: 0,
          top: 0,
          height: 3,
          background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
          pointerEvents: "none",
        }}
      />
      <div className="form-section__title">
        <Landmark size={13} style={{ color: "var(--brand)" }} /> Cuentas bancarias (SPEI){" "}
        <span className="form-section__rule" />
      </div>
      <p style={{ color: "var(--text-3)", fontSize: 12, marginTop: -4, marginBottom: 14 }}>
        Cuentas a las que las clínicas transferirán el pago de tus pedidos.
      </p>

      {/* Lista de cuentas */}
      {accounts.length === 0 ? (
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            border: "1px dashed var(--border-strong)",
            borderRadius: 10,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              display: "grid",
              placeItems: "center",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
              color: "var(--brand)",
            }}
          >
            <CreditCard size={26} />
          </div>
          <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
            Aún no agregas cuentas bancarias
          </div>
          <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
            Agrega una cuenta CLABE para que las clínicas puedan transferirte el pago de tus pedidos.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {accounts.map((a) => {
            const busy = busyId === a.id;
            const hovered = hoverId === a.id;
            return (
              <div
                key={a.id}
                onMouseEnter={() => setHoverId(a.id)}
                onMouseLeave={() => setHoverId((id) => (id === a.id ? null : id))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: `1px solid ${hovered ? "var(--border-brand)" : "var(--border-soft)"}`,
                  background: "var(--bg-elev)",
                  boxShadow: hovered ? "0 6px 16px -10px rgba(124,58,237,0.55)" : "none",
                  transform: hovered ? "translateY(-1px)" : "none",
                  transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      background: "linear-gradient(135deg, var(--brand-softer), var(--brand-soft))",
                      border: "1px solid var(--border-brand)",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Landmark size={16} style={{ color: "var(--brand)" }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{a.bank}</span>
                      {a.isPrimary && (
                        <BadgeNew tone="brand" dot>
                          Principal
                        </BadgeNew>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-3)" }}>{a.holderName}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-4)" }}>
                      CLABE {a.clabe}
                    </div>
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: "inline-flex", gap: 4 }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(a)}
                      className="btn-new btn-new--ghost btn-new--sm"
                      style={{ padding: 0, width: 28, color: "var(--danger)" }}
                      aria-label="Eliminar"
                      title="Eliminar"
                    >
                      {busy ? <Loader2 className="animate-spin" size={12} /> : <Trash2 size={12} />}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Formulario de alta */}
      {canEdit && showForm && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 10,
            border: "1px solid var(--border-soft)",
            background: "var(--bg-elev)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  display: "grid",
                  placeItems: "center",
                  background: "var(--brand-soft)",
                  border: "1px solid var(--border-brand)",
                  color: "var(--brand)",
                  flexShrink: 0,
                }}
              >
                <Plus size={13} />
              </span>
              Nueva cuenta
            </div>
            <button
              type="button"
              onClick={closeForm}
              className="btn-new btn-new--ghost btn-new--sm"
              style={{ padding: 0, width: 28 }}
              aria-label="Cerrar"
            >
              <X size={14} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div className="field-new">
                <label className="field-new__label">Banco</label>
                <input
                  className="input-new"
                  value={fields.bank}
                  onChange={(e) => setFields((f) => ({ ...f, bank: e.target.value }))}
                  disabled={saving}
                  placeholder="Ej: BBVA"
                  maxLength={100}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Titular</label>
                <input
                  className="input-new"
                  value={fields.holderName}
                  onChange={(e) => setFields((f) => ({ ...f, holderName: e.target.value }))}
                  disabled={saving}
                  placeholder="Nombre del titular"
                  maxLength={200}
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div className="field-new">
                <label className="field-new__label">CLABE (18 dígitos)</label>
                <input
                  className="input-new mono"
                  value={fields.clabe}
                  onChange={(e) => setFields((f) => ({ ...f, clabe: e.target.value.replace(/\D/g, "").slice(0, 18) }))}
                  disabled={saving}
                  inputMode="numeric"
                  placeholder="000000000000000000"
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Número de cuenta</label>
                <input
                  className="input-new mono"
                  value={fields.accountNumber}
                  onChange={(e) => setFields((f) => ({ ...f, accountNumber: e.target.value }))}
                  disabled={saving}
                  placeholder="Opcional"
                  maxLength={30}
                />
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={fields.isPrimary}
                onChange={(e) => setFields((f) => ({ ...f, isPrimary: e.target.checked }))}
                disabled={saving}
              />
              Marcar como cuenta principal
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <ButtonNew variant="ghost" type="button" onClick={closeForm} disabled={saving}>
                Cancelar
              </ButtonNew>
              <ButtonNew
                variant="primary"
                type="button"
                onClick={save}
                disabled={saving}
                icon={saving ? <Loader2 className="animate-spin" size={14} /> : undefined}
              >
                Agregar cuenta
              </ButtonNew>
            </div>
          </div>
        </div>
      )}

      {canEdit && !showForm && (
        <div style={{ marginTop: 14 }}>
          <ButtonNew variant="secondary" icon={<Plus size={14} />} onClick={openCreate}>
            Agregar cuenta
          </ButtonNew>
        </div>
      )}
    </CardNew>
  );
}
