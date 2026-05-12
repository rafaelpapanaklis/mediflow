"use client";
// Drawer Treatment Card detallado (Sección D ⭐).
//
// Modal lateral derecho que sustituye temporalmente la sidebar derecha.
// Editable: SOAP, elásticos, IPR, brackets caídos, higiene, foto.
// Maneja modo edición (DRAFT) y vista firmada (SIGNED) read-only.
//
// El submit/firma del card se delega vía callbacks — la persistencia (server
// action) se conecta en commit posterior.

import { useEffect, useMemo, useReducer } from "react";
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
  wireToId: string | null;
  nextDate: string | null;
  nextDurationMin: number | null;
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
  onClose: () => void;
  onSave?: (payload: DrawerCardSubmit) => Promise<void> | void;
  onSign?: (payload: DrawerCardSubmit) => Promise<void> | void;
  onSharePatient?: (cardId: string) => void;
}

interface DrawerState {
  soap: SOAP;
  plaquePct: number | null;
  gingivitis: OrthoGingivitisLevel | null;
  whiteSpots: boolean;
  elastics: ElasticDTO[];
  iprPoints: IPRPointDTO[];
  brokenBrackets: BrokenBracketDTO[];
  hasProgressPhoto: boolean;
  wireToId: string | null;
  nextDate: string | null;
  nextDurationMin: number | null;
}

type DrawerAction =
  | { kind: "set-soap"; field: keyof SOAP; value: string }
  | { kind: "set-plaque"; value: number | null }
  | { kind: "set-gingivitis"; value: OrthoGingivitisLevel | null }
  | { kind: "set-white-spots"; value: boolean }
  | { kind: "set-wire-to"; value: string | null }
  | { kind: "set-next-date"; value: string | null }
  | { kind: "set-next-duration"; value: number | null }
  | { kind: "set-has-photo"; value: boolean }
  | { kind: "add-elastic"; value: ElasticDTO }
  | { kind: "remove-elastic"; id: string }
  | { kind: "add-ipr"; value: IPRPointDTO }
  | { kind: "remove-ipr"; id: string }
  | { kind: "toggle-ipr"; id: string }
  | { kind: "add-bracket"; value: BrokenBracketDTO }
  | { kind: "remove-bracket"; id: string }
  | { kind: "mark-rebonded"; id: string };

function initialState(card: TreatmentCardDTO | null): DrawerState {
  if (card) {
    return {
      soap: { ...card.soap },
      plaquePct: card.hygiene.plaquePct,
      gingivitis: card.hygiene.gingivitis,
      whiteSpots: card.hygiene.whiteSpots,
      elastics: card.elastics,
      iprPoints: card.iprPoints,
      brokenBrackets: card.brokenBrackets,
      hasProgressPhoto: card.hasProgressPhoto,
      wireToId: card.wireTo?.id ?? null,
      nextDate: card.nextDate,
      nextDurationMin: card.nextDurationMin,
    };
  }
  return {
    soap: { s: "", o: "", a: "", p: "" },
    plaquePct: null,
    gingivitis: null,
    whiteSpots: false,
    elastics: [],
    iprPoints: [],
    brokenBrackets: [],
    hasProgressPhoto: false,
    wireToId: null,
    nextDate: null,
    nextDurationMin: 30,
  };
}

