// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PLD — LA ARITMÉTICA. Módulo PURO y client-safe.
//
// Aquí está el corazón del módulo: comparar el monto de una operación
// contra el umbral VIGENTE y decir qué obliga. Es puro a propósito, igual
// que las calculadoras: el navegador puede recalcular en vivo mientras el
// usuario captura, y el servidor vuelve a correr LA MISMA función como
// autoridad. Dos implementaciones que se desincronizan es el bug clásico.
//
// ── 🔴 NINGÚN NÚMERO DE LA LEY ESTÁ ESCRITO AQUÍ ──────────────────────
// Ni la UMA, ni 8 025, ni 16 000, ni el día 17, ni las 24 horas, ni los 10
// años. TODOS llegan por parámetro desde realty_calc_params. Si el
// parámetro del año no está capturado, `resolvePldParams` devuelve
// `ok: false` con la lista de lo que falta y la pantalla lo dice — nunca
// se rellena con un valor "razonable".
//
// ── 🔴 LOS UMBRALES SE MIDEN EN UMA, NO EN PESOS ──────────────────────
// La ley no dice "941 412.75 pesos": dice "8 025 veces la UMA". Por eso lo
// que se guarda es el NÚMERO DE VECES y el peso se DERIVA. Cuando el INEGI
// publique la UMA de 2027, los tres umbrales se mueven solos con capturar
// una fila. Guardar el peso ya multiplicado sería tener que corregir tres
// números cada enero y equivocarse en uno.
//
// La multiplicación es EXACTA porque los dos factores son enteros: la UMA
// en centavos (117.31 → 11 731) por un número de veces (8 025) da
// 94 141 275 centavos = $941 412.75, sin un solo redondeo por en medio.
//
// ── 🔴 "IGUAL O SUPERIOR", NO "MAYOR QUE" ─────────────────────────────
// La comparación es `>=`. La LFPIORPI dice "igual o superior al equivalente
// a…", así que una operación que caiga EXACTAMENTE en el umbral SÍ obliga.
// Un `>` dejaría fuera justo el caso que alguien construiría a propósito.
// La prueba de aritmética comprueba el centavo exacto del borde.
// ═══════════════════════════════════════════════════════════════════════
// Rutas RELATIVAS y no el alias "@/…": este módulo lo carga `tsx --test`
// sin pasar por el resolvedor de Next, y ahí `pickVigente` y `toCents` son
// importaciones de VALOR que sí hay que resolver en tiempo de ejecución.
import {
  pickVigente,
  type CalcFaltante,
  type ParamsResolved,
  type RawCalcParamRow,
} from "../calc/catalog";
import { toCents, type Cents } from "../calc/money";
import type {
  EstadoExpediente,
  NivelUmbral,
  PldDocKind,
  PldPepKind,
  PldPersonKind,
  PldRisk,
} from "./contrato";

/** El `stateCode` de la fila federal. Los umbrales PLD son federales. */
export const PLD_STATE_CODE = "MX";

/** La llave del bloque PLD dentro del `meta` de la fila UMA. */
export const PLD_META_KEY = "pld";

// ── Parámetros ─────────────────────────────────────────────────────────

/**
 * Todo lo que la ley aporta, ya resuelto. Los tres umbrales viajan en
 * VECES LA UMA; los pesos se derivan con umbralesEnPesos().
 */
export interface PldParams {
  /** Año de la fila UMA que se usó. */
  year: number;
  /** Vigencia de esa fila (ISO). */
  effectiveFrom: string;
  /** UMA diaria en CENTAVOS enteros. */
  umaDiariaCents: Cents;
  /** Umbral de identificación, en veces la UMA. */
  identificacionUma: number;
  /** Umbral de aviso, en veces la UMA. */
  avisoUma: number;
  /** Tope de efectivo permitido, en veces la UMA. */
  efectivoUma: number;
  /** Día del mes SIGUIENTE en que vence el aviso del periodo. */
  diaLimiteAviso: number;
  /** Horas para el aviso urgente (indicios o coincidencia con listas). */
  horasAvisoUrgente: number;
  /** Años que hay que conservar la documentación. */
  aniosConservacion: number;
  /** Meses de vigencia de un comprobante de domicilio. */
  mesesVigenciaComprobante: number;
  /** true = nadie confirmó estos números contra el documento oficial. */
  porVerificar: boolean;
  fuente: string;
  nota: string;
}

