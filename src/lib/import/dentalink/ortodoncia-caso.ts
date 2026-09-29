// Un tratamiento de ORTODONCIA de Dentalink → el plan de un CASO vivo del módulo (ws1-t12). Puro: sin Prisma, sin
// Next, sin reloj propio (la fecha de hoy entra por `ahora`). Lo prueban los tests en node y lo conduce
// ortodoncia-caso-db.ts, que es quien escribe.
//
// Lo que decide, y por qué:
//   · TÉCNICA — de los nombres de las prestaciones (alineadores / Damon-autoligado / estéticos / linguales /
//     metálicos); alineadores + brackets = mixto. Si Dentalink no da ninguna pista queda «metálicos» (el tipo base
//     más común) con el texto de la colocación como nombre propio, para que se vea que es una suposición.
//   · ESTADO — «Finalizado» → Terminado; «Activo» → En tratamiento, o En retención si su último control hecho es de
//     «contención»; un caso activo sin nada hecho ni pagado todavía queda Planeado (como cualquier caso sin colocar).
//   · MODO DE COBRO, POR CASO — con controles que traen precio → «Pago por control»; un solo cargo de tratamiento
//     completo sin controles cobrados → «Precio total» (el cargo ES el total del caso, sin calendario inventado).
//     Nunca toca el modo por defecto de la clínica.
//   · CONTROLES — solo los HECHOS (con «Fecha Realización») son un control registrado; los que no se han hecho no se
//     inventan. Cada uno lleva su precio y lo que se pagó de él.
//   · PAGOS — «Pagado Prestación» por renglón; lo que Dentalink cobró sin asignarlo a un renglón («Total Pagos
//     Tratamiento» menos lo asignado) se reparte del cargo más viejo al más nuevo, sin pasarse del saldo de ninguno.

import type { OrthoTechnique } from "@prisma/client";
import { dayKey } from "../migrado";
import { renglonEsOrtodoncia, sinAcentos } from "./es-ortodoncia";

export type TipoRenglon = "control" | "colocacion" | "tratamiento" | "extra";
export type ModoDeCobro = "PAGO_POR_CONTROL" | "PRECIO_TOTAL";
export type EstadoDelCaso = "PLANNED" | "IN_PROGRESS" | "RETENTION" | "COMPLETED";

/** Un renglón del tratamiento, ya validado por treatmentPlansHandler (importes en pesos, fechas de calendario). */
export interface RenglonDelCaso {
  /** Fila del archivo (para ordenar de forma estable y para los avisos). */
  row: number;
  procedure: string;
  categoria: string;
  /** Precio final de la línea (cantidad × unitario − descuento). */
  lineTotal: number;
  quantity: number;
  unitPrice: number;
  discount: number;
  hecho: boolean;
  /** Día de calendario anclado al mediodía UTC (`calendarNoonUtc`), o null. */
  fechaRealizado: Date | null;
  /** «Pagado Prestación»: lo pagado de ESTE renglón. null = el archivo no lo trae. */
  abonadoLinea: number | null;
  itemNotes?: string | null;
}

export interface EntradaDelCaso {
  folio: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  renglones: RenglonDelCaso[];
  estadoTratamiento: "activo" | "finalizado" | null;
  /** «Total Pagos Tratamiento»: lo pagado del tratamiento entero. null = no viene. */
  abonadoTratamiento: number | null;
  /** Fecha en que se generó el tratamiento (calendario, mediodía UTC). */
  generado: Date;
  /** Técnicas propias de la clínica (la lista de Configuración), si las hay. */
  tecnicasPropias?: ReadonlyArray<{ id: string; nombre: string; base: string; activa: boolean }>;
}

export interface ItemDeCargo {
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  notes: string | null;
}

