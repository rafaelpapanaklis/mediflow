"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import { EduModal } from "@/components/edu/edu-modal";
import {
  EDU_PLAN_MAX_PARTIDAS,
  EDU_PLAN_MAX_SESIONES,
  EDU_PLAN_STATUS_DESCRIPTIONS,
  EDU_PLAN_STATUS_LABELS,
  EDU_PLAN_TRANSITIONS,
  eduPlanPartidasParaPresupuesto,
  type EduTreatmentPlanStatus,
} from "@/lib/edu/plan-tratamiento-core";
import { eduMoney } from "@/lib/edu/dinero-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LA PESTAÑA «PLAN» — EL PLAN DE TRATAMIENTO (fila 25 del informe).
 *
 * 🔴 EL AVANCE NO SE TECLEA: SE CUENTA. Los porcentajes y los KPI llegan
 * calculados del servidor (`eduPlanKpis`) sobre las sesiones marcadas. Un
 * contador guardado se desincroniza el día que una escritura falle a la
 * mitad, y entonces o le cierras el plan a quien no ha terminado o le
 * abres uno terminado.
 *
 * 🔴 NO HAY BOTÓN DE BORRAR, y no es un olvido: un plan se PAUSA, se
 * TERMINA o se marca ABANDONADO. «Abandonado» y «terminado» se ven igual
 * en una tabla y son lo contrario: distinguirlos es media estadística de
 * una escuela, y por eso abandonar pide motivo.
 *
 * 🔴 EL IMPORTE SOLO LO VE QUIEN VE EL DINERO. El plan lo abre el alcance
 * clínico —un alumno arma el suyo—, así que el número viaja en la fila;
 * aquí se esconde para quien no lleva `caja.view`. Y las PARTIDAS solo las
 * puede poner quien ve el tarifario: el precio lo pone la lista de
 * precios, nunca esta pantalla (regla (d) de la casa).
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface EduPlanSesionUI {
  id: string;
  sessionNumber: number;
  notes: string | null;
  completedAt: string | null;
  /** Ya escrito por el servidor en la zona del instituto. */
  completedLabel: string | null;
  completedByName: string | null;
  appointmentId: string | null;
  appointmentLabel: string | null;
}

export interface EduPlanUI {
  id: string;
  name: string;
  descripcion: string;
  partidas: { name: string; quantity: number; unitPriceCents: number }[];
  caseId: string | null;
  caseLabel: string | null;
  status: EduTreatmentPlanStatus;
  totalCents: number;
  startsLabel: string;
  closedLabel: string | null;
  nextExpectedLabel: string | null;
  closeReason: string | null;
  createdByName: string;
  kpis: { hechas: number; total: number; avance: number; siguienteNumero: number | null; atrasado: boolean };
  sesiones: EduPlanSesionUI[];
}

export interface EduPlanScreenProps {
  patientId: string;
  rows: EduPlanUI[];
  /** Los casos ABIERTOS del paciente que le tocan a quien mira. */
  casos: { id: string; label: string }[];
  /** Las citas del paciente, para ligar una sesión. Vacío = no hay o no ve. */
  citas: { id: string; label: string }[];
  /**
   * El tarifario resuelto PARA ESTE PACIENTE. Solo viaja para quien ve el
   * dinero: el precio no se enseña a quien no puede verlo.
   */
  procedimientos: { id: string; name: string; priceCents: number }[];
  canEdit: boolean;
  veDinero: boolean;
  /** `caja.charge`: convertir el plan en presupuesto es armar dinero. */
  canPresupuestar: boolean;
  motivoSinPermiso: string;
}

interface PartidaForm {
  procedureId: string;
  quantity: number;
}

