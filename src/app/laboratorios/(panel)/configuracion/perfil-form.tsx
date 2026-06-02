"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { DENTAL_LAB_STATUS_LABELS, type DentalLabStatus } from "@/lib/laboratorios/types";

interface PerfilInitial {
  name: string;
  email: string;
  slug: string;
  status: DentalLabStatus;
  rfc: string;
  phone: string;
  whatsapp: string;
  website: string;
  description: string;
  address: string;
  city: string;
  state: string;
  founded: number | null;
}

const STATUS_TONE: Record<DentalLabStatus, "success" | "warning" | "danger"> = {
  APPROVED: "success",
  PENDING: "warning",
  REJECTED: "danger",
  SUSPENDED: "danger",
};

export function PerfilForm({ canEdit, initial }: { canEdit: boolean; initial: PerfilInitial }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(initial.name);
  const [rfc, setRfc] = useState(initial.rfc);
  const [phone, setPhone] = useState(initial.phone);
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp);
  const [website, setWebsite] = useState(initial.website);
  const [description, setDescription] = useState(initial.description);
  const [address, setAddress] = useState(initial.address);
  const [city, setCity] = useState(initial.city);
  const [state, setState] = useState(initial.state);
  const [founded, setFounded] = useState(initial.founded != null ? String(initial.founded) : "");

  async function save() {
    if (!name.trim()) {
      toast.error("El nombre del laboratorio es requerido.");
      return;
    }
    if (founded.trim() !== "") {
      const y = Math.floor(Number(founded));
      if (!Number.isInteger(y) || y < 1900 || y > 2100) {
        toast.error("El año de fundación no es válido.");
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch("/api/laboratorios/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          rfc,
          phone,
          whatsapp,
          website,
          description,
          address,
          city,
          state,
          founded: founded.trim() === "" ? null : Math.floor(Number(founded)),
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
          Solo el propietario o un gerente del laboratorio puede editar la configuración. Tienes acceso de solo lectura.
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
              {DENTAL_LAB_STATUS_LABELS[initial.status]}
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

      {/* Datos del laboratorio */}
      <CardNew>
        <div className="form-section__title">
          Datos del laboratorio <span className="form-section__rule" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field-new">
            <label className="field-new__label">Nombre comercial</label>
            <input
              className="input-new"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="Nombre del laboratorio"
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
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
              <label className="field-new__label">Año de fundación</label>
              <input
                className="input-new mono"
                type="number"
                inputMode="numeric"
                value={founded}
                onChange={(e) => setFounded(e.target.value)}
                disabled={!canEdit || saving}
                placeholder="Opcional"
              />
            </div>
          </div>
          <div className="field-new">
            <label className="field-new__label">Descripción</label>
            <textarea
              className="input-new"
              style={{ minHeight: 90, height: "auto", resize: "vertical", paddingTop: 8 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="Describe tu laboratorio para las clínicas…"
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
            <label className="field-new__label">WhatsApp</label>
            <input
              className="input-new"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              disabled={!canEdit || saving}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Sitio web</label>
            <input
              className="input-new"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="https://"
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
