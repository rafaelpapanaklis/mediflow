"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  SUPPLIER_CATEGORY_OPTIONS,
  SUPPLIER_PAYMENT_METHOD_OPTIONS,
  SUPPLIER_STATUS_LABELS,
} from "@/lib/suppliers/types";
import type { SupplierStatus } from "@/lib/suppliers/types";

interface ProfileInitial {
  businessName: string;
  email: string;
  slug: string;
  status: SupplierStatus;
  rfc: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  description: string;
  categories: string[];
  paymentMethods: string[];
}

const STATUS_TONE: Record<SupplierStatus, "success" | "warning" | "danger"> = {
  APPROVED: "success",
  PENDING: "warning",
  REJECTED: "danger",
  SUSPENDED: "danger",
};

export function ProfileForm({ canEdit, initial }: { canEdit: boolean; initial: ProfileInitial }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [businessName, setBusinessName] = useState(initial.businessName);
  const [rfc, setRfc] = useState(initial.rfc);
  const [phone, setPhone] = useState(initial.phone);
  const [address, setAddress] = useState(initial.address);
  const [city, setCity] = useState(initial.city);
  const [state, setState] = useState(initial.state);
  const [description, setDescription] = useState(initial.description);
  const [categories, setCategories] = useState<string[]>(initial.categories);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(initial.paymentMethods);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    if (!canEdit) return;
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function save() {
    if (!businessName.trim()) {
      toast.error("El nombre del negocio es requerido.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/proveedores/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          rfc,
          phone,
          address,
          city,
          state,
          description,
          categories,
          paymentMethods,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "No se pudo guardar el perfil.");
      }
      toast.success("Perfil actualizado");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const chip = (active: boolean): React.CSSProperties => ({
    textDecoration: "none",
    cursor: canEdit ? "pointer" : "default",
    opacity: canEdit ? 1 : 0.7,
    fontFamily: "inherit",
    ...(active
      ? { background: "var(--brand-soft)", color: "#c4b5fd", borderColor: "rgba(124,58,237,0.4)" }
      : {}),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!canEdit && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--warning-soft)",
            border: "1px solid rgba(245,158,11,0.25)",
            color: "#fcd34d",
            fontSize: 12,
          }}
        >
          Solo el propietario o un gerente del negocio puede editar el perfil. Tienes acceso de solo lectura.
        </div>
      )}

      {/* Estado de la cuenta (solo lectura) */}
      <CardNew>
        <div className="form-section__title">
          Estado de la cuenta <span className="form-section__rule" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--text-3)" }}>Estado</span>
            <BadgeNew tone={STATUS_TONE[initial.status]} dot>
              {SUPPLIER_STATUS_LABELS[initial.status]}
            </BadgeNew>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--text-3)" }}>Correo (inicio de sesión)</span>
            <span style={{ color: "var(--text-1)", wordBreak: "break-word" }}>{initial.email}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--text-3)" }}>URL pública</span>
            <span className="mono" style={{ color: "var(--text-2)" }}>/{initial.slug}</span>
          </div>
        </div>
      </CardNew>

      {/* Datos del negocio */}
      <CardNew>
        <div className="form-section__title">
          Datos del negocio <span className="form-section__rule" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field-new">
            <label className="field-new__label">Nombre comercial</label>
            <input
              className="input-new"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="Nombre del negocio"
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">RFC</label>
            <input
              className="input-new"
              value={rfc}
              onChange={(e) => setRfc(e.target.value)}
              disabled={!canEdit || saving}
              maxLength={13}
              placeholder="Opcional"
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Descripción</label>
            <textarea
              className="input-new"
              style={{ minHeight: 90, height: "auto", resize: "vertical", paddingTop: 8 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="Describe tu negocio para las clínicas…"
            />
          </div>
        </div>
      </CardNew>

      {/* Contacto y ubicación */}
      <CardNew>
        <div className="form-section__title">
          Contacto y ubicación <span className="form-section__rule" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div className="field-new">
            <label className="field-new__label">Teléfono</label>
            <input
              className="input-new"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!canEdit || saving}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Ciudad</label>
            <input
              className="input-new"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={!canEdit || saving}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Estado</label>
            <input
              className="input-new"
              value={state}
              onChange={(e) => setState(e.target.value)}
              disabled={!canEdit || saving}
            />
          </div>
          <div className="field-new" style={{ gridColumn: "1 / -1" }}>
            <label className="field-new__label">Dirección</label>
            <input
              className="input-new"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!canEdit || saving}
            />
          </div>
        </div>
      </CardNew>

      {/* Categorías */}
      <CardNew>
        <div className="form-section__title">
          Categorías <span className="form-section__rule" />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SUPPLIER_CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className="tag-new"
              style={chip(categories.includes(opt))}
              disabled={!canEdit || saving}
              onClick={() => toggle(categories, setCategories, opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      </CardNew>

      {/* Métodos de pago */}
      <CardNew>
        <div className="form-section__title">
          Métodos de pago aceptados <span className="form-section__rule" />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SUPPLIER_PAYMENT_METHOD_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className="tag-new"
              style={chip(paymentMethods.includes(opt))}
              disabled={!canEdit || saving}
              onClick={() => toggle(paymentMethods, setPaymentMethods, opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      </CardNew>

      {canEdit && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <ButtonNew variant="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </ButtonNew>
        </div>
      )}
    </div>
  );
}
