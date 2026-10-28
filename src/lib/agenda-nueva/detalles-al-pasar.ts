/**
 * La tarjeta de detalles al pasar el mouse sobre una cita (decisión de Rafael, 28-oct-2026) — la parte PURA.
 *
 * Dos capas, para que la agenda no se vuelva más lenta:
 *  · LIGERO — lo que ya está en `CitaVista` (hora, doctor, sillón, motivo, estado, anticipo, mensualidad de
 *    ortodoncia vencida, sobreagendada). Se pinta en cuanto sale la tarjeta, sin ir al servidor.
 *  · PESADO — alergias, «En esta cita», «Debe hoy», teléfono, edad y primera vez. Se pide AL PASAR el mouse,
 *    con retardo, una sola ruta GET (`/api/appointments/[id]/detalles-al-pasar`), caché por cita y cancelable.
 *
 * Sin React ni Prisma: lo usan la pantalla, la ruta y las pruebas.
 */

/** Lo que espera el mouse quieto sobre la cita antes de pedir (y enseñar) nada. */
export const RETARDO_DETALLES_MS = 300;

/** Cuánto vale lo ya pedido de una cita. Pasado esto se vuelve a pedir (cobró, cambió de estado…). */
export const VIGENCIA_DETALLES_MS = 60_000;

/** Lo que devuelve la ruta. Todo opcional por dentro: si algo no se pudo leer, no se pinta. */
export interface DetallesPesados {
  paciente: {
    /** Años cumplidos, o `null` sin fecha de nacimiento. */
    edad: number | null;
    /** `true` = no tiene ninguna cita anterior que haya contado (ni canceladas ni plantones). */
    primeraVez: boolean;
    telefono: string | null;
  };
  /** Del cuestionario de salud / la ficha (`Patient.allergies`). Vacío = sin alergias registradas. */
  alergias: string[];
  /** El paciente contestó CONFIRMAR al recordatorio de WhatsApp de esta cita. */
  confirmadaPorWhatsapp: boolean;
  /** «En esta cita: resina $700»: los procedimientos del plan agendados para la cita o hechos en ella. */
  enEstaCita: Array<{ id: string; nombre: string; importe: number; estado: string }>;
  /** «Debe hoy»: la misma cifra que Pacientes y el «Debe» de la ficha (saldo − lo que aún no se debe). */
  debeHoy: number;
}

/** Años cumplidos a la fecha `ahora`, en la zona de la clínica. `null` si no hay fecha o sale absurda. */
export function edadEnAnios(dob: Date | string | null | undefined, ahora: Date, timezone: string): number | null {
  if (!dob) return null;
  const nacio = new Date(dob);
  if (!Number.isFinite(nacio.getTime())) return null;
  // La fecha de nacimiento se guarda a medianoche UTC: su día es el de UTC. El de hoy, el de la clínica.
  const hoy = partesEnZona(ahora, timezone);
  let edad = hoy.anio - nacio.getUTCFullYear();
  const mes = nacio.getUTCMonth() + 1;
  if (hoy.mes < mes || (hoy.mes === mes && hoy.dia < nacio.getUTCDate())) edad -= 1;
  return edad >= 0 && edad < 130 ? edad : null;
}

function partesEnZona(d: Date, timezone: string): { anio: number; mes: number; dia: number } {
  try {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d);
    const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return { anio: n("year"), mes: n("month"), dia: n("day") };
  } catch {
    return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
  }
}

/** La llave de la caché: si la cita cambia de estado o de hora, lo pedido ya no vale. */
export function claveDeDetalles(c: { id: string; estado: string; dto: { startsAt: string; endsAt?: string } }): string {
  return `${c.id}|${c.estado}|${c.dto.startsAt}|${c.dto.endsAt ?? ""}`;
}

/** Una caché pequeña con vigencia. El reloj se inyecta para poder probarla. */
export class CacheDeDetalles {
  private filas = new Map<string, { en: number; datos: DetallesPesados }>();
  constructor(private readonly vigenciaMs = VIGENCIA_DETALLES_MS, private readonly maximo = 200) {}

  leer(clave: string, ahora = Date.now()): DetallesPesados | null {
    const f = this.filas.get(clave);
    if (!f) return null;
    if (ahora - f.en > this.vigenciaMs) {
      this.filas.delete(clave);
      return null;
    }
    return f.datos;
  }

  guardar(clave: string, datos: DetallesPesados, ahora = Date.now()): void {
    this.filas.delete(clave);
    this.filas.set(clave, { en: ahora, datos });
    // La más vieja sale primero (un Map conserva el orden de inserción).
    while (this.filas.size > this.maximo) {
      const primera = this.filas.keys().next().value;
      if (primera === undefined) break;
      this.filas.delete(primera);
    }
  }
}

