"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import toast from "react-hot-toast";
import { Drawer } from "@/components/ui/design-system/Drawer";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { DENTAL_LAB_SERVICES, type DentalLabServiceDTO } from "@/lib/laboratorios/types";

const UNIT_OPTIONS = ["pieza", "arcada", "juego", "par", "modelo", "diente", "unidad"];

type Props = {
  onClose: () => void;
  onSaved: (svc: DentalLabServiceDTO, mode: "create" | "edit") => void;
} & ({ mode: "create"; service?: undefined } | { mode: "edit"; service: DentalLabServiceDTO });

export function ServicioForm(props: Props) {
  const editing = props.mode === "edit";
  const service = props.mode === "edit" ? props.service : undefined;

  const [serviceKey, setServiceKey] = useState(service?.serviceKey ?? DENTAL_LAB_SERVICES[0].key);
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [priceFrom, setPriceFrom] = useState(service ? String(service.priceFrom) : "");
  const [unit, setUnit] = useState(service?.unit ?? "pieza");
  const [daysMin, setDaysMin] = useState(service?.daysMin != null ? String(service.daysMin) : "");
  const [daysMax, setDaysMax] = useState(service?.daysMax != null ? String(service.daysMax) : "");
  const [isActive, setIsActive] = useState(service?.isActive ?? true);

  const [saving, setSaving] = useState(false);

  function onKeyChange(key: string) {
    setServiceKey(key);
    // En alta, si el nombre está vacío, sugerimos el nombre completo del catálogo.
    if (!editing && !name.trim()) {
      const found = DENTAL_LAB_SERVICES.find((s) => s.key === key);
      if (found) setName(found.full);
    }
  }

  function validate(): string | null {
    if (!DENTAL_LAB_SERVICES.some((s) => s.key === serviceKey)) return "El tipo de servicio no es válido.";
    if (!name.trim()) return "El nombre del servicio es requerido.";
    const p = Number(priceFrom);
    if (priceFrom.trim() === "" || !Number.isFinite(p) || p < 0) {
      return "El precio debe ser un número mayor o igual a 0.";
    }
    const min = daysMin.trim() === "" ? null : Math.floor(Number(daysMin));
    const max = daysMax.trim() === "" ? null : Math.floor(Number(daysMax));
    if (min !== null && (!Number.isInteger(min) || min < 0)) return "Los días mínimos deben ser un entero ≥ 0.";
    if (max !== null && (!Number.isInteger(max) || max < 0)) return "Los días máximos deben ser un entero ≥ 0.";
    if (min !== null && max !== null && min > max) return "El mínimo de días no puede ser mayor que el máximo.";
    return null;
  }

  function buildPayload() {
    return {
      serviceKey,
      name: name.trim(),
      description: description.trim() || null,
      priceFrom: Number(priceFrom),
      unit: unit.trim() || "pieza",
      daysMin: daysMin.trim() === "" ? null : Math.floor(Number(daysMin)),
      daysMax: daysMax.trim() === "" ? null : Math.floor(Number(daysMax)),
      isActive,
    };
  }

  async function submit() {
    if (saving) return;
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const url = editing ? `/api/laboratorios/services/${service!.id}` : "/api/laboratorios/services";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "No se pudo guardar el servicio.");
        return;
      }
      toast.success(editing ? "Cambios guardados" : "Servicio creado");
      props.onSaved(data as DentalLabServiceDTO, editing ? "edit" : "create");
    } catch {
      toast.error("Ocurrió un error. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={props.onClose}
      title={editing ? "Editar servicio" : "Nuevo servicio"}
      subtitle={editing ? "Actualiza los datos de este servicio." : "Agrega un servicio a tu catálogo."}
      width="md"
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <ButtonNew variant="ghost" type="button" onClick={props.onClose} disabled={saving}>
            Cancelar
          </ButtonNew>
          <ButtonNew
            variant="primary"
            type="button"
            onClick={submit}
            disabled={saving}
            icon={saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          >
            {editing ? "Guardar cambios" : "Crear servicio"}
          </ButtonNew>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="field-new">
          <label className="field-new__label">Tipo de servicio <span className="req">*</span></label>
          <select className="input-new" value={serviceKey} onChange={(e) => onKeyChange(e.target.value)}>
            {DENTAL_LAB_SERVICES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.short} — {s.full}
              </option>
            ))}
          </select>
        </div>

        <div className="field-new">
          <label className="field-new__label">Nombre <span className="req">*</span></label>
          <input
            className="input-new"
            placeholder="Ej: Corona de zirconio monolítico"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field-new">
          <label className="field-new__label">Descripción</label>
          <textarea
            className="input-new"
            style={{ height: 84, paddingTop: 8, resize: "vertical" }}
            placeholder="Materiales, acabado, tiempos, requisitos…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="field-new">
            <label className="field-new__label">Precio desde (MXN) <span className="req">*</span></label>
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              className="input-new mono"
              placeholder="0.00"
              value={priceFrom}
              onChange={(e) => setPriceFrom(e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Unidad</label>
            <select className="input-new" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="field-new">
            <label className="field-new__label">Entrega mínima (días)</label>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="input-new mono"
              placeholder="Opcional"
              value={daysMin}
              onChange={(e) => setDaysMin(e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Entrega máxima (días)</label>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="input-new mono"
              placeholder="Opcional"
              value={daysMax}
              onChange={(e) => setDaysMax(e.target.value)}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            marginTop: 4,
            paddingTop: 14,
            borderTop: "1px solid var(--border-soft)",
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>Visible en el catálogo</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
              Si lo desactivas, las clínicas no podrán verlo ni solicitarlo.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            aria-label="Visible en el catálogo"
            onClick={() => setIsActive((v) => !v)}
            style={{
              width: 44,
              height: 24,
              borderRadius: 999,
              border: "1px solid var(--border-strong)",
              background: isActive ? "var(--brand)" : "var(--bg-elev-2)",
              position: "relative",
              cursor: "pointer",
              transition: "background .15s",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: isActive ? 22 : 2,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#fff",
                transition: "left .15s",
              }}
            />
          </button>
        </div>
      </div>
    </Drawer>
  );
}
