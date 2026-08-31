/**
 * DaleControl INSTITUCIONAL — EL CUPO DE IA DEL INSTITUTO.
 *
 * SERVIDOR (importa prisma y lee process.env). Lo puro —el estado de cada
 * función, la aritmética del cupo, los textos— vive en ia-core.ts, y las
 * llamadas a los proveedores en ia.ts. Este archivo es el que contesta
 * "¿puedo gastar?" y el que escribe "gasté esto".
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUIÉN EDITA EL CUPO, Y POR QUÉ ESA LÍNEA ESTÁ AQUÍ Y NO EN LA PANTALLA
 *
 * El cupo tiene DOS mitades y NO se editan igual:
 *
 *   · LO QUE INCLUYE EL CONTRATO (`monthlyUsdCents`) NO SE EDITA DESDE EL
 *     PANEL, con ningún permiso. Lo escribe DaleControl al firmar o
 *     renovar, igual que `contractStartsAt` y `contractEndsAt` — que el
 *     panel también solo PINTA. La razón no es de jerarquía: la cuenta de
 *     API que se consume es la de DaleControl, así que un formulario que
 *     dejara subir ese número convertiría "lo que incluye tu contrato" en
 *     "lo que alguien tecleó", y quien paga la factura no estaría en la
 *     conversación. `updateEduAiQuota` RECHAZA el campo con un mensaje que
 *     lo dice, en vez de ignorarlo en silencio: ignorarlo dejaría a la
 *     dirección creyendo que se guardó.
 *
 *   · LO QUE DECIDE LA ESCUELA (`isEnabled`, `allowOverage`,
 *     `hardCapUsdCents`, `contactNote`) SÍ se edita, con `ia.manage`. Es
 *     lo suyo: si hoy quiere la IA apagada, si autoriza pasar del cupo
 *     incluido y hasta dónde, y a quién hay que pedirle más. Ninguna de
 *     las cuatro puede AMPLIAR lo incluido — solo autorizar excedente por
 *     encima, con un techo, a sabiendas y con su nombre en la fila.
 *
 * 🔴 Y LA FILA NO SE CREA DESDE EL PANEL. Un instituto sin fila de cupo
 * tiene la IA apagada y `updateEduAiQuota` contesta que no, porque crearla
 * obligaría a elegir un `monthlyUsdCents` — que es justo lo que el panel
 * no decide. Se da de alta con el contrato (sección 7 de sql/edu-ola-8.sql).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL ORDEN DEL GASTO, Y LO QUE ESE ORDEN NO PUEDE GARANTIZAR
 *
 *   1. se comprueba el cupo ANTES de llamar al proveedor (aquí es donde se
 *      dice que no, con el mensaje que explica cuánto se lleva y a quién
 *      pedirle más);
 *   2. se llama al proveedor;
 *   3. se escribe el renglón con el costo REAL.
 *
 * Consecuencia que hay que decir en voz alta: la ÚLTIMA llamada de un mes
 * puede rebasar el techo por lo que cueste ESA llamada, porque nadie sabe
 * cuánto cuesta hasta que termina. El techo frena las llamadas que
 * EMPIEZAN; no aborta una en vuelo. El rebase está acotado por el costo de
 * una sola operación (céntimos), y la alternativa —cobrar por adelantado
 * un estimado y ajustar después— habría metido dos escrituras por llamada
 * y un estado intermedio que se queda colgado cuando el proveedor falla.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import {
  eduFormatDayShort,
  eduFormatTime,
  eduOptionalText,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import {
  EDU_IA_MAX_TOPE_USD_CENTS,
  EDU_IA_MAX_USOS,
  EDU_IA_MODELOS,
  eduIaCentsToMicros,
  eduIaCostoLabel,
  eduIaEstado,
  eduIaParte,
  eduIaPeriodKey,
  eduIaPeriodoLabel,
  eduIaUnidadesLabel,
  eduIaUsdLabel,
  eduIaValidarCupo,
  parseEduIaUsdCents,
  type EduIaCupo,
  type EduIaEstado,
  type EduIaFuncionRow,
  type EduIaPanel,
  type EduIaPersonaRow,
  type EduIaPrecio,
  type EduIaSituacion,
  type EduIaUsoRow,
} from "@/lib/edu/ia-core";
import {
  EDU_AI_FEATURES,
  EDU_AI_FEATURE_LABELS,
  type EduAiFeature,
  type EduAiUnit,
  type EduRole,
} from "@/lib/edu/types";
import {
  eduAiUsageScopeWhere,
  eduVisibility,
  EDU_VISIBILITY_NONE_DETAIL,
  type EduClinicaContext,
} from "@/lib/edu/visibility";

/** Cliente de Prisma o de una transacción: el renglón se escribe con los dos. */
type EduDb = Prisma.TransactionClient | typeof prisma;

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL ENTORNO
// ═══════════════════════════════════════════════════════════════════════

