// Fila 12 — «la hoja de control empieza en blanco cada vez».
//
// Con controles de 15 minutos, recapturar elásticos, arco, brackets pendientes
// y la nota entera es lo que más tiempo quita. Aquí vive, en puro (sin Prisma
// ni React), lo que una hoja NUEVA hereda del control anterior del mismo caso:
//
//   · el control anterior es la última hoja FIRMADA (un borrador todavía no
//     dice nada: puede cambiar);
//   · el arco actual es el que ese control colocó, o —si no cambió el arco—
//     el mismo con el que llegó;
//   · los brackets caídos que ese control dejó sin recementar siguen
//     pendientes en este;
//   · la nota arranca con `buildOrthoSoapPrefill` (soap-prefill.ts), con sus
//     «[completar …]» convertidos en huecos `____` para que la hoja los cuente
//     y avise antes de firmar, igual que con las plantillas de nota.
//
// Lo usan `buildTreatmentCardContext` (servidor, Agenda y ficha) y el camino
// de respaldo de la ficha cuando ese contexto no llega.

import type { OrthoPaymentStatus, OrthoPhaseKey, OrthoTechnique } from "@prisma/client";
import { buildOrthoSoapPrefill } from "./soap-prefill";
import { techniqueLabel } from "./consent-texts";
import { HUECO, type NotaSoap } from "./consulta-ortodoncia";

/** La última hoja FIRMADA del caso (la de mayor número), o `null`. */
export function ultimoControlFirmado<T extends { cardNumber: number; status: string }>(
  cards: readonly T[],
): T | null {
  let ultimo: T | null = null;
  for (const c of cards) {
    if (c.status !== "SIGNED") continue;
    if (!ultimo || c.cardNumber > ultimo.cardNumber) ultimo = c;
  }
  return ultimo;
}

/**
 * El arco con el que el paciente llega a este control: el que puso el
 * anterior o, si el anterior no cambió de arco, el mismo con el que llegó.
 */
export function arcoActualDelControl(
  anterior: { wireFromId: string | null; wireToId: string | null } | null,
): string | null {
  if (!anterior) return null;
  return anterior.wireToId ?? anterior.wireFromId ?? null;
}

export interface BracketPendiente {
  toothFdi: number;
  brokenDate: string;
  notes: string | null;
}

/** Brackets caídos que el control anterior dejó sin recementar. */
export function bracketsPendientes(
  lista: ReadonlyArray<{
    toothFdi: number;
    brokenDate: Date | string;
    reBondedDate: Date | string | null;
    notes?: string | null;
  }>,
): BracketPendiente[] {
  return lista
    .filter((b) => b.reBondedDate == null)
    .map((b) => ({
      toothFdi: b.toothFdi,
      brokenDate: typeof b.brokenDate === "string" ? b.brokenDate : b.brokenDate.toISOString(),
      notes: b.notes ?? null,
    }));
}

/** «[completar — dolor, molestia]» → «____ (dolor, molestia)»; «[completar]» → «____». */
export function completarAHuecos(texto: string): string {
  return texto.replace(/\[completar(?:\s*[—–-]\s*([^\]]*))?\]/g, (_t, pista?: string) =>
    pista && pista.trim() ? `${HUECO} (${pista.trim()})` : HUECO,
  );
}

export interface DatosNotaPrecargada {
  patientName: string;
  monthAt: number;
  technique: OrthoTechnique | null;
  /** ws1-t10: nombre propio de la técnica del caso. */
  techniqueName?: string | null;
  phaseKey: OrthoPhaseKey | null;
  paymentStatus: OrthoPaymentStatus | null;
  /** FDI de los brackets que siguen caídos (se mencionan en el Objetivo). */
  bracketsPendientesFdi: number[];
}

/** La nota S/O/A/P con la que arranca una hoja nueva. */
export function notaPrecargada(d: DatosNotaPrecargada): NotaSoap {
  const n = buildOrthoSoapPrefill({
    patientName: d.patientName.trim() || "Paciente",
    monthInTreatment: Math.floor(d.monthAt),
    technique: d.technique ? techniqueLabel(d.technique, d.techniqueName) : "ortodoncia",
    phaseKey: d.phaseKey,
    paymentStatus: d.paymentStatus,
    bracketsLooseFdis: d.bracketsPendientesFdi,
    appliancesIntact: d.bracketsPendientesFdi.length === 0,
  });
  return {
    s: completarAHuecos(n.S),
    o: completarAHuecos(n.O),
    a: completarAHuecos(n.A),
    p: completarAHuecos(n.P),
  };
}
