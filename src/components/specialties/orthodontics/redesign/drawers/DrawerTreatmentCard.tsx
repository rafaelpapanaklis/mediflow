"use client";
// Drawer Treatment Card detallado (Sección D ⭐).
//
// Modal lateral derecho que sustituye temporalmente la sidebar derecha.
// Editable: SOAP, elásticos, IPR, brackets caídos, higiene, foto.
// Maneja modo edición (DRAFT) y vista firmada (SIGNED) read-only.
//
// El submit/firma del card se delega vía callbacks — la persistencia (server
// action) se conecta en commit posterior.

import { useEffect, useMemo, useReducer, useState } from "react";
import {
  Camera,
  Check,
  ChevronRight,
  MessageCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Pill } from "../atoms/Pill";
import { fmtDate } from "../atoms/format";
import {
  ELASTIC_CLASS_LABELS,
  ELASTIC_ZONE_LABELS,
  GINGIVITIS_LABELS,
  PHASE_LABELS,
  type ElasticDTO,
  type IPRPointDTO,
  type BrokenBracketDTO,
  type OrthoElasticClass,
  type OrthoElasticZone,
  type OrthoGingivitisLevel,
  type SOAP,
  type TreatmentCardDTO,
  type WireStepDTO,
} from "../types";
import { useCajon } from "../atoms/useCajon";
import { EvolutionTemplatePicker } from "@/components/clinical-shared/EvolutionTemplatePicker";
import { aplicarPlantillaAlControl, huecosPorLlenar } from "@/lib/orthodontics/consulta-ortodoncia";
import { AgendarProximoControlButton } from "@/components/specialties/orthodontics/AgendarProximoControlButton";
import { AvisarProximoControlButton } from "@/components/specialties/orthodontics/AvisarProximoControlButton";
import { initialState, reducer, type DrawerState } from "./treatment-card-state";
import orto from "../orto.module.css";

export type DrawerCardSubmit = {
  cardId: string | null;
  soap: SOAP;
  hygiene: {
    plaquePct: number | null;
    gingivitis: OrthoGingivitisLevel | null;
    whiteSpots: boolean;
  };
  elastics: Array<{ elasticClass: OrthoElasticClass; config: string; zone: OrthoElasticZone }>;
  iprPoints: Array<{ toothA: number; toothB: number; amountMm: number; done: boolean }>;
  brokenBrackets: Array<{ toothFdi: number; brokenDate: string; reBondedDate: string | null }>;
  hasProgressPhoto: boolean;
  /** C4: qué foto-set existente (ya subido) corresponde a esta visita. */
  photoSetId: string | null;
  wireToId: string | null;
  nextDate: string | null;
  nextDurationMin: number | null;
  /** C2: activaciones de mecánica auxiliar de ESTA visita (texto libre). */
  activationsNote: string | null;
  /** C3: indicaciones para el paciente de ESTA visita (texto libre). */
  indications: string | null;
};

export interface DrawerTreatmentCardProps {
  /** Card existente (modo edición/lectura) o null para nueva. */
  card: TreatmentCardDTO | null;
  /** Catálogo de wire steps planificados para el dropdown wire-to. */
  availableWires: WireStepDTO[];
  /** Para una nueva cita, se sugieren defaults: número, fase, mes, wire actual. */
  defaultsForNew?: {
    cardNumber: number;
    phase: string;
    monthAt: number;
    wireFrom: WireStepDTO | null;
    visitDate: string;
  };
  /**
   * C4: foto-sets ya existentes del caso (subidos desde la sección de fotos)
   * para ligar el que corresponde a ESTA visita. Sin esta prop (p. ej. desde
   * la ficha del paciente) el bloque de foto cae al toggle simple de
   * siempre — nadie más está obligado a pasarla.
   */
  availablePhotoSets?: Array<{ id: string; label: string }>;
  onClose: () => void;
  /**
   * Devuelve el `cardId` con el que quedó la tarjeta (creada o
   * actualizada) — o `null`/`void` si no se sabe (falló, o el caller no lo
   * dice; `BotonHojaControl.tsx` en Agenda es un caller así hoy, fuera del
   * alcance de este arreglo). Cuando SÍ llega, el cajón lo recuerda (§1
   * completo, ws1-t8): sin esto, "Guardar borrador" y luego "Firmar" en
   * la MISMA sesión abierta volvían a mandar `cardId: null` los dos, y el
   * segundo intentaba CREAR una tarjeta nueva con el mismo `cardNumber`
   * de la que el primero ya había creado — "Unique constraint failed on
   * (treatmentPlanId, cardNumber)".
   */
  onSave?: (payload: DrawerCardSubmit) => Promise<string | null | void> | string | null | void;
  onSign?: (payload: DrawerCardSubmit) => Promise<string | null | void> | string | null | void;
  onSharePatient?: (cardId: string) => void;
}

