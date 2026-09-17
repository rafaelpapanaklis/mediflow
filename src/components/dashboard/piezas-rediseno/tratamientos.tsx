"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { Plus, ChevronRight, AlertTriangle, CheckCircle, Clock, Activity, Users, Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { fmtMXN, formatRelativeDate } from "@/lib/format";
import { useT } from "@/i18n/i18n-provider";
import type { Treatment, InvItem, SelectedInv } from "@/app/dashboard/treatments/treatments-client";
import { RaizRediseno } from "./raiz";
import {
  Boton,
  Cabecera,
  Campo,
  Dialogo,
  Etiqueta,
  Iniciales,
  Kpi,
  Progreso,
  SeccionTitulo,
  Segmentos,
  Vacio,
  clases as s,
  type Tono,
} from "./piezas";

/**
 * Tratamientos, vestido con el lenguaje del menú de dos niveles: la misma
 * cabecera, los mismos cuatro KPI, los mismos cinco filtros, la misma
 * lista de planes (cada fila abre su ficha), la misma ficha (datos, sesiones,
 * registrar sesión con insumos, pausar/abandonar/reactivar) y el mismo
 * formulario de plan nuevo con las mismas cinco sugerencias. Ni una opción
 * más, ni una menos, ni un clic más.
 *
 * La lógica (estado, fetch, refresh) sigue en
 * `app/dashboard/treatments/treatments-client.tsx` y llega por `vm`; esto
 * solo pinta. Las cifras (sesiones, importes, fechas) van en Instrument
 * Sans con `tabular-nums`, no en letra de máquina.
 */

const TONO_ESTADO: Record<string, { tono: Tono; labelKey: string }> = {
  ACTIVE: { tono: "exito", labelKey: "pages.treatments.statusActive" },
  COMPLETED: { tono: "neutra", labelKey: "pages.treatments.statusCompleted" },
  ABANDONED: { tono: "peligro", labelKey: "pages.treatments.statusAbandoned" },
  PAUSED: { tono: "ambar", labelKey: "pages.treatments.statusPaused" },
};

type Filtro = "ALL" | "ACTIVE" | "OVERDUE" | "COMPLETED" | "PAUSED";

interface FormularioPlan {
  patientId: string;
  doctorId: string;
  name: string;
  description: string;
  totalSessions: string;
  sessionIntervalDays: string;
  totalCost: string;
}

export interface TratamientosVm {
  treatments: Treatment[];
  filtered: Treatment[];
  filter: string;
  setFilter: (v: string) => void;
  showNew: boolean;
  setShowNew: (v: boolean) => void;
  selected: Treatment | null;
  setSelected: (v: Treatment | null) => void;
  saving: boolean;
  addingSession: string | null;
  setAddingSession: (v: string | null) => void;
  sessionNote: string;
  setSessionNote: (v: string) => void;
  invItems: InvItem[];
  selInv: SelectedInv[];
  setSelInv: Dispatch<SetStateAction<SelectedInv[]>>;
  loadingInv: boolean;
  loadInventory: () => Promise<void>;
  form: FormularioPlan;
  setForm: Dispatch<SetStateAction<FormularioPlan>>;
  createPlan: () => Promise<void>;
  addSession: (treatmentId: string) => Promise<void>;
  changeStatus: (treatmentId: string, status: string) => Promise<void>;
  patients: { id: string; firstName: string; lastName: string }[];
  doctors: { id: string; firstName: string; lastName: string; color: string }[];
  isAdmin: boolean;
  canEdit: boolean;
  active: number;
  overdue: number;
  completed: number;
  daysOverdue: (tp: Treatment) => number;
  progressPct: (tp: Treatment) => number;
  commonTreatments: string[];
}