/** Los tres umbrales ya convertidos a centavos. */
export interface UmbralesEnPesos {
  identificacionCents: Cents;
  avisoCents: Cents;
  efectivoCents: Cents;
}

function faltantePld(etiqueta: string): CalcFaltante {
  return {
    kind: "UMA",
    stateCode: PLD_STATE_CODE,
    etiqueta,
    comoResolver:
      "Captúralo en el panel de DaleControl, en Inmobiliarias → Parámetros de las calculadoras, " +
      'en la fila UMA del año en curso (bloque "pld" del detalle).',
  };
}

/**
 * Un parámetro fuera de rango es peor que uno que falta: se cuela hasta la
 * pantalla y nadie lo nota. El `meta` se edita como JSON crudo en /admin,
 * así que la cordura se comprueba AQUÍ, al leer. Mismo criterio que
 * `enRango` de las calculadoras.
 */
function enRango(v: unknown, min: number, max: number): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

function texto(v: unknown, porDefecto: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : porDefecto;
}

/**
 * Resuelve los parámetros PLD vigentes a una fecha.
 *
 * Vive en la fila `kind: "UMA"`, `stateCode: "MX"` — la misma que ya
 * siembran las calculadoras — dentro de un sub-objeto `pld` de su `meta`.
 * Dos razones para colgarlo de ahí y no inventar nada:
 *
 *   1. Los umbrales SON múltiplos de la UMA. Cuando cambia la UMA cambian
 *      los tres a la vez, y una sola fila con una sola vigencia mantiene
 *      esa relación imposible de romper por accidente.
 *   2. `RealtyCalcParamKind` es contrato cerrado de la Ola 0 y no se toca.
 *
 * 🔴 El sub-objeto `pld` NO está en la lista blanca de `sanitizarMeta`, y
 * eso es DELIBERADO: la ruta pública `/api/realty/calc/params` sirve estas
 * filas a internet sin sesión. Los umbrales son públicos, pero no hay razón
 * para publicarlos ahí, y no agregarlos a la lista blanca garantiza que no
 * se filtren. Por eso este módulo lee la tabla por su cuenta
 * (src/lib/realty/pld/parametros.ts) en vez de usar getCalcParamRows().
 */
