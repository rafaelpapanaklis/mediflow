"use client";

// ═══════════════════════════════════════════════════════════════════════
// El formulario del prospecto — alta y edición, el MISMO.
//
// Uno solo y no dos: el día que se agregue un campo, tiene que aparecer en
// los dos lados sin que nadie se acuerde de ir a copiarlo. La ETAPA sólo
// se elige al dar de alta; después se cambia desde el tablero o la ficha,
// porque mover de etapa además escribe la bitácora (ver crmMoverEtapa).
//
// Valida con `crmValidarProspecto`, la MISMA función que vuelve a correr
// la server action. Si el formulario validara por su cuenta, el botón se
// pondría verde y la acción reventaría después.
// ═══════════════════════════════════════════════════════════════════════
import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import {
  crmValidarProspecto,
  crmValorDeInput,
  crmVertical,
  CRM_ETAPAS,
  CRM_FUENTES,
  CRM_VERTICALES,
} from "@/lib/admin/crm/crm-core";
import type { CrmProspectoDTO } from "@/lib/admin/crm/service";
import { actualizarProspectoAccion, crearProspectoAccion } from "./actions";

const AREA: React.CSSProperties = {
  height: "auto",
  minHeight: 74,
  padding: "8px 12px",
  lineHeight: 1.45,
  resize: "vertical",
};

interface Campos {
  name: string;
  vertical: string;
  stage: string;
  source: string;
  contactName: string;
  contactRole: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  country: string;
  website: string;
  size: string;
  monthlyValue: string;
  nextActionAt: string;
  nextActionNote: string;
  tags: string;
  notes: string;
}

function desdeProspecto(p?: CrmProspectoDTO | null): Campos {
  return {
    name: p?.name ?? "",
    vertical: p?.vertical ?? "DENTAL",
    stage: p?.stage ?? "NUEVO",
    source: p?.source ?? "",
    contactName: p?.contactName ?? "",
    contactRole: p?.contactRole ?? "",
    phone: p?.phone ?? "",
    email: p?.email ?? "",
    city: p?.city ?? "",
    state: p?.state ?? "",
    country: p?.country ?? "",
    website: p?.website ?? "",
    size: p?.size === null || p?.size === undefined ? "" : String(p.size),
    monthlyValue:
      p?.monthlyValue === null || p?.monthlyValue === undefined ? "" : String(p.monthlyValue),
    nextActionAt: crmValorDeInput(p?.nextActionAt),
    nextActionNote: p?.nextActionNote ?? "",
    tags: (p?.tags ?? []).join(", "),
    notes: p?.notes ?? "",
  };
}