export function Tratamientos({ vm }: { vm: TratamientosVm }) {
  const t = useT();
  const {
    treatments, filtered, filter, setFilter, showNew, setShowNew, selected, setSelected, saving,
    addingSession, setAddingSession, sessionNote, setSessionNote, invItems, selInv, setSelInv,
    loadingInv, loadInventory, form, setForm, createPlan, addSession, changeStatus, patients,
    doctors, isAdmin, canEdit, active, overdue, completed, daysOverdue, progressPct, commonTreatments,
  } = vm;

  const filtros: { valor: Filtro; etiqueta: string }[] = [
    { valor: "ALL", etiqueta: t("common.all") },
    { valor: "ACTIVE", etiqueta: t("pages.treatments.filterActive") },
    { valor: "OVERDUE", etiqueta: t("pages.treatments.filterAtRisk") },
    { valor: "COMPLETED", etiqueta: t("pages.treatments.filterCompleted") },
    { valor: "PAUSED", etiqueta: t("pages.treatments.filterPaused") },
  ];

  const estadoDe = (status: string) => TONO_ESTADO[status] ?? TONO_ESTADO.ACTIVE;

  return (
    <RaizRediseno>
      <Cabecera
        titulo={t("pages.treatments.title")}
        subtitulo={t("pages.treatments.subtitle")}
        acciones={
          canEdit && (
            <Boton variante="principal" icono={<Plus size={16} strokeWidth={2} />} onClick={() => setShowNew(true)}>
              {t("pages.treatments.newPlan")}
            </Boton>
          )
        }
      />

      <div className={s.rejillaKpi}>
        <Kpi etiqueta={t("pages.treatments.kpiActivePlans")} valor={String(active)} icono={<Activity size={15} strokeWidth={1.75} />} />
        <Kpi etiqueta={t("pages.treatments.kpiOverdue")} valor={String(overdue)} icono={<AlertTriangle size={15} strokeWidth={1.75} />} />
        <Kpi etiqueta={t("pages.treatments.kpiCompleted")} valor={String(completed)} icono={<CheckCircle size={15} strokeWidth={1.75} />} />
        <Kpi
          etiqueta={t("pages.treatments.kpiTotalPatients")}
          valor={String(new Set(treatments.map((tp) => tp.patient.id)).size)}
          icono={<Users size={15} strokeWidth={1.75} />}
        />
      </div>

      <Segmentos opciones={filtros} valor={filter as Filtro} onCambio={setFilter} />

      {filtered.length === 0 ? (
        <Vacio alto icono={<Activity size={18} strokeWidth={1.75} />} titulo={t("pages.treatments.emptyTitle")} pista={t("pages.treatments.emptyHint")} />
      ) : (
        <div className={s.lista}>
          {filtered.map((tp) => {
            const pct = progressPct(tp);
            const od = daysOverdue(tp);
            const isLate = tp.status === "ACTIVE" && od > 0;
            const cfg = estadoDe(tp.status);
            const patientName = `${tp.patient.firstName} ${tp.patient.lastName}`;
            return (
              <button
                key={tp.id}
                type="button"
                onClick={() => setSelected(tp)}
                className={`${s.fila} ${s.filaSuelta} ${s.filaBoton} ${isLate ? s.filaAtrasada : ""}`}
              >
                <span className={s.barraColor} style={{ background: tp.doctor.color }} aria-hidden />
                <Iniciales nombre={patientName} />
                <div className={s.filaCuerpo}>
                  <div className={s.filaArriba}>
                    <p className={s.nombre}>{tp.name}</p>
                    <Etiqueta tono={cfg.tono}>{t(cfg.labelKey)}</Etiqueta>
                    {isLate && <Etiqueta tono="ambar">{t("pages.treatments.daysWithoutVisit", { days: od })}</Etiqueta>}
                  </div>
                  <div className={s.detalle}>
                    <Link href={`/dashboard/patients/${tp.patient.id}`} onClick={(e) => e.stopPropagation()} className={s.enlace}>
                      {patientName}
                    </Link>
                    <span aria-hidden>·</span>
                    <span>
                      {t("pages.treatments.doctorPrefix")} {tp.doctor.firstName} {tp.doctor.lastName}
                    </span>
                    {tp.nextExpectedDate && (
                      <>
                        <span aria-hidden>·</span>
                        <span>
                          {t("pages.treatments.nextLabel")} {formatRelativeDate(tp.nextExpectedDate)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className={s.derecha}>
                  <div className={s.derechaValor}>{t("pages.treatments.sessionsCount", { done: tp.sessions.length, total: tp.totalSessions })}</div>
                  <Progreso pct={pct} corto />
                  <div>{fmtMXN(tp.totalCost)}</div>
                </div>
                <ChevronRight size={16} strokeWidth={1.75} className={s.chevron} aria-hidden />
              </button>
            );
          })}
        </div>
      )}

      {/* ── Ficha del plan ── */}
      {selected && (
        <Dialogo
          ancho
          cerrarConVelo
          titulo={selected.name}
          onCerrar={() => setSelected(null)}
          cabecera={
            <>
              <Iniciales nombre={`${selected.patient.firstName} ${selected.patient.lastName}`} />
              <div className={s.tarjetaTextos}>
                <h2 className={s.dialogoTitulo}>{selected.name}</h2>
                <p className={s.dialogoSub}>
                  {selected.patient.firstName} {selected.patient.lastName}
                </p>
              </div>
              <Etiqueta tono={estadoDe(selected.status).tono}>{t(estadoDe(selected.status).labelKey)}</Etiqueta>
            </>
          }
        >
          <div className={s.datos}>
            <div className={s.dato}>
              <div className={s.datoEtiqueta}>{t("pages.treatments.patientLabel")}</div>
              <div className={s.datoValor}>
                <Link href={`/dashboard/patients/${selected.patient.id}`} onClick={() => setSelected(null)} className={s.enlace}>
                  {selected.patient.firstName} {selected.patient.lastName}
                </Link>
                {selected.patient.phone && <div className={s.detalle}>{selected.patient.phone}</div>}
              </div>
            </div>
            <div className={s.dato}>
              <div className={s.datoEtiqueta}>{t("pages.treatments.doctorLabel")}</div>
              <div className={s.datoValor}>
                <span className={s.puntoDoctor} style={{ background: selected.doctor.color }} aria-hidden />
                {t("pages.treatments.doctorPrefix")} {selected.doctor.firstName} {selected.doctor.lastName}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className={s.filaArriba} style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <span className={s.nombre}>{t("pages.treatments.progress")}</span>
              <span className={s.derecha}>
                {selected.sessions.length}/{selected.totalSessions} ({progressPct(selected)}%)
              </span>
            </div>
            <Progreso pct={progressPct(selected)} exito={selected.status === "COMPLETED"} />
          </div>

          <div className={s.datos}>
            {[
              { label: t("pages.treatments.statTotalCost"), val: formatCurrency(selected.totalCost) },
              { label: t("pages.treatments.statInterval"), val: t("pages.treatments.daysValue", { days: selected.sessionIntervalDays }) },
              { label: t("pages.treatments.statSessions"), val: `${selected.sessions.length}/${selected.totalSessions}` },
            ].map((d) => (
              <div key={d.label} className={s.dato}>
                <div className={s.datoEtiqueta}>{d.label}</div>
                <div className={s.datoValor}>{d.val}</div>
              </div>
            ))}
          </div>

          <SeccionTitulo>{t("pages.treatments.sessionsHeading")}</SeccionTitulo>
          <div className={s.cronologia}>
            {selected.sessions.map((se) => (
              <div key={se.id} className={s.cronoItem}>
                <span className={`${s.cronoPunto} ${s.cronoPuntoHecho}`} aria-hidden>
                  <Check size={12} strokeWidth={2.5} />
                </span>
                <div className={s.cronoCaja}>
                  <div className={s.filaCuerpo}>
                    <div className={s.nombre}>{t("pages.treatments.sessionLabel", { num: se.sessionNumber })}</div>
                    {se.notes && <div className={s.cronoNota}>{se.notes}</div>}
                  </div>
                  {se.completedAt && (
                    <span className={s.derecha}>{new Date(se.completedAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>
                  )}
                </div>
              </div>
            ))}
            {Array.from({ length: Math.max(0, selected.totalSessions - selected.sessions.length) }).map((_, i) => (
              <div key={`pending-${i}`} className={`${s.cronoItem} ${s.cronoPendiente}`}>
                <span className={s.cronoPunto} aria-hidden>
                  <Clock size={12} strokeWidth={1.75} />
                </span>
                <div className={s.cronoCaja}>
                  <span className={s.detalle}>
                    {t("pages.treatments.sessionLabel", { num: selected.sessions.length + i + 1 })} · {t("pages.treatments.pending")}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {canEdit && selected.status === "ACTIVE" && (
            <div style={{ marginBottom: 14 }}>
              {addingSession === selected.id ? (
                <div className={s.campos}>
                  <SeccionTitulo>{t("pages.treatments.recordSession")}</SeccionTitulo>
                  <Campo etiqueta={t("pages.treatments.sessionNotesLabel")} htmlFor="tr-nota">
                    <textarea
                      id="tr-nota"
                      className={`${s.campoEntrada} ${s.campoArea}`}
                      placeholder={t("pages.treatments.sessionNotesPlaceholder")}
                      rows={3}
                      value={sessionNote}
                      onChange={(e) => setSessionNote(e.target.value)}
                    />
                  </Campo>
                  <SelectorInsumos
                    clinicItems={invItems}
                    selected={selInv}
                    loading={loadingInv}
                    onOpen={loadInventory}
                    onAdd={(item) => {
                      if (!selInv.find((i) => i.id === item.id)) {
                        setSelInv((prev) => [...prev, { id: item.id, name: item.name, unit: item.unit, qty: 1 }]);
                      }
                    }}
                    onQtyChange={(id, qty) => setSelInv((prev) => prev.map((i) => (i.id === id ? { ...i, qty } : i)))}
                    onRemove={(id) => setSelInv((prev) => prev.filter((i) => i.id !== id))}
                  />
                  <div className={s.acciones} style={{ justifyContent: "flex-end" }}>
                    <Boton variante="suave" onClick={() => { setAddingSession(null); setSessionNote(""); setSelInv([]); }}>
                      {t("common.cancel")}
                    </Boton>
                    <Boton variante="principal" onClick={() => addSession(selected.id)} disabled={saving} icono={<CheckCircle size={15} strokeWidth={1.75} />}>
                      {saving ? t("pages.treatments.savingEllipsis") : t("pages.treatments.confirmSession")}
                    </Boton>
                  </div>
                </div>
              ) : (
                <Boton ancho variante="principal" onClick={() => setAddingSession(selected.id)} icono={<Plus size={15} strokeWidth={2} />}>
                  {t("pages.treatments.recordCompletedSession")}
                </Boton>
              )}
            </div>
          )}

          {canEdit && selected.status === "ACTIVE" && addingSession !== selected.id && (
            <>
              <div className={s.separador} />
              <div className={s.acciones}>
                <Boton style={{ flex: 1 }} onClick={() => changeStatus(selected.id, "PAUSED")}>
                  {t("pages.treatments.pause")}
                </Boton>
                <Boton style={{ flex: 1 }} variante="peligro" onClick={() => changeStatus(selected.id, "ABANDONED")}>
                  {t("pages.treatments.markAbandoned")}
                </Boton>
              </div>
            </>
          )}
          {canEdit && selected.status === "PAUSED" && (
            <Boton ancho variante="principal" onClick={() => changeStatus(selected.id, "ACTIVE")}>
              {t("pages.treatments.reactivateTreatment")}
            </Boton>
          )}
        </Dialogo>
      )}

      {/* ── Plan nuevo ── */}
      {showNew && (
        <Dialogo
          cerrarConVelo
          titulo={t("pages.treatments.newPlanTitle")}
          onCerrar={() => setShowNew(false)}
          pie={
            <>
              <Boton onClick={() => setShowNew(false)}>{t("common.cancel")}</Boton>
              <Boton variante="principal" onClick={createPlan} disabled={saving || !form.patientId || !form.name.trim()}>
                {saving ? t("pages.treatments.creatingEllipsis") : t("pages.treatments.createPlan")}
              </Boton>
            </>
          }
        >
          <div className={s.campos}>
            <SeccionTitulo>{t("pages.treatments.generalInfo")}</SeccionTitulo>
            <Campo etiqueta={<>{t("pages.treatments.patientLabel")} *</>} htmlFor="tr-paciente">
              <select id="tr-paciente" className={s.campoEntrada} value={form.patientId} onChange={(e) => setForm((f) => ({ ...f, patientId: e.target.value }))}>
                <option value="">{t("pages.treatments.selectPatientOption")}</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </option>
                ))}
              </select>
            </Campo>
            {isAdmin && (
              <Campo etiqueta={<>{t("pages.treatments.doctorLabel")} *</>} htmlFor="tr-doctor">
                <select id="tr-doctor" className={s.campoEntrada} value={form.doctorId} onChange={(e) => setForm((f) => ({ ...f, doctorId: e.target.value }))}>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {t("pages.treatments.doctorPrefix")} {d.firstName} {d.lastName}
                    </option>
                  ))}
                </select>
              </Campo>
            )}
            <Campo etiqueta={<>{t("pages.treatments.treatmentNameLabel")} *</>} htmlFor="tr-nombre">
              <input
                id="tr-nombre"
                className={s.campoEntrada}
                placeholder={t("pages.treatments.treatmentNamePlaceholder")}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <div className={s.chips}>
                {commonTreatments.map((sugerencia) => (
                  <button key={sugerencia} type="button" className={s.chip} onClick={() => setForm((f) => ({ ...f, name: sugerencia }))}>
                    {sugerencia}
                  </button>
                ))}
              </div>
            </Campo>
            <Campo etiqueta={t("common.description")} htmlFor="tr-descripcion">
              <textarea
                id="tr-descripcion"
                className={`${s.campoEntrada} ${s.campoArea}`}
                placeholder={t("pages.treatments.descriptionPlaceholder")}
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Campo>

            <SeccionTitulo>{t("pages.treatments.sessionPlan")}</SeccionTitulo>
            <div className={s.campoDoble}>
              <Campo etiqueta={t("pages.treatments.totalSessionsLabel")} htmlFor="tr-sesiones">
                <input id="tr-sesiones" type="number" min="1" max="100" className={s.campoEntrada} value={form.totalSessions} onChange={(e) => setForm((f) => ({ ...f, totalSessions: e.target.value }))} />
              </Campo>
              <Campo etiqueta={t("pages.treatments.daysBetweenSessionsLabel")} htmlFor="tr-intervalo">
                <input id="tr-intervalo" type="number" min="1" max="365" className={s.campoEntrada} value={form.sessionIntervalDays} onChange={(e) => setForm((f) => ({ ...f, sessionIntervalDays: e.target.value }))} />
              </Campo>
            </div>

            <SeccionTitulo>{t("pages.treatments.cost")}</SeccionTitulo>
            <Campo etiqueta={t("pages.treatments.totalCostLabel")} htmlFor="tr-costo">
              <input id="tr-costo" type="number" min="0" className={s.campoEntrada} placeholder="0.00" value={form.totalCost} onChange={(e) => setForm((f) => ({ ...f, totalCost: e.target.value }))} />
            </Campo>
          </div>
        </Dialogo>
      )}
    </RaizRediseno>
  );
}

// ── Selector de insumos (misma conducta que el InventoryPicker de siempre) ──
function SelectorInsumos({
  clinicItems,
  selected,
  loading,
  onOpen,
  onAdd,
  onQtyChange,
  onRemove,
}: {
  clinicItems: InvItem[];
  selected: SelectedInv[];
  loading: boolean;
  onOpen: () => void;
  onAdd: (item: InvItem) => void;
  onQtyChange: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = clinicItems.filter(
    (i) => i.name.toLowerCase().includes(search.toLowerCase()) || i.category.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className={s.campo}>
      <div className={s.filaArriba} style={{ justifyContent: "space-between" }}>
        <span className={s.campoEtiqueta}>{t("pages.treatments.suppliesUsed")}</span>
        <button
          type="button"
          className={s.enlace}
          style={{ fontSize: 12 }}
          onClick={() => {
            setOpen((o) => !o);
            if (!open) onOpen();
          }}
        >
          {open ? t("common.close") : `+ ${t("pages.treatments.addSupply")}`}
        </button>
      </div>

      {selected.length > 0 && (
        <div className={s.lista}>
          {selected.map((item) => (
            <div key={item.id} className={s.fila}>
              <span className={`${s.filaCuerpo} ${s.nombre}`}>{item.name}</span>
              <span className={s.cantidad}>
                <button type="button" className={s.cantidadBoton} onClick={() => item.qty > 1 && onQtyChange(item.id, item.qty - 1)} aria-label="−">
                  −
                </button>
                <span className={s.cantidadValor}>{item.qty}</span>
                <button type="button" className={s.cantidadBoton} onClick={() => onQtyChange(item.id, item.qty + 1)} aria-label="+">
                  +
                </button>
                <span className={s.detalle}>{item.unit}</span>
              </span>
              <button type="button" className={`${s.botonIcono} ${s.botonIconoPeligro}`} onClick={() => onRemove(item.id)} aria-label={t("pages.treatments.removeSupply")}>
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className={s.selector}>
          <div className={s.selectorBuscar}>
            <input
              className={s.campoEntrada}
              placeholder={t("pages.treatments.searchSupplyPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          {loading ? (
            <div className={s.selectorNota}>{t("pages.treatments.loadingInventory")}</div>
          ) : filtered.length === 0 ? (
            <div className={s.selectorNota}>{search ? t("pages.treatments.noMatchingSupplies") : t("pages.treatments.noSuppliesInInventory")}</div>
          ) : (
            <div className={s.selectorLista}>
              {filtered.map((item) => {
                const isSelected = !!selected.find((x) => x.id === item.id);
                return (
                  <button key={item.id} type="button" className={s.selectorItem} onClick={() => onAdd(item)} disabled={isSelected}>
                    <span style={{ fontSize: 16 }} aria-hidden>{item.emoji}</span>
                    <span className={s.filaCuerpo}>
                      <span className={s.nombre}>{item.name}</span>
                      <span className={s.detalle}>
                        {item.category} · {item.quantity} {item.unit} {t("pages.treatments.available")}
                      </span>
                    </span>
                    {isSelected && (
                      <Etiqueta tono="exito">{t("pages.treatments.added")}</Etiqueta>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
