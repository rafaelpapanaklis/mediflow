// M6 (ws1-t8, ronda 6): firmar la hoja de control cierra la cita en la Agenda.
// Verificado en vivo: desde «Agendada» la máquina de estados NO permite ir
// directo a «Completada» (solo desde en sillón / en consulta), así que la cita
// se quedaba en «Agendada» y el arreglo no hacía nada. Si la cita todavía no
// arrancó, se pasa por «En consulta» (el doctor sí atendió: firmó la hoja),
// respetando el rol y la máquina de estados de siempre.
import { canTransition, sideEffectsOf } from "@/lib/agenda/transitions";

type Estado = Parameters<typeof canTransition>[0];
type Rol = Parameters<typeof canTransition>[2];

export type PlanDeCierre =
  | { accion: "nada" }
  | { accion: "completar"; pasaPorEnConsulta: boolean };

export function planDeCierreDeCita(
  estado: string,
  rol: string,
  ahora: Date,
  inicio: Date,
): PlanDeCierre {
  if (estado === "COMPLETED") return { accion: "nada" };
  const from = estado as Estado;
  const r = rol as Rol;
  if (canTransition(from, "COMPLETED", r, ahora, inicio).ok) {
    return { accion: "completar", pasaPorEnConsulta: false };
  }
  if (
    canTransition(from, "IN_PROGRESS", r, ahora, inicio).ok &&
    canTransition("IN_PROGRESS", "COMPLETED", r, ahora, inicio).ok
  ) {
    return { accion: "completar", pasaPorEnConsulta: true };
  }
  return { accion: "nada" };
}

/** Campos a escribir en la cita según el plan (vacío si no hay que tocarla). */
export function datosDeCierreDeCita(plan: PlanDeCierre, ahora: Date) {
  if (plan.accion === "nada") return null;
  return {
    status: "COMPLETED" as const,
    ...(plan.pasaPorEnConsulta ? sideEffectsOf("IN_PROGRESS", ahora) : {}),
    ...sideEffectsOf("COMPLETED", ahora),
  };
}