function reducer(state: DrawerState, action: DrawerAction): DrawerState {
  switch (action.kind) {
    case "set-soap":
      return { ...state, soap: { ...state.soap, [action.field]: action.value } };
    case "set-plaque":
      return { ...state, plaquePct: action.value };
    case "set-gingivitis":
      return { ...state, gingivitis: action.value };
    case "set-white-spots":
      return { ...state, whiteSpots: action.value };
    case "set-wire-to":
      return { ...state, wireToId: action.value };
    case "set-next-date":
      return { ...state, nextDate: action.value };
    case "set-next-duration":
      return { ...state, nextDurationMin: action.value };
    case "set-has-photo":
      return { ...state, hasProgressPhoto: action.value };
    case "add-elastic":
      return { ...state, elastics: [...state.elastics, action.value] };
    case "remove-elastic":
      return { ...state, elastics: state.elastics.filter((e) => e.id !== action.id) };
    case "add-ipr":
      return { ...state, iprPoints: [...state.iprPoints, action.value] };
    case "remove-ipr":
      return { ...state, iprPoints: state.iprPoints.filter((p) => p.id !== action.id) };
    case "toggle-ipr":
      return {
        ...state,
        iprPoints: state.iprPoints.map((p) =>
          p.id === action.id ? { ...p, done: !p.done } : p,
        ),
      };
    case "add-bracket":
      return { ...state, brokenBrackets: [...state.brokenBrackets, action.value] };
    case "remove-bracket":
      return {
        ...state,
        brokenBrackets: state.brokenBrackets.filter((b) => b.id !== action.id),
      };
    case "mark-rebonded":
      return {
        ...state,
        brokenBrackets: state.brokenBrackets.map((b) =>
          b.id === action.id ? { ...b, reBondedDate: new Date().toISOString() } : b,
        ),
      };
  }
}

