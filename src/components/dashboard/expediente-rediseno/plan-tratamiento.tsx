"use client";

import { Calendar, CheckCircle2, Clock, CreditCard, Edit, Hourglass, ListChecks, Pill, Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";
import { esDescripcionDePlan, MARCA_PLAN } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";
import { RaizExpediente } from "./raiz";
import s from "./expediente.module.css";

/**
 * Plan de tratamiento, con el diseño nuevo. La MISMA información que el
 * apartado de siempre (patient-detail-client.tsx, «TAB: PLAN DE
 * TRATAMIENTO»): los tres contadores, y por cada plan su nombre, doctor,
 * descripción, estado, avance en sesiones, costo, intervalo, pendientes y
 * próxima fecha, con Editar y Eliminar para quien puede. Solo cambia la
 * ropa: las ventanas de Nuevo/Ver/Editar plan siguen siendo las del padre y
 * se abren por los mismos callbacks.
 *
 * Las sesiones HECHAS son las que tienen `completedAt` (N8, MAPA-pacientes
 * §9), igual que el camino viejo hace ya con la bandera encendida.
 */

export interface PlanTratamientoProps {
  tratamientos: any[];
  puedeEditar: boolean;
  onNuevo: () => void;
  onVer: (plan: any) => void;
  onEditar: (plan: any) => void;
  onEliminar: (plan: any) => void;
}

const ESTADO_PLAN: Record<string, { labelKey: string; tono: string }> = {
  ACTIVE:    { labelKey: "patients.treatmentStatus.active",    tono: "etiquetaExito" },
  COMPLETED: { labelKey: "patients.treatmentStatus.completed", tono: "etiquetaNeutra" },
  ABANDONED: { labelKey: "patients.treatmentStatus.abandoned", tono: "etiquetaPeligro" },
  PAUSED:    { labelKey: "patients.treatmentStatus.paused",    tono: "etiquetaAlerta" },
};

/**
 * La ventana nueva escribe en `description` el plan clínico entero (varias
 * líneas que empiezan con «▸ »). En la tarjeta cabe su primer renglón —el
 * diagnóstico—; el plan completo se lee al abrirlo, como siempre. Una
 * descripción de las de antes (una frase) se pinta tal cual.
 */
const resumenDescripcion = (descripcion: string) =>
  esDescripcionDePlan(descripcion) ? descripcion.split("\n")[0].slice(MARCA_PLAN.length) : descripcion;

const sesionesHechas = (sesiones: any[] | undefined) =>
  (sesiones ?? []).filter((x: any) => x.completedAt).length;

export function PlanTratamiento({ tratamientos, puedeEditar, onNuevo, onVer, onEditar, onEliminar }: PlanTratamientoProps) {
  const t = useT();

  const activos = tratamientos.filter((p: any) => p.status === "ACTIVE");
  const pendientesTotal = activos.reduce(
    (acc: number, p: any) => acc + Math.max(0, (p.totalSessions || 0) - sesionesHechas(p.sessions)),
    0,
  );
  const completados = tratamientos.filter((p: any) => p.status === "COMPLETED").length;

  return (
    <RaizExpediente>
      <div className={s.columna}>
        <header className={s.cabecera}>
          <span className={s.cabeceraIcono}>
            <ListChecks size={16} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className={s.titulo}>{t("planTratamiento.lista.titulo")}</h2>
          {puedeEditar && (
            <div className={s.acciones}>
              <button type="button" className={`${s.boton} ${s.botonPrincipal}`} onClick={onNuevo}>
                <Plus size={14} strokeWidth={2} aria-hidden />
                {t("planTratamiento.lista.nuevo")}
              </button>
            </div>
          )}
        </header>

        {tratamientos.length > 0 && (
          <div className={s.kpis}>
            <div className={s.kpi}>
              <span className={s.kpiIcono}><Hourglass size={16} strokeWidth={1.75} aria-hidden /></span>
              <div>
                <div className={s.kpiCifra}>{pendientesTotal}</div>
                <div className={s.kpiEtiqueta}>{t("patients.treatment.pendingSessions")}</div>
              </div>
            </div>
            <div className={s.kpi}>
              <span className={`${s.kpiIcono} ${s.kpiIconoExito}`}><Clock size={16} strokeWidth={1.75} aria-hidden /></span>
              <div>
                <div className={s.kpiCifra}>{activos.length}</div>
                <div className={s.kpiEtiqueta}>{t("patients.treatment.active")}</div>
              </div>
            </div>
            <div className={s.kpi}>
              <span className={`${s.kpiIcono} ${s.kpiIconoNeutro}`}><CheckCircle2 size={16} strokeWidth={1.75} aria-hidden /></span>
              <div>
                <div className={s.kpiCifra}>{completados}</div>
                <div className={s.kpiEtiqueta}>{t("patients.treatment.completed")}</div>
              </div>
            </div>
          </div>
        )}

        {tratamientos.length === 0 ? (
          <section className={s.tarjeta}>
            <div className={s.vacio}>
              <span className={s.vacioIcono}><Pill size={17} strokeWidth={1.75} aria-hidden /></span>
              <div className={s.vacioTitulo}>{t("planTratamiento.lista.vacio")}</div>
              {puedeEditar && (
                <button type="button" className={s.enlace} onClick={onNuevo}>
                  {t("planTratamiento.lista.crearPrimero")}
                </button>
              )}
            </div>
          </section>
        ) : tratamientos.map((plan: any) => {
          const hechas = sesionesHechas(plan.sessions);
          const pct = plan.totalSessions > 0 ? Math.round((hechas / plan.totalSessions) * 100) : 0;
          const pendientes = Math.max(0, (plan.totalSessions || 0) - hechas);
          const estado = ESTADO_PLAN[plan.status] ?? ESTADO_PLAN.ACTIVE;
          return (
            <div
              key={plan.id}
              role="button"
              tabIndex={0}
              onClick={() => onVer(plan)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onVer(plan); } }}
              className={`${s.tarjeta} ${s.plan}`}
            >
              <div className={s.planCabeza}>
                <div>
                  <div className={s.planNombre}>{plan.name}</div>
                  <div className={s.planSub}>
                    {t("patients.doctorPrefix")} {plan.doctor?.firstName} {plan.doctor?.lastName}
                  </div>
                  {plan.description && <div className={s.planDescripcion}>{resumenDescripcion(plan.description)}</div>}
                </div>
                <div className={s.planLado}>
                  <span className={`${s.etiqueta} ${(s as Record<string, string>)[estado.tono]}`}>{t(estado.labelKey)}</span>
                  {puedeEditar && (
                    <>
                      <button
                        type="button"
                        className={s.icono}
                        onClick={(e) => { e.stopPropagation(); onEditar(plan); }}
                        aria-label={t("patients.treatment.editAria", { name: plan.name })}
                        title={t("patients.treatment.editBtn")}
                      >
                        <Edit size={15} strokeWidth={1.75} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={`${s.icono} ${s.iconoPeligro}`}
                        onClick={(e) => { e.stopPropagation(); onEliminar(plan); }}
                        aria-label={t("patients.treatment.deletePlanAria", { name: plan.name })}
                        title={t("patients.treatment.deletePlanTitle")}
                      >
                        <Trash2 size={15} strokeWidth={1.75} aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className={s.progreso}>
                <div className={s.barra}>
                  <div
                    className={`${s.barraRelleno} ${plan.status === "COMPLETED" ? s.barraRellenoExito : ""}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={s.progresoCifra}>{hechas}/{plan.totalSessions}</span>
              </div>

              <div className={s.planDatos}>
                <span className={s.planDato}>
                  <CreditCard size={12} strokeWidth={1.75} aria-hidden /> {formatCurrency(plan.totalCost)}
                </span>
                <span className={s.planDato}>
                  <Calendar size={12} strokeWidth={1.75} aria-hidden /> {t("patients.treatment.everyDays", { days: plan.sessionIntervalDays })}
                </span>
                {pendientes > 0 && plan.status === "ACTIVE" && (
                  <span className={`${s.planDato} ${s.planDatoActivo}`}>
                    <Hourglass size={12} strokeWidth={1.75} aria-hidden /> {t("patients.treatment.pendingCount", { count: pendientes })}
                  </span>
                )}
                {plan.nextExpectedDate && (
                  <span className={s.planDato}>
                    <Clock size={12} strokeWidth={1.75} aria-hidden /> {t("patients.treatment.next", { date: new Date(plan.nextExpectedDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </RaizExpediente>
  );
}
