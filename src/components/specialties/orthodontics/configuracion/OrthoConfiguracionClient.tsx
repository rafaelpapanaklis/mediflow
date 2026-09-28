"use client";
// Ortodoncia — Configuración del submenú (Ola 1, ws1-t3 · «Acceso y
// permisos»). Doctor tratante por defecto, catálogo de tipos de cita (C7,
// ÚNICO — ver clinic-settings-db.ts — que new-appointment-dialog.tsx pide a
// /api/orthodontics/context y ofrece como chips de motivo al agendar) y
// plantillas de mensaje. La entrada "Control de ortodoncia" es de solo
// lectura: la Agenda la reconoce por su texto exacto (esCitaControlOrto).
//
// Diseño (ws1-t3): mismos campos, mismas validaciones y el mismo guardado.
// Cambia cómo se pinta: tarjetas del rediseño, campos con su etiqueta
// enlazada, «Quitar» como botón con nombre y el tipo fijo con su candado y
// su explicación a la vista (antes solo salía al pasar el ratón).

import { useId, useState } from "react";
import toast from "react-hot-toast";
import { CalendarClock, Lock, MessageSquareText, Plus, Stethoscope, Trash2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Pantalla, Tarjeta } from "@/components/specialties/orthodontics/modulo/piezas";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";
import { updateOrthoClinicSettings } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import type {
  OrthoAppointmentTypeOption,
  OrthoClinicSettings,
} from "@/lib/orthodontics/clinic-settings-db";
import type { OrthoConfigDoctorOption } from "@/app/actions/orthodontics/getOrthoClinicSettings";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";

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
    const tipo = appointmentTypes.find((t) => t.id === id);
    if (tipo?.label === TIPO_CITA_CONTROL_ORTO) {
      toast.error(`No se puede quitar "${TIPO_CITA_CONTROL_ORTO}" — la Agenda lo usa para reconocer los controles.`);
      return;
    }
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

  const idDoctor = useId();
  const idPlantilla = useId();

  return (
    <Pantalla
      titulo="Configuración"
      sub="Lo que el módulo de Ortodoncia usa por defecto en esta clínica."
      acciones={
        <ButtonNew type="button" variant="primary" onClick={guardar} disabled={saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </ButtonNew>
      }
    >
      <div className={s.formulario}>
        <div className={s.formularioColumna}>
          <Tarjeta
            icono={Stethoscope}
            titulo="Doctor tratante por defecto"
            sub="Se pre-rellena al abrir un caso nuevo — cada caso lo puede cambiar por su cuenta."
          >
            <div className={s.tarjetaCuerpo}>
              <div className={s.campo}>
                <label className={s.campoEtiqueta} htmlFor={idDoctor}>
                  Doctor
                </label>
                <select
                  id={idDoctor}
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
                  <div className={s.campoAyuda}>
                    Esta clínica no tiene doctores dados de alta todavía (Equipo → Nuevo miembro).
                  </div>
                )}
              </div>
            </div>
          </Tarjeta>

          <Tarjeta
            icono={CalendarClock}
            titulo="Tipos de cita de Ortodoncia"
            sub="Estos textos son los que aparecen como chips de motivo al agendar una cita en la Agenda, cuando el módulo de Ortodoncia está activo — un solo catálogo, editable aquí."
          >
            <div className={s.tarjetaCuerpo}>
              <ul className={s.tipos}>
                {appointmentTypes.map((tipo, i) => {
                  const esControl = tipo.label === TIPO_CITA_CONTROL_ORTO;
                  return (
                    <li key={tipo.id} className={s.tipo}>
                      <input
                        type="text"
                        className={s.campoEntrada}
                        value={tipo.label}
                        placeholder="Nombre visible"
                        aria-label={`Tipo de cita ${i + 1}`}
                        onChange={(e) => actualizarTipo(tipo.id, "label", e.target.value)}
                        disabled={esControl}
                        title={esControl ? "La Agenda reconoce los controles por este texto exacto — no se puede editar." : undefined}
                      />
                      {esControl ? (
                        <span className={s.candado} title="Fijo: la Agenda lo usa para reconocer los controles.">
                          <Lock size={15} strokeWidth={1.9} aria-hidden />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => quitarTipo(tipo.id)}
                          className={s.botonIcono}
                          aria-label={`Quitar ${tipo.label.trim() || `el tipo de cita ${i + 1}`}`}
                          title="Quitar"
                        >
                          <Trash2 size={15} strokeWidth={1.9} aria-hidden />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className={s.pie}>
                «{TIPO_CITA_CONTROL_ORTO}» es fijo: la Agenda reconoce los controles por ese texto exacto.
              </p>
              <div style={{ marginTop: 12 }}>
                <ButtonNew
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={15} strokeWidth={1.9} aria-hidden />}
                  onClick={agregarTipo}
                >
                  Agregar tipo de cita
                </ButtonNew>
              </div>
            </div>
          </Tarjeta>
        </div>

        <Tarjeta
          icono={MessageSquareText}
          titulo="Plantillas de mensaje"
          sub="Textos que usa el módulo para avisar por WhatsApp. Vacío = usa el texto por defecto."
        >
          <div className={s.tarjetaCuerpo} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {PLANTILLAS_CLAVES.map((p) => (
              <div className={s.campo} key={p.clave}>
                <label className={s.campoEtiqueta} htmlFor={`${idPlantilla}-${p.clave}`}>
                  {p.etiqueta}
                </label>
                <textarea
                  id={`${idPlantilla}-${p.clave}`}
                  className="input-new"
                  rows={3}
                  value={templates[p.clave] ?? ""}
                  aria-describedby={`${idPlantilla}-${p.clave}-ayuda`}
                  onChange={(e) => setTemplates((t) => ({ ...t, [p.clave]: e.target.value }))}
                />
                <div className={s.campoAyuda} id={`${idPlantilla}-${p.clave}-ayuda`}>
                  {p.ayuda}
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>

        <div className={s.barraGuardar}>
          <ButtonNew type="button" variant="primary" onClick={guardar} disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </ButtonNew>
        </div>
      </div>
    </Pantalla>
  );
}
