/**
 * El criterio de `oportunidades_perdidas`: la forma de una fila, la rendija de
 * lectura, los topes y —lo único de verdad discutible de esta tarea— EL ORDEN.
 *
 * Vive en su propio archivo porque lo comparten la herramienta
 * (./oportunidades-perdidas) y las cuatro fuentes (./oportunidades-fuentes), y
 * porque así el juicio de valor está en un sitio y se discute en una pantalla.
 *
 * ═══ EL ORDEN, QUE ES EL TRABAJO ═══════════════════════════════════════
 *
 *   prioridad = (valor + 1) × 0.5 ^ (días / semivida)
 *
 * En castellano: manda el dinero, y el dinero se descuenta según se enfría.
 *
 * Es lo que pidió Rafael con su ejemplo, y sale exacto: un presupuesto de
 * $30,000 de hace una semana vale 0.5^(7/21) = 0.79 → 23,800, y uno de $800 de
 * hace seis meses vale 0.5^(180/21) = 0.0026 → $2. El primero va arriba por un
 * factor de diez mil, no por un desempate.
 *
 * El `+1` no es cosmético: sin él, una fila sin dinero (una cita caída) daría
 * cero y todas empatarían. Con él, las filas sin pesos se ordenan entre ellas por
 * lo recientes que son y siempre quedan por debajo de cualquier fila con dinero,
 * que es el orden en que se llama por teléfono.
 *
 * 🔴 La prioridad NO viaja en la fila. Es un número ponderado, y un número
 * ponderado al lado de un importe acaba dicho como si fueran pesos («se te
 * escapan 23,800») — que es exactamente la mentira que esta herramienta existe
 * para no contar. Las filas salen YA ordenadas y llevan `valor` (pesos de
 * verdad) y `dias`. El modelo tiene instrucción de no reordenarlas.
 */

/** Las cinco fugas que se consultan. Los pacientes fríos son `pacientes_inactivos`. */
export type TipoEscape = "sin_agendar" | "sin_respuesta" | "por_cobrar" | "sin_reagendar" | "sin_contestar";

export const TIPOS_ESCAPE: TipoEscape[] = ["sin_agendar", "sin_respuesta", "por_cobrar", "sin_reagendar", "sin_contestar"];

/** Cómo se llama cada sección cuando hay que decírselo a una persona. */
export const ETIQUETA_ESCAPE: Record<TipoEscape, string> = {
  sin_agendar: "trabajo aceptado sin agendar",
  sin_respuesta: "presupuestos sin respuesta",
  por_cobrar: "facturas por cobrar",
  sin_reagendar: "citas caídas sin reagendar",
  sin_contestar: "gente esperando respuesta",
};

/**
 * Cuántos días tarda cada cosa en valer la mitad. Es el único juicio de valor de
 * toda la herramienta y está aquí junto para poder discutirlo de un vistazo:
 *
 *  · un presupuesto que nadie contestó se enfría rápido — tres semanas;
 *  · un «sí» del paciente aguanta bastante más — dos meses;
 *  · una deuda se sigue cobrando durante meses — medio año;
 *  · una cita caída se reagenda dentro del mes o ya no se reagenda;
 *  · y quien pidió cita y no recibe respuesta se va a la clínica de al lado en
 *    cuestión de días — de ahí la semivida más corta de todas.
 */
export const SEMIVIDA_DIAS: Record<TipoEscape, number> = {
  sin_agendar: 60,
  sin_respuesta: 21,
  por_cobrar: 180,
  sin_reagendar: 30,
  sin_contestar: 7,
};

export function prioridad(valor: number, dias: number, tipo: TipoEscape): number {
  const frescura = Math.pow(0.5, Math.max(0, dias) / SEMIVIDA_DIAS[tipo]);
  return (Math.max(0, valor) + 1) * frescura;
}

/** Las filas de una sección, de lo más recuperable a lo menos. No muta la entrada. */
export function ordenarPorPrioridad(filas: readonly FilaEscape[], tipo: TipoEscape): FilaEscape[] {
  return [...filas].sort((a, b) => prioridad(b.valor, b.dias, tipo) - prioridad(a.valor, a.dias, tipo));
}

/** Lo mismo, pero mezclando secciones: cada fila se pesa con la semivida de SU tipo. */
export function ordenarMezcla(filas: readonly FilaEscape[]): FilaEscape[] {
  return [...filas].sort((a, b) => prioridad(b.valor, b.dias, b.tipo) - prioridad(a.valor, a.dias, a.tipo));
}