/**
 * Lo que llega del servidor → `DetallesPesados`, sin confiar en la forma. Lo que no cuadra, fuera.
 * `null` si no es ni un objeto.
 */
export function detallesDesdeRespuesta(crudo: unknown): DetallesPesados | null {
  if (!crudo || typeof crudo !== "object") return null;
  const r = crudo as Record<string, any>;
  const p = r.paciente && typeof r.paciente === "object" ? r.paciente : {};
  const edad = typeof p.edad === "number" && Number.isFinite(p.edad) ? p.edad : null;
  return {
    paciente: {
      edad,
      primeraVez: p.primeraVez === true,
      telefono: typeof p.telefono === "string" && p.telefono.trim() ? p.telefono.trim() : null,
    },
    alergias: Array.isArray(r.alergias) ? r.alergias.filter((a: unknown) => typeof a === "string" && a.trim()).map((a: string) => a.trim()) : [],
    confirmadaPorWhatsapp: r.confirmadaPorWhatsapp === true,
    enEstaCita: Array.isArray(r.enEstaCita)
      ? r.enEstaCita
          .filter((f: any) => f && typeof f.id === "string" && typeof f.nombre === "string")
          .map((f: any) => ({ id: f.id, nombre: f.nombre, importe: Number(f.importe) || 0, estado: String(f.estado ?? "") }))
      : [],
    debeHoy: Math.max(0, Number(r.debeHoy) || 0),
  };
}

/**
 * ¿La contestación del paciente al recordatorio fue la que confirmó la cita? La confirmación por
 * WhatsApp escribe `confirmedAt` en el mismo instante en que se guarda `repliedAt` (webhook): se acepta
 * una ventana de dos minutos para no depender del reloj de la base contra el del servidor.
 */
export function confirmoPorWhatsapp(
  confirmedAt: Date | string | null | undefined,
  respuestas: ReadonlyArray<{ repliedAt: Date | string | null }>,
): boolean {
  if (!confirmedAt) return false;
  const c = new Date(confirmedAt).getTime();
  if (!Number.isFinite(c)) return false;
  return respuestas.some((r) => {
    if (!r.repliedAt) return false;
    const t = new Date(r.repliedAt).getTime();
    return Number.isFinite(t) && Math.abs(t - c) <= 2 * 60_000;
  });
}

/**
 * Dónde se pinta la tarjeta: a la derecha de la cita si cabe; si no, a la izquierda. Si no cabe a ningún lado
 * (en Día con un solo doctor la cita ocupa casi todo el ancho) se ancla al PUNTERO: al lado del cursor y bajo
 * él, sin tapar justo lo que se está mirando. Nunca fuera de la ventana.
 */
export function posicionDeLaTarjeta(
  cita: { left: number; top: number; right: number; bottom: number },
  ventana: { ancho: number; alto: number },
  tarjeta: { ancho: number; alto: number },
  puntero: { x: number; y: number } | null = null,
  margen = 8,
): { left: number; top: number; lado: "derecha" | "izquierda" | "puntero" } {
  const cabe = (r: { left: number; right: number }) => ({
    derecha: r.right + margen + tarjeta.ancho <= ventana.ancho - margen,
    izquierda: r.left - margen - tarjeta.ancho >= margen,
  });
  const ajustar = (left: number, top: number) => ({
    left: Math.min(Math.max(margen, left), Math.max(margen, ventana.ancho - margen - tarjeta.ancho)),
    top: Math.min(Math.max(margen, top), Math.max(margen, ventana.alto - margen - tarjeta.alto)),
  });
  const junto = cabe(cita);
  if (junto.derecha || junto.izquierda || !puntero) {
    const lado = junto.derecha || !junto.izquierda ? "derecha" : "izquierda";
    const left = lado === "derecha" ? cita.right + margen : cita.left - margen - tarjeta.ancho;
    return { ...ajustar(left, cita.top), lado };
  }
  const CURSOR = 16;
  const enX = cabe({ left: puntero.x - CURSOR, right: puntero.x + CURSOR });
  const left = enX.derecha || !enX.izquierda ? puntero.x + CURSOR : puntero.x - CURSOR - tarjeta.ancho;
  const abajo = puntero.y + CURSOR + tarjeta.alto <= ventana.alto - margen;
  const top = abajo ? puntero.y + CURSOR : puntero.y - CURSOR - tarjeta.alto;
  return { ...ajustar(left, top), lado: "puntero" };
}

