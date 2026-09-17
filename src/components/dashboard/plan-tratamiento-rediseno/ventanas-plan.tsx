"use client";

import type { Dispatch, SetStateAction } from "react";
import { ClipboardList, Edit, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { esDescripcionDePlan } from "./plan-clinico";
import s from "./plan.module.css";

/**
 * «Plan de tratamiento» (ver) y «Editar plan», con la ropa del menú nuevo.
 * La MISMA información y los MISMOS campos que las dos ventanas de siempre
 * (`patient-detail-client.tsx`), con los mismos callbacks: aquí no se guarda
 * nada. Lo único que cambia de fondo es que la descripción respeta sus saltos
 * de línea, porque la ventana nueva escribe ahí el plan clínico.
 */

const ESTADO: Record<string, { labelKey: string; tono: string }> = {
  ACTIVE:    { labelKey: "patients.treatmentStatus.active",    tono: "etiquetaExito" },
  COMPLETED: { labelKey: "patients.treatmentStatus.completed", tono: "etiquetaNeutra" },
  ABANDONED: { labelKey: "patients.treatmentStatus.abandoned", tono: "etiquetaPeligro" },
  PAUSED:    { labelKey: "patients.treatmentStatus.paused",    tono: "etiquetaAlerta" },
};

const clases = s as Record<string, string>;

function Marco({ titulo, tituloId, angosta, bloqueado, onCerrar, children }: {
  titulo: string; tituloId: string; angosta?: boolean; bloqueado?: boolean; onCerrar: () => void; children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className={`${CLASES_MENU} ${s.velo}`} onClick={() => !bloqueado && onCerrar()}>
      <div
        className={`${s.caja} ${angosta ? s.cajaAngosta : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={s.cabecera}>
          <span className={s.cabeceraIcono}><ClipboardList size={17} strokeWidth={1.75} aria-hidden /></span>
          <div className={s.cabeceraTextos}>
            <h3 id={tituloId} className={s.titulo}>{titulo}</h3>
          </div>
          <button type="button" className={s.cerrar} onClick={() => !bloqueado && onCerrar()} aria-label={t("common.close")}>
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function VentanaVerPlan({ plan, puedeEditar, onCerrar, onEditar }: {
  plan: any; puedeEditar: boolean; onCerrar: () => void; onEditar: () => void;
}) {
  const t = useT();
  // Hechas = con `completedAt` (N8, MAPA-pacientes §9), como todo el camino nuevo.
  const hechas = (plan.sessions ?? []).filter((x: any) => x.completedAt).length;
  const pct = plan.totalSessions > 0 ? Math.round((hechas / plan.totalSessions) * 100) : 0;
  const estado = ESTADO[plan.status] ?? ESTADO.ACTIVE;
  const fecha = (d: string, conAnio = true) =>
    new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "short", ...(conAnio ? { year: "numeric" } : {}) });

  return (
    <Marco titulo={t("patients.treatment.viewTitle")} tituloId="plan-ver-titulo" angosta={!esDescripcionDePlan(plan.description)} onCerrar={onCerrar}>
      <div className={s.cuerpo}>
        <div className={s.bloques}>
          <div className={s.verCabeza}>
            <div>
              <div className={s.verNombre}>{plan.name}</div>
              <div className={s.verDoctor}>{t("patients.doctorPrefix")} {plan.doctor?.firstName} {plan.doctor?.lastName}</div>
            </div>
            <span className={`${s.etiqueta} ${clases[estado.tono]}`}>{t(estado.labelKey)}</span>
          </div>

          {plan.description && <pre className={s.descripcion}>{plan.description}</pre>}

          <div>
            <div className={s.progresoCabeza}>
              <span>{t("patients.treatment.progressLabel")}</span>
              <strong>{hechas}/{plan.totalSessions} ({pct}%)</strong>
            </div>
            <div className={s.barra}>
              <div className={`${s.barraRelleno} ${plan.status === "COMPLETED" ? s.barraRellenoExito : ""}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className={s.datos}>
            <div className={s.dato}>
              <div className={s.rotulo}>{t("patients.treatment.totalCost")}</div>
              <div className={s.datoValor}>{formatCurrency(plan.totalCost)}</div>
            </div>
            <div className={s.dato}>
              <div className={s.rotulo}>{t("patients.treatment.daysBetween")}</div>
              <div className={s.datoValor}>{plan.sessionIntervalDays}</div>
            </div>
            <div className={s.dato}>
              <div className={s.rotulo}>{t("patients.treatment.startLabel")}</div>
              <div className={s.datoValor}>{fecha(plan.startDate)}</div>
            </div>
            {plan.nextExpectedDate && (
              <div className={s.dato}>
                <div className={s.rotulo}>{t("patients.treatment.nextLabel")}</div>
                <div className={s.datoValor}>{fecha(plan.nextExpectedDate, false)}</div>
              </div>
            )}
          </div>

          <div>
            <div className={s.seccionTitulo}>{t("patients.treatment.sessionsTitle")}</div>
            {(plan.sessions?.length ?? 0) === 0 ? (
              <div className={s.vacio}>{t("patients.treatment.noSessions")}</div>
            ) : (
              <ul className={s.sesiones}>
                {plan.sessions.map((ses: any) => (
                  <li key={ses.id} className={s.sesion}>
                    <span>{t("patients.treatment.sessionN", { n: ses.sessionNumber })}</span>
                    <span className={s.sesionFecha}>{ses.completedAt ? fecha(ses.completedAt) : "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <footer className={s.pie}>
        <button type="button" className={s.boton} onClick={onCerrar}>{t("common.close")}</button>
        {puedeEditar && (
          <button type="button" className={`${s.boton} ${s.botonPrincipal}`} onClick={onEditar}>
            <Edit size={14} strokeWidth={1.75} aria-hidden /> {t("patients.treatment.editBtn")}
          </button>
        )}
      </footer>
    </Marco>
  );
}

export interface FormEditarPlan {
  name: string;
  description: string;
  totalSessions: string;
  sessionIntervalDays: string;
  totalCost: string;
  status: string;
}

export function VentanaEditarPlan({ form, setForm, guardando, onCerrar, onGuardar }: {
  form: FormEditarPlan;
  setForm: Dispatch<SetStateAction<FormEditarPlan>>;
  guardando: boolean;
  onCerrar: () => void;
  onGuardar: () => void;
}) {
  const t = useT();
  const clinico = esDescripcionDePlan(form.description);
  return (
    <Marco titulo={t("patients.treatment.editTitle")} tituloId="plan-editar-titulo" angosta={!clinico} bloqueado={guardando} onCerrar={onCerrar}>
      <div className={s.cuerpo}>
        <div className={s.bloques}>
          <div className={s.campo}>
            <label className={s.rotulo} htmlFor="plan-editar-nombre">{t("planTratamiento.nuevo.nombre")}</label>
            <input
              id="plan-editar-nombre"
              type="text"
              className={s.entrada}
              placeholder={t("patients.treatment.namePlaceholder")}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className={s.campo}>
            <label className={s.rotulo} htmlFor="plan-editar-descripcion">{t("patients.treatment.descLabel")}</label>
            <textarea
              id="plan-editar-descripcion"
              className={s.area}
              rows={clinico ? 12 : 2}
              placeholder={t("patients.treatment.descPlaceholder")}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className={s.campo}>
            <label className={s.rotulo} htmlFor="plan-editar-estado">{t("patients.treatment.statusLabel")}</label>
            <select
              id="plan-editar-estado"
              className={s.entrada}
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="ACTIVE">{t("patients.treatmentStatus.active")}</option>
              <option value="PAUSED">{t("patients.treatmentStatus.paused")}</option>
              <option value="COMPLETED">{t("patients.treatmentStatus.completed")}</option>
              <option value="ABANDONED">{t("patients.treatmentStatus.abandoned")}</option>
            </select>
          </div>
          <div className={s.tresColumnas}>
            <div className={s.campo}>
              <label className={s.rotulo} htmlFor="plan-editar-sesiones">{t("patients.treatment.totalSessions")}</label>
              <input id="plan-editar-sesiones" type="number" min={1} className={`${s.entrada} ${s.num}`} value={form.totalSessions} onChange={(e) => setForm((f) => ({ ...f, totalSessions: e.target.value }))} />
            </div>
            <div className={s.campo}>
              <label className={s.rotulo} htmlFor="plan-editar-intervalo">{t("patients.treatment.daysBetween")}</label>
              <input id="plan-editar-intervalo" type="number" min={1} className={`${s.entrada} ${s.num}`} value={form.sessionIntervalDays} onChange={(e) => setForm((f) => ({ ...f, sessionIntervalDays: e.target.value }))} />
            </div>
            <div className={s.campo}>
              <label className={s.rotulo} htmlFor="plan-editar-costo">{t("patients.treatment.totalCost")}</label>
              <input id="plan-editar-costo" type="number" min={0} className={`${s.entrada} ${s.num}`} value={form.totalCost} onChange={(e) => setForm((f) => ({ ...f, totalCost: e.target.value }))} />
            </div>
          </div>
        </div>
      </div>
      <footer className={s.pie}>
        <button type="button" className={s.boton} disabled={guardando} onClick={onCerrar}>{t("common.cancel")}</button>
        <button type="button" className={`${s.boton} ${s.botonPrincipal}`} disabled={guardando} onClick={onGuardar}>
          {guardando ? t("patients.treatment.saving") : t("patients.treatment.saveBtn")}
        </button>
      </footer>
    </Marco>
  );
}