export function resolvePldParams(
  rows: RawCalcParamRow[],
  at: Date = new Date(),
): ParamsResolved<PldParams> {
  const faltantes: CalcFaltante[] = [];
  const avisos: string[] = [];

  const fila = pickVigente(rows, "UMA", PLD_STATE_CODE, at);
  if (!fila) {
    faltantes.push(faltantePld("Valor de la UMA diaria"));
    return { ok: false, faltantes, avisos };
  }

  const umaDiariaCents = toCents(fila.value);
  if (umaDiariaCents <= 0) {
    faltantes.push(faltantePld("Valor de la UMA diaria (la fila capturada es cero o negativa)"));
    return { ok: false, faltantes, avisos };
  }

  const bloque = fila.meta && typeof fila.meta === "object" ? fila.meta[PLD_META_KEY] : null;
  if (!bloque || typeof bloque !== "object" || Array.isArray(bloque)) {
    faltantes.push(
      faltantePld(
        "Umbrales antilavado (identificación, aviso, tope de efectivo, día de corte, plazo urgente y años de conservación)",
      ),
    );
    return { ok: false, faltantes, avisos };
  }
  const m = bloque as Record<string, unknown>;

  // Cada uno se valida por separado para poder decir CUÁL falta, no un
  // "faltan parámetros" que obligue a adivinar.
  if (!enRango(m.identificacionUma, 1, 1_000_000)) {
    faltantes.push(faltantePld("Umbral de identificación, en veces la UMA"));
  }
  if (!enRango(m.avisoUma, 1, 1_000_000)) {
    faltantes.push(faltantePld("Umbral de aviso, en veces la UMA"));
  }
  if (!enRango(m.efectivoUma, 1, 1_000_000)) {
    faltantes.push(faltantePld("Tope de efectivo permitido, en veces la UMA"));
  }
  // Hasta 28 y no 31: un corte el día 30 no existiría en febrero.
  if (!enRango(m.diaLimiteAviso, 1, 28)) {
    faltantes.push(faltantePld("Día del mes siguiente en que vence el aviso"));
  }
  if (!enRango(m.horasAvisoUrgente, 1, 168)) {
    faltantes.push(faltantePld("Plazo en horas del aviso urgente"));
  }
  if (!enRango(m.aniosConservacion, 1, 50)) {
    faltantes.push(faltantePld("Años de conservación de la documentación"));
  }
  if (!enRango(m.mesesVigenciaComprobante, 1, 60)) {
    faltantes.push(faltantePld("Meses de vigencia de un comprobante de domicilio"));
  }
  if (faltantes.length > 0) return { ok: false, faltantes, avisos };

  const anioActual = at.getUTCFullYear();
  if (fila.year < anioActual) {
    avisos.push(
      `La UMA vigente es la de ${fila.year}. Si el INEGI ya publicó la de ${anioActual}, ` +
        "captúrala en Parámetros: los tres umbrales se recalculan solos.",
    );
  }
  const porVerificar = m.porVerificar === true;
  if (porVerificar) {
    avisos.push(
      "Estos umbrales están marcados COMO NO VERIFICADOS: nadie los ha confrontado todavía " +
        "contra el texto vigente de la ley. Confírmalos antes de apoyarte en ellos.",
    );
  }

  const params: PldParams = {
    year: fila.year,
    effectiveFrom: fila.effectiveFrom,
    umaDiariaCents,
    identificacionUma: m.identificacionUma as number,
    avisoUma: m.avisoUma as number,
    efectivoUma: m.efectivoUma as number,
    diaLimiteAviso: m.diaLimiteAviso as number,
    horasAvisoUrgente: m.horasAvisoUrgente as number,
    aniosConservacion: m.aniosConservacion as number,
    mesesVigenciaComprobante: m.mesesVigenciaComprobante as number,
    porVerificar,
    fuente: texto(m.fuente, "Sin fuente capturada."),
    nota: texto(m.nota, ""),
  };
  return { ok: true, params, faltantes, avisos };
}

/**
 * Los tres umbrales en centavos. Multiplicación de enteros: exacta.
 *
 *   11 731 centavos (UMA de 2026) × 8 025 = 94 141 275 = $941 412.75
 *   11 731 centavos               × 16 000 = 187 696 000 = $1 876 960.00
 */
export function umbralesEnPesos(p: PldParams): UmbralesEnPesos {
  return {
    identificacionCents: p.umaDiariaCents * p.identificacionUma,
    avisoCents: p.umaDiariaCents * p.avisoUma,
    efectivoCents: p.umaDiariaCents * p.efectivoUma,
  };
}

// ── Evaluación de una operación ────────────────────────────────────────

export interface OperacionEvaluable {
  /** Monto total de la operación, en centavos. */
  montoCents: Cents;
  /** Cuánto de ese monto se liquidó en EFECTIVO, en centavos. */
  efectivoCents: Cents;
}

export interface EvaluacionOperacion {
  nivel: NivelUmbral;
  /** Hay que integrar el expediente de identificación del cliente. */
  requiereExpediente: boolean;
  /** Hay que presentar aviso a más tardar el día de corte del mes siguiente. */
  requiereAviso: boolean;
  /** 🔴 El efectivo capturado rebasa el tope: la ley lo PROHÍBE. */
  efectivoProhibido: boolean;
  montoCents: Cents;
  efectivoCents: Cents;
  umbrales: UmbralesEnPesos;
  /** Lo que le falta para tocar el umbral de identificación (0 si ya lo tocó). */
  faltaIdentificacionCents: Cents;
  /** Lo que le falta para tocar el umbral de aviso (0 si ya lo tocó). */
  faltaAvisoCents: Cents;
  /** Cuánto se pasó del tope de efectivo (0 si no se pasó). */
  excedenteEfectivoCents: Cents;
}

/**
 * La comparación. Es TODO lo que hace: compara. No dictamina, no presenta
 * nada y no decide por nadie.
 *
 * 🔴 `>=` y no `>`: la ley dice "igual o superior". Una operación que caiga
 * en el centavo exacto del umbral SÍ obliga.
 */
