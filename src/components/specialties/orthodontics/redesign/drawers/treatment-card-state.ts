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
  /**
   * Fila 12: qué vino del control anterior (hoja nueva). Sirve para marcarlo
   * en pantalla como «del control anterior»; en cuanto el doctor lo cambia
   * deja de estar marcado (ya es de este control).
   */
  delAnterior: MarcasDelAnterior;
  /**
   * Fila 12: la nota tal como se precargó (soap-prefill), o `null`. Una
   * plantilla elegida después REEMPLAZA los campos que siguen igual a la
   * precarga en vez de añadirse debajo, y el Plan precargado sin tocar no
   * cuenta como Plan escrito.
   */
  notaPrecargada: SOAP | null;
}

export interface MarcasDelAnterior {
  arco: boolean;
  /** Ids (locales) de los elásticos heredados. */
  elasticos: string[];
  /** Ids (locales) de los brackets pendientes heredados. */
  brackets: string[];
  indicaciones: boolean;
}

const SIN_MARCAS: MarcasDelAnterior = { arco: false, elasticos: [], brackets: [], indicaciones: false };

/** Lo que una hoja NUEVA hereda del control anterior del mismo caso. */
export interface PrecargaHoja {
  /** Arco actual (el que queda si no se cambia). */
  arcoId?: string | null;
  elastics?: ReadonlyArray<Pick<ElasticDTO, "elasticClass" | "config" | "zone">>;
  /** Brackets que el control anterior dejó caídos sin recementar. */
  brackets?: ReadonlyArray<{ toothFdi: number; brokenDate: string; notes?: string | null }>;
  indications?: string | null;
  nota?: SOAP | null;
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
  | { kind: "update-bracket"; id: string; patch: Partial<Pick<BrokenBracketDTO, "toothFdi" | "brokenDate">> }
  | { kind: "remove-bracket"; id: string }
  | { kind: "mark-rebonded"; id: string }
  | { kind: "learn-card-id"; id: string };

export function initialState(
  card: TreatmentCardDTO | null,
  precarga?: PrecargaHoja | null,
): DrawerState {
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
      delAnterior: SIN_MARCAS,
      notaPrecargada: null,
    };
  }
  // Fila 12: la precarga va aquí, en el estado inicial, y no en efectos
  // después de montar: así ocurre UNA vez (sin duplicar elásticos cuando
  // React corre los efectos dos veces en desarrollo) y elegir «Sin cambio»
  // en el arco ya no se deshace solo.
  const p = precarga ?? {};
  const elastics: ElasticDTO[] = (p.elastics ?? []).map((e, i) => ({
    id: `anterior-elastico-${i}`,
    elasticClass: e.elasticClass,
    config: e.config,
    zone: e.zone,
  }));
  const brokenBrackets: BrokenBracketDTO[] = (p.brackets ?? []).map((b, i) => ({
    id: `anterior-bracket-${i}`,
    toothFdi: b.toothFdi,
    brokenDate: b.brokenDate,
    reBondedDate: null,
    notes: b.notes ?? null,
  }));
  const indications = p.indications?.trim() ? p.indications : "";
  const nota = p.nota ? { ...p.nota } : null;
  return {
    soap: nota ? { ...nota } : { s: "", o: "", a: "", p: "" },
    plaquePct: null,
    gingivitis: null,
    whiteSpots: false,
    elastics,
    iprPoints: [],
    brokenBrackets,
    hasProgressPhoto: false,
    photoSetId: null,
    wireToId: p.arcoId ?? null,
    nextDate: null,
    nextDurationMin: 30,
    activationsNote: "",
    indications,
    learnedCardId: null,
    delAnterior: {
      arco: Boolean(p.arcoId),
      elasticos: elastics.map((e) => e.id),
      brackets: brokenBrackets.map((b) => b.id),
      indicaciones: indications !== "",
    },
    notaPrecargada: nota,
  };
}

/** Quita un id de una lista de marcas sin crear objetos si no estaba. */
function sinMarca(marcas: MarcasDelAnterior, campo: "elasticos" | "brackets", id: string): MarcasDelAnterior {
  return marcas[campo].includes(id) ? { ...marcas, [campo]: marcas[campo].filter((x) => x !== id) } : marcas;
}

/**
 * Fila 12 (c): para firmar solo el Plan es obligatorio; S, O y A son
 * opcionales. Un Plan precargado que nadie tocó no cuenta como escrito.
 * El servidor aplica la misma regla (`canSignSoap`, sin saber de precargas).
 */
export function puedeFirmarNota(soap: SOAP, precargada: SOAP | null): boolean {
  const plan = soap.p.trim();
  if (plan.length === 0) return false;
  return !precargada || plan !== precargada.p.trim();
}

/**
 * Fila 12 (b): sobre qué nota se aplica una plantilla elegida. Un campo que
 * sigue tal cual se precargó se vacía SI la plantilla trae texto para él (la
 * plantilla lo reemplaza); si la plantilla no dice nada de ese campo, la
 * precarga se queda. Lo que el doctor ya escribió o cambió se conserva y la
 * plantilla va debajo, como siempre.
 */
export function notaBaseParaPlantilla(
  soap: SOAP,
  precargada: SOAP | null,
  plantilla: { S: string; O: string; A: string; P: string },
): SOAP {
  if (!precargada) return soap;
  const campo = (k: keyof SOAP, deLaPlantilla: string) =>
    soap[k] === precargada[k] && deLaPlantilla.trim() !== "" ? "" : soap[k];
  return { s: campo("s", plantilla.S), o: campo("o", plantilla.O), a: campo("a", plantilla.A), p: campo("p", plantilla.P) };
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
      return {
        ...state,
        wireToId: action.value,
        delAnterior: state.delAnterior.arco ? { ...state.delAnterior, arco: false } : state.delAnterior,
      };
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
      return {
        ...state,
        indications: action.value,
        delAnterior: state.delAnterior.indicaciones
          ? { ...state.delAnterior, indicaciones: false }
          : state.delAnterior,
      };
    case "add-elastic":
      return { ...state, elastics: [...state.elastics, action.value] };
    case "update-elastic":
      return {
        ...state,
        elastics: state.elastics.map((e) =>
          e.id === action.id ? { ...e, ...action.patch } : e,
        ),
        delAnterior: sinMarca(state.delAnterior, "elasticos", action.id),
      };
    case "remove-elastic":
      return {
        ...state,
        elastics: state.elastics.filter((e) => e.id !== action.id),
        delAnterior: sinMarca(state.delAnterior, "elasticos", action.id),
      };
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
        delAnterior: sinMarca(state.delAnterior, "brackets", action.id),
      };
    case "remove-bracket":
      return {
        ...state,
        brokenBrackets: state.brokenBrackets.filter((b) => b.id !== action.id),
        delAnterior: sinMarca(state.delAnterior, "brackets", action.id),
      };
    case "mark-rebonded":
      return {
        ...state,
        brokenBrackets: state.brokenBrackets.map((b) =>
          b.id === action.id ? { ...b, reBondedDate: new Date().toISOString() } : b,
        ),
        delAnterior: sinMarca(state.delAnterior, "brackets", action.id),
      };
    case "learn-card-id":
      return { ...state, learnedCardId: action.id };
  }
}