export interface CargoDelCaso {
  /** Para el concepto del pago migrado y el aviso. */
  concepto: string;
  items: ItemDeCargo[];
  total: number;
  pagado: number;
  saldo: number;
  status: "PAID" | "PARTIAL" | "PENDING";
  /** Día del cargo (creación): el de la generación del tratamiento o el de la realización del control. */
  fecha: Date;
}

export interface ControlDelCaso {
  /** «AAAA-MM-DD» de la «Fecha Realización». */
  dia: string;
  fecha: Date;
  nombre: string;
  esContencion: boolean;
  cardNumber: number;
  monthAt: number;
  phaseKey: "ALIGNMENT" | "RETENTION";
  /** null si el control no trae precio (0): la visita queda registrada sin cargo. */
  cargo: CargoDelCaso | null;
}

export interface PlanDelCaso {
  folio: string;
  technique: OrthoTechnique;
  techniqueLabel: string | null;
  techniqueNotes: string;
  prescriptionNotes: string;
  estimatedDurationMonths: number;
  status: EstadoDelCaso;
  installedAt: Date | null;
  startDate: Date | null;
  /** Última visita hecha (o la generación): cierra las fases de un caso Terminado. */
  ultimaActividad: Date;
  billingMode: ModoDeCobro;
  /** «Costo total» del caso: el cargo principal en «Precio total»; 0 (referencia) en «Pago por control». */
  totalCostMxn: number;
  /** La colocación / el tratamiento completo (`plan.invoiceId`). */
  principal: CargoDelCaso | null;
  controles: ControlDelCaso[];
  /** Todo lo demás del presupuesto (TADs, retenedores, reposiciones, trabajo dental) en un solo cargo aparte. */
  extras: CargoDelCaso | null;
  /** Lo que Dentalink cobró y no cabe en ningún cargo creado. */
  pagoSinCargo: number;
  avisos: string[];
  cifras: CifrasDelCaso;
}

export interface CifrasDelCaso {
  renglones: number;
  controlesDelPresupuesto: number;
  controlesHechos: number;
  controlesSinHacer: number;
  /** Importe de los controles sin hacer: no se crean, no cuentan como deuda. */
  importeControlesSinHacer: number;
  controlesHechosPagados: number;
  controlesHechosPendientes: number;
  cobrado: number;
  pendiente: number;
}

const MS_DIA = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Renglones
// ---------------------------------------------------------------------------

const ES_REPOSICION = /despegad|reposicion|recementad|cementad|roto\b|rota\b|perdid|extravi/;
const ES_CONTROL = /\b(control|controles|ajuste|ajustes|activacion|activaciones|mensualidad|revision)\b/;
const ES_ALINEADORES = /alineador|invisalign|spark|clear ?aligner/;
const ES_COLOCACION = /coloc|bracket|pago inicial|enganche|inicial|aparatolog|damon|autoligad|autoligable|ortodoncia (metalic|estetic|ceramic)/;

/**
 * Qué es un renglón dentro de un tratamiento de ortodoncia:
 *  control     — visita mensual / ajuste / activación
 *  tratamiento — el cargo de un tratamiento completo (alineadores)
 *  colocacion  — la colocación de la aparatología / pago inicial
 *  extra       — todo lo demás (TADs, retenedores, reposiciones, resinas, extracciones…)
 */
export function tipoDeRenglon(procedure: string, categoria: string): TipoRenglon {
  const n = sinAcentos(procedure);
  if (!renglonEsOrtodoncia({ procedure, categoria })) return "extra";
  if (ES_REPOSICION.test(n)) return "extra";
  if (ES_CONTROL.test(n)) return "control";
  if (ES_ALINEADORES.test(n)) return "tratamiento";
  if (ES_COLOCACION.test(n)) return "colocacion";
  return "extra";
}

const esContencion = (procedure: string) => /contenc|retenc/.test(sinAcentos(procedure));

// ---------------------------------------------------------------------------
// Técnica
// ---------------------------------------------------------------------------