export function CrmFormulario({
  prospecto,
  alCerrar,
  alGuardar,
}: {
  /** Con prospecto = editar; sin él = alta nueva. */
  prospecto?: CrmProspectoDTO | null;
  alCerrar: () => void;
  alGuardar?: (p: CrmProspectoDTO) => void;
}) {
  const editando = !!prospecto;
  const [c, setC] = useState<Campos>(() => desdeProspecto(prospecto));
  const [pendiente, startTransition] = useTransition();

  function set<K extends keyof Campos>(campo: K, valor: string) {
    setC((prev) => ({ ...prev, [campo]: valor }));
  }

  const entrada = {
    name: c.name,
    vertical: c.vertical,
    source: c.source || null,
    contactName: c.contactName,
    contactRole: c.contactRole,
    phone: c.phone,
    email: c.email,
    city: c.city,
    state: c.state,
    country: c.country,
    website: c.website,
    size: c.size,
    monthlyValue: c.monthlyValue,
    nextActionAt: c.nextActionAt || null,
    nextActionNote: c.nextActionNote,
    notes: c.notes,
    tags: c.tags,
  };

  // La misma validación que corre el servidor, sin la etapa cuando se
  // edita (ahí no se toca).
  const invalido = crmValidarProspecto(editando ? entrada : { ...entrada, stage: c.stage });

  function guardar() {
    if (invalido) {
      toast.error(invalido);
      return;
    }
    startTransition(async () => {
      const r = editando
        ? await actualizarProspectoAccion(prospecto!.id, entrada as any)
        : await crearProspectoAccion({ ...entrada, stage: c.stage } as any);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo guardar.");
        return;
      }
      toast.success(r.mensaje ?? "Guardado.");
      if (r.datos) alGuardar?.(r.datos);
      alCerrar();
    });
  }

  const medida = crmVertical(c.vertical).medida;

  return (
    <div className="modal-overlay" onClick={alCerrar}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-form-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <div className="modal__title" id="crm-form-titulo">
            {editando ? `Editar ${prospecto?.name}` : "Nuevo prospecto"}
          </div>
          <ButtonNew
            size="sm"
            variant="ghost"
            icon={<X size={14} />}
            onClick={alCerrar}
            aria-label="Cerrar"
          />
        </div>

        <div className="modal__body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* ── Quién es ─────────────────────────────────────────────── */}
          <div>
            <div className="form-section__title">
              El negocio
              <span className="form-section__rule" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field-new">
                <label className="field-new__label" htmlFor="crm-name">
                  Nombre <span className="req">*</span>
                </label>
                <input
                  id="crm-name"
                  className="input-new"
                  autoFocus
                  placeholder="Clínica Dental Sonrisa"
                  value={c.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-vertical">
                    Giro
                  </label>
                  <select
                    id="crm-vertical"
                    className="input-new"
                    value={c.vertical}
                    onChange={(e) => set("vertical", e.target.value)}
                  >
                    {CRM_VERTICALES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-source">
                    ¿De dónde salió?
                  </label>
                  <select
                    id="crm-source"
                    className="input-new"
                    value={c.source}
                    onChange={(e) => set("source", e.target.value)}
                  >
                    <option value="">Sin especificar</option>
                    {CRM_FUENTES.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!editando && (
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-stage">
                    Etapa de arranque
                  </label>
                  <select
                    id="crm-stage"
                    className="input-new"
                    value={c.stage}
                    onChange={(e) => set("stage", e.target.value)}
                  >
                    {CRM_ETAPAS.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                  <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "2px 0 0" }}>
                    Casi siempre es &laquo;Sin contactar&raquo;. Después se mueve arrastrando la
                    tarjeta en el tablero, y cada movimiento queda en la bitácora.
                  </p>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-city">
                    Ciudad
                  </label>
                  <input
                    id="crm-city"
                    className="input-new"
                    placeholder="Puebla"
                    value={c.city}
                    onChange={(e) => set("city", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-state">
                    Estado
                  </label>
                  <input
                    id="crm-state"
                    className="input-new"
                    placeholder="Puebla"
                    value={c.state}
                    onChange={(e) => set("state", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-country">
                    País
                  </label>
                  <input
                    id="crm-country"
                    className="input-new"
                    placeholder="México"
                    value={c.country}
                    onChange={(e) => set("country", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-size">
                    {medida}
                  </label>
                  <input
                    id="crm-size"
                    className="input-new"
                    type="number"
                    min={0}
                    placeholder="4"
                    value={c.size}
                    onChange={(e) => set("size", e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Con quién se habla ───────────────────────────────────── */}
          <div>
            <div className="form-section__title">
              Con quién se habla
              <span className="form-section__rule" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-contact">
                    Persona
                  </label>
                  <input
                    id="crm-contact"
                    className="input-new"
                    placeholder="Dra. Ana Ruiz"
                    value={c.contactName}
                    onChange={(e) => set("contactName", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-role">
                    Puesto
                  </label>
                  <input
                    id="crm-role"
                    className="input-new"
                    placeholder="Dueña / Directora"
                    value={c.contactRole}
                    onChange={(e) => set("contactRole", e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-phone">
                    WhatsApp / teléfono
                  </label>
                  <input
                    id="crm-phone"
                    className="input-new"
                    placeholder="55 1234 5678"
                    value={c.phone}
                    onChange={(e) => set("phone", e.target.value)}
                  />
                  <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "2px 0 0" }}>
                    Con 10 dígitos se activa el botón de WhatsApp.
                  </p>
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-email">
                    Correo
                  </label>
                  <input
                    id="crm-email"
                    className="input-new"
                    type="email"
                    placeholder="contacto@clinica.mx"
                    value={c.email}
                    onChange={(e) => set("email", e.target.value)}
                  />
                </div>
              </div>
              <div className="field-new">
                <label className="field-new__label" htmlFor="crm-web">
                  Sitio o redes
                </label>
                <input
                  id="crm-web"
                  className="input-new"
                  placeholder="instagram.com/clinicasonrisa"
                  value={c.website}
                  onChange={(e) => set("website", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* ── Qué sigue ────────────────────────────────────────────── */}
          <div>
            <div className="form-section__title">
              Qué sigue y cuánto vale
              <span className="form-section__rule" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12 }}>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-next">
                    Próximo paso
                  </label>
                  <input
                    id="crm-next"
                    className="input-new"
                    type="date"
                    value={c.nextActionAt}
                    onChange={(e) => set("nextActionAt", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-next-note">
                    ¿Qué hay que hacer?
                  </label>
                  <input
                    id="crm-next-note"
                    className="input-new"
                    placeholder="Quiere junta pero aún no confirma — volver a marcarle"
                    value={c.nextActionNote}
                    onChange={(e) => set("nextActionNote", e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-value">
                    Valor mensual estimado (MXN)
                  </label>
                  <input
                    id="crm-value"
                    className="input-new"
                    placeholder="689"
                    value={c.monthlyValue}
                    onChange={(e) => set("monthlyValue", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="crm-tags">
                    Etiquetas
                  </label>
                  <input
                    id="crm-tags"
                    className="input-new"
                    placeholder="congreso, recomendado"
                    value={c.tags}
                    onChange={(e) => set("tags", e.target.value)}
                  />
                </div>
              </div>
              <div className="field-new">
                <label className="field-new__label" htmlFor="crm-notes">
                  Notas
                </label>
                <textarea
                  id="crm-notes"
                  className="input-new"
                  style={AREA}
                  placeholder="Lo que conviene recordar: cuántas sucursales tiene, qué usa hoy, con quién hay que hablar de verdad…"
                  value={c.notes}
                  onChange={(e) => set("notes", e.target.value)}
                />
                {prospecto?.affiliateId && (
                  <p style={{ fontSize: 11.5, color: "var(--warning)", margin: "2px 0 0" }}>
                    Ojo: este prospecto lo recomendó un socio, y él TAMBIÉN ve estas notas. Lo
                    interno del equipo va en la bitácora, que ningún afiliado puede leer.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="modal__footer">
          {invalido && (
            <span style={{ fontSize: 11.5, color: "var(--danger)", marginRight: "auto" }}>
              {invalido}
            </span>
          )}
          <ButtonNew variant="ghost" onClick={alCerrar} disabled={pendiente}>
            Cancelar
          </ButtonNew>
          <ButtonNew variant="primary" onClick={guardar} disabled={pendiente || !!invalido}>
            {pendiente ? "Guardando…" : editando ? "Guardar cambios" : "Agregar a la lista"}
          </ButtonNew>
        </div>
      </div>
    </div>
  );
}