export function evaluarOperacion(
  op: OperacionEvaluable,
  p: PldParams,
): EvaluacionOperacion {
  const umbrales = umbralesEnPesos(p);
  const monto = Math.max(0, Math.round(op.montoCents || 0));
  const efectivo = Math.max(0, Math.round(op.efectivoCents || 0));

  const requiereAviso = monto >= umbrales.avisoCents;
  const requiereExpediente = monto >= umbrales.identificacionCents;
  const efectivoProhibido = efectivo >= umbrales.efectivoCents;

  const nivel: NivelUmbral = requiereAviso
    ? "AVISO"
    : requiereExpediente
      ? "IDENTIFICACION"
      : "NINGUNO";

  return {
    nivel,
    // Rebasar el umbral de aviso implica el de identificación: quien tiene
    // que avisar tiene que haber identificado antes. Se deja explícito y no
    // se deduce en la pantalla.
    requiereExpediente: requiereExpediente || requiereAviso,
    requiereAviso,
    efectivoProhibido,
    montoCents: monto,
    efectivoCents: efectivo,
    umbrales,
    faltaIdentificacionCents: Math.max(0, umbrales.identificacionCents - monto),
    faltaAvisoCents: Math.max(0, umbrales.avisoCents - monto),
    excedenteEfectivoCents: Math.max(0, efectivo - umbrales.efectivoCents),
  };
}

// ── Calendario del día de corte ────────────────────────────────────────

const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/**
 * La fecha CALENDARIO ("AAAA-MM-DD") de un instante en una zona horaria.
 *
 * Existe porque el periodo de una operación es una fecha de calendario
 * mexicana, no un instante UTC: una venta cerrada el 31 de marzo a las
 * 19:00 en México es del 1 de abril en UTC, y caería en el aviso del mes
 * equivocado. `en-CA` da justo "AAAA-MM-DD" sin tener que armar la cadena.
 */
export function fechaLocalISO(d: Date, timeZone = "America/Mexico_City"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    // Zona horaria inválida en la cuenta: mejor UTC que reventar.
    return d.toISOString().slice(0, 10);
  }
}

/** El periodo "AAAA-MM" al que pertenece una fecha, en la zona de la cuenta. */
export function periodoDeFecha(d: Date, timeZone?: string): string {
  return fechaLocalISO(d, timeZone).slice(0, 7);
}

/** "2026-03" → "marzo de 2026". */
export function etiquetaPeriodo(periodMonth: string): string {
  const [y, m] = periodMonth.split("-");
  const idx = Number(m) - 1;
  if (!MESES_ES[idx]) return periodMonth;
  return `${MESES_ES[idx]} de ${y}`;
}

/**
 * 🔴 LA CONVENCIÓN DEL MEDIODÍA — por qué ninguna FECHA DE CALENDARIO de
 * este módulo se guarda a medianoche.
 *
 * Una fecha de calendario (el 17 del corte, la fecha de nacimiento, la
 * vigencia de un comprobante) no es un instante: es un día. Pero la columna
 * es un DateTime, así que hay que elegir una hora, y medianoche UTC es la
 * peor posible: en México (UTC-6) esa medianoche cae a las 18:00 del día
 * ANTERIOR, así que el corte del 17 se pinta como 16 y una fecha de
 * nacimiento retrocede un día en cada ida y vuelta por el formulario.
 *
 * Al MEDIODÍA UTC no hay zona mexicana —de UTC-6 a UTC-8— que cambie de
 * día: son las 04:00-06:00 de la mañana del día correcto. Es la misma
 * convención que ya usa `parseDate` de src/app/api/realty/deals/service.ts
 * para el cierre de una operación, y por eso el periodo de un cierre no se
 * equivoca de mes.
 *
 * Los INSTANTES de verdad (cuándo se revisó el expediente, cuándo se marcó
 * el aviso, cuándo vence la alerta de 24 horas) NO pasan por aquí: esos sí
 * son un momento y se guardan tal cual.
 */
export const HORA_DE_CALENDARIO = "T12:00:00.000Z";