export function DrawerTreatmentCard(props: DrawerTreatmentCardProps) {
  const isNew = props.card === null;
  const isReadOnly = props.card?.status === "SIGNED";
  const [state, dispatch] = useReducer(reducer, props.card, initialState);

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
      return `${fmtDate(props.defaultsForNew.visitDate)} · ${props.defaultsForNew.phase}`;
    }
    if (props.card) {
      return `${fmtDate(props.card.visitDate)} · ${PHASE_LABELS[props.card.phaseKey]}`;
    }
    return "Nueva cita";
  }, [isNew, props.card, props.defaultsForNew]);

  const headerEyebrow = isNew
    ? "Nueva cita de control"
    : `Cita #${props.card!.cardNumber}`;

  const wireFromLabel = wireText(props.card?.wireFrom ?? props.defaultsForNew?.wireFrom ?? null);
  const wireToCurrent = props.availableWires.find((w) => w.id === state.wireToId) ?? null;
  const wireToLabel = wireText(wireToCurrent);

  const buildSubmit = (): DrawerCardSubmit => ({
    cardId: props.card?.id ?? null,
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
    wireToId: state.wireToId,
    nextDate: state.nextDate,
    nextDurationMin: state.nextDurationMin,
  });

  const canSign =
    state.soap.s.trim().length > 0 &&
    state.soap.o.trim().length > 0 &&
    state.soap.a.trim().length > 0 &&
    state.soap.p.trim().length > 0;

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/30 z-40 dark:bg-slate-950/60"
        onClick={props.onClose}
        aria-hidden
      />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[520px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-tcard-title"
      >
        <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-violet-50/40 dark:bg-violet-900/10 dark:border-slate-800">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">
              {headerEyebrow}
              {isReadOnly ? <span className="ml-2 text-slate-500">· firmada</span> : null}
            </div>
            <h3
              id="drawer-tcard-title"
              className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100"
            >
              {headerTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* WIRE */}
          <section className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2 dark:text-slate-400">
              Wire (G3)
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-[10px] text-slate-400 dark:text-slate-500">Actual</div>
                <div className="text-sm font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {wireFromLabel}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-violet-500" aria-hidden />
              <div className="flex-1">
                <div className="text-[10px] text-slate-400 dark:text-slate-500">Nuevo</div>
                {isReadOnly ? (
                  <div className="text-sm font-mono font-semibold text-violet-700 dark:text-violet-300">
                    {wireToLabel}
                  </div>
                ) : (
                  <select
                    value={state.wireToId ?? ""}
                    onChange={(e) =>
                      dispatch({ kind: "set-wire-to", value: e.target.value || null })
                    }
                    className="w-full text-sm font-mono bg-white border border-slate-200 rounded px-2 py-1 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                    aria-label="Wire nuevo"
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
            onRemove={(id) => dispatch({ kind: "remove-elastic", id })}
          />

          {/* IPR */}
          <IprBlock
            points={state.iprPoints}
            readOnly={isReadOnly}
            onAdd={(p) => dispatch({ kind: "add-ipr", value: p })}
            onToggle={(id) => dispatch({ kind: "toggle-ipr", id })}
            onRemove={(id) => dispatch({ kind: "remove-ipr", id })}
          />

          {/* BROKEN BRACKETS */}
          <BrokenBlock
            list={state.brokenBrackets}
            readOnly={isReadOnly}
            onAdd={(b) => dispatch({ kind: "add-bracket", value: b })}
            onMarkRebonded={(id) => dispatch({ kind: "mark-rebonded", id })}
            onRemove={(id) => dispatch({ kind: "remove-bracket", id })}
          />

          {/* SOAP */}
          <section className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2 dark:text-slate-400">
              Nota SOAP estructurada
              {!isReadOnly && !canSign ? (
                <span className="ml-2 text-amber-600 dark:text-amber-400">
                  · requiere los 4 campos para firmar
                </span>
              ) : null}
            </div>
            <div className="space-y-2">
              {(
                [
                  ["s", "Subjective"],
                  ["o", "Objective"],
                  ["a", "Assessment"],
                  ["p", "Plan"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5 dark:text-slate-500">
                    <span className="font-mono text-violet-600 font-bold mr-1 dark:text-violet-300">
                      {key.toUpperCase()}
                    </span>
                    {label}
                  </div>
                  {isReadOnly ? (
                    <div
                      className={`text-sm rounded border px-2.5 py-1.5 min-h-[34px] ${
                        state.soap[key]
                          ? "bg-white border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300"
                          : "bg-slate-50 border-dashed border-slate-200 text-slate-300 italic dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-600"
                      }`}
                    >
                      {state.soap[key] || "Pendiente…"}
                    </div>
                  ) : (
                    <textarea
                      value={state.soap[key]}
                      onChange={(e) =>
                        dispatch({ kind: "set-soap", field: key, value: e.target.value })
                      }
                      rows={2}
                      placeholder={`Escribe la sección ${label.toLowerCase()}…`}
                      className="w-full text-sm bg-white border border-slate-200 rounded px-2.5 py-1.5 resize-y dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                      aria-label={`SOAP ${label}`}
                    />
                  )}
                </div>
              ))}
            </div>
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

          {/* FOTO */}
          <section className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2 dark:text-slate-400">
              Foto de progreso
            </div>
            {state.hasProgressPhoto ? (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 text-sm dark:bg-emerald-900/20 dark:border-emerald-800">
                <Check
                  className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
                <span className="text-emerald-700 dark:text-emerald-300">
                  Foto-set capturada
                </span>
                {!isReadOnly ? (
                  <button
                    type="button"
                    onClick={() => dispatch({ kind: "set-has-photo", value: false })}
                    className="ml-auto text-xs text-emerald-700 underline dark:text-emerald-300"
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
            ) : isReadOnly ? (
              <div className="text-sm text-slate-400 italic dark:text-slate-500">
                Sin foto registrada en esta cita.
              </div>
            ) : (
              <Btn
                variant="violet-soft"
                size="md"
                className="w-full justify-center"
                icon={<Camera className="w-4 h-4" aria-hidden />}
                onClick={() => dispatch({ kind: "set-has-photo", value: true })}
              >
                Capturar foto-set ahora
              </Btn>
            )}
          </section>

          {/* PRÓXIMA CITA */}
          {!isReadOnly ? (
            <section className="px-6 py-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2 dark:text-slate-400">
                Próxima cita
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="datetime-local"
                  value={state.nextDate ? state.nextDate.slice(0, 16) : ""}
                  onChange={(e) =>
                    dispatch({
                      kind: "set-next-date",
                      value: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    })
                  }
                  className="text-sm bg-white border border-slate-200 rounded px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                  aria-label="Fecha próxima cita"
                />
                <select
                  value={state.nextDurationMin ?? 30}
                  onChange={(e) =>
                    dispatch({ kind: "set-next-duration", value: parseInt(e.target.value, 10) })
                  }
                  className="text-sm bg-white border border-slate-200 rounded px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
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
          ) : null}
        </div>

        <footer className="px-6 py-3 border-t border-slate-200 flex items-center justify-between bg-slate-50 dark:bg-slate-900/40 dark:border-slate-800 gap-2 flex-wrap">
          {props.card && props.onSharePatient ? (
            <Btn
              variant="ghost"
              size="sm"
              icon={<MessageCircle className="w-3.5 h-3.5" aria-hidden />}
              onClick={() => props.onSharePatient!(props.card!.id)}
            >
              Compartir paciente
            </Btn>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Btn variant="secondary" size="md" onClick={props.onClose}>
              {isReadOnly ? "Cerrar" : "Cancelar"}
            </Btn>
            {!isReadOnly && props.onSave ? (
              <Btn
                variant="secondary"
                size="md"
                onClick={() => void props.onSave!(buildSubmit())}
              >
                Guardar borrador
              </Btn>
            ) : null}
            {!isReadOnly && props.onSign ? (
              <Btn
                variant="primary"
                size="md"
                icon={<Check className="w-3.5 h-3.5" aria-hidden />}
                onClick={() => void props.onSign!(buildSubmit())}
                disabled={!canSign}
                title={!canSign ? "Captura S/O/A/P para firmar la cita" : undefined}
              >
                Firmar cita
              </Btn>
            ) : null}
          </div>
        </footer>
      </aside>
    </>
  );
}

// ─── Sub-blocks ─────────────────────────────────────────────────────────

function ElasticsBlock(props: {
  elastics: ElasticDTO[];
  readOnly: boolean;
  onAdd: (e: ElasticDTO) => void;
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
    <section className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
          Elásticos
        </div>
        {!props.readOnly ? (
          <div className="flex gap-1">
            {(["CLASE_I", "CLASE_II", "CLASE_III", "BOX"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onPick(c)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-900/30 dark:text-violet-300"
              >
                + {ELASTIC_CLASS_LABELS[c]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {props.elastics.length === 0 ? (
        <div className="text-xs text-slate-400 dark:text-slate-500">
          Sin elásticos esta cita
        </div>
      ) : (
        <div className="space-y-1.5">
          {props.elastics.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-700"
            >
              <span className="font-mono text-slate-900 dark:text-slate-100">
                {ELASTIC_CLASS_LABELS[e.elasticClass]} {e.config}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {ELASTIC_ZONE_LABELS[e.zone]}
                {!props.readOnly ? (
                  <button
                    type="button"
                    onClick={() => props.onRemove(e.id)}
                    aria-label="Quitar elástico"
                    className="ml-2 text-slate-400 hover:text-rose-500"
                  >
                    <Trash2 className="w-3 h-3 inline" aria-hidden />
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function IprBlock(props: {
  points: IPRPointDTO[];
  readOnly: boolean;
  onAdd: (p: IPRPointDTO) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const onAddRow = () => {
    const id = `tmp-${Math.random().toString(36).slice(2)}`;
    props.onAdd({ id, toothA: 13, toothB: 14, amountMm: 0.3, done: true });
  };
  return (
    <section className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
          IPR realizado
        </div>
        {!props.readOnly ? (
          <Btn
            variant="ghost"
            size="sm"
            icon={<Plus className="w-3 h-3" aria-hidden />}
            onClick={onAddRow}
          >
            Agregar
          </Btn>
        ) : null}
      </div>
      {props.points.length === 0 ? (
        <div className="text-xs text-slate-400 dark:text-slate-500">Sin IPR esta cita</div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {props.points.map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between rounded px-2.5 py-1.5 text-xs border ${
                p.done
                  ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"
                  : "bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700"
              }`}
            >
              <span className="font-mono text-slate-900 dark:text-slate-100">
                {p.toothA}-{p.toothB}
              </span>
              <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                {p.amountMm.toFixed(1)} mm
              </span>
              {!props.readOnly ? (
                <button
                  type="button"
                  onClick={() => props.onToggle(p.id)}
                  className="text-[10px] text-slate-500 underline"
                  aria-label={p.done ? "Marcar pendiente" : "Marcar realizado"}
                >
                  {p.done ? "✓" : "○"}
                </button>
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
    <section className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
          Brackets caídos / re-bonding
        </div>
        {!props.readOnly ? (
          <Btn
            variant="ghost"
            size="sm"
            icon={<Plus className="w-3 h-3" aria-hidden />}
            onClick={onAddRow}
          >
            Reportar
          </Btn>
        ) : null}
      </div>
      {props.list.length === 0 ? (
        <div className="text-xs text-slate-400 dark:text-slate-500">
          Ningún bracket caído
        </div>
      ) : (
        <div className="space-y-1.5">
          {props.list.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between bg-rose-50 border border-rose-200 rounded px-3 py-2 text-sm dark:bg-rose-900/20 dark:border-rose-800"
            >
              <span className="font-mono text-slate-900 dark:text-slate-100">
                Diente {b.toothFdi}
              </span>
              <span className="text-xs flex items-center gap-2">
                {b.reBondedDate ? (
                  <Pill color="emerald" size="xs">
                    Re-bondeado
                  </Pill>
                ) : (
                  <span className="text-rose-700 dark:text-rose-300">Pendiente</span>
                )}
                {!props.readOnly && !b.reBondedDate ? (
                  <button
                    type="button"
                    onClick={() => props.onMarkRebonded(b.id)}
                    className="text-[10px] text-rose-700 underline dark:text-rose-300"
                  >
                    Marcar re-bond
                  </button>
                ) : null}
              </span>
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
    <section className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2 dark:text-slate-400">
        Higiene
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-50 border border-slate-200 rounded p-2.5 dark:bg-slate-800 dark:border-slate-700">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Placa</div>
          {props.readOnly ? (
            <div className="text-sm font-mono font-semibold text-slate-900 mt-0.5 dark:text-slate-100">
              {props.plaquePct ?? "—"}%
            </div>
          ) : (
            <input
              type="number"
              min={0}
              max={100}
              value={props.plaquePct ?? ""}
              onChange={(e) =>
                props.onPlaque(e.target.value === "" ? null : parseInt(e.target.value, 10))
              }
              className="w-full mt-0.5 text-sm font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
              aria-label="Placa porcentaje"
            />
          )}
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded p-2.5 dark:bg-slate-800 dark:border-slate-700">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Gingivitis</div>
          {props.readOnly ? (
            <div className="text-sm font-medium text-slate-900 mt-0.5 dark:text-slate-100">
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
              className="w-full mt-0.5 text-sm bg-white border border-slate-200 rounded px-1.5 py-0.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
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
        <div className="bg-slate-50 border border-slate-200 rounded p-2.5 dark:bg-slate-800 dark:border-slate-700">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">White spots</div>
          {props.readOnly ? (
            <div className="text-sm font-medium text-slate-900 mt-0.5 dark:text-slate-100">
              {props.whiteSpots ? "Sí" : "No"}
            </div>
          ) : (
            <label className="mt-0.5 inline-flex items-center gap-1 text-sm dark:text-slate-200">
              <input
                type="checkbox"
                checked={props.whiteSpots}
                onChange={(e) => props.onWhiteSpots(e.target.checked)}
              />{" "}
              Detectados
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
