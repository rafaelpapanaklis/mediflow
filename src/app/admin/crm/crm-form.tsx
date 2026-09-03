"use client";

// ═══════════════════════════════════════════════════════════════════════
// El formulario del prospecto — alta y edición, el MISMO.
//
// Uno solo y no dos: el día que se agregue un campo, tiene que aparecer en
// los dos lados sin que nadie se acuerde de ir a copiarlo. Se abre desde
// donde se esté mirando —el tablero, la lista, «hoy toca» y la ficha— y
// siempre es esta misma ventana.
//
// ── LOS CAMPOS DEL MODELO QUE NO SE TECLEAN AQUÍ, Y POR QUÉ ────────────
// Un formulario que se calla lo que no deja editar deja a alguien
// buscando un campo que no existe. Por eso, al editar, esos campos se
// PINTAN (en «Lo que se llena solo») en vez de desaparecer:
//
//   · `stage` — mover de etapa además escribe la bitácora y acomoda las
//     fechas de cierre (crmMoverEtapa). Se cambia con el selector de la
//     lista, arrastrando en el tablero o desde la ficha. Al dar de ALTA sí
//     se elige, porque ahí no hay de dónde venir.
//   · `lastContactAt` — sale de la bitácora: es el último contacto REAL.
//     Teclearlo a mano haría que el semáforo dijera que se buscó a alguien
//     a quien nadie buscó.
//   · `wonAt` / `lostAt` — las pone el cierre.
//   · `createdAt`, `createdByEmail`, `affiliateId` — son el acta de
//     nacimiento de la fila.
//
// Los que SÍ se editan y antes no se podían: `lostReason` (para corregir
// el motivo que se tecleó con prisa al cerrar) y `clinicId` (la cuenta que
// nació de este prospecto; sin esto la ficha decía «todavía no se le
// vinculó una clínica» para siempre).
//
// Valida con `crmValidarProspecto`, la MISMA función que vuelve a correr
// la server action. Si el formulario validara por su cuenta, el botón se
// pondría verde y la acción reventaría después.
// ═══════════════════════════════════════════════════════════════════════
import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  crmDiasSinContacto,
  crmEtapa,
  crmValidarProspecto,
  crmValorDeInput,
  crmVertical,
  CRM_ETAPAS,
  CRM_FUENTES,
  CRM_VERTICALES,
} from "@/lib/admin/crm/crm-core";
import type { CrmProspectoDTO } from "@/lib/admin/crm/service";
import { actualizarProspectoAccion, crearProspectoAccion } from "./actions";
import { crmFmtFecha } from "./crm-ui";

/** Lo mínimo para poder elegir la cuenta que nació de un prospecto ganado. */
export interface CrmClinicaLite {
  id: string;
  name: string;
}

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
  lostReason: string;
  clinicId: string;
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
    lostReason: p?.lostReason ?? "",
    clinicId: p?.clinicId ?? "",
  };
}

