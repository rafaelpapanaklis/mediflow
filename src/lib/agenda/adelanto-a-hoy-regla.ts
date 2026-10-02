// ws1-t8 (decisión 6 de Rafael): la regla PURA de traer a hoy la cita futura de un paciente que llegó hoy.
// Sin base de datos (se prueba sola); la lectura de la agenda y la escritura están en adelantar-cita-a-hoy.ts.
import { diaEnZona } from "@/lib/orthodontics/cerrar-cita-al-firmar";
import { fechaHoraParaTexto } from "@/lib/movimientos-paciente/textos";

/** Estados en los que el paciente ya está en la clínica para ESA cita. */
export const ESTADOS_CON_PACIENTE_PRESENTE: ReadonlySet<string> = new Set(["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"]);

/** ¿Pasar la cita a `destino` ahora la tiene que traer a hoy? Solo si el paciente llega y la cita es de un día futuro. */
export function debeAdelantarseAHoy(cita: { startsAt: Date }, destino: string, ahora: Date, zona: string): boolean {
  if (!ESTADOS_CON_PACIENTE_PRESENTE.has(destino)) return false;
  return diaEnZona(cita.startsAt, zona) > diaEnZona(ahora, zona);
}

/** Empieza ahora (al minuto, sin segundos) y dura lo mismo que antes. */
export function rangoAdelantado(cita: { startsAt: Date; endsAt: Date }, ahora: Date): { startsAt: Date; endsAt: Date } {
  const inicio = new Date(Math.floor(ahora.getTime() / 60_000) * 60_000);
  const duracion = Math.max(60_000, cita.endsAt.getTime() - cita.startsAt.getTime());
  return { startsAt: inicio, endsAt: new Date(inicio.getTime() + duracion) };
}

export type ChoqueDeAgenda = { id: string; paciente: string; startsAt: Date };

export interface AdelantoAHoy {
  antes: { startsAt: Date; endsAt: Date };
  despues: { startsAt: Date; endsAt: Date };
  /** El sillón de la cita estaba ocupado a esta hora: la cita queda sin sillón. */
  sinSillon: boolean;
  /** Otra cita del mismo doctor a esta hora: la cita entra como sobreturno. */
  seCruzaCon: ChoqueDeAgenda | null;
  /** Campos a escribir en la cita, en el mismo UPDATE que el cambio de estado. */
  datos: {
    startsAt: Date;
    endsAt: Date;
    resourceId?: null;
    overrideReason?: string;
    overriddenBy?: string;
    overriddenAt?: Date;
  };
}

/** El texto del sobreturno: lo lee quien abra la cita en la Agenda. Cabe en VarChar(500). */
export function motivoDelSobreturno(antes: Date, zona: string): string {
  return `Adelantada a hoy: el paciente llegó antes de su cita del ${fechaHoraParaTexto(antes, zona)}.`;
}

/** Lo que hay que hacer con el sillón y el doctor según lo que ya ocupa ese hueco. */
export function planDeAdelanto(args: {
  cita: { startsAt: Date; endsAt: Date; resourceId: string | null; overrideReason: string | null };
  ahora: Date;
  zona: string;
  userId: string;
  choqueDoctor: ChoqueDeAgenda | null;
  choqueSillon: ChoqueDeAgenda | null;
}): AdelantoAHoy {
  const despues = rangoAdelantado(args.cita, args.ahora);
  const sinSillon = Boolean(args.cita.resourceId && args.choqueSillon);
  const datos: AdelantoAHoy["datos"] = { ...despues };
  if (sinSillon) datos.resourceId = null;
  // Un sobreturno que ya traía su motivo lo conserva.
  if (args.choqueDoctor && !args.cita.overrideReason) {
    datos.overrideReason = motivoDelSobreturno(args.cita.startsAt, args.zona);
    datos.overriddenBy = args.userId;
    datos.overriddenAt = args.ahora;
  }
  return {
    antes: { startsAt: args.cita.startsAt, endsAt: args.cita.endsAt },
    despues,
    sinSillon,
    seCruzaCon: args.choqueDoctor,
    datos,
  };
}

/** Motivo con que se cancelan los recordatorios de la fecha vieja. */
export const MOTIVO_RECORDATORIOS_ADELANTO = "Cancelado: la cita se adelantó a hoy (el paciente llegó)";

/** Lo que viaja al navegador para avisar del cambio. */
export function adelantoParaRespuesta(a: AdelantoAHoy) {
  return {
    de: a.antes.startsAt.toISOString(),
    a: a.despues.startsAt.toISOString(),
    sinSillon: a.sinSillon,
    seCruzaCon: a.seCruzaCon ? { paciente: a.seCruzaCon.paciente, startsAt: a.seCruzaCon.startsAt.toISOString() } : null,
  };
}

export type AdelantoEnRespuesta = ReturnType<typeof adelantoParaRespuesta>;