/**
 * Lo que manda un `<input type="date">` ("AAAA-MM-DD") → un Date al
 * mediodía UTC. Devuelve null si no se entiende.
 *
 * El `Z` explícito importa: `new Date("2026-04-17T12:00:00")` SIN zona se
 * interpreta en la del servidor, y entonces el resultado depende de cómo
 * esté configurada la máquina que corra el despliegue.
 */
export function fechaDeCalendario(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}${HORA_DE_CALENDARIO}` : s);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * Cuándo vence el aviso de un periodo: el día de corte del mes SIGUIENTE.
 *
 * Al MEDIODÍA UTC del día de corte — ver HORA_DE_CALENDARIO: a medianoche,
 * el 17 se pintaba como 16 en toda la República. `Date.UTC` resuelve solo
 * el salto de año: el periodo "2026-12" vence en enero de 2027.
 *
 * ⚠️ NO se recorre al siguiente día hábil cuando el corte cae en sábado,
 * domingo o día festivo. Es a propósito: adelantar el vencimiento nunca
 * perjudica a nadie, y meter un calendario de días inhábiles mexicanos sin
 * que un abogado lo valide sería inventar una regla.
 */
export function vencimientoDelPeriodo(periodMonth: string, diaLimite: number): Date {
  const [y, m] = periodMonth.split("-").map(Number);
  // m es 1–12; como índice 0-based, el mes SIGUIENTE es exactamente `m`.
  return new Date(Date.UTC(y, m, diaLimite, 12, 0, 0));
}

/** Días de calendario entre dos instantes (positivo = `hasta` es futuro). */
export function diasEntre(desde: Date, hasta: Date): number {
  const MS = 86_400_000;
  const a = Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate());
  const b = Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), hasta.getUTCDate());
  return Math.round((b - a) / MS);
}

/**
 * Los `n` periodos que terminan en el mes en curso, del más reciente al más
 * viejo. Es lo que pinta el calendario del corte.
 */
export function periodosRecientes(hoy: Date, n: number, timeZone?: string): string[] {
  const actual = periodoDeFecha(hoy, timeZone);
  const [y, m] = actual.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Suma años a una fecha — la usa la bóveda para calcular retainUntil. */
export function sumarAnios(d: Date, anios: number): Date {
  const out = new Date(d.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + anios);
  return out;
}

/** Suma meses — la usa la vigencia del comprobante de domicilio. */
export function sumarMeses(d: Date, meses: number): Date {
  const out = new Date(d.getTime());
  out.setUTCMonth(out.getUTCMonth() + meses);
  return out;
}

/** Suma horas — la usa el plazo del aviso urgente. */
export function sumarHoras(d: Date, horas: number): Date {
  return new Date(d.getTime() + horas * 3_600_000);
}

// ── Expediente: qué papeles pide y en qué estado está ──────────────────

/**
 * Qué documentos exige el expediente según el tipo de persona.
 *
 * Una persona moral tiene que declarar además a su BENEFICIARIO
 * CONTROLADOR — la persona física que de verdad manda detrás de la
 * sociedad. Es el papel que más se olvida y el que más se revisa.
 */
export function documentosRequeridos(personKind: PldPersonKind): PldDocKind[] {
  if (personKind === "FISICA") {
    return ["IDENTIFICACION", "COMPROBANTE_DOMICILIO", "CONSTANCIA_FISCAL"];
  }
  return [
    "ACTA_CONSTITUTIVA",
    "PODER",
    "IDENTIFICACION",
    "COMPROBANTE_DOMICILIO",
    "CONSTANCIA_FISCAL",
    "BENEFICIARIO_CONTROLADOR",
  ];
}

/** Los datos (no papeles) sin los que el expediente no está integrado. */
export function datosRequeridos(personKind: PldPersonKind): string[] {
  const base = ["rfc", "occupation", "address"];
  return personKind === "FISICA" ? [...base, "curp"] : base;
}

export interface DocumentoParaEstado {
  kind: PldDocKind;
  expiresAt: Date | null;
  archivedAt: Date | null;
}

export interface ExpedienteParaEstado {
  personKind: PldPersonKind;
  rfc: string | null;
  curp: string | null;
  occupation: string | null;
  address: string | null;
  pep: PldPepKind;
  pepAskedAt: Date | null;
  beneficialOwnersCount: number;
}

export interface EstadoCalculado {
  estado: EstadoExpediente;
  /** Papeles que no están. */
  faltantes: PldDocKind[];
  /** Papeles que están pero ya vencieron. */
  vencidos: PldDocKind[];
  /** Campos del formulario sin capturar. */
  datosFaltantes: string[];
}

/**
 * El estado del expediente, calculado — nunca leído de una columna.
 *
 * Precedencia: INCOMPLETO gana a VENCIDO. Un expediente al que le falta un
 * papel nunca estuvo completo; "vencido" se reserva para el que sí lo
 * estuvo y se le caducó algo, que es UNA acción para arreglarlo.
 *
 * 🔴 El cuestionario PEP cuenta como dato requerido. `pep = "NO"` por
 * omisión y "NO" declarado por la persona no son lo mismo: sin `pepAskedAt`
 * nadie preguntó, y el expediente NO está integrado.
 */
export function estadoDeExpediente(
  file: ExpedienteParaEstado,
  documentos: DocumentoParaEstado[],
  hoy: Date = new Date(),
): EstadoCalculado {
  const requeridos = documentosRequeridos(file.personKind);
  const vivos = documentos.filter((d) => !d.archivedAt);

  const faltantes: PldDocKind[] = [];
  const vencidos: PldDocKind[] = [];

  for (const kind of requeridos) {
    const delTipo = vivos.filter((d) => d.kind === kind);
    if (delTipo.length === 0) {
      faltantes.push(kind);
      continue;
    }
    // Basta con que UNO siga vigente. Un comprobante viejo no descalifica
    // al nuevo que se subió encima.
    const alguienVigente = delTipo.some((d) => !d.expiresAt || d.expiresAt.getTime() >= hoy.getTime());
    if (!alguienVigente) vencidos.push(kind);
  }

  const datosFaltantes: string[] = [];
  for (const campo of datosRequeridos(file.personKind)) {
    const v = (file as unknown as Record<string, unknown>)[campo];
    if (typeof v !== "string" || !v.trim()) datosFaltantes.push(campo);
  }
  if (!file.pepAskedAt) datosFaltantes.push("pepAskedAt");
  if (file.personKind !== "FISICA" && file.beneficialOwnersCount < 1) {
    datosFaltantes.push("beneficialOwners");
  }

  const estado: EstadoExpediente =
    faltantes.length > 0 || datosFaltantes.length > 0
      ? "INCOMPLETO"
      : vencidos.length > 0
        ? "VENCIDO"
        : "COMPLETO";

  return { estado, faltantes, vencidos, datosFaltantes };
}

export interface EntradaRiesgo {
  pep: PldPepKind;
  estado: EstadoExpediente;
  /** ¿Alguna de sus operaciones rebasó el umbral de identificación? */
  rebasaUmbral: boolean;
  /** ¿Alguna de sus operaciones tiene efectivo por encima del tope? */
  efectivoProhibido: boolean;
}

/**
 * El semáforo. Devuelve el grado Y por qué, porque un "riesgo alto" sin
 * motivo es una etiqueta de colores que nadie puede accionar.
 */
export function riesgoDeExpediente(e: EntradaRiesgo): { risk: PldRisk; motivos: string[] } {
  const motivos: string[] = [];
  let risk: PldRisk = "BAJO";

  if (e.pep !== "NO") {
    risk = "ALTO";
    motivos.push(
      e.pep === "PEP"
        ? "Es persona políticamente expuesta."
        : e.pep === "FAMILIAR"
          ? "Es familiar de una persona políticamente expuesta."
          : "Es asociado cercano de una persona políticamente expuesta.",
    );
  }
  if (e.efectivoProhibido) {
    risk = "ALTO";
    motivos.push("Tiene una operación con efectivo por encima del tope que permite la ley.");
  }
  if (e.rebasaUmbral && e.estado !== "COMPLETO") {
    if (risk !== "ALTO") risk = "MEDIO";
    motivos.push("Tiene una operación que rebasa el umbral y su expediente no está integrado.");
  }
  if (motivos.length === 0) motivos.push("Sin señales de alerta.");
  return { risk, motivos };
}