/**
 * Lo que la tarjeta dice del estado. v2 (revisión t11, m5): el chip es el MISMO de la cita (`cita.chip`:
 * «Agendada», «Confirmada», «Registrado · 12 min», «En consulta»…, con sus colores de `pinta`), para no
 * enseñar dos nombres distintos del mismo estado uno al lado del otro. Detrás va solo lo que la cita dice en
 * su segunda línea y el chip no: «sin confirmar», «por WhatsApp» y los minutos en el sillón o en consulta.
 */
export interface EstadoAlPasar {
  chip: string;
  /** Llave de `EXTRA_DEL_CHIP`, o nada. */
  extra: "porWhatsapp" | "sinConfirmar" | null;
  /** Minutos que el chip no trae (en el sillón, en consulta); `null` = no se dicen. */
  minutos: number | null;
}

/**
 * Lo que va detrás del chip, en el MISMO idioma que el chip (v3, n3): el chip de la cita (`pinta.chipTexto`)
 * todavía no pasa por los diccionarios y sale en español también en inglés; «Agendada · not confirmed»
 * mezclaba idiomas. Cuando se traduzcan los chips de la agenda, esto pasa a `agenda.alPasar.*` con ellos.
 */
export const EXTRA_DEL_CHIP = {
  porWhatsapp: "por WhatsApp",
  sinConfirmar: "sin confirmar",
} as const;

/**
 * `cita.estado` ya viene normalizado (`PENDING` → `SCHEDULED`) por `aCitaVista`. «Por WhatsApp» solo cuando
 * lo pesado ya llegó y lo confirma; mientras, el chip a secas.
 */
export function estadoAlPasar(
  cita: { estado: string; chip: string; minutosEsperando: number | null; minutosEnConsulta: number | null },
  confirmadaPorWhatsapp: boolean | null,
): EstadoAlPasar {
  const min = (n: number | null) => (n !== null && n > 0 ? n : null);
  switch (cita.estado) {
    case "SCHEDULED":
      return { chip: cita.chip, extra: "sinConfirmar", minutos: null };
    case "CONFIRMED":
      return { chip: cita.chip, extra: confirmadaPorWhatsapp ? "porWhatsapp" : null, minutos: null };
    case "IN_CHAIR":
      return { chip: cita.chip, extra: null, minutos: min(cita.minutosEsperando) };
    case "IN_PROGRESS":
      return { chip: cita.chip, extra: null, minutos: min(cita.minutosEnConsulta) };
    default:
      // CHECKED_IN ya trae sus minutos en el chip («Registrado · 12 min»).
      return { chip: cita.chip, extra: null, minutos: null };
  }
}

/** Un aviso de la tarjeta: llave de `agenda.alPasar.avisos.*` (o texto ya hecho) y su tono. */
export interface AvisoAlPasar {
  clave: "apartada" | "anticipoPagado" | "anticipoPedido" | "mensualidadVencida" | "sobreagendada" | "porValidar";
  /** Texto ya armado por `aCitaVista` («Apartada · paga antes de mañana a las 19:00»). */
  texto?: string;
  monto?: number;
  tono: "verde" | "ambar" | "rojo" | "morado";
}

/** Los avisos que ya sabe la pantalla (todo LIGERO: sale de `CitaVista`, sin ir al servidor). */
export function avisosAlPasar(cita: {
  estado: string;
  notaAnticipo: string | null;
  avisoMensualidadVencida: boolean;
  sobreagendada: boolean;
  esperaValidacion: boolean;
  dto: { anticipoPedido?: number; depositoPagado?: boolean };
}): AvisoAlPasar[] {
  const salida: AvisoAlPasar[] = [];
  // `notaAnticipo` solo existe apartada (SCHEDULED con plazo vivo) o pagada (CONFIRMED): ver vista-modelo.
  if (cita.notaAnticipo) {
    salida.push(
      cita.estado === "CONFIRMED"
        ? { clave: "anticipoPagado", tono: "verde" }
        : { clave: "apartada", texto: cita.notaAnticipo, tono: "ambar" },
    );
  } else if (cita.dto.depositoPagado === true) {
    salida.push({ clave: "anticipoPagado", tono: "verde" });
  } else if ((cita.dto.anticipoPedido ?? 0) > 0) {
    salida.push({ clave: "anticipoPedido", monto: cita.dto.anticipoPedido, tono: "ambar" });
  }
  if (cita.avisoMensualidadVencida) salida.push({ clave: "mensualidadVencida", tono: "rojo" });
  if (cita.sobreagendada) salida.push({ clave: "sobreagendada", tono: "morado" });
  if (cita.esperaValidacion) salida.push({ clave: "porValidar", tono: "ambar" });
  return salida;
}