export function DrawerTreatmentCard(props: DrawerTreatmentCardProps) {
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  const isNew = props.card === null;
  const isReadOnly = props.card?.status === "SIGNED";
  const [state, dispatch] = useReducer(reducer, props.card, initialState);
  // Hallazgo ws1-t1/ws1-t4 §1, cerrado en dos partes (ws1-t8): "Firmar
  // control" fallaba en dev.108 con "Unique constraint failed on
  // (treatmentPlanId, cardNumber)" por DOS caminos —
  //   1. Doble clic en "Guardar borrador"/"Firmar control": `enVuelo`
  //      deshabilita los dos botones mientras la llamada sigue en vuelo.
  //   2. Guardar un borrador y FIRMAR después sin cerrar el cajón:
  //      `props.card` no cambia dentro de la misma sesión (el padre solo
  //      lo actualiza si remonta el componente), así que sin más nada
  //      `buildSubmit()` seguía mandando `cardId: null` en el segundo
  //      submit — el servidor intentaba CREAR la tarjeta otra vez con el
  //      mismo `cardNumber`. `state.learnedCardId` (reducer, acción
  //      "learn-card-id") es lo que arregla esto: se pone al valor que
  //      `onSave`/`onSign` confirma, y `buildSubmit()` lo usa primero.
  const [enVuelo, setEnVuelo] = useState(false);

  // Re-init si cambia la card target.
  useEffect(() => {
    // No usamos useReducer init dynamic; en su lugar, si la card cambia entre
    // mounts, el componente se remonta porque el padre debe usar key={cardId}.
  }, [props.card]);

  // Sincroniza el wireFrom/to inicial cuando es nueva.
  useEffect(() => {
    if (isNew && props.defaultsForNew && state.wireToId === null) {
      const wf = props.defaultsForNew.wireFrom;
      if (wf) dispatch({ kind: "set-wire-to", value: wf.id });
    }
  }, [isNew, props.defaultsForNew, state.wireToId]);

  const headerTitle = useMemo(() => {
    if (isNew && props.defaultsForNew) {
      // La ficha manda la CLAVE de la fase («ALIGNMENT») y la Agenda su
      // nombre ya traducido: aquí se muestra siempre el nombre.
      const fase = props.defaultsForNew.phase;
      const nombre = (PHASE_LABELS as Record<string, string>)[fase] ?? fase;
      return `${fmtDate(props.defaultsForNew.visitDate)} · ${nombre}`;
    }
    if (props.card) {
      return `${fmtDate(props.card.visitDate)} · ${PHASE_LABELS[props.card.phaseKey]}`;
    }
    return "Nuevo control";
  }, [isNew, props.card, props.defaultsForNew]);

  const headerEyebrow = isNew
    ? "Nuevo control"
    : `Control ${props.card!.cardNumber}`;

  const wireFromLabel = wireText(props.card?.wireFrom ?? props.defaultsForNew?.wireFrom ?? null);
  const wireToCurrent = props.availableWires.find((w) => w.id === state.wireToId) ?? null;
  const wireToLabel = wireText(wireToCurrent);

  // Plantillas de nota (Rafael, 28-sep-2026): las seis de ortodoncia que ya
  // existían y nadie usaba (Cementado de brackets, Activación de arco, Control
  // mensual general, Cambio de alineador, Retiro de brackets, Entrega de
  // retenedor). Al elegir una se rellena la nota con lo que esta hoja ya sabe
  // —mes, fase, arcos— y lo demás queda como un hueco a la vista. No pisa lo
  // que ya esté escrito: se añade debajo.
  const aplicarPlantilla = (plantilla: { S: string; O: string; A: string; P: string }) => {
    const clave = props.card?.phaseKey ?? props.defaultsForNew?.phase ?? null;
    const arcoDe = props.card?.wireFrom ?? props.defaultsForNew?.wireFrom ?? null;
    const nota = aplicarPlantillaAlControl(state.soap, plantilla, {
      mes: props.card?.monthAt ?? props.defaultsForNew?.monthAt ?? null,
      duracionMeses: null,
      fase: clave ? ((PHASE_LABELS as Record<string, string>)[clave] ?? clave) : null,
      arcoActual: arcoDe ? wireText(arcoDe) : null,
      arcoNuevo: wireToCurrent ? wireText(wireToCurrent) : null,
    });
    (["s", "o", "a", "p"] as const).forEach((campo) => {
      if (nota[campo] !== state.soap[campo]) dispatch({ kind: "set-soap", field: campo, value: nota[campo] });
    });
  };
  const huecos = huecosPorLlenar(state.soap);

  const buildSubmit = (): DrawerCardSubmit => ({
    cardId: state.learnedCardId,
    soap: state.soap,
    hygiene: {
      plaquePct: state.plaquePct,
      gingivitis: state.gingivitis,
      whiteSpots: state.whiteSpots,
    },
    elastics: state.elastics.map((e) => ({
      elasticClass: e.elasticClass,
      config: e.config,
      zone: e.zone,
    })),
    iprPoints: state.iprPoints.map((p) => ({
      toothA: p.toothA,
      toothB: p.toothB,
      amountMm: p.amountMm,
      done: p.done,
    })),
    brokenBrackets: state.brokenBrackets.map((b) => ({
      toothFdi: b.toothFdi,
      brokenDate: b.brokenDate,
      reBondedDate: b.reBondedDate,
    })),
    hasProgressPhoto: state.hasProgressPhoto,
    photoSetId: state.photoSetId,
    wireToId: state.wireToId,
    nextDate: state.nextDate,
    nextDurationMin: state.nextDurationMin,
    activationsNote: state.activationsNote.trim() ? state.activationsNote : null,
    indications: state.indications.trim() ? state.indications : null,
  });

  const canSign =
    state.soap.s.trim().length > 0 &&
    state.soap.o.trim().length > 0 &&
    state.soap.a.trim().length > 0 &&
    state.soap.p.trim().length > 0;

  return (
    <>
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside
        ref={cajonRef}
        tabIndex={-1}
        className={orto.cajon}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-tcard-title"
      >
        <header className={orto.cajonCabeza}>
          <div className={orto.cajonTextos}>
            <div className={orto.cajonCeja}>
              {headerEyebrow}
              {isReadOnly ? <span className={orto.tonoApagado}> · firmado</span> : null}
            </div>
            <h3 id="drawer-tcard-title" className={orto.cajonTitulo}>
              {headerTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            className={orto.botonIcono}
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div className={orto.cajonCuerpo}>
          {/* ARCO */}
          <section className={orto.bloque}>
            <div className={orto.bloqueCabeza}>
              <h4 className={orto.bloqueTitulo}>Arco</h4>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-0">
                <div className={orto.campoEtiqueta}>Actual</div>
                <div className="flex items-center h-[38px] text-[13.5px] font-semibold">
                  {wireFromLabel}
                </div>
              </div>
              <ChevronRight
                size={16}
                strokeWidth={1.75}
                className={`${orto.tonoApagado} mb-[11px] flex-none`}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className={`${orto.campoEtiqueta} mb-[5px]`}>Nuevo</div>
                {isReadOnly ? (
                  <div className={`${orto.tonoVioleta} flex items-center h-[38px] text-[13.5px] font-semibold`}>
                    {wireToLabel}
                  </div>
                ) : (
                  <select
                    value={state.wireToId ?? ""}
                    onChange={(e) =>
                      dispatch({ kind: "set-wire-to", value: e.target.value || null })
                    }
                    className={orto.entrada}
                    aria-label="Arco nuevo"
                  >
                    <option value="">Sin cambio</option>
                    {props.availableWires.map((w) => (
                      <option key={w.id} value={w.id}>
                        {wireText(w)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </section>

          {/* ELÁSTICOS */}
          <ElasticsBlock
            elastics={state.elastics}
            readOnly={isReadOnly}
            onAdd={(e) => dispatch({ kind: "add-elastic", value: e })}
            onUpdate={(id, patch) => dispatch({ kind: "update-elastic", id, patch })}
            onRemove={(id) => dispatch({ kind: "remove-elastic", id })}
          />

          {/* IPR */}
          <IprBlock
            points={state.iprPoints}
            readOnly={isReadOnly}
            onAdd={(p) => dispatch({ kind: "add-ipr", value: p })}
            onUpdate={(id, patch) => dispatch({ kind: "update-ipr", id, patch })}
            onToggle={(id) => dispatch({ kind: "toggle-ipr", id })}
            onRemove={(id) => dispatch({ kind: "remove-ipr", id })}
          />

          {/* BROKEN BRACKETS */}
          <BrokenBlock
            list={state.brokenBrackets}
            readOnly={isReadOnly}
            onAdd={(b) => dispatch({ kind: "add-bracket", value: b })}
            onUpdate={(id, patch) => dispatch({ kind: "update-bracket", id, patch })}
            onMarkRebonded={(id) => dispatch({ kind: "mark-rebonded", id })}
            onRemove={(id) => dispatch({ kind: "remove-bracket", id })}
          />

          {/* ACTIVACIONES (C2) */}
          <section className={orto.bloque}>
            <div className={orto.bloqueCabeza}>
              <h4 className={orto.bloqueTitulo}>Activaciones de esta visita</h4>
            </div>
            {isReadOnly ? (
              <Lectura vacio="Sin activaciones anotadas.">{state.activationsNote}</Lectura>
            ) : (
              <textarea
                value={state.activationsNote}
                onChange={(e) =>
                  dispatch({ kind: "set-activations-note", value: e.target.value })
                }
                rows={2}
                placeholder="Vueltas del expansor, activación de resortes o arcos auxiliares…"
                className={orto.entrada}
                aria-label="Activaciones de esta visita"
              />
            )}
          </section>

          {/* SOAP */}
          <section className={orto.bloque}>
            <div className={orto.bloqueCabeza}>
              <h4 className={orto.bloqueTitulo}>Nota de evolución</h4>
              {!isReadOnly ? (
                <span className={orto.plantillas}>
                  <EvolutionTemplatePicker
                    module="orthodontics"
                    ensureDefaults
                    onApply={(plantilla) => aplicarPlantilla(plantilla.soapTemplate)}
                  />
                </span>
              ) : null}
              {!isReadOnly && !canSign ? (
                <span className={`${orto.bloqueNota} ${orto.tonoAlerta}`}>
                  Los 4 campos son obligatorios para firmar
                </span>
              ) : null}
            </div>
            {!isReadOnly && huecos > 0 ? (
              <p className={`${orto.bloqueNota} ${orto.tonoAlerta} mb-[10px]`} role="status">
                {huecos === 1
                  ? "La plantilla dejó 1 hueco (____) por llenar."
                  : `La plantilla dejó ${huecos} huecos (____) por llenar.`}
              </p>
            ) : null}
            <div className="flex flex-col gap-[10px]">
              {(
                [
                  ["s", "Subjetivo", "Lo que refiere el paciente…"],
                  ["o", "Objetivo", "Lo que encuentras en la exploración…"],
                  ["a", "Análisis", "Tu valoración de cómo va el caso…"],
                  ["p", "Plan", "Lo que sigue para la próxima visita…"],
                ] as const
              ).map(([key, label, pista]) => (
                <div key={key} className={orto.campo}>
                  <div className={orto.campoEtiqueta}>
                    <span className={`${orto.tonoVioleta} font-bold mr-[5px]`}>
                      {key.toUpperCase()}
                    </span>
                    {label}
                  </div>
                  {isReadOnly ? (
                    <Lectura vacio="Sin anotar.">{state.soap[key]}</Lectura>
                  ) : (
                    <textarea
                      value={state.soap[key]}
                      onChange={(e) =>
                        dispatch({ kind: "set-soap", field: key, value: e.target.value })
                      }
                      rows={2}
                      placeholder={pista}
                      className={orto.entrada}
                      aria-label={`SOAP ${label}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* INDICACIONES (C3) */}
          <section className={orto.bloque}>
            <div className={orto.bloqueCabeza}>
              <h4 className={orto.bloqueTitulo}>Indicaciones para el paciente</h4>
            </div>
            {isReadOnly ? (
              <Lectura vacio="Sin indicaciones para esta visita.">{state.indications}</Lectura>
            ) : (
              <textarea
                value={state.indications}
                onChange={(e) => dispatch({ kind: "set-indications", value: e.target.value })}
                rows={2}
                placeholder="Horas de elásticos, higiene, qué no comer, qué hacer si se despega un bracket…"
                className={orto.entrada}
                aria-label="Indicaciones para el paciente"
              />
            )}
          </section>

          {/* HIGIENE */}
          <HygieneBlock
            plaquePct={state.plaquePct}
            gingivitis={state.gingivitis}
            whiteSpots={state.whiteSpots}
            readOnly={isReadOnly}
            onPlaque={(v) => dispatch({ kind: "set-plaque", value: v })}
            onGingivitis={(v) => dispatch({ kind: "set-gingivitis", value: v })}
            onWhiteSpots={(v) => dispatch({ kind: "set-white-spots", value: v })}
          />

          {/* FOTO (C4: liga un foto-set ya subido cuando hay catálogo disponible) */}
          <section className={orto.bloque}>
            <div className={orto.bloqueCabeza}>
              <h4 className={orto.bloqueTitulo}>Fotos de progreso</h4>
            </div>
            {props.availablePhotoSets && props.availablePhotoSets.length > 0 ? (
              isReadOnly ? (
                <div className={`${orto.tonoTexto2} text-[13px]`}>
                  {state.photoSetId
                    ? (props.availablePhotoSets.find((s) => s.id === state.photoSetId)?.label ??
                      "Juego de fotos vinculado")
                    : "Sin fotos ligadas a esta visita."}
                </div>
              ) : (
                <select
                  value={state.photoSetId ?? ""}
                  onChange={(e) =>
                    dispatch({ kind: "set-photo-set", value: e.target.value || null })
                  }
                  className={orto.entrada}
                  aria-label="Fotos de esta visita"
                >
                  <option value="">Sin fotos ligadas</option>
                  {props.availablePhotoSets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )
            ) : state.hasProgressPhoto ? (
              <div className={`${orto.caja} ${orto.cajaExito} flex items-center gap-2 text-[13px]`}>
                <Check size={16} strokeWidth={1.75} className={orto.tonoExito} aria-hidden />
                <span className={orto.tonoExito}>Fotos de progreso tomadas</span>
                {!isReadOnly ? (
                  <button
                    type="button"
                    onClick={() => dispatch({ kind: "set-has-photo", value: false })}
                    className={`${orto.enlace} ml-auto`}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
            ) : isReadOnly ? (
              <div className={orto.vacioLinea}>Sin fotos registradas en este control.</div>
            ) : (
              <Btn
                variant="violet-soft"
                size="md"
                className="w-full"
                icon={<Camera size={15} strokeWidth={1.75} aria-hidden />}
                onClick={() => dispatch({ kind: "set-has-photo", value: true })}
              >
                Marcar que se tomaron fotos
              </Btn>
            )}
          </section>

          {/* PRÓXIMA CITA (C5: "próximo control en N semanas" al cerrar la
              hoja — Recepción es quien la agenda de verdad, con un clic,
              cuando cobra; ver REPORTE-ws1-t4.md) */}
          {!isReadOnly ? (
            <section className={orto.bloque}>
              <div className={orto.bloqueCabeza}>
                <h4 className={orto.bloqueTitulo}>Próximo control en…</h4>
              </div>
              <div className="flex gap-[6px] flex-wrap mb-[10px]">
                {[2, 4, 6, 8].map((weeks) => {
                  const fecha = addWeeks(
                    props.card?.visitDate ?? props.defaultsForNew?.visitDate ?? null,
                    weeks,
                  );
                  const elegido = state.nextDate != null && state.nextDate === fecha;
                  return (
                    <button
                      key={weeks}
                      type="button"
                      aria-pressed={elegido}
                      onClick={() => dispatch({ kind: "set-next-date", value: fecha })}
                      className={[orto.chip, elegido ? orto.chipActivo : ""].filter(Boolean).join(" ")}
                    >
                      {weeks} semanas
                    </button>
                  );
                })}
              </div>
              <div className={orto.rejilla2}>
                <input
                  type="datetime-local"
                  value={toDatetimeLocalValue(state.nextDate)}
                  onChange={(e) =>
                    dispatch({
                      kind: "set-next-date",
                      value: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    })
                  }
                  className={orto.entrada}
                  aria-label="Fecha próxima cita"
                />
                <select
                  value={state.nextDurationMin ?? 30}
                  onChange={(e) =>
                    dispatch({ kind: "set-next-duration", value: parseInt(e.target.value, 10) })
                  }
                  className={orto.entrada}
                  aria-label="Duración próxima cita"
                >
                  {[15, 30, 45, 60, 90].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>
            </section>
          ) : state.nextDate ? (
            // ws1-t1 ronda 2 — punto pendiente de la ronda 1: firmado el
            // control, se ofrece agendarlo de una vez (createBotAppointment,
            // mismos candados que cualquier alta) y avisar al paciente si
            // hay ventana de 24 h. Ambos usan cardId, no appointmentId: el
            // card puede no venir todavía de una cita real.
            <section className={orto.bloque}>
              <div className={orto.bloqueCabeza}>
                <h4 className={orto.bloqueTitulo}>Próximo control</h4>
              </div>
              <div className={orto.caja} style={{ marginBottom: 10 }}>
                {new Date(state.nextDate).toLocaleString("es-MX", {
                  weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
                })}
                {state.nextDurationMin ? ` · ${state.nextDurationMin} min` : ""}
              </div>
              {props.card?.id ? (
                <div className="flex flex-wrap items-center gap-[8px]">
                  <AgendarProximoControlButton cardId={props.card.id} />
                  <AvisarProximoControlButton cardId={props.card.id} />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer className={orto.cajonPie}>
          {props.card && props.onSharePatient ? (
            <Btn
              variant="ghost"
              size="md"
              className="mr-auto"
              icon={<MessageCircle size={15} strokeWidth={1.75} aria-hidden />}
              onClick={() => props.onSharePatient!(props.card!.id)}
            >
              Compartir con el paciente
            </Btn>
          ) : null}
          <Btn variant="ghost" size="md" onClick={props.onClose} disabled={enVuelo}>
            {isReadOnly ? "Cerrar" : "Cancelar"}
          </Btn>
          {!isReadOnly && props.onSave ? (
            <Btn
              variant="secondary"
              size="md"
              disabled={enVuelo}
              onClick={async () => {
                if (enVuelo) return;
                setEnVuelo(true);
                try {
                  const id = await props.onSave!(buildSubmit());
                  if (id) dispatch({ kind: "learn-card-id", id });
                } finally {
                  setEnVuelo(false);
                }
              }}
            >
              {enVuelo ? "Guardando…" : "Guardar borrador"}
            </Btn>
          ) : null}
          {!isReadOnly && props.onSign ? (
            <Btn
              variant="primary"
              size="md"
              icon={<Check size={15} strokeWidth={1.75} aria-hidden />}
              onClick={async () => {
                if (enVuelo) return;
                setEnVuelo(true);
                try {
                  const id = await props.onSign!(buildSubmit());
                  if (id) dispatch({ kind: "learn-card-id", id });
                } finally {
                  setEnVuelo(false);
                }
              }}
              disabled={!canSign || enVuelo}
              title={!canSign ? "Completa los 4 campos de la nota para firmar el control" : undefined}
            >
              {enVuelo ? "Firmando…" : "Firmar control"}
            </Btn>
          ) : null}
        </footer>
      </aside>
    </>
  );
}

/** Un campo en modo lectura (control ya firmado). */
function Lectura({ children, vacio }: { children: string; vacio: string }) {
  return children ? (
    <div className={`${orto.caja} text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]`}>
      {children}
    </div>
  ) : (
    <div className={orto.vacioLinea}>{vacio}</div>
  );
}

// ─── Sub-blocks ─────────────────────────────────────────────────────────

function ElasticsBlock(props: {
  elastics: ElasticDTO[];
  readOnly: boolean;
  onAdd: (e: ElasticDTO) => void;
  onUpdate: (id: string, patch: Partial<Pick<ElasticDTO, "config" | "zone">>) => void;
  onRemove: (id: string) => void;
}) {
  const onPick = (cls: OrthoElasticClass) => {
    const id = `tmp-${Math.random().toString(36).slice(2)}`;
    props.onAdd({
      id,
      elasticClass: cls,
      config: '1/4" 6oz',
      zone: "INTERMAXILAR",
    });
  };
  return (
    <section className={orto.bloque}>
      <div className={orto.bloqueCabeza}>
        <h4 className={orto.bloqueTitulo}>Elásticos</h4>
      </div>
      {!props.readOnly ? (
        <div className="flex gap-[6px] flex-wrap mb-[10px]">
          {(["CLASE_I", "CLASE_II", "CLASE_III", "BOX"] as const).map((c) => (
            <button key={c} type="button" onClick={() => onPick(c)} className={orto.chip}>
              <Plus size={13} strokeWidth={2} aria-hidden />
              {ELASTIC_CLASS_LABELS[c]}
            </button>
          ))}
        </div>
      ) : null}
      {props.elastics.length === 0 ? (
        <div className={orto.vacioLinea}>Sin elásticos en este control.</div>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {props.elastics.map((e) =>
            props.readOnly ? (
              <div key={e.id} className={`${orto.caja} flex items-center gap-2 text-[13px]`}>
                <span className="font-semibold">
                  {ELASTIC_CLASS_LABELS[e.elasticClass]} {e.config}
                </span>
                <span className={`${orto.tonoApagado} ml-auto text-xs`}>
                  {ELASTIC_ZONE_LABELS[e.zone]}
                </span>
              </div>
            ) : (
              <div key={e.id} className={`${orto.caja} flex items-center gap-2 text-[13px]`}>
                <span className="font-semibold shrink-0">{ELASTIC_CLASS_LABELS[e.elasticClass]}</span>
                <input
                  type="text"
                  value={e.config}
                  onChange={(ev) => props.onUpdate(e.id, { config: ev.target.value })}
                  className={`${orto.entrada} flex-1`}
                  aria-label="Descripción del elástico (medida y onzas)"
                />
                <select
                  value={e.zone}
                  onChange={(ev) => props.onUpdate(e.id, { zone: ev.target.value as OrthoElasticZone })}
                  className={`${orto.entrada} w-[140px] shrink-0`}
                  aria-label="Zona del elástico"
                >
                  {(["ANTERIOR", "POSTERIOR", "INTERMAXILAR"] as const).map((z) => (
                    <option key={z} value={z}>
                      {ELASTIC_ZONE_LABELS[z]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => props.onRemove(e.id)}
                  aria-label="Quitar elástico"
                  className={`${orto.botonIcono} ${orto.botonIconoPeligro} -my-1 -mr-1 shrink-0`}
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function IprBlock(props: {
  points: IPRPointDTO[];
  readOnly: boolean;
  onAdd: (p: IPRPointDTO) => void;
  onUpdate: (id: string, patch: Partial<Pick<IPRPointDTO, "toothA" | "toothB" | "amountMm">>) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const onAddRow = () => {
    const id = `tmp-${Math.random().toString(36).slice(2)}`;
    props.onAdd({ id, toothA: 13, toothB: 14, amountMm: 0.3, done: true });
  };
  return (
    <section className={orto.bloque}>
      <div className={orto.bloqueCabeza}>
        <h4 className={orto.bloqueTitulo}>IPR realizado</h4>
        {!props.readOnly ? (
          <button type="button" onClick={onAddRow} className={orto.chip}>
            <Plus size={13} strokeWidth={2} aria-hidden />
            Agregar
          </button>
        ) : null}
      </div>
      {props.points.length === 0 ? (
        <div className={orto.vacioLinea}>Sin IPR en este control.</div>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {props.points.map((p) => (
            <div
              key={p.id}
              className={`${orto.caja} ${p.done ? orto.cajaExito : ""} flex items-center gap-2 text-[13px]`}
            >
              {props.readOnly ? (
                <>
                  <span className="font-semibold">
                    {p.toothA}-{p.toothB}
                  </span>
                  <span className={`${p.done ? orto.tonoExito : orto.tonoTexto2} font-semibold`}>
                    {p.amountMm.toFixed(1)} mm
                  </span>
                </>
              ) : (
                <>
                  <div className="w-[34px] shrink-0">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={11}
                      max={48}
                      value={p.toothA}
                      onChange={(e) =>
                        props.onUpdate(p.id, {
                          toothA: e.target.value === "" ? p.toothA : parseInt(e.target.value, 10),
                        })
                      }
                      className={`${orto.entrada} ${orto.entradaCorta}`}
                      aria-label="Diente mesial del IPR"
                    />
                  </div>
                  <span className="font-semibold">-</span>
                  <div className="w-[34px] shrink-0">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={11}
                      max={48}
                      value={p.toothB}
                      onChange={(e) =>
                        props.onUpdate(p.id, {
                          toothB: e.target.value === "" ? p.toothB : parseInt(e.target.value, 10),
                        })
                      }
                      className={`${orto.entrada} ${orto.entradaCorta}`}
                      aria-label="Diente distal del IPR"
                    />
                  </div>
                  <div className="w-[52px] shrink-0">
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      value={p.amountMm}
                      onChange={(e) =>
                        props.onUpdate(p.id, {
                          amountMm: e.target.value === "" ? 0 : parseFloat(e.target.value),
                        })
                      }
                      className={`${orto.entrada} ${orto.entradaCorta}`}
                      aria-label="Milímetros de desgaste"
                    />
                  </div>
                  <span className={`${orto.tonoApagado} text-xs`}>mm</span>
                </>
              )}
              <span className={`${orto.tonoApagado} ml-auto text-xs`}>
                {p.done ? "Realizado" : "Pendiente"}
              </span>
              {!props.readOnly ? (
                <>
                  <button
                    type="button"
                    onClick={() => props.onToggle(p.id)}
                    className={orto.enlace}
                    aria-label={p.done ? "Marcar pendiente" : "Marcar realizado"}
                  >
                    {p.done ? "Dejar pendiente" : "Marcar realizado"}
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onRemove(p.id)}
                    aria-label="Quitar IPR"
                    className={`${orto.botonIcono} ${orto.botonIconoPeligro} -my-1 -mr-1`}
                  >
                    <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                  </button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BrokenBlock(props: {
  list: BrokenBracketDTO[];
  readOnly: boolean;
  onAdd: (b: BrokenBracketDTO) => void;
  onUpdate: (id: string, patch: Partial<Pick<BrokenBracketDTO, "toothFdi">>) => void;
  onMarkRebonded: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const onAddRow = () => {
    const id = `tmp-${Math.random().toString(36).slice(2)}`;
    props.onAdd({
      id,
      toothFdi: 25,
      brokenDate: new Date().toISOString(),
      reBondedDate: null,
      notes: null,
    });
  };
  return (
    <section className={orto.bloque}>
      <div className={orto.bloqueCabeza}>
        <h4 className={orto.bloqueTitulo}>Brackets caídos</h4>
        {!props.readOnly ? (
          <button type="button" onClick={onAddRow} className={orto.chip}>
            <Plus size={13} strokeWidth={2} aria-hidden />
            Reportar
          </button>
        ) : null}
      </div>
      {props.list.length === 0 ? (
        <div className={orto.vacioLinea}>Ningún bracket caído.</div>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {props.list.map((b) => (
            <div
              key={b.id}
              className={`${orto.caja} ${b.reBondedDate ? "" : orto.cajaPeligro} flex items-center gap-2 text-[13px]`}
            >
              {props.readOnly ? (
                <span className="font-semibold">Diente {b.toothFdi}</span>
              ) : (
                <>
                  <span className="font-semibold shrink-0">Diente</span>
                  <div className="w-[34px] shrink-0">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={11}
                      max={48}
                      value={b.toothFdi}
                      onChange={(e) =>
                        props.onUpdate(b.id, {
                          toothFdi: e.target.value === "" ? b.toothFdi : parseInt(e.target.value, 10),
                        })
                      }
                      className={`${orto.entrada} ${orto.entradaCorta}`}
                      aria-label="Diente FDI del bracket caído"
                    />
                  </div>
                </>
              )}
              <span className="ml-auto flex items-center gap-2">
                {b.reBondedDate ? (
                  <Pill color="emerald" size="xs">
                    Recementado
                  </Pill>
                ) : (
                  <span className={`${orto.tonoPeligro} text-xs font-semibold`}>Pendiente</span>
                )}
                {!props.readOnly && !b.reBondedDate ? (
                  <button
                    type="button"
                    onClick={() => props.onMarkRebonded(b.id)}
                    className={orto.enlace}
                  >
                    Marcar recementado
                  </button>
                ) : null}
              </span>
              {!props.readOnly ? (
                <button
                  type="button"
                  onClick={() => props.onRemove(b.id)}
                  aria-label="Quitar bracket caído"
                  className={`${orto.botonIcono} ${orto.botonIconoPeligro} -my-1 -mr-1`}
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HygieneBlock(props: {
  plaquePct: number | null;
  gingivitis: OrthoGingivitisLevel | null;
  whiteSpots: boolean;
  readOnly: boolean;
  onPlaque: (v: number | null) => void;
  onGingivitis: (v: OrthoGingivitisLevel | null) => void;
  onWhiteSpots: (v: boolean) => void;
}) {
  return (
    <section className={orto.bloque}>
      <div className={orto.bloqueCabeza}>
        <h4 className={orto.bloqueTitulo}>Higiene</h4>
      </div>
      <div className={orto.rejilla3}>
        <div className={orto.campo}>
          <div className={orto.campoEtiqueta}>Placa (%)</div>
          {props.readOnly ? (
            <div className="flex items-center h-[38px] text-[13.5px] font-semibold">
              {props.plaquePct ?? "—"}%
            </div>
          ) : (
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={props.plaquePct ?? ""}
              onChange={(e) =>
                props.onPlaque(e.target.value === "" ? null : parseInt(e.target.value, 10))
              }
              className={orto.entrada}
              aria-label="Placa porcentaje"
            />
          )}
        </div>
        <div className={orto.campo}>
          <div className={orto.campoEtiqueta}>Gingivitis</div>
          {props.readOnly ? (
            <div className="flex items-center h-[38px] text-[13.5px] font-semibold">
              {props.gingivitis ? GINGIVITIS_LABELS[props.gingivitis] : "—"}
            </div>
          ) : (
            <select
              value={props.gingivitis ?? ""}
              onChange={(e) =>
                props.onGingivitis(
                  e.target.value === "" ? null : (e.target.value as OrthoGingivitisLevel),
                )
              }
              className={orto.entrada}
              aria-label="Gingivitis nivel"
            >
              <option value="">—</option>
              {(["AUSENTE", "LEVE", "MODERADA", "SEVERA"] as const).map((g) => (
                <option key={g} value={g}>
                  {GINGIVITIS_LABELS[g]}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className={orto.campo}>
          <div className={orto.campoEtiqueta}>Manchas blancas</div>
          {props.readOnly ? (
            <div className="flex items-center h-[38px] text-[13.5px] font-semibold">
              {props.whiteSpots ? "Sí" : "No"}
            </div>
          ) : (
            <label className={`${orto.casilla} h-[38px]`}>
              <input
                type="checkbox"
                checked={props.whiteSpots}
                onChange={(e) => props.onWhiteSpots(e.target.checked)}
              />
              Presentes
            </label>
          )}
        </div>
      </div>
    </section>
  );
}

function wireText(wire: { gauge: string; material: string } | null): string {
  if (!wire) return "—";
  const matLabel: Record<string, string> = {
    NITI: "NiTi",
    SS: "SS",
    TMA: "TMA",
    BETA_TITANIUM: "β-Ti",
  };
  const m = matLabel[wire.material] ?? wire.material;
  return `${m} ${wire.gauge}`;
}

/** C5: "próximo control en N semanas" — parte de la fecha de ESTA visita, no de hoy. */
function addWeeks(fromIso: string | null, weeks: number): string {
  const base = fromIso ? new Date(fromIso) : new Date();
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString();
}

/**
 * ISO UTC → el string local que pide `<input type="datetime-local">`.
 * Hallazgo ws1-t4 §4: `iso.slice(0, 16)` pintaba los dígitos UTC tal cual
 * (05:45 UTC salía como "05:45" en la casilla, cuando en México son las
 * 23:45 del día anterior o similar según la fecha). `getHours()`/
 * `getMinutes()` etc. SÍ convierten a la zona del navegador — mismo
 * criterio que ya usan `fmtDate`/`fmtTime` de `atoms/format.ts` para el
 * resto de fechas de esta pantalla (sin timezone explícita de la clínica:
 * el equipo que llena la hoja trabaja desde la propia clínica).
 */
export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
