"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AlertTriangle, ClipboardList, Grid3x3, MessageCircle, Plus, Trash2, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { COND_BY_ID, PERM, PRIMARY } from "@/components/dashboard/odontogram-v2/data";
import {
  CARAS, FASES, FASE_CLAVE, PLAN_VACIO, PRONOSTICOS, PRONOSTICO_CLAVE,
  alternarDiente, avisosDeOrden, componerDescripcion, hallazgosPorTratar, importeRenglon,
  leerDientes, letraCentro, sesionesSugeridas, subtotalesPorFase, totalProcedimientos,
  type EntradaOdontograma, type Fase, type Hallazgo, type PlanClinico, type Pronostico, type Renglon,
} from "./plan-clinico";
import s from "./plan.module.css";

/**
 * «Nuevo plan de tratamiento», con el lenguaje del menú de dos niveles.
 *
 * Los MISMOS campos que la ventana de siempre (doctor, nombre con sus cinco
 * sugerencias, descripción, sesiones, días entre sesiones y costo) siguen a
 * la vista y se guardan por el mismo `handleCreateTreatment` del padre, con
 * el mismo `POST /api/treatments`. Lo nuevo es lo clínico —diagnóstico,
 * procedimientos por diente y cara, fases, pronóstico y alternativa— que se
 * escribe como texto en `description` (ver `plan-clinico.ts`).
 *
 * ⛔ No toca `nextExpectedDate` ni `lastFollowUpSent`: los calcula el
 * servidor con `totalSessions` y `sessionIntervalDays`, igual que hoy.
 *
 * Se pinta dentro del apartado (no en un portal), pero monta `CLASES_MENU`
 * él mismo para no depender de quién lo abra.
 */

export interface FormPlan {
  doctorId: string;
  name: string;
  description: string;
  totalSessions: string;
  sessionIntervalDays: string;
  totalCost: string;
}

interface Procedimiento { id: string; name: string; basePrice: number; duration: number | null; category: string }

export interface VentanaNuevoPlanProps {
  paciente: { id: string; nombre: string; esNino: boolean };
  doctores: { id: string; firstName: string; lastName: string }[];
  form: FormPlan;
  setForm: Dispatch<SetStateAction<FormPlan>>;
  sugerencias: string[];
  guardando: boolean;
  onCerrar: () => void;
  onCrear: () => void;
}

let contador = 0;
const renglonNuevo = (parcial: Partial<Renglon> = {}): Renglon => ({
  id: `r${++contador}`,
  fase: "higienica",
  procedimiento: "",
  procedimientoId: null,
  dientes: "",
  caras: [],
  motivo: "",
  cantidad: "1",
  precio: "",
  precioDelTarifario: false,
  minutos: 0,
  ...parcial,
});

