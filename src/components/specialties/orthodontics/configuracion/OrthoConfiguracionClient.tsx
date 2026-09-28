"use client";
// Ortodoncia — Configuración del submenú (Ola 1, ws1-t3 · «Acceso y
// permisos»). Doctor tratante por defecto, catálogo de tipos de cita (C7:
// valoración, toma de registros, colocación, control, urgencia, retiro,
// control de retención — la parte «Control y agenda» solo cablea el chip de
// "Control de ortodoncia" en la Agenda; el resto del catálogo se administra
// aquí) y plantillas de mensaje.

import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { updateOrthoClinicSettings } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import type {
  OrthoAppointmentTypeOption,
  OrthoClinicSettings,
} from "@/lib/orthodontics/clinic-settings-db";
import type { OrthoConfigDoctorOption } from "@/app/actions/orthodontics/getOrthoClinicSettings";

export interface OrthoConfiguracionClientProps {
  settings: OrthoClinicSettings;
  doctors: OrthoConfigDoctorOption[];
}

function nuevoIdTipoCita(existentes: OrthoAppointmentTypeOption[]): string {
  let n = existentes.length + 1;
  while (existentes.some((t) => t.id === `tipo-${n}`)) n++;
  return `tipo-${n}`;
}

const PLANTILLAS_CLAVES: { clave: string; etiqueta: string; ayuda: string }[] = [
  {
    clave: "recordatorioControl",
    etiqueta: "Recordatorio de control",
    ayuda: "WhatsApp que se manda antes de la cita de control. Variables: {paciente}, {fecha}, {hora}.",
  },
  {
    clave: "avisoMensualidadVencida",
    etiqueta: "Aviso de mensualidad vencida",
    ayuda: "WhatsApp cuando una mensualidad de la factura a plazos vence sin cobrarse. Variables: {paciente}, {monto}.",
  },
];

export function OrthoConfiguracionClient({ settings, doctors }: OrthoConfiguracionClientProps) {
  const [defaultTreatingDoctorId, setDefaultTreatingDoctorId] = useState<string>(
    settings.defaultTreatingDoctorId ?? "",
  );
  const [appointmentTypes, setAppointmentTypes] = useState<OrthoAppointmentTypeOption[]>(
    settings.appointmentTypes,
  );
  const [templates, setTemplates] = useState<Record<string, string>>(settings.messageTemplates);
  const [saving, setSaving] = useState(false);

  function actualizarTipo(id: string, campo: "id" | "label", valor: string) {
    setAppointmentTypes((arr) => arr.map((t) => (t.id === id ? { ...t, [campo]: valor } : t)));
  }

  function quitarTipo(id: string) {
    setAppointmentTypes((arr) => arr.filter((t) => t.id !== id));
  }

  function agregarTipo() {
    setAppointmentTypes((arr) => [...arr, { id: nuevoIdTipoCita(arr), label: "" }]);
  }

  async function guardar() {
    if (appointmentTypes.length === 0) {
      toast.error("Deja al menos un tipo de cita en el catálogo.");
      return;
    }
    if (appointmentTypes.some((t) => !t.id.trim() || !t.label.trim())) {
      toast.error("Cada tipo de cita necesita clave y nombre.");
      return;
    }
    setSaving(true);
    try {
      const res = await updateOrthoClinicSettings({
        defaultTreatingDoctorId: defaultTreatingDoctorId || null,
        appointmentTypes,
        messageTemplates: templates,
      });
      if (isFailure(res)) {
        toast.error(res.error);
        return;
      }
      toast.success("Configuración de Ortodoncia guardada.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-4" style={{ padding: 24, maxWidth: 640 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>
            Doctor tratante por defecto
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>
            Se pre-rellena al abrir un caso nuevo — cada caso lo puede cambiar por su cuenta.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Doctor</Label>
          <select
            className="input-new"
            value={defaultTreatingDoctorId}
            onChange={(e) => setDefaultTreatingDoctorId(e.target.value)}
          >
            <option value="">Sin doctor por defecto</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {doctors.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>
              Esta clínica no tiene doctores dados de alta todavía (Equipo → Nuevo miembro).
            </div>
          )}
        </div>
      </div>

      <div className="card space-y-4" style={{ padding: 24, maxWidth: 640 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>
            Tipos de cita de Ortodoncia
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>
            Catálogo propio del módulo (valoración, toma de registros, colocación, control,
            urgencia, retiro, control de retención). El chip de &quot;Control de ortodoncia&quot; en la
            Agenda es aparte — este catálogo es de referencia para el resto de tipos.
          </p>
        </div>
        <div className="space-y-2">
          {appointmentTypes.map((tipo) => (
            <div key={tipo.id} className="flex items-center gap-2">
              <Input
                value={tipo.label}
                placeholder="Nombre visible"
                onChange={(e) => actualizarTipo(tipo.id, "label", e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => quitarTipo(tipo.id)}
                className="underline"
                style={{ fontSize: 12, color: "var(--danger-strong, #dc2626)" }}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={agregarTipo}
          className="underline"
          style={{ fontSize: 12, color: "var(--text-3)" }}
        >
          + Agregar tipo de cita
        </button>
      </div>

      <div className="card space-y-4" style={{ padding: 24, maxWidth: 640 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>
            Plantillas de mensaje
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>
            Textos que usa el módulo para avisar por WhatsApp. Vacío = usa el texto por defecto.
          </p>
        </div>
        {PLANTILLAS_CLAVES.map((p) => (
          <div className="space-y-1.5" key={p.clave}>
            <Label>{p.etiqueta}</Label>
            <textarea
              className="input-new resize-y"
              style={{ height: "auto", padding: "10px 12px" }}
              rows={3}
              value={templates[p.clave] ?? ""}
              onChange={(e) => setTemplates((t) => ({ ...t, [p.clave]: e.target.value }))}
            />
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>{p.ayuda}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-end" style={{ maxWidth: 640 }}>
        <Button onClick={guardar} disabled={saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </div>
  );
}