const BASES: ReadonlySet<string> = new Set(["METAL_BRACKETS", "CERAMIC_BRACKETS", "SELF_LIGATING_METAL", "SELF_LIGATING_CERAMIC", "LINGUAL_BRACKETS", "CLEAR_ALIGNERS", "HYBRID"]);

export interface TecnicaDeducida {
  technique: OrthoTechnique;
  label: string | null;
  /** Qué pista se usó (va a las notas del caso). */
  motivo: string;
  /** false = Dentalink no dio ninguna pista: se usó «metálicos» por defecto. */
  deducida: boolean;
}

export function deducirTecnica(
  renglones: ReadonlyArray<Pick<RenglonDelCaso, "procedure" | "categoria">>,
  propias?: EntradaDelCaso["tecnicasPropias"],
): TecnicaDeducida {
  const ortos = renglones.filter((r) => renglonEsOrtodoncia({ procedure: r.procedure, categoria: r.categoria }));
  const texto = ortos.map((r) => sinAcentos(r.procedure)).join(" | ");

  // 1) Una técnica PROPIA de la clínica cuyo nombre aparece en las prestaciones: manda su tipo base y su nombre.
  const propia = (propias ?? []).find((t) => {
    if (!t.activa || BASES.has(t.id) || !BASES.has(t.base)) return false;
    const nombre = sinAcentos(t.nombre);
    return nombre.length >= 4 && texto.includes(nombre);
  });
  if (propia) return { technique: propia.base as OrthoTechnique, label: propia.nombre, motivo: `técnica propia «${propia.nombre}» de la clínica`, deducida: true };

  const alineadores = ES_ALINEADORES.test(texto);
  const autoligado = /damon|autoligad|autoligable|self.?lig|pasiv/.test(texto);
  const ceramicos = /ceramic|zafiro|bracket\w* estetic|estetic\w* bracket|brackets? transparent/.test(texto);
  const linguales = /lingual/.test(texto);
  const metalicos = /metalic|tradicional|bracket/.test(texto);
  const conBrackets = autoligado || ceramicos || linguales || metalicos;

  if (alineadores && conBrackets) return { technique: "HYBRID", label: null, motivo: "alineadores y brackets en el mismo presupuesto (mixto)", deducida: true };
  if (alineadores) return { technique: "CLEAR_ALIGNERS", label: null, motivo: "prestaciones de alineadores", deducida: true };
  if (autoligado) return { technique: ceramicos ? "SELF_LIGATING_CERAMIC" : "SELF_LIGATING_METAL", label: null, motivo: "prestaciones Damon / autoligado", deducida: true };
  if (linguales) return { technique: "LINGUAL_BRACKETS", label: null, motivo: "prestaciones de brackets linguales", deducida: true };
  if (ceramicos) return { technique: "CERAMIC_BRACKETS", label: null, motivo: "prestaciones de brackets estéticos", deducida: true };
  if (metalicos) return { technique: "METAL_BRACKETS", label: null, motivo: "prestaciones de brackets metálicos / tradicional", deducida: true };

  // Sin pista: metálicos por defecto, con el texto de la colocación como nombre propio.
  const coloc = renglones.find((r) => tipoDeRenglon(r.procedure, r.categoria) === "colocacion");
  return {
    technique: "METAL_BRACKETS",
    label: coloc ? coloc.procedure.replace(/\s+/g, " ").trim().slice(0, 60) : null,
    motivo: "Dentalink no dice la técnica: se propone metálicos (tipo base más común)",
    deducida: false,
  };
}

// ---------------------------------------------------------------------------
// Armado del caso
// ---------------------------------------------------------------------------

function itemDe(r: RenglonDelCaso): ItemDeCargo {
  return { name: r.procedure, quantity: r.quantity, unitPrice: r.unitPrice, discount: r.discount, lineTotal: round2(r.lineTotal), notes: r.itemNotes ?? null };
}

function statusDe(total: number, pagado: number): CargoDelCaso["status"] {
  return total > 0 && total - pagado <= 0.004 ? "PAID" : pagado > 0 ? "PARTIAL" : "PENDING";
}