export function VentanaNuevoPlan({ paciente, doctores, form, setForm, sugerencias, guardando, onCerrar, onCrear }: VentanaNuevoPlanProps) {
  const t = useT();
  const [plan, setPlan] = useState<PlanClinico>(PLAN_VACIO);
  const [tarifario, setTarifario] = useState<Procedimiento[]>([]);
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);
  const [selectorAbierto, setSelectorAbierto] = useState<string | null>(null);
  // Mientras nadie los teclee, sesiones y costo siguen a los procedimientos.
  const [sesionesAMano, setSesionesAMano] = useState(false);
  const [costoAMano, setCostoAMano] = useState(false);
  const focoPendiente = useRef<string | null>(null);

  // Tarifario y odontograma: las dos cosas que el repo ya sabe del paciente.
  // Si alguna falla, la ventana sigue sirviendo: se teclea a mano como hoy.
  useEffect(() => {
    let vivo = true;
    fetch("/api/procedures")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (vivo && Array.isArray(d)) setTarifario(d); })
      .catch(() => {});
    fetch(`/api/odontogram?patientId=${encodeURIComponent(paciente.id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d && Array.isArray(d.entries)) setHallazgos(hallazgosPorTratar(d.entries as EntradaOdontograma[])); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [paciente.id]);

  const rotulos = useMemo(() => ({
    diagnostico: t("planTratamiento.texto.diagnostico"),
    pronostico: t("planTratamiento.texto.pronostico"),
    total: t("planTratamiento.texto.total"),
    alternativa: t("planTratamiento.texto.alternativa"),
    notas: t("planTratamiento.texto.notas"),
    por: t("planTratamiento.texto.por"),
    fase: (f: Fase) => t(FASE_CLAVE[f]),
    pronosticoValor: (p: Exclude<Pronostico, "">) => t(PRONOSTICO_CLAVE[p]),
    dinero: (n: number) => formatCurrency(n),
  }), [t]);

  const total = totalProcedimientos(plan.renglones);
  const sugeridas = sesionesSugeridas(plan.renglones);
  const fases = subtotalesPorFase(plan.renglones);
  const avisos = avisosDeOrden(plan.renglones);
  const hayRenglones = fases.length > 0;

  // Lo clínico baja al formulario del padre, que es quien guarda.
  const descripcion = componerDescripcion(plan, rotulos);
  useEffect(() => {
    setForm((f) => (f.description === descripcion ? f : { ...f, description: descripcion }));
  }, [descripcion, setForm]);
  useEffect(() => {
    if (!hayRenglones) return;
    setForm((f) => {
      const sig = { ...f };
      if (!sesionesAMano) sig.totalSessions = String(sugeridas);
      if (!costoAMano && total > 0) sig.totalCost = String(total);
      return sig.totalSessions === f.totalSessions && sig.totalCost === f.totalCost ? f : sig;
    });
  }, [hayRenglones, sugeridas, total, sesionesAMano, costoAMano, setForm]);

  useEffect(() => {
    if (!focoPendiente.current) return;
    document.getElementById(focoPendiente.current)?.focus();
    focoPendiente.current = null;
  });

  const cambiar = (id: string, parcial: Partial<Renglon>) =>
    setPlan((p) => ({ ...p, renglones: p.renglones.map((r) => (r.id === id ? { ...r, ...parcial } : r)) }));

  const agregar = (parcial: Partial<Renglon> = {}) => {
    const nuevo = renglonNuevo(parcial);
    focoPendiente.current = `plan-proc-${nuevo.id}`;
    setPlan((p) => ({ ...p, renglones: [...p.renglones, nuevo] }));
  };

  const quitar = (id: string) => {
    setPlan((p) => ({ ...p, renglones: p.renglones.filter((r) => r.id !== id) }));
    if (selectorAbierto === id) setSelectorAbierto(null);
  };

  // Al escribir un nombre que está en el tarifario, trae su precio y su tiempo.
  const cambiarProcedimiento = (r: Renglon, nombre: string) => {
    const hit = tarifario.find((p) => p.name.toLowerCase() === nombre.trim().toLowerCase());
    if (!hit) { cambiar(r.id, { procedimiento: nombre, procedimientoId: null }); return; }
    const ponerPrecio = r.precio.trim() === "" || r.precioDelTarifario;
    cambiar(r.id, {
      procedimiento: nombre,
      procedimientoId: hit.id,
      minutos: hit.duration ?? 0,
      ...(ponerPrecio ? { precio: String(hit.basePrice), precioDelTarifario: true } : {}),
    });
  };

  const nombreHallazgo = (h: Hallazgo) => COND_BY_ID[h.conditionId]?.es ?? h.conditionId;
  const yaEnPlan = (h: Hallazgo) =>
    plan.renglones.some((r) => r.motivo === nombreHallazgo(h) && leerDientes(r.dientes).dientes.includes(h.diente));

  const etiquetaCaras = (h: Hallazgo) => {
    const centro = letraCentro([h.diente]);
    return CARAS.filter((c) => h.caras.includes(c)).map((c) => (c === "O" ? centro : c)).join("");
  };

  const arcadas = [PERM.upper, PERM.lower, ...(paciente.esNino ? [PRIMARY.upper, PRIMARY.lower] : [])];

  return (
    <div className={`${CLASES_MENU} ${s.velo}`} onClick={() => !guardando && onCerrar()}>
      <div
        className={s.caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-nuevo-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={s.cabecera}>
          <span className={s.cabeceraIcono}><ClipboardList size={17} strokeWidth={1.75} aria-hidden /></span>
          <div className={s.cabeceraTextos}>
            <h3 id="plan-nuevo-titulo" className={s.titulo}>{t("planTratamiento.nuevo.titulo")}</h3>
            <div className={s.subtitulo}>{paciente.nombre}</div>
          </div>
          <button type="button" className={s.cerrar} onClick={() => !guardando && onCerrar()} aria-label={t("common.close")}>
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </header>

        <div className={s.cuerpo}>
          {/* ── 1 · Quién y qué ─────────────────────────────────────────── */}
          <section className={s.seccion}>
            <div className={s.dosColumnas}>
              <div className={s.campo}>
                <label className={s.rotulo} htmlFor="plan-doctor">{t("patients.treatment.doctorLabel")}</label>
                <select
                  id="plan-doctor"
                  className={s.entrada}
                  value={form.doctorId}
                  onChange={(e) => setForm((f) => ({ ...f, doctorId: e.target.value }))}
                >
                  {doctores.map((d) => (
                    <option key={d.id} value={d.id}>{t("patients.doctorPrefix")} {d.firstName} {d.lastName}</option>
                  ))}
                </select>
              </div>
              <div className={s.campo}>
                <label className={s.rotulo} htmlFor="plan-nombre">{t("planTratamiento.nuevo.nombre")}</label>
                <input
                  id="plan-nombre"
                  type="text"
                  className={s.entrada}
                  placeholder={t("patients.treatment.namePlaceholder")}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
            </div>
            <div className={s.sugerencias}>
              {sugerencias.map((sug) => (
                <button key={sug} type="button" className={s.ficha} onClick={() => setForm((f) => ({ ...f, name: sug }))}>
                  {sug}
                </button>
              ))}
            </div>
            <p className={s.pista}>
              <MessageCircle size={12} strokeWidth={1.75} aria-hidden /> {t("planTratamiento.nuevo.nombrePista")}
            </p>
          </section>

          {/* ── 2 · Diagnóstico ─────────────────────────────────────────── */}
          <section className={s.seccion}>
            <h4 className={s.seccionTitulo}>{t("planTratamiento.nuevo.diagnostico")}</h4>
            <div className={s.dosColumnasAncha}>
              <div className={s.campo}>
                <label className={s.rotulo} htmlFor="plan-diagnostico">{t("planTratamiento.nuevo.diagnosticoRotulo")}</label>
                <textarea
                  id="plan-diagnostico"
                  className={s.area}
                  rows={2}
                  placeholder={t("planTratamiento.nuevo.diagnosticoEjemplo")}
                  value={plan.diagnostico}
                  onChange={(e) => setPlan((p) => ({ ...p, diagnostico: e.target.value }))}
                />
              </div>
              <div className={s.campo}>
                <label className={s.rotulo} htmlFor="plan-pronostico">{t("planTratamiento.texto.pronostico")}</label>
                <select
                  id="plan-pronostico"
                  className={s.entrada}
                  value={plan.pronostico}
                  onChange={(e) => setPlan((p) => ({ ...p, pronostico: e.target.value as Pronostico }))}
                >
                  <option value="">{t("planTratamiento.pronostico.sinDefinir")}</option>
                  {PRONOSTICOS.map((p) => <option key={p} value={p}>{t(PRONOSTICO_CLAVE[p])}</option>)}
                </select>
              </div>
            </div>

            {hallazgos.length > 0 && (
              <div className={s.hallazgos}>
                <div className={s.rotulo}>{t("planTratamiento.nuevo.hallazgos")}</div>
                <div className={s.sugerencias}>
                  {hallazgos.map((h) => {
                    const puesto = yaEnPlan(h);
                    return (
                      <button
                        key={h.clave}
                        type="button"
                        className={`${s.ficha} ${s.fichaHallazgo} ${puesto ? s.fichaPuesta : ""}`}
                        disabled={puesto}
                        onClick={() => agregar({ fase: h.fase, dientes: String(h.diente), caras: h.caras, motivo: nombreHallazgo(h) })}
                        title={t("planTratamiento.nuevo.hallazgoAgregar")}
                      >
                        <span className={s.fichaDiente}>{h.diente}</span>
                        {etiquetaCaras(h) && <span className={s.fichaCaras}>{etiquetaCaras(h)}</span>}
                        {nombreHallazgo(h)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* ── 3 · Procedimientos ──────────────────────────────────────── */}
          <section className={s.seccion}>
            <h4 className={s.seccionTitulo}>{t("planTratamiento.nuevo.procedimientos")}</h4>

            {plan.renglones.length > 0 && (
              <div className={s.renglones}>
                <div className={`${s.renglon} ${s.renglonCabeza}`} aria-hidden>
                  <span>{t("planTratamiento.nuevo.colFase")}</span>
                  <span>{t("planTratamiento.nuevo.colProcedimiento")}</span>
                  <span>{t("planTratamiento.nuevo.colDientes")}</span>
                  <span>{t("planTratamiento.nuevo.colCaras")}</span>
                  <span className={s.num}>{t("planTratamiento.nuevo.colCantidad")}</span>
                  <span className={s.num}>{t("planTratamiento.nuevo.colPrecio")}</span>
                  <span className={s.num}>{t("planTratamiento.nuevo.colImporte")}</span>
                  <span />
                </div>
                {plan.renglones.map((r) => {
                  const leidos = leerDientes(r.dientes);
                  const centro = letraCentro(leidos.dientes);
                  return (
                    <div key={r.id} className={s.renglonCaja}>
                      <div className={s.renglon}>
                        <select
                          className={s.entrada}
                          aria-label={t("planTratamiento.nuevo.colFase")}
                          value={r.fase}
                          onChange={(e) => cambiar(r.id, { fase: e.target.value as Fase })}
                        >
                          {FASES.map((f) => <option key={f} value={f}>{t(FASE_CLAVE[f])}</option>)}
                        </select>
                        <input
                          id={`plan-proc-${r.id}`}
                          className={s.entrada}
                          list="plan-tarifario"
                          aria-label={t("planTratamiento.nuevo.colProcedimiento")}
                          placeholder={r.motivo ? t("planTratamiento.nuevo.procedimientoPara", { motivo: r.motivo }) : t("planTratamiento.nuevo.procedimientoEjemplo")}
                          value={r.procedimiento}
                          onChange={(e) => cambiarProcedimiento(r, e.target.value)}
                        />
                        <div className={s.dientesCelda}>
                          <input
                            className={`${s.entrada} ${leidos.invalidos.length > 0 ? s.entradaMal : ""}`}
                            aria-label={t("planTratamiento.nuevo.colDientes")}
                            aria-invalid={leidos.invalidos.length > 0 || undefined}
                            placeholder="16, 26"
                            inputMode="numeric"
                            value={r.dientes}
                            onChange={(e) => cambiar(r.id, { dientes: e.target.value })}
                          />
                          <button
                            type="button"
                            className={`${s.botonDientes} ${selectorAbierto === r.id ? s.botonDientesActivo : ""}`}
                            aria-expanded={selectorAbierto === r.id}
                            aria-label={t("planTratamiento.nuevo.elegirDientes")}
                            title={t("planTratamiento.nuevo.elegirDientes")}
                            onClick={() => setSelectorAbierto((a) => (a === r.id ? null : r.id))}
                          >
                            <Grid3x3 size={15} strokeWidth={1.75} aria-hidden />
                          </button>
                        </div>
                        <div className={s.caras} role="group" aria-label={t("planTratamiento.nuevo.colCaras")}>
                          {CARAS.map((c) => {
                            const puesta = r.caras.includes(c);
                            return (
                              <button
                                key={c}
                                type="button"
                                className={`${s.cara} ${puesta ? s.caraPuesta : ""}`}
                                aria-pressed={puesta}
                                title={t(`planTratamiento.cara.${c === "O" ? centro : c}`)}
                                onClick={() => cambiar(r.id, { caras: puesta ? r.caras.filter((x) => x !== c) : [...r.caras, c] })}
                              >
                                {c === "O" ? centro : c}
                              </button>
                            );
                          })}
                        </div>
                        <input
                          type="number"
                          min={1}
                          className={`${s.entrada} ${s.num}`}
                          aria-label={t("planTratamiento.nuevo.colCantidad")}
                          value={r.cantidad}
                          onChange={(e) => cambiar(r.id, { cantidad: e.target.value })}
                        />
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={`${s.entrada} ${s.num}`}
                          aria-label={t("planTratamiento.nuevo.colPrecio")}
                          placeholder="0.00"
                          value={r.precio}
                          onChange={(e) => cambiar(r.id, { precio: e.target.value, precioDelTarifario: false })}
                        />
                        <span className={`${s.importe} ${s.num}`}>{formatCurrency(importeRenglon(r))}</span>
                        <button
                          type="button"
                          className={s.quitar}
                          onClick={() => quitar(r.id)}
                          aria-label={t("planTratamiento.nuevo.quitar")}
                          title={t("planTratamiento.nuevo.quitar")}
                        >
                          <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                        </button>
                      </div>
                      {leidos.invalidos.length > 0 && (
                        <div className={s.error}>{t("planTratamiento.nuevo.dienteInvalido", { dientes: leidos.invalidos.join(", ") })}</div>
                      )}
                      {selectorAbierto === r.id && (
                        <div className={s.selector}>
                          {arcadas.map((arcada, i) => (
                            <div key={i} className={s.arcada}>
                              {arcada.map((fdi, j) => {
                                const puesto = leidos.dientes.includes(fdi);
                                return (
                                  <button
                                    key={fdi}
                                    type="button"
                                    className={`${s.pieza} ${puesto ? s.piezaPuesta : ""} ${j === arcada.length / 2 ? s.piezaLineaMedia : ""}`}
                                    aria-pressed={puesto}
                                    onClick={() => cambiar(r.id, { dientes: alternarDiente(r.dientes, fdi) })}
                                  >
                                    {fdi}
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <datalist id="plan-tarifario">
              {tarifario.map((p) => <option key={p.id} value={p.name}>{formatCurrency(p.basePrice)}</option>)}
            </datalist>

            <div className={s.bajoRenglones}>
              <button type="button" className={s.boton} onClick={() => agregar()}>
                <Plus size={14} strokeWidth={2} aria-hidden /> {t("planTratamiento.nuevo.agregar")}
              </button>
              {plan.renglones.length === 0 && <span className={s.pistaLinea}>{t("planTratamiento.nuevo.procedimientosPista")}</span>}
            </div>

            {avisos.length > 0 && (
              <ul className={s.avisos}>
                {avisos.map((a) => (
                  <li key={`${a.tipo}-${a.diente}`} className={s.aviso}>
                    <AlertTriangle size={13} strokeWidth={1.75} aria-hidden />
                    {t(`planTratamiento.aviso.${a.tipo}`, { diente: a.diente })}
                  </li>
                ))}
              </ul>
            )}

            {hayRenglones && (
              <div className={s.resumen}>
                {fases.map((f) => (
                  <div key={f.fase} className={s.resumenFila}>
                    <span>{t(FASE_CLAVE[f.fase])}</span>
                    <span className={s.resumenCuenta}>{t("planTratamiento.nuevo.nProcedimientos", { count: f.renglones.length })}</span>
                    <span className={s.num}>{formatCurrency(f.subtotal)}</span>
                  </div>
                ))}
                <div className={`${s.resumenFila} ${s.resumenTotal}`}>
                  <span>{t("planTratamiento.texto.total")}</span>
                  <span />
                  <span className={s.num}>{formatCurrency(total)}</span>
                </div>
              </div>
            )}
          </section>

          {/* ── 4 · Sesiones, seguimiento y costo (lo de siempre) ───────── */}
          <section className={s.seccion}>
            <h4 className={s.seccionTitulo}>{t("planTratamiento.nuevo.seguimiento")}</h4>
            <div className={s.tresColumnas}>
              <div className={s.campo}>
                <label className={s.rotulo} htmlFor="plan-sesiones">{t("patients.treatment.totalSessions")}</label>
                <input
                  id="plan-sesiones"
                  type="number"
                  min={1}
                  max={100}
                  className={`${s.entrada} ${s.num}`}
                  value={form.totalSessions}
                  onChange={(e) => { setSesionesAMano(true); setForm((f) => ({ ...f, totalSessions: e.target.value })); }}
                />
                {hayRenglones && (
                  sesionesAMano && String(sugeridas) !== form.totalSessions ? (
                    <button type="button" className={s.enlace} onClick={() => { setSesionesAMano(false); }}>
                      {t("planTratamiento.nuevo.usarSesiones", { count: sugeridas })}
                    </button>
                  ) : !sesionesAMano ? <span className={s.pistaLinea}>{t("planTratamiento.nuevo.calculado")}</span> : null
                )}
              </div>
              <div className={s.campo}>
                <label className={s.rotulo} htmlFor="plan-intervalo">{t("patients.treatment.daysBetween")}</label>
                <input
                  id="plan-intervalo"
                  type="number"
                  min={1}
                  max={365}
                  className={`${s.entrada} ${s.num}`}
                  value={form.sessionIntervalDays}
                  onChange={(e) => setForm((f) => ({ ...f, sessionIntervalDays: e.target.value }))}
                />
              </div>
              <div className={s.campo}>
                <label className={s.rotulo} htmlFor="plan-costo">{t("patients.treatment.totalCost")}</label>
                <input
                  id="plan-costo"
                  type="number"
                  min={0}
                  step="0.01"
                  className={`${s.entrada} ${s.num}`}
                  placeholder="0.00"
                  value={form.totalCost}
                  onChange={(e) => { setCostoAMano(true); setForm((f) => ({ ...f, totalCost: e.target.value })); }}
                />
                {hayRenglones && total > 0 && (
                  costoAMano && Number(form.totalCost) !== total ? (
                    <button type="button" className={s.enlace} onClick={() => setCostoAMano(false)}>
                      {t("planTratamiento.nuevo.usarCosto", { total: formatCurrency(total) })}
                    </button>
                  ) : !costoAMano ? <span className={s.pistaLinea}>{t("planTratamiento.nuevo.calculado")}</span> : null
                )}
              </div>
            </div>
            <p className={s.pista}>
              <MessageCircle size={12} strokeWidth={1.75} aria-hidden /> {t("planTratamiento.nuevo.seguimientoPista")}
            </p>
          </section>

          {/* ── 5 · Alternativa y notas ─────────────────────────────────── */}
          <section className={s.seccion}>
            <div className={s.dosColumnas}>
              <div className={s.campo}>
                <label className={s.rotulo} htmlFor="plan-alternativa">{t("planTratamiento.nuevo.alternativa")}</label>
                <textarea
                  id="plan-alternativa"
                  className={s.area}
                  rows={2}
                  placeholder={t("planTratamiento.nuevo.alternativaEjemplo")}
                  value={plan.alternativa}
                  onChange={(e) => setPlan((p) => ({ ...p, alternativa: e.target.value }))}
                />
              </div>
              <div className={s.campo}>
                <label className={s.rotulo} htmlFor="plan-notas">{t("patients.treatment.descLabel")}</label>
                <textarea
                  id="plan-notas"
                  className={s.area}
                  rows={2}
                  placeholder={t("patients.treatment.descPlaceholder")}
                  value={plan.notas}
                  onChange={(e) => setPlan((p) => ({ ...p, notas: e.target.value }))}
                />
              </div>
            </div>
            <p className={s.pista}>{t("planTratamiento.nuevo.firmaPista")}</p>
          </section>
        </div>

        <footer className={s.pie}>
          {hayRenglones && (
            <div className={s.pieResumen}>
              <span>{t("planTratamiento.nuevo.nProcedimientos", { count: fases.reduce((a, f) => a + f.renglones.length, 0) })}</span>
              <strong>{formatCurrency(total)}</strong>
            </div>
          )}
          <button type="button" className={s.boton} onClick={onCerrar} disabled={guardando}>
            {t("common.cancel")}
          </button>
          <button type="button" className={`${s.boton} ${s.botonPrincipal}`} onClick={onCrear} disabled={guardando}>
            {guardando ? t("patients.treatment.creating") : t("planTratamiento.nuevo.crear")}
          </button>
        </footer>
      </div>
    </div>
  );
}
