// Estado/reducer de DrawerTreatmentCard, separado del componente para que
// se pueda importar sin arrastrar su hoja de estilos ni los átomos que la
// usan: Node no sabe leer un `.module.css` (mismo motivo, mismo criterio,
// que ya llevó a mover `phase-criteria.ts`/`wire-options.ts` — el
// contenido es el mismo, movido tal cual).

import type {
  ElasticDTO,
  IPRPointDTO,
  BrokenBracketDTO,
  OrthoGingivitisLevel,
  SOAP,
  TreatmentCardDTO,
} from "../types";

export interface DrawerState {
  soap: SOAP;
  plaquePct: number | null;
  gingivitis: OrthoGingivitisLevel | null;
  whiteSpots: boolean;
  elastics: ElasticDTO[];
  iprPoints: IPRPointDTO[];
  brokenBrackets: BrokenBracketDTO[];
  hasProgressPhoto: boolean;
  photoSetId: string | null;
  wireToId: string | null;
  nextDate: string | null;
  nextDurationMin: number | null;
  activationsNote: string;
  indications: string;
  /**
   * §1 completo (ws1-t8): el `cardId` que `onSave`/`onSign` confirmó en
   * ESTA sesión del cajón — `props.card` no cambia hasta que el padre
   * remonte el componente, así que sin esto un "Guardar borrador" seguido
   * de "Firmar" (sin cerrar el cajón) volvía a mandar `cardId: null` los
   * dos, y el servidor intentaba CREAR la tarjeta dos veces con el mismo
   * `cardNumber` — "Unique constraint failed on (treatmentPlanId,
   * cardNumber)".
   */
  learnedCardId: string | null;
}

export type DrawerAction =
  | { kind: "set-soap"; field: keyof SOAP; value: string }
  | { kind: "set-plaque"; value: number | null }
  | { kind: "set-gingivitis"; value: OrthoGingivitisLevel | null }
  | { kind: "set-white-spots"; value: boolean }
  | { kind: "set-wire-to"; value: string | null }
  | { kind: "set-next-date"; value: string | null }
  | { kind: "set-next-duration"; value: number | null }
  | { kind: "set-has-photo"; value: boolean }
  | { kind: "set-photo-set"; value: string | null }
  | { kind: "set-activations-note"; value: string }
  | { kind: "set-indications"; value: string }
  | { kind: "add-elastic"; value: ElasticDTO }
  | { kind: "update-elastic"; id: string; patch: Partial<Pick<ElasticDTO, "config" | "zone">> }
  | { kind: "remove-elastic"; id: string }
  | { kind: "add-ipr"; value: IPRPointDTO }
  | { kind: "update-ipr"; id: string; patch: Partial<Pick<IPRPointDTO, "toothA" | "toothB" | "amountMm">> }
  | { kind: "remove-ipr"; id: string }
  | { kind: "toggle-ipr"; id: string }
  | { kind: "add-bracket"; value: BrokenBracketDTO }
  | { kind: "update-bracket"; id: string; patch: Partial<Pick<BrokenBracketDTO, "toothFdi">> }
  | { kind: "remove-bracket"; id: string }
  | { kind: "mark-rebonded"; id: string }
  | { kind: "learn-card-id"; id: string };

export function initialState(card: TreatmentCardDTO | null): DrawerState {
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
      photoSetId: card.photoSetId,
      wireToId: card.wireTo?.id ?? null,
      nextDate: card.nextDate,
      nextDurationMin: card.nextDurationMin,
      activationsNote: card.activationsNote ?? "",
      indications: card.indications ?? "",
      learnedCardId: card.id,
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
    photoSetId: null,
    wireToId: null,
    nextDate: null,
    nextDurationMin: 30,
    activationsNote: "",
    indications: "",
    learnedCardId: null,
  };
}

export function reducer(state: DrawerState, action: DrawerAction): DrawerState {
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
    case "set-photo-set":
      return { ...state, photoSetId: action.value, hasProgressPhoto: action.value != null };
    case "set-activations-note":
      return { ...state, activationsNote: action.value };
    case "set-indications":
      return { ...state, indications: action.value };
    case "add-elastic":
      return { ...state, elastics: [...state.elastics, action.value] };
    case "update-elastic":
      return {
        ...state,
        elastics: state.elastics.map((e) =>
          e.id === action.id ? { ...e, ...action.patch } : e,
        ),
      };
    case "remove-elastic":
      return { ...state, elastics: state.elastics.filter((e) => e.id !== action.id) };
    case "add-ipr":
      return { ...state, iprPoints: [...state.iprPoints, action.value] };
    case "update-ipr":
      return {
        ...state,
        iprPoints: state.iprPoints.map((p) =>
          p.id === action.id ? { ...p, ...action.patch } : p,
        ),
      };
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
    case "update-bracket":
      return {
        ...state,
        brokenBrackets: state.brokenBrackets.map((b) =>
          b.id === action.id ? { ...b, ...action.patch } : b,
        ),
      };
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
    case "learn-card-id":
      return { ...state, learnedCardId: action.id };
  }
}