const porFechaYFila = (a: RenglonDelCaso, b: RenglonDelCaso) => {
  const x = a.fechaRealizado?.getTime() ?? Infinity;
  const y = b.fechaRealizado?.getTime() ?? Infinity;
  return x !== y ? x - y : a.row - b.row;
};

function mesesEntre(desde: Date, hasta: Date): number {
  const m = (hasta.getTime() - desde.getTime()) / (30.4375 * MS_DIA);
  return Math.max(0, Math.round(m * 10) / 10);
}

export function armarCaso(e: EntradaDelCaso): PlanDelCaso {
  const avisos: string[] = [];
  const renglones = [...e.renglones].sort((a, b) => a.row - b.row);
  const tipo = new Map<RenglonDelCaso, TipoRenglon>();
  for (const r of renglones) tipo.set(r, tipoDeRenglon(r.procedure, r.categoria));
  const de = (t: TipoRenglon) => renglones.filter((r) => tipo.get(r) === t);

  const controlesTodos = de("control");
  const controlesHechos = controlesTodos.filter((r) => r.hecho && r.fechaRealizado).sort(porFechaYFila);
  const controlesSinHacer = controlesTodos.filter((r) => !controlesHechos.includes(r));
  const principales = [...de("colocacion"), ...de("tratamiento")].sort((a, b) => a.row - b.row);
  const extrasL = de("extra");

  // --- Modo de cobro, por caso -------------------------------------------------------------
  const conPrecio = controlesTodos.some((r) => r.lineTotal > 0);
  const billingMode: ModoDeCobro = conPrecio ? "PAGO_POR_CONTROL" : "PRECIO_TOTAL";

  // --- Pagos: primero lo asignado a cada renglón, luego el resto de más viejo a más nuevo ---------
  // Los cargos que se van a crear, en el orden en que se cubren: principal → controles hechos → extras.
  type Cubierto = { r: RenglonDelCaso; pagado: number };
  const cubiertos: Cubierto[] = [
    ...principales.map((r) => ({ r, pagado: 0 })),
    ...controlesHechos.map((r) => ({ r, pagado: 0 })),
    ...extrasL.map((r) => ({ r, pagado: 0 })),
  ];
  let asignado = 0;
  for (const c of cubiertos) {
    const p = Math.min(Math.max(0, c.r.abonadoLinea ?? 0), Math.max(0, c.r.lineTotal));
    c.pagado = round2(p);
    asignado += c.pagado;
  }
  const sumaLineas = round2(renglones.reduce((s, r) => s + Math.max(0, r.abonadoLinea ?? 0), 0));
  const hayPagadoPorLinea = renglones.some((r) => r.abonadoLinea !== null);
  const totalPagado = e.abonadoTratamiento !== null ? Math.max(0, e.abonadoTratamiento) : hayPagadoPorLinea ? sumaLineas : 0;
  let resto = round2(Math.max(0, totalPagado - asignado));
  const restoInicial = resto;
  const porCubrir = [...cubiertos].sort((a, b) => {
    const rank = (c: Cubierto) => (tipo.get(c.r) === "extra" ? 2 : tipo.get(c.r) === "control" ? 1 : 0);
    return rank(a) - rank(b) || porFechaYFila(a.r, b.r);
  });
  for (const c of porCubrir) {
    if (resto <= 0.004) break;
    const falta = round2(Math.max(0, c.r.lineTotal) - c.pagado);
    if (falta <= 0) continue;
    const p = Math.min(falta, resto);
    c.pagado = round2(c.pagado + p);
    resto = round2(resto - p);
  }
  const pagoSinCargo = resto;
  if (restoInicial > 0.004 && restoInicial !== resto) avisos.push(`Dentalink cobró $${restoInicial.toFixed(2)} sin asignarlos a un renglón: se aplicaron a los cargos más viejos.`);
  if (pagoSinCargo > 0.004) avisos.push(`Dentalink cobró $${pagoSinCargo.toFixed(2)} que no caben en ningún cargo de este caso (un control sin hacer o un exceso): no se registran.`);

  const pagadoDe = (r: RenglonDelCaso) => cubiertos.find((c) => c.r === r)?.pagado ?? 0;
  const cargoDeGrupo = (concepto: string, rs: RenglonDelCaso[], fecha: Date): CargoDelCaso | null => {
    if (rs.length === 0) return null;
    const total = round2(rs.reduce((s, r) => s + Math.max(0, r.lineTotal), 0));
    if (total <= 0) return null;
    const pagado = round2(Math.min(total, rs.reduce((s, r) => s + pagadoDe(r), 0)));
    return { concepto, items: rs.map(itemDe), total, pagado, saldo: round2(total - pagado), status: statusDe(total, pagado), fecha };
  };

  // --- Fechas y estado ------------------------------------------------------------------------
  const hechosPrincipales = principales.filter((r) => r.hecho && r.fechaRealizado).sort(porFechaYFila);
  const colocadas = hechosPrincipales.filter((r) => tipo.get(r) === "colocacion");
  const primerHecho = (colocadas[0] ?? hechosPrincipales[0] ?? controlesHechos[0])?.fechaRealizado ?? null;
  const todosLosHechos = renglones.filter((r) => r.hecho && r.fechaRealizado).map((r) => r.fechaRealizado!.getTime());
  const ultimaActividad = new Date(Math.max(e.generado.getTime(), ...todosLosHechos));
  const iniciado = primerHecho !== null || totalPagado > 0;

  const ultimoControl = controlesHechos[controlesHechos.length - 1];
  const soloContencion = controlesTodos.length > 0 && controlesTodos.every((r) => esContencion(r.procedure));
  const enRetencion = ultimoControl ? esContencion(ultimoControl.procedure) : soloContencion;

  let status: EstadoDelCaso;
  if (e.estadoTratamiento === "finalizado") status = "COMPLETED";
  else if (!iniciado) status = "PLANNED";
  else status = enRetencion ? "RETENTION" : "IN_PROGRESS";
  if (e.estadoTratamiento === null) avisos.push("El archivo no dice si el tratamiento está activo o finalizado: se deduce de lo hecho.");

  // Un caso Terminado o en marcha siempre tiene fecha de colocación; sin ninguna pista se usa la generación.
  const installedAt = status === "PLANNED" ? null : primerHecho ?? e.generado;
  if (status !== "PLANNED" && primerHecho === null) avisos.push("Ninguna prestación tiene «Fecha Realización»: la colocación se fecha con la generación del tratamiento.");
  const startDate = status === "PLANNED" ? null : installedAt;

  // --- Controles registrados ------------------------------------------------------------------
  const desdeRetencion = controlesHechos.findIndex((r) => esContencion(r.procedure));
  const base = installedAt ?? e.generado;
  const controles: ControlDelCaso[] = controlesHechos.map((r, i) => ({
    dia: dayKey(r.fechaRealizado!),
    fecha: r.fechaRealizado!,
    nombre: r.procedure,
    esContencion: esContencion(r.procedure),
    cardNumber: i + 1,
    monthAt: mesesEntre(base, r.fechaRealizado!),
    phaseKey: desdeRetencion >= 0 && i >= desdeRetencion ? "RETENTION" : "ALIGNMENT",
    cargo: cargoDeGrupo(r.procedure, [r], r.fechaRealizado!),
  }));

  // --- Cargos ---------------------------------------------------------------------------------
  const nombreTratamiento = tipo.get(principales[0] ?? renglones[0]) === "tratamiento" ? "Tratamiento de ortodoncia" : "Colocación de ortodoncia";
  const principal = cargoDeGrupo(`${nombreTratamiento} (migrado de Dentalink)`, principales, e.generado);
  const extras = cargoDeGrupo("Extras y otros cargos del tratamiento (migrado de Dentalink)", extrasL, e.generado);

  // --- Técnica y duración -----------------------------------------------------------------------
  const tec = deducirTecnica(renglones, e.tecnicasPropias);
  const nControles = controlesTodos.length;
  const duracionPorControles = nControles >= 3;
  const estimatedDurationMonths = duracionPorControles ? Math.min(60, nControles) : 18;

  const tarifa = /nueva italia/.test(sinAcentos(controlesTodos.map((r) => r.procedure).join(" ")));
  const notasTecnica = [
    `Técnica ${tec.deducida ? "deducida" : "supuesta"} de las prestaciones de Dentalink: ${tec.motivo}.`,
    duracionPorControles
      ? `Duración estimada = ${estimatedDurationMonths} meses, uno por cada control del presupuesto (${nControles}).`
      : "Duración estimada por defecto (18 meses): Dentalink no la trae.",
    tarifa ? "Sus controles usan la tarifa «Nueva Italia» de Dentalink (precio distinto al control normal): es una tarifa, no una técnica." : "",
  ].filter(Boolean).join(" ").slice(0, 1000);

  const cifras: CifrasDelCaso = {
    renglones: renglones.length,
    controlesDelPresupuesto: nControles,
    controlesHechos: controlesHechos.length,
    controlesSinHacer: controlesSinHacer.length,
    importeControlesSinHacer: round2(controlesSinHacer.reduce((s, r) => s + Math.max(0, r.lineTotal), 0)),
    controlesHechosPagados: controles.filter((c) => c.cargo?.status === "PAID").length,
    controlesHechosPendientes: controles.filter((c) => c.cargo && c.cargo.status !== "PAID").length,
    cobrado: round2((principal?.pagado ?? 0) + (extras?.pagado ?? 0) + controles.reduce((s, c) => s + (c.cargo?.pagado ?? 0), 0)),
    pendiente: round2((principal?.saldo ?? 0) + (extras?.saldo ?? 0) + controles.reduce((s, c) => s + (c.cargo?.saldo ?? 0), 0)),
  };

  const prescriptionNotes = [
    `Migrado de Dentalink · # Tratamiento ${e.folio} · generado el ${dayKey(e.generado)}${e.doctorName ? ` · profesional: ${e.doctorName}` : ""}.`,
    `Cobro: ${billingMode === "PAGO_POR_CONTROL" ? "por control (cada control con su precio)" : "precio total (un solo cargo, sin calendario de mensualidades)"}.`,
  ].join("\n");

  return {
    folio: e.folio,
    technique: tec.technique,
    techniqueLabel: tec.label,
    techniqueNotes: notasTecnica,
    prescriptionNotes,
    estimatedDurationMonths,
    status,
    installedAt,
    startDate,
    ultimaActividad,
    billingMode,
    totalCostMxn: billingMode === "PRECIO_TOTAL" ? (principal?.total ?? 0) : 0,
    principal,
    controles,
    extras,
    pagoSinCargo,
    avisos,
    cifras,
  };
}

/** Una línea legible para la vista previa del asistente (sin datos personales). */
export function resumenDelCaso(p: PlanDelCaso): string {
  const estado = { PLANNED: "Planeado", IN_PROGRESS: "En tratamiento", RETENTION: "En retención", COMPLETED: "Terminado" }[p.status];
  const modo = p.billingMode === "PAGO_POR_CONTROL" ? "Pago por control" : "Precio total";
  const c = p.cifras;
  return `Entra como CASO de ortodoncia · ${estado} · ${modo} · ${c.controlesHechos} control(es) hecho(s) registrado(s)${
    c.controlesSinHacer > 0 ? ` (${c.controlesSinHacer} sin hacer, no se crean)` : ""
  } · cobrado $${c.cobrado.toFixed(2)} · pendiente $${c.pendiente.toFixed(2)}`;
}