export function CrmFormulario({
  prospecto,
  clinicas,
  alCerrar,
  alGuardar,
}: {
  /** Con prospecto = editar; sin él = alta nueva. */
  prospecto?: CrmProspectoDTO | null;
  /**
   * Las cuentas de /admin/clinics, para poder decir cuál nació de este
   * prospecto. Se pasa desde la página (servidor); si no llega, el campo
   * cae a un id a mano en vez de desaparecer.
   */
  clinicas?: CrmClinicaLite[];
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
    // Sólo al editar: en un alta nueva no hay cierre que corregir ni cuenta
    // que vincular, y mandarlos vacíos sólo serviría para escribir dos
    // NULL que ya son NULL.
    ...(editando ? { lostReason: c.lostReason, clinicId: c.clinicId } : {}),
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

              {!editando ? (
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
              ) : (
                /* La etapa se ENSEÑA aunque no se teclee aquí: un campo que
                   desaparece deja a alguien buscándolo. */
                <div className="field-new">
                  <span className="field-new__label">Etapa</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34 }}>
                    <BadgeNew tone={crmEtapa(prospecto!.stage).tono} dot>
                      {crmEtapa(prospecto!.stage).label}
                    </BadgeNew>
                    <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                      Se cambia arrastrando la tarjeta en el tablero, con el selector de la lista
                      o desde la ficha: mover de etapa también escribe la bitácora.
                    </span>
                  </div>
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

          {/* ── El cierre, sólo si ya cerró ──────────────────────────── */}
          {editando && crmEtapa(prospecto!.stage).terminal && (
            <div>
              <div className="form-section__title">
                El cierre
                <span className="form-section__rule" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {prospecto!.stage === "PERDIDO" ? (
                  <div className="field-new">
                    <label className="field-new__label" htmlFor="crm-lost">
                      ¿Por qué se perdió?
                    </label>
                    <input
                      id="crm-lost"
                      className="input-new"
                      placeholder="Le pareció caro"
                      value={c.lostReason}
                      onChange={(e) => set("lostReason", e.target.value)}
                    />
                    <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "2px 0 0" }}>
                      Se tecleó al cerrarlo y aquí se puede corregir. Es lo único que enseña qué
                      cambiar del discurso el día que haya diez perdidos.
                    </p>
                  </div>
                ) : (
                  <div className="field-new">
                    <label className="field-new__label" htmlFor="crm-clinic">
                      ¿Qué cuenta nació de aquí?
                    </label>
                    {clinicas && clinicas.length > 0 ? (
                      <select
                        id="crm-clinic"
                        className="input-new"
                        value={c.clinicId}
                        onChange={(e) => set("clinicId", e.target.value)}
                      >
                        <option value="">Sin vincular</option>
                        {clinicas.map((cl) => (
                          <option key={cl.id} value={cl.id}>
                            {cl.name}
                          </option>
                        ))}
                        {/* Un id vinculado que ya no está en la lista (la
                            cuenta se borró, o la lista viene recortada) se
                            ofrece igual: si no, abrir el selector lo
                            desvincularía solo. */}
                        {c.clinicId && !clinicas.some((cl) => cl.id === c.clinicId) && (
                          <option value={c.clinicId}>{c.clinicId} (cuenta que ya no está)</option>
                        )}
                      </select>
                    ) : (
                      <input
                        id="crm-clinic"
                        className="input-new"
                        placeholder="Id de la clínica en /admin/clinics"
                        value={c.clinicId}
                        onChange={(e) => set("clinicId", e.target.value)}
                      />
                    )}
                    <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "2px 0 0" }}>
                      Es lo que une la venta con la cuenta que paga. La ficha lo enseña como
                      enlace a /admin/clinics; sin esto se queda diciendo que no se le vinculó
                      ninguna. No borra ni toca la clínica: es sólo una anotación de la libreta.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Lo que no se teclea ──────────────────────────────────── */}
          {editando && <LoQueSeLlenaSolo p={prospecto!} />}
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

// ═══════════════════════════════════════════════════════════════════════

/**
 * Los campos del modelo que NO se teclean, dichos en voz alta.
 *
 * Podrían no estar —no se editan— y justo por eso tienen que estar: sin
 * esto, quien busca «último contacto» para corregirlo se queda pensando que
 * el formulario está incompleto. Aquí se ve el valor y de dónde sale.
 */
function LoQueSeLlenaSolo({ p }: { p: CrmProspectoDTO }) {
  const dias = crmDiasSinContacto(p.lastContactAt, new Date());

  const filas: { label: string; valor: React.ReactNode; ayuda: string }[] = [
    {
      label: "Último contacto",
      valor:
        dias === null ? (
          <Sin>Nunca</Sin>
        ) : (
          <>
            {crmFmtFecha(p.lastContactAt)}
            <span style={{ color: "var(--text-4)" }}>
              {" "}
              · {dias === 0 ? "hoy" : `hace ${dias} ${dias === 1 ? "día" : "días"}`}
            </span>
          </>
        ),
      ayuda: "Sale de la bitácora, y sólo de un contacto REAL: una nota interna no lo mueve.",
    },
    {
      label: "Cerrado como cliente",
      valor: p.wonAt ? crmFmtFecha(p.wonAt) : <Sin>Todavía no</Sin>,
      ayuda: "La pone el pase a «Ya es cliente».",
    },
    {
      label: "Dado por perdido",
      valor: p.lostAt ? crmFmtFecha(p.lostAt) : <Sin>No</Sin>,
      ayuda: "La pone el pase a «Perdido». Reabrirlo la borra.",
    },
    {
      label: "Dado de alta",
      valor: (
        <>
          {crmFmtFecha(p.createdAt)}
          {p.createdByEmail && (
            <span style={{ color: "var(--text-4)" }}> · {p.createdByEmail}</span>
          )}
        </>
      ),
      ayuda: p.affiliateId
        ? `Lo recomendó ${p.affiliateName ?? "un socio que ya no está dado de alta"} desde su panel.`
        : "Quién lo escribió, tal como estaba ese día.",
    },
  ];

  return (
    <div>
      <div className="form-section__title">
        Lo que se llena solo
        <span className="form-section__rule" />
      </div>
      <div
        style={{
          border: "1px solid var(--border-soft)",
          borderRadius: 9,
          background: "var(--bg-elev-2)",
          padding: "10px 12px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 10,
        }}
      >
        {filas.map((f) => (
          <div key={f.label}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: "var(--text-4)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {f.label}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-1)", marginTop: 2 }}>{f.valor}</div>
            <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 2, lineHeight: 1.4 }}>
              {f.ayuda}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sin({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--text-4)" }}>{children}</span>;
}
