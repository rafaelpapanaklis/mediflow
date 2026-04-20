"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import toast from "react-hot-toast";

interface Props { open: boolean; onClose: () => void; onCreated: (patient: any) => void; }

const emptyForm = {
  firstName: "", lastName: "", email: "", phone: "", gender: "OTHER",
  dob: "", address: "", allergies: "", notes: "", isChild: false,
};

export function NewPatientModal({ open, onClose, onCreated }: Props) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName || !form.lastName) { toast.error("Nombre y apellido requeridos"); return; }
    setLoading(true);
    try {
      const dupeCheck = await fetch(`/api/patients?search=${encodeURIComponent(form.firstName + " " + form.lastName)}`);
      if (dupeCheck.ok) {
        const existing = await dupeCheck.json();
        if (Array.isArray(existing) && existing.length > 0) {
          const confirmed = window.confirm(`Ya existe un paciente con nombre "${form.firstName} ${form.lastName}". ¿Deseas crear otro de todos modos?`);
          if (!confirmed) { setLoading(false); return; }
        }
      }
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          isChild: form.isChild,
          allergies: form.allergies ? form.allergies.split(",").map(s => s.trim()).filter(Boolean) : [],
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const patient = await res.json();
      onCreated(patient);
      setForm(emptyForm);
      toast.success(`Paciente ${patient.firstName} creado`);
    } catch (err: any) {
      toast.error(err.message ?? "Error al crear paciente");
    } finally { setLoading(false); }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">Nuevo paciente</div>
          <button onClick={onClose} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal__body">
            {/* Sección: Identidad */}
            <div style={{ marginBottom: 22 }}>
              <div className="form-section__title">
                Identidad
                <span className="form-section__rule" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
                <div className="field-new">
                  <label className="field-new__label">Nombre <span className="req">*</span></label>
                  <input className="input-new" placeholder="Ana" value={form.firstName} onChange={e => set("firstName", e.target.value)} />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Apellido <span className="req">*</span></label>
                  <input className="input-new" placeholder="García" value={form.lastName} onChange={e => set("lastName", e.target.value)} />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Fecha de nacimiento</label>
                  <input className="input-new" type="date" value={form.dob} onChange={e => set("dob", e.target.value)} />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Género</label>
                  <select className="input-new" value={form.gender} onChange={e => set("gender", e.target.value)}>
                    <option value="M">Masculino</option>
                    <option value="F">Femenino</option>
                    <option value="OTHER">Otro</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Sección: Contacto */}
            <div style={{ marginBottom: 22 }}>
              <div className="form-section__title">
                Contacto
                <span className="form-section__rule" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
                <div className="field-new">
                  <label className="field-new__label">Email</label>
                  <input className="input-new" type="email" placeholder="ana@email.com" value={form.email} onChange={e => set("email", e.target.value)} />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Teléfono</label>
                  <input className="input-new" placeholder="+52 55…" value={form.phone} onChange={e => set("phone", e.target.value)} />
                </div>
                <div className="field-new" style={{ gridColumn: "1 / -1" }}>
                  <label className="field-new__label">Dirección</label>
                  <input className="input-new" placeholder="Calle, colonia, ciudad" value={form.address} onChange={e => set("address", e.target.value)} />
                </div>
              </div>
            </div>

            {/* Sección: Tipo + Clínico */}
            <div style={{ marginBottom: 6 }}>
              <div className="form-section__title">
                Perfil clínico
                <span className="form-section__rule" />
              </div>
              <div className="field-new" style={{ marginBottom: 12 }}>
                <label className="field-new__label">Tipo de paciente</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => set("isChild", false)}
                    className={`btn-new ${!form.isChild ? "btn-new--primary" : "btn-new--secondary"}`}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    Adulto
                  </button>
                  <button
                    type="button"
                    onClick={() => set("isChild", true)}
                    className={`btn-new ${form.isChild ? "btn-new--primary" : "btn-new--secondary"}`}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    Niño (dentición temporal)
                  </button>
                </div>
              </div>
              <div className="field-new" style={{ marginBottom: 12 }}>
                <label className="field-new__label">Alergias (separadas por coma)</label>
                <input className="input-new" placeholder="Penicilina, Látex…" value={form.allergies} onChange={e => set("allergies", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">Notas</label>
                <textarea
                  className="input-new"
                  style={{ height: 64, paddingTop: 8, resize: "vertical" }}
                  placeholder="Motivo de consulta, antecedentes…"
                  value={form.notes}
                  onChange={e => set("notes", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="modal__footer">
            <ButtonNew variant="ghost" onClick={onClose} type="button">Cancelar</ButtonNew>
            <ButtonNew variant="primary" type="submit" disabled={loading}>
              {loading ? "Guardando…" : "Crear paciente"}
            </ButtonNew>
          </div>
        </form>
      </div>
    </div>
  );
}