/**
 * El freno de emergencia GLOBAL de DaleControl.
 *
 * 🔴 OJO A LA INVERSIÓN, PORQUE ES LO CONTRARIO DE LA OLA 3B. Ahí
 * `EDU_IA_ENABLED` era la puerta y nacía CERRADA: había que ponerla para
 * que la IA existiera. Ahora nace ABIERTA y solo sirve para cerrarla —
 * ponerla en "0", "false", "off" o "no" apaga la IA de TODAS las escuelas
 * de golpe, para una incidencia (el proveedor caído, una factura rara, un
 * abuso).
 *
 * Por qué el default cambió de lado: lo que decide si un instituto tiene
 * IA ya no es una variable de entorno sino su CUPO, que es un dato por
 * escuela. Una bandera global apagada por defecto solo conseguiría que la
 * escuela que sí contrató IA no la tuviera hasta que alguien se acordara
 * de exportar una variable.
 *
 * ⚠️ Lo AMBIGUO se interpreta como "encendida" (al revés que en la Ola 3B)
 * porque ya no es la bandera la que abre el grifo del gasto: el techo lo
 * pone el cupo, que no se puede confundir con un dedazo en un `.env`.
 */
export function eduIaGlobalOn(): boolean {
  const raw = String(process.env.EDU_IA_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LEER EL CUPO Y LO CONSUMIDO
// ═══════════════════════════════════════════════════════════════════════

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function stampLabel(d: Date, timeZone: string): string {
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(d, tz);
  return `${eduFormatDayShort(dayISO)} ${eduFormatTime(d, tz)}`;
}

const QUOTA_SELECT = {
  monthlyUsdCents: true,
  allowOverage: true,
  hardCapUsdCents: true,
  isEnabled: true,
  contactNote: true,
  updatedByName: true,
  updatedAt: true,
} satisfies Prisma.EduAiQuotaSelect;

const PRICE_SELECT = {
  feature: true,
  model: true,
  unit: true,
  inUsdMicrosPerMillion: true,
  outUsdMicrosPerMillion: true,
  source: true,
} satisfies Prisma.EduAiPriceSelect;

function toPrecio(p: Prisma.EduAiPriceGetPayload<{ select: typeof PRICE_SELECT }>): EduIaPrecio {
  return {
    feature: p.feature as EduAiFeature,
    model: p.model,
    unit: p.unit as EduAiUnit,
    inUsdMicrosPerMillion: p.inUsdMicrosPerMillion,
    outUsdMicrosPerMillion: p.outUsdMicrosPerMillion,
    source: p.source,
  };
}

/**
 * TODAS las tarifas activas, para pintarlas. Ordenadas por función para
 * que la tabla del panel se lea siempre igual.
 */
export async function listEduAiPrices(): Promise<EduIaPrecio[]> {
  const rows = await prisma.eduAiPrice.findMany({
    where: { isActive: true },
    orderBy: [{ feature: "asc" }, { updatedAt: "desc" }],
    select: PRICE_SELECT,
  });
  return rows.map(toPrecio);
}

/**
 * La tarifa que aplica a cada función: la del MODELO EXACTO que esa
 * función llama, con la unidad que le corresponde.
 *
 * 🔴 Se compara modelo Y unidad, no solo la función. Buscar solo por
 * función haría que una fila vieja —la del modelo barato que se usaba el
 * año pasado— siguiera cobrando por el modelo nuevo, y el cupo de la
 * escuela bajaría a un quinto de lo que de verdad se está gastando. Sin
 * coincidencia exacta, `eduIaEstado` devuelve "sin_precio" y la función se
 * apaga: es preferible a cobrar mal.
 */
function preciosPorFeature(precios: EduIaPrecio[]): Record<EduAiFeature, EduIaPrecio | null> {
  const out: Record<EduAiFeature, EduIaPrecio | null> = { DICTADO: null, ANALISIS: null };
  for (const f of EDU_AI_FEATURES) {
    const esperado = EDU_IA_MODELOS[f];
    out[f] =
      precios.filter((p) => p.feature === f && p.model === esperado.model && p.unit === esperado.unit)[0] ??
      null;
  }
  return out;
}

/**
 * Lo consumido por el instituto en un periodo, en millonésimas de dólar.
 *
 * 🔴 SE CUENTA, NO SE LEE DE UN CONTADOR. Es la misma decisión que el
 * avance académico de la Ola 6: un contador guardado se desincroniza el
 * día que una escritura falle a la mitad, y entonces o se le apaga la IA a
 * una escuela que sí tenía cupo, o se le regala el que ya gastó.
 */
async function sumaDelPeriodo(institutionId: string, periodKey: string): Promise<number> {
  const agg = await prisma.eduAiUsage.aggregate({
    where: { institutionId, periodKey },
    _sum: { costUsdMicros: true },
  });
  const v = agg._sum.costUsdMicros;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * El cupo del instituto con lo consumido del mes, o `null` si no tiene
 * fila — que es lo mismo que decir "su contrato todavía no incluye IA".
 */
export async function getEduIaCupo(
  ctx: EduClinicaContext,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduIaCupo | null> {
  const institutionId = requireInstitution(ctx);
  const periodo = eduIaPeriodKey(now, timeZone);

  const fila = await prisma.eduAiQuota.findUnique({
    where: { institutionId },
    select: QUOTA_SELECT,
  });
  if (!fila) return null;

  const consumidoUsdMicros = await sumaDelPeriodo(institutionId, periodo);

  return {
    periodo,
    periodoLabel: eduIaPeriodoLabel(periodo),
    incluidoUsdCents: fila.monthlyUsdCents,
    permiteExcedente: fila.allowOverage,
    topeUsdCents: fila.hardCapUsdCents,
    encendido: fila.isEnabled,
    contacto: fila.contactNote,
    consumidoUsdMicros,
    actualizadoPor: fila.updatedByName,
    actualizadoLabel: fila.updatedByName ? stampLabel(fila.updatedAt, timeZone) : null,
  };
}

/**
 * TODO lo que hace falta para decidir si una función está disponible, en
 * UNA sola pasada: el freno global, las llaves, el cupo con su consumo y
 * las tarifas.
 *
 * Se resuelve entero aunque la pantalla solo pregunte por una función,
 * porque las dos consultas que cuestan (el cupo y la suma del mes) son las
 * mismas para las dos y separarlas duplicaría el trabajo.
 */
export async function getEduIaSituacion(
  ctx: EduClinicaContext,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduIaSituacion> {
  const [cupo, precios] = await Promise.all([
    getEduIaCupo(ctx, timeZone, now),
    listEduAiPrices(),
  ]);
  return {
    global: eduIaGlobalOn(),
    openaiConfigurado: Boolean(process.env.OPENAI_API_KEY),
    anthropicConfigurado: Boolean(process.env.ANTHROPIC_API_KEY),
    cupo,
    precios: preciosPorFeature(precios),
  };
}

/** El estado de UNA función, ya resuelto contra la base y el entorno. */
export async function eduIaEstadoActual(
  ctx: EduClinicaContext,
  feature: EduAiFeature,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduIaEstado> {
  const situacion = await getEduIaSituacion(ctx, timeZone, now);
  return eduIaEstado(feature, situacion);
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA PUERTA DEL GASTO
// ═══════════════════════════════════════════════════════════════════════

/** Lo que necesita quien va a gastar: la tarifa y a qué mes cargarlo. */
export interface EduIaPermiso {
  precio: EduIaPrecio;
  periodKey: string;
  cupo: EduIaCupo;
}

/**
 * Lanza si esta función no se puede usar AHORA, con el motivo escrito para
 * una persona. Si deja pasar, devuelve la tarifa con la que hay que cobrar
 * y el mes al que se carga.
 *
 * 🔴 El status distingue dos cosas que se ven iguales desde fuera y no lo
 * son:
 *   · 402 (Payment Required) = SE ACABÓ EL CUPO. El despliegue está bien;
 *     lo que se acabó es el presupuesto del mes. Una gráfica de 402s dice
 *     "hay escuelas quedándose sin cupo", que es una conversación
 *     comercial.
 *   · 503 = falta configurar algo (cupo, tarifa, llave) o está apagada.
 *     Una gráfica de 503s dice "hay algo mal montado", que es una
 *     conversación de ingeniería.
 * Con un solo código, las dos conversaciones se verían igual en el panel
 * de errores y ninguna de las dos empezaría.
 */
export async function requireEduIaCupo(
  ctx: EduClinicaContext,
  feature: EduAiFeature,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduIaPermiso> {
  const situacion = await getEduIaSituacion(ctx, timeZone, now);
  const estado = eduIaEstado(feature, situacion);

  if (!estado.disponible) {
    throw new EduPadronError(
      `${estado.titulo}. ${estado.detalle}`,
      estado.motivo === "cupo_agotado" ? 402 : 503,
    );
  }

  // No puede pasar: `eduIaEstado` ya devolvió "sin_cupo"/"sin_precio" si
  // faltara alguno. El cinturón está para que un cambio futuro en el orden
  // de las comprobaciones no deje un `null!` cobrando de gratis.
  const precio = situacion.precios[feature];
  const cupo = situacion.cupo;
  if (!precio || !cupo) {
    throw new EduPadronError(
      "No se pudo resolver el cupo de IA del instituto. Intenta de nuevo.",
      503,
    );
  }

  return { precio, periodKey: cupo.periodo, cupo };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · ESCRIBIR EL RENGLÓN
// ═══════════════════════════════════════════════════════════════════════

/** El nombre de quien está en la sesión, para congelarlo en la fila. */
export async function eduIaNombreDeSesion(ctx: EduClinicaContext): Promise<string> {
  const u = await prisma.eduUser.findFirst({
    where: { id: ctx.eduUserId, institutionId: ctx.institutionId },
    select: { firstName: true, lastName: true, email: true },
  });
  if (!u) return "Sin nombre";
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}

export interface EduAiUsageInput {
  feature: EduAiFeature;
  model: string;
  unit: EduAiUnit;
  inputUnits: number;
  outputUnits: number;
  costUsdMicros: number;
  /** true = el proveedor no dijo cuánto consumió y se cobró el tope. */
  isEstimated: boolean;
  periodKey: string;
  userName: string;
  studyId?: string | null;
  caseId?: string | null;
  targetLabel?: string | null;
}

/**
 * Un renglón en el libro mayor del gasto.
 *
 * Acepta un cliente de transacción para que el análisis pueda guardar la
 * lectura y su renglón de gasto de forma ATÓMICA: si se guardara solo el
 * análisis, la escuela tendría una lectura que nadie le cobró; si se
 * guardara solo el renglón, un cargo sin nada que enseñar.
 */
export async function recordEduAiUsage(
  ctx: EduClinicaContext,
  input: EduAiUsageInput,
  db: EduDb = prisma,
): Promise<void> {
  const institutionId = requireInstitution(ctx);
  await db.eduAiUsage.create({
    data: {
      institutionId,
      feature: input.feature,
      userId: ctx.eduUserId || null,
      userName: input.userName.slice(0, 160),
      userRole: ctx.role as EduRole,
      studyId: input.studyId ?? null,
      caseId: input.caseId ?? null,
      targetLabel: input.targetLabel ? input.targetLabel.slice(0, 200) : null,
      model: input.model.slice(0, 80),
      unit: input.unit,
      inputUnits: Math.max(0, Math.round(input.inputUnits || 0)),
      outputUnits: Math.max(0, Math.round(input.outputUnits || 0)),
      costUsdMicros: Math.max(0, Math.round(input.costUsdMicros || 0)),
      isEstimated: input.isEstimated,
      periodKey: input.periodKey,
    },
  });
}

/**
 * Lo mismo, pero para el DICTADO: registra y NO deja que un fallo de
 * escritura se lleve por delante la transcripción.
 *
 * 🔴 El criterio es feo de escribir y es el correcto: el dinero ya se
 * gastó. Reventar aquí le quitaría a la persona el texto que acaba de
 * dictar SIN devolverle el gasto — se perderían las dos cosas en vez de
 * una. Se registra el fallo con lo que se iba a cobrar, para que quede en
 * el log del servidor lo que no quedó en la tabla.
 */
export async function recordEduAiUsageSafe(
  ctx: EduClinicaContext,
  input: EduAiUsageInput,
): Promise<void> {
  try {
    await recordEduAiUsage(ctx, input);
  } catch (err) {
    console.error(
      `[instituto/ia] NO se pudo registrar el consumo (${input.feature}, ${input.costUsdMicros} uUSD, instituto ${ctx.institutionId}):`,
      err,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL PANEL — /instituto/ia
// ═══════════════════════════════════════════════════════════════════════

const USO_SELECT = {
  id: true,
  feature: true,
  userName: true,
  userRole: true,
  targetLabel: true,
  model: true,
  unit: true,
  inputUnits: true,
  outputUnits: true,
  costUsdMicros: true,
  isEstimated: true,
  createdAt: true,
} satisfies Prisma.EduAiUsageSelect;

export interface EduIaPanelData extends EduIaPanel {
  /** Lo consumido el mes ANTERIOR, para no leer el día 1 como una caída. */
  mesAnteriorLabel: string;
  mesAnteriorCostLabel: string;
}

/** "2026-08" → "2026-07". Sin aritmética de fechas: son dos números. */
function periodoAnterior(periodKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) return periodKey;
  const y = Number(m[1]);
  const mes = Number(m[2]);
  if (mes <= 1) return `${y - 1}-12`;
  return `${y}-${String(mes - 1).padStart(2, "0")}`;
}

/**
 * Todo lo que pinta /instituto/ia.
 *
 * 🔴 EL ALCANCE ES EL DEL DINERO, Y SE CORTA ANTES DE LEER NADA. Se
 * resuelve con `eduVisibility(ctx, "charges")`, que es una lista BLANCA:
 * DIRECCION y CAJA ven todo, cualquier otro rol —incluido uno que no
 * exista todavía— ve nada. Y "nada" aquí significa que esta función LANZA
 * en vez de devolver un panel vacío, porque el panel vacío seguiría
 * trayendo el CUPO (cuánto incluye el contrato, cuánto se lleva gastado),
 * que es lo que un docente con `ia.view` encendido por error no tiene por
 * qué leer. Dos candados: el permiso abre la pantalla, el alcance decide
 * las filas — y el segundo no se abre desde la pantalla de permisos.
 *
 * ⚠️ SOLO EL MES EN CURSO. No hay selector de meses, y no es un olvido:
 * el cupo que se pinta arriba es el que está configurado HOY, y enseñarlo
 * junto al consumo de marzo diría "te pasaste del cupo" comparando contra
 * un techo que en marzo era otro. Lo del mes pasado se resume en UN número
 * —el total— que no se puede malinterpretar.
 */
export async function getEduIaPanel(
  ctx: EduClinicaContext,
  timeZone: string,
  opciones: { puedeEditar: boolean },
  now: Date = new Date(),
): Promise<EduIaPanelData> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "charges");
  if (scope.kind !== "all") {
    throw new EduPadronError(EDU_VISIBILITY_NONE_DETAIL.charges, 403);
  }
  const where = eduAiUsageScopeWhere({ institutionId, scope });
  const periodo = eduIaPeriodKey(now, timeZone);
  const anterior = periodoAnterior(periodo);

  const [cupo, precios, personas, funciones, filas, aggAnterior] = await Promise.all([
    getEduIaCupo(ctx, timeZone, now),
    listEduAiPrices(),
    prisma.eduAiUsage.groupBy({
      by: ["userId", "userName", "userRole"],
      where: { ...where, periodKey: periodo },
      _sum: { costUsdMicros: true },
      _count: { _all: true },
    }),
    prisma.eduAiUsage.groupBy({
      by: ["feature", "unit"],
      where: { ...where, periodKey: periodo },
      _sum: { costUsdMicros: true, inputUnits: true, outputUnits: true },
      _count: { _all: true },
    }),
    prisma.eduAiUsage.findMany({
      where: { ...where, periodKey: periodo },
      orderBy: [{ createdAt: "desc" }],
      take: EDU_IA_MAX_USOS + 1,
      select: USO_SELECT,
    }),
    prisma.eduAiUsage.aggregate({
      where: { ...where, periodKey: anterior },
      _sum: { costUsdMicros: true },
    }),
  ]);

  const num = (v: number | null | undefined): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;

  const totalMes = funciones.reduce((acc, f) => acc + num(f._sum.costUsdMicros), 0);

  const porPersona: EduIaPersonaRow[] = personas
    .map((p) => {
      const costo = num(p._sum.costUsdMicros);
      return {
        userId: p.userId,
        userName: p.userName,
        userRole: p.userRole as EduRole,
        usos: p._count._all,
        costUsdMicros: costo,
        costLabel: eduIaUsdLabel(costo),
        porcentaje: eduIaParte(costo, totalMes),
      };
    })
    .sort((a, b) => b.costUsdMicros - a.costUsdMicros || a.userName.localeCompare(b.userName, "es"));

  const porFuncion: EduIaFuncionRow[] = funciones
    .map((f) => {
      const costo = num(f._sum.costUsdMicros);
      const unit = f.unit as EduAiUnit;
      const unidades = num(f._sum.inputUnits) + num(f._sum.outputUnits);
      return {
        feature: f.feature as EduAiFeature,
        featureLabel: EDU_AI_FEATURE_LABELS[f.feature as EduAiFeature] ?? String(f.feature),
        usos: f._count._all,
        costUsdMicros: costo,
        costLabel: eduIaUsdLabel(costo),
        porcentaje: eduIaParte(costo, totalMes),
        unidades,
        unit,
        unidadesLabel: eduIaUnidadesLabel(unidades, unit),
      };
    })
    .sort((a, b) => b.costUsdMicros - a.costUsdMicros);

  const usosTruncados = filas.length > EDU_IA_MAX_USOS;
  const usos: EduIaUsoRow[] = filas.slice(0, EDU_IA_MAX_USOS).map((u) => ({
    id: u.id,
    feature: u.feature as EduAiFeature,
    featureLabel: EDU_AI_FEATURE_LABELS[u.feature as EduAiFeature] ?? String(u.feature),
    userName: u.userName,
    userRole: u.userRole as EduRole,
    targetLabel: u.targetLabel,
    model: u.model,
    unit: u.unit as EduAiUnit,
    inputUnits: u.inputUnits,
    outputUnits: u.outputUnits,
    costUsdMicros: u.costUsdMicros,
    costLabel: eduIaCostoLabel(u.costUsdMicros),
    isEstimated: u.isEstimated,
    createdAt: u.createdAt.toISOString(),
    createdLabel: stampLabel(u.createdAt, timeZone),
  }));

  const situacion: EduIaSituacion = {
    global: eduIaGlobalOn(),
    openaiConfigurado: Boolean(process.env.OPENAI_API_KEY),
    anthropicConfigurado: Boolean(process.env.ANTHROPIC_API_KEY),
    cupo,
    precios: preciosPorFeature(precios),
  };

  return {
    cupo,
    estados: EDU_AI_FEATURES.map((f) => eduIaEstado(f, situacion)),
    precios,
    porPersona,
    porFuncion,
    usos,
    usosTruncados,
    puedeEditar: opciones.puedeEditar,
    mesAnteriorLabel: eduIaPeriodoLabel(anterior),
    mesAnteriorCostLabel: eduIaUsdLabel(num(aggAnterior._sum.costUsdMicros)),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · EDITAR LO QUE LA ESCUELA DECIDE
// ═══════════════════════════════════════════════════════════════════════

/** Los campos del cuerpo que este endpoint SÍ acepta. */
export interface EduAiQuotaPatch {
  isEnabled?: unknown;
  allowOverage?: unknown;
  hardCapUsdCents?: unknown;
  contactNote?: unknown;
  /** Solo para RECHAZARLO con un mensaje. Ver abajo. */
  monthlyUsdCents?: unknown;
}

function parseBool(raw: unknown, campo: string): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === 1 || raw === "1") return true;
  if (raw === "false" || raw === 0 || raw === "0") return false;
  throw new EduPadronError(`El campo "${campo}" tiene que ser sí o no.`, 400);
}

/**
 * Guarda lo que la ESCUELA decide del cupo. Nunca lo que incluye el
 * contrato.
 *
 * Las tres reglas, y todas viven aquí y no en la pantalla —una validación
 * que solo está en el formulario no es una validación, es una sugerencia:
 *
 *  1. 🔴 `monthlyUsdCents` se RECHAZA con un mensaje. Ignorarlo en
 *     silencio dejaría a la dirección creyendo que subió su cupo.
 *  2. 🔴 Permitir excedente EXIGE tope duro. "Permitido excederse, sin
 *     tope" es la fuga que la Ola 3B se negó a abrir: 120 alumnos con el
 *     micrófono abierto y una factura que nadie puede contestar.
 *  3. 🔴 El tope tiene que ser MAYOR que lo incluido. Un tope por debajo
 *     haría que marcar "permitir excederse" REDUJERA el cupo, que es lo
 *     contrario de lo que dice la casilla.
 *
 * Y la fila NO se crea desde aquí: sin contrato con cupo, no hay nada que
 * editar (ver el encabezado del archivo).
 */
export async function updateEduAiQuota(
  ctx: EduClinicaContext,
  body: EduAiQuotaPatch,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduIaCupo> {
  const institutionId = requireInstitution(ctx);

  if (body && body.monthlyUsdCents !== undefined) {
    throw new EduPadronError(
      "El cupo mensual que incluye el contrato no se edita desde el panel: lo escribe " +
        "DaleControl al firmar o renovar, igual que las fechas del contrato. Lo que sí " +
        "puedes decidir aquí es apagar la IA, autorizar gastar de más de lo incluido y " +
        "hasta cuánto. Para ampliar lo incluido, habla con DaleControl.",
      400,
    );
  }

  const actual = await prisma.eduAiQuota.findUnique({
    where: { institutionId },
    select: { id: true, monthlyUsdCents: true, allowOverage: true, hardCapUsdCents: true },
  });
  if (!actual) {
    throw new EduPadronError(
      "Tu instituto todavía no tiene cupo de IA asignado, así que no hay nada que " +
        "configurar. El cupo llega con el contrato: pídeselo a DaleControl y en cuanto " +
        "esté, esta pantalla se enciende sola.",
      409,
    );
  }

  const data: Prisma.EduAiQuotaUpdateInput = {};

  if (body.isEnabled !== undefined) data.isEnabled = parseBool(body.isEnabled, "isEnabled");

  const permite =
    body.allowOverage !== undefined ? parseBool(body.allowOverage, "allowOverage") : actual.allowOverage;
  if (body.allowOverage !== undefined) data.allowOverage = permite;

  let tope = actual.hardCapUsdCents;
  if (body.hardCapUsdCents !== undefined) {
    if (body.hardCapUsdCents === null || body.hardCapUsdCents === "") {
      tope = null;
    } else {
      const cents = parseEduIaCents(body.hardCapUsdCents);
      if (cents === null) {
        throw new EduPadronError(
          `El tope tiene que ser una cantidad en dólares (por ejemplo 75.00) y no puede pasar de ${
            EDU_IA_MAX_TOPE_USD_CENTS / 100
          } USD.`,
          400,
        );
      }
      tope = cents;
    }
    data.hardCapUsdCents = tope;
  }

  // Las dos reglas del excedente viven en una función PURA (ia-core.ts)
  // para que se puedan comprobar sin una base de datos delante. Aquí solo
  // se traduce el "no" a una respuesta HTTP.
  const mal = eduIaValidarCupo({
    incluidoUsdCents: actual.monthlyUsdCents,
    permiteExcedente: permite,
    topeUsdCents: tope,
  });
  if (mal) throw new EduPadronError(mal, 400);

  if (body.contactNote !== undefined) {
    const nota = eduOptionalText(body.contactNote, 300);
    if (nota === undefined) {
      throw new EduPadronError("El contacto para pedir más cupo no es un texto válido.", 400);
    }
    data.contactNote = nota;
  }

  if (Object.keys(data).length === 0) {
    // Un PATCH sin nada que cambiar no es un error: se devuelve el estado
    // tal cual, para que la pantalla no tenga que distinguir dos caminos.
    const sinCambios = await getEduIaCupo(ctx, timeZone, now);
    if (!sinCambios) throw new EduPadronError("No se pudo leer el cupo de IA.", 500);
    return sinCambios;
  }

  data.updatedByUserId = ctx.eduUserId || null;
  data.updatedByName = (await eduIaNombreDeSesion(ctx)).slice(0, 160);

  await prisma.eduAiQuota.update({ where: { institutionId }, data });

  const actualizado = await getEduIaCupo(ctx, timeZone, now);
  if (!actualizado) throw new EduPadronError("No se pudo leer el cupo de IA.", 500);
  return actualizado;
}

/**
 * Centavos de dólar con tope, o null si no es una cantidad válida.
 *
 * Lee con `parseEduIaUsdCents` (que a su vez reusa el lector de dinero de
 * la Ola 5) para que no haya dos formas de interpretar "1,234.5" en el
 * mismo vertical.
 */
function parseEduIaCents(raw: unknown): number | null {
  const v = parseEduIaUsdCents(raw);
  if (v === null) return null;
  return v > EDU_IA_MAX_TOPE_USD_CENTS ? null : v;
}
