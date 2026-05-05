// Periodontics — reducer del estado del periodontograma. SPEC §6.5.

import type { Site, ToothLevel } from "@/lib/periodontics/schemas";
import { nextSite, prevSite, type SitePos } from "@/lib/periodontics/site-helpers";

export type PerioState = {
  recordId: string;
  sites: Site[];
  teeth: ToothLevel[];
  cursor: { fdi: number; position: SitePos } | null;
};

export type PerioAction =
  | { type: "SET_CURSOR"; fdi: number; position: SitePos }
  | { type: "MOVE_NEXT" }
  | { type: "MOVE_PREV" }
  | { type: "UPSERT_SITE"; site: Site }
  | { type: "UPSERT_TOOTH"; tooth: ToothLevel }
  | { type: "TOGGLE_BOP" }
  | { type: "TOGGLE_PLAQUE" }
  | { type: "TOGGLE_SUPPURATION" };

export function perioReducer(state: PerioState, action: PerioAction): PerioState {
  switch (action.type) {
    case "SET_CURSOR":
      return { ...state, cursor: { fdi: action.fdi, position: action.position } };

    case "MOVE_NEXT": {
      if (!state.cursor) return state;
      const next = nextSite(state.cursor.fdi, state.cursor.position);
      return next ? { ...state, cursor: next } : state;
    }

    case "MOVE_PREV": {
      if (!state.cursor) return state;
      const prev = prevSite(state.cursor.fdi, state.cursor.position);
      return prev ? { ...state, cursor: prev } : state;
    }

    case "UPSERT_SITE": {
      const idx = state.sites.findIndex(
        (s) => s.fdi === action.site.fdi && s.position === action.site.position,
      );
      const sites =
        idx >= 0
          ? [...state.sites.slice(0, idx), action.site, ...state.sites.slice(idx + 1)]
          : [...state.sites, action.site];
      return { ...state, sites };
    }

    case "UPSERT_TOOTH": {
      const idx = state.teeth.findIndex((t) => t.fdi === action.tooth.fdi);
      const teeth =
        idx >= 0
          ? [...state.teeth.slice(0, idx), action.tooth, ...state.teeth.slice(idx + 1)]
          : [...state.teeth, action.tooth];
      return { ...state, teeth };
    }

    case "TOGGLE_BOP":
      return toggleAtCursor(state, "bop");
    case "TOGGLE_PLAQUE":
      return toggleAtCursor(state, "plaque");
    case "TOGGLE_SUPPURATION":
      return toggleAtCursor(state, "suppuration");

    default:
      return state;
  }
}

function toggleAtCursor(
  state: PerioState,
  key: "bop" | "plaque" | "suppuration",
): PerioState {
  if (!state.cursor) return state;
  const idx = state.sites.findIndex(
    (s) => s.fdi === state.cursor!.fdi && s.position === state.cursor!.position,
  );
  if (idx < 0) {
    // Sitio no existe aún — inicializa con el toggle puesto.
    const newSite: Site = {
      fdi: state.cursor.fdi,
      position: state.cursor.position,
      pdMm: 0,
      recMm: 0,
      bop: key === "bop",
      plaque: key === "plaque",
      suppuration: key === "suppuration",
    };
    return { ...state, sites: [...state.sites, newSite] };
  }
  const target = state.sites[idx]!;
  const next: Site = { ...target, [key]: !target[key] };
  const sites = [...state.sites.slice(0, idx), next, ...state.sites.slice(idx + 1)];
  return { ...state, sites };
}

/**
 * Lee el sitio en (fdi, position) o devuelve undefined.
 */
export function getSite(state: PerioState, fdi: number, position: SitePos): Site | undefined {
  return state.sites.find((s) => s.fdi === fdi && s.position === position);
}

/**
 * Lee el diente o devuelve undefined.
 */
export function getTooth(state: PerioState, fdi: number): ToothLevel | undefined {
  return state.teeth.find((t) => t.fdi === fdi);
}