/* ═══════════════════════════════════════════════════════════════════════
   LA FORMA DE UNA FILA
   ═══════════════════════════════════════════════════════════════════════ */

export interface FilaEscape {
  tipo: TipoEscape;
  paciente: string;
  /** Folio del PACIENTE (`patientNumber`), para buscarlo en el panel. */
  folio: string | null;
  telefono: string | null;
  /** Pesos DE VERDAD de esta fila. 0 cuando la fila no lleva dinero defendible. */
  valor: number;
  /** Días que lleva parada. Es la otra mitad del orden. */
  dias: number;
  /** Qué es, en una línea: el folio del presupuesto o de la factura, el plan, la fecha. */
  detalle: string;
  /** `true` = ese dinero YA está contado en `por_cobrar`; esta fila vale 0 para no sumarlo dos veces. */
  yaFacturado?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════
   TOPES — menos una preferencia que una defensa del pooler
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Cuántas filas se traen de cada tabla ANTES de ordenar. Esto cruza cuatro
 * tablas de toda la historia de la clínica, y sin tope una clínica de siete años
 * se come el pooler y el contexto. Cada consulta pide sus candidatos ordenados
 * por DINERO (o por fecha, donde no hay dinero), así que lo que se pierde al
 * recortar es siempre lo más barato. Cuando se toca el tope se DICE
 * (`aproximado`): un recorte nunca se presenta como el total.
 */
export const TOPE_CANDIDATOS = 500;

/** Las citas caídas son muchas más que lo demás: su tope va aparte. */
export const TOPE_CAIDAS = 2000;

/**
 * Ventana hacia atrás de las citas caídas y de las solicitudes sin contestar.
 * Más allá ya no es una reagenda: es un paciente inactivo. El parámetro `dias`
 * puede ENSANCHARLA, nunca estrecharla.
 */
export const VENTANA_CAIDAS_DIAS = 90;

/**
 * Lo máximo que se hace esperar a una cita caída antes de contarla. Lo único
 * que hay que dejar madurar es que a la cancelación le dé tiempo a ser
 * reagendada; una semana sobra. Sin este tope, un `dias` grande vaciaba la
 * sección en silencio en vez de ensanchar la búsqueda.
 */
export const GRACIA_CAIDAS_DIAS = 7;

/** Días parada que tiene que llevar una fila para contar. Se mueve con el parámetro `dias`. */
export const DIAS_POR_DEFECTO = 7;

/** Cuántas filas por sección trae el modo resumen. Cinco se leen; cincuenta no. */
export const TOPE_RESUMEN = 5;

export const DIA_MS = 86_400_000;

/* ═══════════════════════════════════════════════════════════════════════
   LA RENDIJA DE LECTURA
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Lo que esta herramienta necesita de la base, y NADA más. Mismo patrón que
 * `DineroDb` (../dinero/comun): se declara aquí en vez de engordar `SabinaDb`
 * porque los modelos que faltaban —`quote` con `count` y `treatmentPlan`— solo
 * los usa esta área, y hay otras pantallas tocando `tipos.ts` a la vez.
 *
 * Por tipos NO hay `create`, `update`, `delete` ni `$executeRaw`: la regla 1 del
 * contrato deja de depender de que nadie se despiste.
 */
export interface EscapeDb {
  /** Solicitudes de cita desde la mini-web pública, SIN cuenta. Puede no existir (ver la fuente). */
  bookingRequest: { findMany(args: any): Promise<any[]> };
  /** Peticiones de mover o cancelar cita hechas por el paciente desde el portal. */
  appointmentChangeRequest: { findMany(args: any): Promise<any[]> };
  invoice: {
    findMany(args: any): Promise<any[]>;
    aggregate(args: any): Promise<any>;
    /** El tope por paciente de `sin_agendar`: cuánto se le facturó ya y no ha pagado. */
    groupBy(args: any): Promise<any[]>;
  };
  quote: { findMany(args: any): Promise<any[]>; aggregate(args: any): Promise<any> };
  treatmentPlan: { findMany(args: any): Promise<any[]> };
  appointment: { findMany(args: any): Promise<any[]>; groupBy(args: any): Promise<any[]> };
}