export function EduPlanScreen(props: EduPlanScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [nuevo, setNuevo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /** Qué plan tiene abierto el campo del motivo de cierre, y a qué estado. */
  const [cerrando, setCerrando] = useState<{ planId: string; destino: EduTreatmentPlanStatus } | null>(null);
  const [motivo, setMotivo] = useState("");
  /** Qué sesión tiene abierto su formulario de «qué se hizo». */
  const [sesion, setSesion] = useState<{ planId: string; sesionId: string; numero: number } | null>(null);

  function hecho(mensaje: string) {
    setFlash(mensaje);
    setError(null);
    setCerrando(null);
    setSesion(null);
    setMotivo("");
    startNav(() => router.refresh());
  }

  async function cambiarEstado(planId: string, destino: EduTreatmentPlanStatus) {
    if (destino === "ABANDONADO" && motivo.trim().length < 3) {
      setError(
        "Abandonar un plan pide un motivo: es lo que distingue «el paciente dejó de venir» de «se terminó».",
      );
      return;
    }
    setError(null);
    setBusy(planId);
    try {
      await eduRequest(`/api/instituto/planes-tratamiento/${planId}`, {
        method: "PATCH",
        body: { status: destino, reason: motivo.trim() || undefined },
      });
      hecho(`El plan quedó como «${EDU_PLAN_STATUS_LABELS[destino]}».`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo mover el plan.");
    } finally {
      setBusy(null);
    }
  }

  async function desmarcar(planId: string, sesionId: string) {
    setError(null);
    setBusy(sesionId);
    try {
      await eduRequest(`/api/instituto/planes-tratamiento/${planId}/sesiones/${sesionId}`, {
        method: "PATCH",
        body: { hecha: false },
      });
      hecho("La sesión volvió a quedar pendiente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo desmarcar la sesión.");
    } finally {
      setBusy(null);
    }
  }

  async function convertir(plan: EduPlanUI) {
    setError(null);
    setBusy(plan.id);
    try {
      // 🔴 LA CONVERSIÓN LA HACE LA FUNCIÓN DE PRESUPUESTOS, no ésta: aquí
      // solo está el BOTÓN. Las partidas salen del plan (o, si no hay
      // bloque legible, una sola por el total) y el folio, la vigencia, los
      // totales y el token de aceptación los pone el servidor de
      // presupuestos, que es donde vive esa lógica.
      const partidas = eduPlanPartidasParaPresupuesto({
        name: plan.name,
        description: null,
        totalCents: plan.totalCents,
      });
      const items = (plan.partidas.length > 0 ? plan.partidas : partidas).map((p) => ({
        name: p.name,
        quantity: p.quantity,
        unitPriceCents: p.unitPriceCents,
      }));
      const r = await eduRequest<{ folio: string }>("/api/instituto/presupuestos", {
        method: "POST",
        body: {
          patientId: props.patientId,
          caseId: plan.caseId ?? undefined,
          title: plan.name,
          notes: `Sale del plan de tratamiento «${plan.name}».`,
          items,
        },
      });
      hecho(
        `Quedó el presupuesto ${r.folio} con ${items.length} ${
          items.length === 1 ? "partida" : "partidas"
        }. Se presenta y se acepta desde Caja → Presupuestos.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el presupuesto.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="edu-stack">
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Planes de tratamiento</h2>
            <p className="edu-section__lead">
              Cuántas sesiones lleva y cuántas le faltan. El avance se CUENTA sobre las sesiones
              marcadas; no hay ningún número que alguien tenga que mantener a mano.
            </p>
          </div>
          <span className="edu-count">{props.rows.length}</span>
          {props.canEdit ? (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => {
                setFlash(null);
                setError(null);
                setNuevo(true);
              }}
            >
              Nuevo plan
            </button>
          ) : (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              disabled
              title={props.motivoSinPermiso}
            >
              Nuevo plan
            </button>
          )}
        </div>

        {!props.canEdit && <p className="edu-note">{props.motivoSinPermiso}</p>}

        {props.rows.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Sin planes de tratamiento</p>
            <p className="edu-empty__detail">
              Un plan dice cuántas sesiones lleva un tratamiento y en cuál va. Se abre sobre un
              caso: es lo que permite contestar «¿cuántas le faltan a la señora?» sin contar citas
              a mano.
            </p>
          </div>
        ) : (
          <div className="edu-stack edu-stack--tight">
            {props.rows.map((plan) => {
              const cerrado = plan.status === "COMPLETADO" || plan.status === "ABANDONADO";
              const destinos = EDU_PLAN_TRANSITIONS[plan.status] ?? [];
              const cerrandoAqui = cerrando?.planId === plan.id;
              return (
                <article
                  key={plan.id}
                  className={`edu-nota ${cerrado ? "edu-nota--borrador" : ""}`}
                >
                  <div className="edu-nota__head">
                    <div>
                      <span className="edu-nota__when">{plan.name}</span>
                      <span className="edu-nota__who">
                        {plan.caseLabel ? `${plan.caseLabel} · ` : ""}
                        lo armó {plan.createdByName} · empezó el {plan.startsLabel}
                      </span>
                    </div>
                    <span
                      className={`edu-tag ${
                        plan.status === "ACTIVO"
                          ? "edu-tag--ok"
                          : plan.status === "PAUSADO"
                            ? "edu-tag--warn"
                            : "edu-tag--muted"
                      }`}
                      title={EDU_PLAN_STATUS_DESCRIPTIONS[plan.status]}
                    >
                      {EDU_PLAN_STATUS_LABELS[plan.status]}
                    </span>
                  </div>

                  {plan.descripcion && <p className="edu-nota__soap">{plan.descripcion}</p>}

                  {/* ── LOS KPI ─────────────────────────────────────── */}
                  <div className="edu-kpis">
                    <div className="edu-kpi">
                      <span className="edu-kpi__label">Avance</span>
                      <span className="edu-kpi__value">{plan.kpis.avance}%</span>
                      <span className="edu-kpi__sub">
                        {plan.kpis.hechas} de {plan.kpis.total} sesiones
                      </span>
                    </div>
                    <div className="edu-kpi">
                      <span className="edu-kpi__label">Siguiente</span>
                      <span className="edu-kpi__value edu-kpi__value--texto">
                        {plan.kpis.siguienteNumero === null
                          ? "Ninguna"
                          : `Sesión ${plan.kpis.siguienteNumero}`}
                      </span>
                    </div>
                    <div className={`edu-kpi ${plan.kpis.atrasado ? "edu-kpi--alerta" : ""}`}>
                      <span className="edu-kpi__label">Se esperaba</span>
                      <span className="edu-kpi__value edu-kpi__value--texto">
                        {plan.nextExpectedLabel ?? "—"}
                      </span>
                      {plan.kpis.atrasado && (
                        <span className="edu-kpi__sub">Atrasado</span>
                      )}
                    </div>
                    {/* 🔴 EL IMPORTE, SOLO CON `caja.view`. Un residente
                        que puede consultar cuánto vale el tratamiento de su
                        paciente sabe cuánto vale su propia lista de espera
                        (visibility.ts). */}
                    {props.veDinero && (
                      <div className="edu-kpi">
                        <span className="edu-kpi__label">Importe</span>
                        <span className="edu-kpi__value">{eduMoney(plan.totalCents)}</span>
                      </div>
                    )}
                  </div>

                  <div className="edu-progress">
                    <div
                      className="edu-progress__bar"
                      style={{ width: `${plan.kpis.avance}%` }}
                      role="progressbar"
                      aria-valuenow={plan.kpis.avance}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Avance del plan ${plan.name}`}
                    />
                  </div>

                  {/* ── LAS PARTIDAS ────────────────────────────────── */}
                  {props.veDinero && plan.partidas.length > 0 && (
                    <div className="edu-lineas">
                      {plan.partidas.map((p, i) => (
                        <div key={`${p.name}-${i}`} className="edu-linea">
                          <span className="edu-linea__name">
                            {p.name}
                            {p.quantity > 1 ? ` ×${p.quantity}` : ""}
                          </span>
                          <span className="edu-linea__total">
                            {eduMoney(p.unitPriceCents * p.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── LAS SESIONES ────────────────────────────────── */}
                  <ul className="edu-chiplist">
                    {plan.sesiones.map((s) => (
                      /* ⚠️ SIN `edu-assign--baja` EN LAS PENDIENTES. Ese
                         modificador TACHA el texto —lo estrenó el
                         odontograma para decir «esto se retiró»— y una
                         sesión que todavía no se ha hecho no está retirada:
                         está por hacer. Tachada se lee como cancelada, que
                         es lo contrario. Lo que las distingue es lo que
                         dicen y su botón. */
                      <li key={s.id} className="edu-assign">
                        <span>
                          <strong>Sesión {s.sessionNumber}</strong>
                          {s.completedAt ? (
                            <>
                              {" · "}
                              {s.completedLabel}
                              {s.completedByName ? ` · ${s.completedByName}` : ""}
                              {s.appointmentLabel ? ` · cita del ${s.appointmentLabel}` : ""}
                              {s.notes ? ` · ${s.notes}` : ""}
                            </>
                          ) : (
                            " · pendiente"
                          )}
                        </span>
                        {!s.completedAt && (
                          <span className="edu-tag edu-tag--muted">Pendiente</span>
                        )}
                        {props.canEdit && !cerrado && (
                          <button
                            type="button"
                            className="edu-btn edu-btn--ghost edu-btn--sm"
                            onClick={() =>
                              s.completedAt
                                ? void desmarcar(plan.id, s.id)
                                : setSesion({
                                    planId: plan.id,
                                    sesionId: s.id,
                                    numero: s.sessionNumber,
                                  })
                            }
                            disabled={busy === s.id}
                          >
                            {s.completedAt ? "Desmarcar" : "Registrar"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>

                  {cerrado && (
                    <p className="edu-receta__anulada">
                      {plan.status === "COMPLETADO" ? "Terminado" : "Abandonado"}
                      {plan.closedLabel ? ` el ${plan.closedLabel}` : ""}
                      {plan.closeReason ? `. Motivo: ${plan.closeReason}` : "."} Un plan cerrado no
                      se reabre: se abre otro.
                    </p>
                  )}

                  {/* ── LAS ACCIONES ────────────────────────────────── */}
                  <div className="edu-receta__acciones">
                    {props.canEdit &&
                      destinos.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`edu-btn edu-btn--sm ${
                            d === "ABANDONADO" ? "edu-btn--danger" : "edu-btn--ghost"
                          }`}
                          title={EDU_PLAN_STATUS_DESCRIPTIONS[d]}
                          onClick={() => {
                            setError(null);
                            setMotivo("");
                            // COMPLETADO y ABANDONADO cierran el plan y no
                            // se deshacen: se piden con confirmación (y con
                            // motivo obligatorio, el segundo). PAUSAR y
                            // REANUDAR no: pedir permiso para PARAR es cómo
                            // nadie registra que paró.
                            if (d === "COMPLETADO" || d === "ABANDONADO") {
                              setCerrando({ planId: plan.id, destino: d });
                            } else {
                              void cambiarEstado(plan.id, d);
                            }
                          }}
                          disabled={busy === plan.id}
                        >
                          {d === "ACTIVO"
                            ? "Reanudar"
                            : d === "PAUSADO"
                              ? "Pausar"
                              : d === "COMPLETADO"
                                ? "Marcar terminado"
                                : "Marcar abandonado"}
                        </button>
                      ))}

                    {/* 🔴 CONVERTIR EN PRESUPUESTO. Aquí SOLO está el
                        botón: la pantalla de presupuestos y la función que
                        los arma son de otra casilla. Pide `caja.charge`
                        porque crear un presupuesto es armar dinero, y por
                        eso a un alumno ni se le pinta. */}
                    {props.canPresupuestar && !cerrado && (
                      <button
                        type="button"
                        className="edu-btn edu-btn--ghost edu-btn--sm"
                        onClick={() => void convertir(plan)}
                        disabled={busy === plan.id}
                      >
                        Convertir en presupuesto
                      </button>
                    )}
                  </div>

                  {cerrandoAqui && cerrando && (
                    <div className="edu-auth-card__motivo">
                      <label className="edu-field__label" htmlFor={`cerrar-${plan.id}`}>
                        {cerrando.destino === "ABANDONADO"
                          ? "¿Por qué se abandona? (obligatorio)"
                          : "Nota de cierre (opcional)"}
                      </label>
                      <textarea
                        id={`cerrar-${plan.id}`}
                        className="edu-input"
                        rows={2}
                        value={motivo}
                        autoFocus
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder={
                          cerrando.destino === "ABANDONADO"
                            ? "Ej.: dejó de venir después de la tercera sesión; no contesta el teléfono."
                            : "Ej.: se terminó la rehabilitación completa."
                        }
                      />
                      <div className="edu-receta__acciones">
                        <button
                          type="button"
                          className="edu-btn edu-btn--danger edu-btn--sm"
                          onClick={() => void cambiarEstado(plan.id, cerrando.destino)}
                          disabled={busy === plan.id}
                        >
                          Sí, {cerrando.destino === "ABANDONADO" ? "marcarlo abandonado" : "cerrarlo"}
                        </button>
                        <button
                          type="button"
                          className="edu-btn edu-btn--quiet edu-btn--sm"
                          onClick={() => setCerrando(null)}
                          disabled={busy === plan.id}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {nuevo && (
        <NuevoPlan
          patientId={props.patientId}
          casos={props.casos}
          procedimientos={props.procedimientos}
          veDinero={props.veDinero}
          onClose={() => setNuevo(false)}
          onDone={(mensaje) => {
            setNuevo(false);
            hecho(mensaje);
          }}
        />
      )}

      {sesion && (
        <RegistrarSesion
          planId={sesion.planId}
          sesionId={sesion.sesionId}
          numero={sesion.numero}
          citas={props.citas}
          onClose={() => setSesion(null)}
          onDone={hecho}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// NUEVO PLAN
// ═══════════════════════════════════════════════════════════════════════

function NuevoPlan({
  patientId,
  casos,
  procedimientos,
  veDinero,
  onClose,
  onDone,
}: {
  patientId: string;
  casos: { id: string; label: string }[];
  procedimientos: { id: string; name: string; priceCents: number }[];
  veDinero: boolean;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [name, setName] = useState("");
  const [caseId, setCaseId] = useState(casos.length === 1 ? casos[0].id : "");
  const [description, setDescription] = useState("");
  const [totalSessions, setTotalSessions] = useState("1");
  const [intervalo, setIntervalo] = useState("30");
  const [partidas, setPartidas] = useState<PartidaForm[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const porId = useMemo(
    () => new Map(procedimientos.map((p) => [p.id, p])),
    [procedimientos],
  );

  // 🔴 EL TOTAL QUE SE PINTA ES UNA PREVISUALIZACIÓN, y el que se guarda lo
  // vuelve a calcular el SERVIDOR con la lista de precios que a este
  // paciente le toca. Si aquí saliera otro número, el que manda es el del
  // servidor: un total que calcula el navegador es un total que el
  // navegador puede cambiar.
  const total = partidas.reduce(
    (t, p) => t + (porId.get(p.procedureId)?.priceCents ?? 0) * p.quantity,
    0,
  );

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      const r = await eduRequest<{ id: string }>(
        `/api/instituto/pacientes/${patientId}/plan-tratamiento`,
        {
          method: "POST",
          body: {
            name,
            caseId: caseId || undefined,
            description: description.trim() || undefined,
            totalSessions,
            sessionIntervalDays: intervalo,
            // Solo procedimiento y cantidad: el PRECIO lo pone el
            // tarifario en el servidor (regla (d) de la casa).
            items: partidas.filter((p) => p.procedureId),
          },
        },
      );
      void r;
      onDone("El plan quedó abierto con sus sesiones vacías. Márcalas conforme se hagan.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Nuevo plan de tratamiento"
      subtitle="Las sesiones se crean todas desde el día uno: es lo que permite marcar la 5 sin haber marcado la 4 (pasa: el paciente se saltó una cita)."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--quiet" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={guardar}
            disabled={busy || name.trim().length < 2}
          >
            {busy ? "Creando…" : "Crear el plan"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-formgrid">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="plan-nombre">
            Nombre del plan
          </label>
          <input
            id="plan-nombre"
            className="edu-input edu-input--sm"
            value={name}
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ortodoncia 18 meses · Rehabilitación superior"
            autoFocus
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="plan-caso">
            Caso
          </label>
          <select
            id="plan-caso"
            className="edu-input edu-input--sm"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
          >
            <option value="">Sin caso</option>
            {casos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="edu-field__hint">
            Colgarlo de un caso es lo que hace que el plan aparezca en el seguimiento de ese
            estudiante y su docente.
          </span>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="plan-sesiones">
            Sesiones estimadas
          </label>
          <input
            id="plan-sesiones"
            className="edu-input edu-input--sm"
            type="number"
            min={1}
            max={EDU_PLAN_MAX_SESIONES}
            value={totalSessions}
            onChange={(e) => setTotalSessions(e.target.value)}
          />
          <span className="edu-field__hint">
            Es una estimación: si el tratamiento se alarga, se puede marcar la sesión 13 de un plan
            de 12 y el avance baja en vez de pasar del 100%.
          </span>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="plan-intervalo">
            Cada cuántos días
          </label>
          <input
            id="plan-intervalo"
            className="edu-input edu-input--sm"
            type="number"
            min={1}
            max={365}
            value={intervalo}
            onChange={(e) => setIntervalo(e.target.value)}
          />
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="plan-desc">
          Descripción (opcional)
        </label>
        <textarea
          id="plan-desc"
          className="edu-input"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {/* ── LAS PARTIDAS DEL TARIFARIO ─────────────────────────────── */}
      {veDinero ? (
        <div className="edu-fichab-grupo">
          <p className="edu-fichab-grupo__title">Partidas del tarifario</p>
          <p className="edu-fichab-grupo__lead">
            El precio de cada una sale de la lista que le toca a ESTE paciente y lo resuelve el
            servidor: aquí solo se elige qué y cuánto.
          </p>

          {partidas.map((p, i) => (
            <div key={i} className="edu-receta-itemgrid">
              <div className="edu-field">
                <label className="edu-field__label" htmlFor={`plan-proc-${i}`}>
                  Procedimiento {i + 1}
                </label>
                <select
                  id={`plan-proc-${i}`}
                  className="edu-input edu-input--sm"
                  value={p.procedureId}
                  onChange={(e) =>
                    setPartidas((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, procedureId: e.target.value } : x)),
                    )
                  }
                >
                  <option value="">Elige uno</option>
                  {procedimientos.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name} — {eduMoney(pr.priceCents)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="edu-field">
                <label className="edu-field__label" htmlFor={`plan-cant-${i}`}>
                  Cantidad
                </label>
                <input
                  id={`plan-cant-${i}`}
                  className="edu-input edu-input--sm"
                  type="number"
                  min={1}
                  max={999}
                  value={p.quantity}
                  onChange={(e) =>
                    setPartidas((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x,
                      ),
                    )
                  }
                />
              </div>
              <button
                type="button"
                className="edu-btn edu-btn--quiet edu-btn--sm"
                onClick={() => setPartidas((prev) => prev.filter((_, j) => j !== i))}
              >
                Quitar
              </button>
            </div>
          ))}

          {procedimientos.length === 0 ? (
            <p className="edu-note">
              Ningún procedimiento tiene precio en la lista que le toca a este paciente. Ponles
              precio en Tarifarios y el plan podrá llevar importe.
            </p>
          ) : (
            <div className="edu-form-acciones">
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                onClick={() =>
                  setPartidas((prev) =>
                    prev.length >= EDU_PLAN_MAX_PARTIDAS
                      ? prev
                      : [...prev, { procedureId: "", quantity: 1 }],
                  )
                }
                disabled={partidas.length >= EDU_PLAN_MAX_PARTIDAS}
              >
                Añadir partida
              </button>
              {partidas.length > 0 && (
                <span className="edu-fichaform__motivo">
                  Suma estimada: {eduMoney(total)}. El servidor la vuelve a calcular con el
                  tarifario.
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="edu-note">
          El plan se crea sin importe: poner precios pide ver el tarifario. La dirección o caja le
          añaden las partidas después.
        </p>
      )}
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// REGISTRAR UNA SESIÓN — fecha, qué se hizo y la cita
// ═══════════════════════════════════════════════════════════════════════

function RegistrarSesion({
  planId,
  sesionId,
  numero,
  citas,
  onClose,
  onDone,
}: {
  planId: string;
  sesionId: string;
  numero: number;
  citas: { id: string; label: string }[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [notes, setNotes] = useState("");
  const [fecha, setFecha] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/planes-tratamiento/${planId}/sesiones/${sesionId}`, {
        method: "PATCH",
        body: {
          hecha: true,
          notes: notes.trim() || undefined,
          // Fecha vacía = hoy. Se manda el día a las 12:00 y no a las 00:00
          // para que el desfase de zona no lo tire al día anterior.
          completedAt: fecha ? `${fecha}T12:00:00` : undefined,
          appointmentId: appointmentId || undefined,
        },
      });
      onDone(`La sesión ${numero} quedó registrada.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la sesión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={`Registrar la sesión ${numero}`}
      subtitle="Queda firmada con tu nombre y con la fecha. Se puede desmarcar si te equivocaste de renglón."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--quiet" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={guardar}
            disabled={busy}
          >
            {busy ? "Guardando…" : "Marcarla como hecha"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="ses-notes">
          Qué se hizo
        </label>
        <textarea
          id="ses-notes"
          className="edu-input"
          rows={3}
          value={notes}
          maxLength={2000}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej.: se cementaron brackets del 13 al 23; se citó a control en 4 semanas."
        />
        <span className="edu-field__hint">
          Esto es el resumen de la sesión, no la nota clínica: la nota SOAP con su firma vive en la
          pestaña Expediente.
        </span>
      </div>

      <div className="edu-formgrid">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="ses-fecha">
            Cuándo se hizo
          </label>
          <input
            id="ses-fecha"
            className="edu-input edu-input--sm"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
          <span className="edu-field__hint">
            Vacío = hoy. No se acepta una fecha futura: marcar como hecha una sesión que todavía no
            pasó es escribir en el expediente un acto que no ocurrió.
          </span>
        </div>

        {citas.length > 0 && (
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ses-cita">
              Cita en la que se hizo (opcional)
            </label>
            <select
              id="ses-cita"
              className="edu-input edu-input--sm"
              value={appointmentId}
              onChange={(e) => setAppointmentId(e.target.value)}
            >
              <option value="">Sin ligar a ninguna cita</option>
              {citas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </EduModal>
  );
}
