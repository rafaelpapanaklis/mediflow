// ═══════════════════════════════════════════════════════════════════════
// CRM de ventas de DaleControl — TODO lo que toca la base.
//
// Módulo de SERVIDOR (importa Prisma). Ningún componente "use client"
// puede importarlo: las reglas puras —catálogo de etapas, semáforo,
// enlaces de WhatsApp, validación— viven en ./crm-core.ts, que sí
// comparten los dos lados.
//
// ── LAS TRES REGLAS QUE VIVEN AQUÍ Y NO EN LA PANTALLA ─────────────────
//
// 1. REGISTRAR UN CONTACTO MUEVE EL PROSPECTO. Anotar "le mandé WhatsApp"
//    en uno que sigue en "Sin contactar" lo pasa solo a "Contactado". Sin
//    esto el tablero miente: la columna de sin contactar se llena de gente
//    a la que sí se contactó y deja de servir para trabajar.
//
// 2. `lastContactAt` NUNCA RETROCEDE. Se puede registrar una llamada de la
//    semana pasada; eso no puede volver "frío" a un prospecto con el que
//    se habló ayer. Se queda con el contacto MÁS RECIENTE.
//
// 3. CERRAR (ganar o perder) BORRA EL PRÓXIMO PASO. Un prospecto cerrado
//    con seguimiento pendiente saldría para siempre en "hoy toca".
//
// Toda escritura valida contra el catálogo de crm-core ANTES de tocar la
// base: las columnas son TEXT y la integridad la pone esta capa.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import {
  crmActividadCuentaComoContacto,
  crmEsActividad,
  crmEsEtapa,
  crmEsFuente,
  crmEsResultado,
  crmEsVertical,
  crmEtapaEsTerminal,
  crmFechaDeCalendario,
  crmFinDelDiaMx,
  crmNormalizarEtiquetas,
  crmNumeroOpcional,
  crmTextoOpcional,
  crmTextoPlano,
  crmCoincide,
  crmComparar,
  crmInicioDelDiaMx,
  crmLimiteFrio,
  crmPaginaValida,
  crmTotalPaginas,
  crmValidarProspecto,
  crmVistaEfectiva,
  CRM_ETAPAS,
  CRM_FILTROS_VACIOS,
  CRM_IMPORT_MAX,
  CRM_NOMBRE_MAX,
  CRM_ORIGEN_AFILIADOS,
  CRM_ORIGEN_DALECONTROL,
  CRM_TABLERO_MAX,
  type CrmEstadoId,
  type CrmFilaImportada,
  type CrmFiltros,
  type CrmOrden,
  type CrmProspectoEntrada,
  type CrmResumen,
  type CrmVista,
} from "./crm-core";

/**
 * Tope del BARRIDO en memoria de la búsqueda de texto. Ver `crmListar`:
 * los filtros de catálogo (giro, fuente, etapa, estado, origen) los
 * resuelve la base, pero el texto se compara aquí con `crmCoincide` para
 * no perder acentos ni teléfonos escritos con guiones. Ese barrido se
 * hace sobre lo que ya redujeron los filtros, y este número es el tope
 * de lo que se lee para hacerlo.
 *
 * NO es un techo de la lista: sin búsqueda de texto no se toca, y la
 * paginación llega a todas las filas siempre. Cuando el barrido sí se
 * corta, `CrmListado.escaneoTruncado` lo dice con los números exactos
 * para que la pantalla lo pueda enseñar en vez de callárselo.
 */
export const CRM_ESCANEO_MAX = 20000;

/** Cuántos "hoy toca" se traen para la tarjeta de arriba. */
export const CRM_HOY_TOCA_MAX = 12;

/** Tope del selector de socios del filtro de origen. */
const CRM_SOCIOS_MAX = 200;

/** Las etapas que cierran el prospecto, para los `where` de la base. */
const ETAPAS_TERMINALES: string[] = CRM_ETAPAS.filter((e) => e.terminal).map((e) => e.id);

// ── Lo que viaja a la pantalla ──────────────────────────────────────────

/** Fechas en ISO: cruzan del servidor al cliente sin sorpresas de serialización. */
export interface CrmProspectoDTO {
  id: string;
  name: string;
  vertical: string;
  stage: string;
  source: string | null;
  contactName: string | null;
  contactRole: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  website: string | null;
  size: number | null;
  monthlyValue: number | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
  lastContactAt: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  clinicId: string | null;
  notes: string | null;
  tags: string[];
  createdByEmail: string | null;
  /** Null = lo dio de alta DaleControl. Con valor = lo recomendó ese socio. */
  affiliateId: string | null;
  /**
   * Nombre del socio que lo recomendó, resuelto aparte (no hay llave foránea).
   * `null` con `affiliateId` puesto = el socio ya no existe; la pantalla lo
   * dice así en vez de callarse el origen del prospecto.
   */
  affiliateName?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Cuántas cosas hay anotadas en la bitácora. Sale de un groupBy, no de un N+1. */
  actividades?: number;
}

export interface CrmActividadDTO {
  id: string;
  kind: string;
  body: string | null;
  outcome: string | null;
  stageFrom: string | null;
  stageTo: string | null;
  happenedAt: string;
  authorEmail: string | null;
  createdAt: string;
}

/** Un socio que ha recomendado algo, para el filtro de origen. */
export interface CrmSocioListado {
  id: string;
  nombre: string;
  cuantos: number;
}

/**
 * TODO lo que necesita la pantalla, ya resuelto en el servidor. Va junto
 * a propósito: los números de las fichas de filtro, los de las columnas
 * del tablero y los de la paginación tienen que salir de la MISMA
 * consulta que las filas, o la pantalla dice "37" y enseña 41.
 */
export interface CrmListado {
  /** La página pedida, ya filtrada y ordenada. Nunca la libreta entera. */
  filas: CrmProspectoDTO[];
  /** Cuántos cumplen los filtros. El de la izquierda en «37 de 1,240». */
  total: number;
  /** Cuántos hay en la libreta, sin filtro ninguno. El de la derecha. */
  totalGeneral: number;
  /** Los filtros ya validados, con la página ajustada a lo que existe. */
  filtros: CrmFiltros;
  /** Tablero o lista, ya decidido (ver `crmVistaEfectiva`). */
  vista: CrmVista;
  totalPaginas: number;
  /** Cuántos hay en cada etapa BAJO LOS FILTROS: columnas y fichas. */
  porEtapa: Record<string, number>;
  /** Las cuentas del embudo COMPLETO — los KPI de arriba no se filtran. */
  resumen: CrmResumen;
  /** A quién hay que buscar hoy. No depende del filtro puesto: es la
   *  pregunta con la que se abre la pantalla por la mañana. */
  hoyToca: CrmProspectoDTO[];
  /** Los socios que han recomendado algo, para el filtro de origen. */
  socios: CrmSocioListado[];
  /**
   * Recomendaciones de socios que siguen en "Sin contactar". Merecen
   * aviso propio y no un badge más: un socio que recomienda y ve que
   * nunca lo buscamos deja de recomendar, y estas NO entran en "hoy
   * toca" porque nacen sin fecha de seguimiento.
   */
  recomendacionesSinTocar: { total: number; socios: string[] };
  /**
   * La búsqueda de texto tuvo que cortar el barrido. `null` = se revisó
   * todo lo que cumplía los filtros, que es el caso normal.
   */
  escaneoTruncado: { escaneados: number; de: number } | null;
  /**
   * El tablero no cabe entero. `null` = se pintan todas las tarjetas.
   * Nunca se esconden filas en silencio: cuando esto trae valor, la
   * pantalla lo dice y manda a la lista, que sí llega a todas.
   */
  tableroTruncado: { pintadas: number; de: number } | null;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function aDTO(p: any, actividades?: number, affiliateName?: string | null): CrmProspectoDTO {
  return {
    id: p.id,
    name: p.name,
    vertical: p.vertical,
    stage: p.stage,
    source: p.source ?? null,
    contactName: p.contactName ?? null,
    contactRole: p.contactRole ?? null,
    phone: p.phone ?? null,
    email: p.email ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    country: p.country ?? null,
    website: p.website ?? null,
    size: p.size ?? null,
    monthlyValue: p.monthlyValue ?? null,
    nextActionAt: iso(p.nextActionAt),
    nextActionNote: p.nextActionNote ?? null,
    lastContactAt: iso(p.lastContactAt),
    wonAt: iso(p.wonAt),
    lostAt: iso(p.lostAt),
    lostReason: p.lostReason ?? null,
    clinicId: p.clinicId ?? null,
    notes: p.notes ?? null,
    tags: Array.isArray(p.tags) ? p.tags : [],
    createdByEmail: p.createdByEmail ?? null,
    affiliateId: p.affiliateId ?? null,
    ...(affiliateName === undefined ? {} : { affiliateName }),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    ...(actividades === undefined ? {} : { actividades }),
  };
}

function actividadDTO(a: any): CrmActividadDTO {
  return {
    id: a.id,
    kind: a.kind,
    body: a.body ?? null,
    outcome: a.outcome ?? null,
    stageFrom: a.stageFrom ?? null,
    stageTo: a.stageTo ?? null,
    happenedAt: a.happenedAt.toISOString(),
    authorEmail: a.authorEmail ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

// ── Lectura ─────────────────────────────────────────────────────────────

/**
 * De los filtros de la pantalla al `where` de Prisma. Todo lo que es
 * IGUALDAD contra un catálogo se resuelve aquí, en la base: giro, fuente,
 * etapa y quién lo trajo. Lo único que no baja a SQL es el texto libre —
 * ver `crmListar` para el porqué.
 */
function whereDeFiltros(f: CrmFiltros, ahora: Date): Record<string, any> {
  const partes: Record<string, any>[] = [];

  if (f.vertical) partes.push({ vertical: f.vertical });
  if (f.fuente) partes.push({ source: f.fuente });
  if (f.etapa) partes.push({ stage: f.etapa });

  if (f.origen === CRM_ORIGEN_DALECONTROL) partes.push({ affiliateId: null });
  else if (f.origen === CRM_ORIGEN_AFILIADOS) partes.push({ affiliateId: { not: null } });
  else if (f.origen) partes.push({ affiliateId: f.origen });

  const estado = whereDeEstado(f.estado, ahora);
  if (estado) partes.push(estado);

  if (partes.length === 0) return {};
  if (partes.length === 1) return partes[0];
  return { AND: partes };
}

/**
 * El filtro de situación, en SQL. ES LA ÚNICA DEFINICIÓN de qué quiere
 * decir cada una: la usan el filtro de la lista, la tarjeta de "hoy
 * toca" y —vía las mismas fechas— los tres contadores de arriba. Si
 * hubiera una segunda definición en la pantalla, un día dirían cosas
 * distintas y no habría forma de saber cuál miente.
 *
 * Lo que sí está repartido son las CUENTAS de fecha, y ésas viven en
 * crm-core con sus pruebas: `crmInicioDelDiaMx` y `crmFinDelDiaMx` (día
 * natural mexicano, no UTC — a las 19:00 de México ya es otro día en
 * UTC y la lista de "hoy toca" se vaciaría sola cada tarde) y
 * `crmLimiteFrio`, que tiene una prueba que lo compara día por día con
 * `crmEstaFrio` alrededor del umbral.
 *
 * En Prisma, un `lt` sobre una columna que admite NULL deja fuera los
 * NULL por sí solo — que es lo que se quiere: sin fecha no es "vencido".
 */
function whereDeEstado(estado: CrmEstadoId, ahora: Date): Record<string, any> | null {
  if (!estado) return null;
  if (estado === "cerrados") return { stage: { in: ETAPAS_TERMINALES } };

  const abierto = { stage: { notIn: ETAPAS_TERMINALES } };
  if (estado === "abiertos") return abierto;
  if (estado === "frios") return { ...abierto, lastContactAt: { lt: crmLimiteFrio(ahora) } };
  if (estado === "sin-tocar") return { ...abierto, lastContactAt: null };
  if (estado === "sin-fecha") return { ...abierto, nextActionAt: null };
  if (estado === "pendientes") return { ...abierto, nextActionAt: { lt: crmFinDelDiaMx(ahora) } };
  if (estado === "vencidos") return { ...abierto, nextActionAt: { lt: crmInicioDelDiaMx(ahora) } };
  if (estado === "hoy") {
    return {
      ...abierto,
      nextActionAt: { gte: crmInicioDelDiaMx(ahora), lt: crmFinDelDiaMx(ahora) },
    };
  }
  return null;
}

/**
 * El `orderBy` de cada criterio. Tiene que dar la MISMA lista que
 * `crmComparar` de crm-core, que es el que ordena cuando hay búsqueda de
 * texto; por eso los `nulls` están puestos a mano en vez de dejados al
 * azar del motor:
 *
 *   · prioridad → la fecha más vieja arriba (lo más vencido primero) y
 *     los que no tienen próximo paso al final. Es exactamente el orden
 *     que devuelve `crmPrioridad`.
 *   · sin-contacto → el que nunca se contactó va PRIMERO: es el más
 *     abandonado de todos, no el que menos.
 *   · valor → sin valor puesto NO es valor cero; va al final.
 *
 * Y todos terminan en el ID. El nombre NO basta como desempate —no es
 * único, y dos "Clínica Dental Sonrisa" empatarían hasta el final—, así
 * que sin el id el orden no sería TOTAL y la página 2 podría repetir una
 * fila y saltarse otra. Ver `cmpId` en crm-core, que hace lo mismo del
 * lado de la memoria.
 */
function orderByDeOrden(orden: CrmOrden): Record<string, any>[] {
  // El id va SIEMPRE el último. Ver `cmpId` en crm-core: es el único
  // desempate que desempata de verdad, y sin él la paginación puede
  // repetir una fila en la página 1 y saltársela en la 2 sin avisar.
  const id = { id: "asc" };
  switch (orden) {
    case "reciente":
      return [{ updatedAt: "desc" }, { name: "asc" }, id];
    case "nuevos":
      return [{ createdAt: "desc" }, { name: "asc" }, id];
    case "sin-contacto":
      return [{ lastContactAt: { sort: "asc", nulls: "first" } }, { name: "asc" }, id];
    case "valor":
      return [{ monthlyValue: { sort: "desc", nulls: "last" } }, { name: "asc" }, id];
    case "nombre":
      return [{ name: "asc" }, id];
    default:
      return [{ nextActionAt: { sort: "asc", nulls: "last" } }, { name: "asc" }, id];
  }
}

/** Las cuentas del embudo COMPLETO, armadas con agregados y no leyendo filas. */
function resumenDeAgregados(
  grupos: { stage: string; cuantos: number; valor: number }[],
  vencidos: number,
  paraHoy: number,
  frios: number,
): CrmResumen {
  const porId = new Map(grupos.map((g) => [g.stage, g]));
  let abiertos = 0;
  let valorAbierto = 0;
  for (const g of grupos) {
    // Una etapa fuera del catálogo (edición a mano en Supabase) cuenta
    // como abierta, igual que en `crmResumen`: no cierra nada.
    if (!crmEtapaEsTerminal(g.stage)) {
      abiertos += g.cuantos;
      valorAbierto += g.valor;
    }
  }
  return {
    porEtapa: CRM_ETAPAS.map((etapa) => ({
      etapa,
      cuantos: porId.get(etapa.id)?.cuantos ?? 0,
      valorMensual: porId.get(etapa.id)?.valor ?? 0,
    })),
    abiertos,
    valorAbierto,
    vencidos,
    paraHoy,
    frios,
    ganados: porId.get("GANADO")?.cuantos ?? 0,
    perdidos: porId.get("PERDIDO")?.cuantos ?? 0,
  };
}

/**
 * LA CONSULTA DE LA PANTALLA. Devuelve UNA página, no la libreta entera.
 *
 * ── QUÉ CAMBIÓ Y POR QUÉ ───────────────────────────────────────────────
 * Antes esto traía hasta 2.000 filas completas de una vez y la pantalla
 * filtraba, ordenaba y paginaba en el navegador. Eso tenía dos costes que
 * se notaban justo cuando la libreta empieza a servir: un techo silencioso
 * a las 2.000 (el prospecto 2.001 no existía para la pantalla) y un
 * arranque cada vez más lento, porque las 2.000 filas viajan enteras
 * dentro del HTML — con notas, etiquetas y todo. Ahora los filtros, el
 * orden y el corte de página los hace la base y sólo cruza la red lo que
 * de verdad se va a pintar.
 *
 * ── LA ÚNICA EXCEPCIÓN: LA BÚSQUEDA DE TEXTO ───────────────────────────
 * El texto NO baja a SQL, y no es por comodidad. `contains` de Prisma no
 * sabe que "Clínica" y "clinica" son la misma palabra (haría falta la
 * extensión `unaccent`, que este repo evita a propósito — ver
 * sql/edu-ola-1b.sql), no sabe que "55-1234-5678" y "5512345678" son el
 * mismo teléfono, y no escapa los comodines de LIKE: un "%" tecleado
 * devolvería la tabla entera. Hay una prueba que fija ese comportamiento
 * (crm-core.test.ts, «un comodín de LIKE es texto, no un patrón»).
 *
 * Así que se hace lo que sí escala de verdad: los filtros de catálogo
 * REDUCEN en la base, y el texto se compara con `crmCoincide` sobre lo
 * que quedó — en el servidor, no en el navegador de nadie. Buscar dentro
 * de "clínicas dentales de Puebla" barre las de Puebla, no la libreta.
 * El barrido tiene tope (`CRM_ESCANEO_MAX`) y cuando se corta lo DICE con
 * los números exactos: `escaneoTruncado`.
 *
 * ── LAS RONDAS ────────────────────────────────────────────────────────
 * Tres viajes a la base, ninguno con más de 6 consultas a la vez (el
 * pooler de Supabase se satura por encima de eso):
 *   1. las cuentas del embudo completo, los socios y —sin búsqueda— el
 *      total que cumple los filtros;
 *   2. la página (o el barrido) y la lista de "hoy toca";
 *   3. lo accesorio SÓLO de las filas que se van a pintar: cuántas
 *      anotaciones tiene cada una y quién la recomendó.
 * La ronda 3 es la que antes se hacía sobre 2.000 ids y ahora se hace
 * sobre 50.
 */
export async function crmListar(
  filtros: CrmFiltros = CRM_FILTROS_VACIOS,
  ahora: Date = new Date(),
): Promise<CrmListado> {
  const where = whereDeFiltros(filtros, ahora);
  const hayTexto = filtros.q.trim().length > 0;
  const orderBy = orderByDeOrden(filtros.orden);

  const inicioDia = crmInicioDelDiaMx(ahora);
  const finDia = crmFinDelDiaMx(ahora);
  const abierto = { stage: { notIn: ETAPAS_TERMINALES } };

  // ── Ronda 1: las cuentas ─────────────────────────────────────────────
  const conteoFiltrado = hayTexto
    ? Promise.resolve(null)
    : prisma.crmProspect.groupBy({ by: ["stage"], _count: { _all: true }, where });

  const [gruposGlobal, vencidos, paraHoy, frios, gruposSocios, gruposFiltro] = await Promise.all([
    prisma.crmProspect.groupBy({
      by: ["stage"],
      _count: { _all: true },
      _sum: { monthlyValue: true },
    }),
    prisma.crmProspect.count({ where: { ...abierto, nextActionAt: { lt: inicioDia } } }),
    prisma.crmProspect.count({
      where: { ...abierto, nextActionAt: { gte: inicioDia, lt: finDia } },
    }),
    prisma.crmProspect.count({ where: { ...abierto, lastContactAt: { lt: crmLimiteFrio(ahora) } } }),
    prisma.crmProspect.groupBy({
      by: ["affiliateId"],
      _count: { _all: true },
      where: { affiliateId: { not: null } },
    }),
    conteoFiltrado,
  ]);

  const global = (gruposGlobal as any[]).map((g) => ({
    stage: String(g.stage),
    cuantos: g._count?._all ?? 0,
    valor: Number(g._sum?.monthlyValue ?? 0) || 0,
  }));
  const totalGeneral = global.reduce((s, g) => s + g.cuantos, 0);
  const resumen = resumenDeAgregados(global, vencidos, paraHoy, frios);

  // La vista se decide con la libreta ENTERA, no con lo filtrado: si el
  // tablero fuera lo normal al filtrar y la lista al quitar el filtro, la
  // pantalla cambiaría de forma sola a media faena.
  const vista = crmVistaEfectiva(filtros, totalGeneral);
  const porPagina = vista === "tablero" ? CRM_TABLERO_MAX : filtros.porPagina;

  // ── Ronda 2: las filas ───────────────────────────────────────────────
  // "Hoy toca" es exactamente la situación "pendientes", así que sale del
  // MISMO sitio que el filtro: si un día cambiara qué cuenta como
  // pendiente, la tarjeta de arriba y el filtro de abajo cambiarían
  // juntos en vez de discrepar.
  const hoyTocaPromesa = prisma.crmProspect.findMany({
    where: whereDeEstado("pendientes", ahora) ?? {},
    orderBy: [{ nextActionAt: "asc" }, { name: "asc" }],
    take: CRM_HOY_TOCA_MAX,
  });

  // Lo que mandaron los socios y nadie ha tocado. Va agrupado por socio y
  // no como un `count` pelado para poder decirlos por su nombre: "3 de
  // María" mueve a hacer algo; "3 recomendaciones", no.
  const sinTocarPromesa = prisma.crmProspect
    .groupBy({
      by: ["affiliateId"],
      _count: { _all: true },
      where: { affiliateId: { not: null }, stage: "NUEVO" },
    })
    .catch(() => [] as any[]);

  let crudas: any[];
  let total: number;
  let porEtapa: Record<string, number> = {};
  let escaneoTruncado: { escaneados: number; de: number } | null = null;
  let hoyTocaCrudas: any[];
  let gruposSinTocar: any[];

  if (!hayTexto) {
    // Sin texto la base lo hace TODO: filtra, ordena, cuenta y corta.
    const grupos = (gruposFiltro ?? []) as any[];
    total = grupos.reduce((s, g) => s + (g._count?._all ?? 0), 0);
    for (const g of grupos) porEtapa[String(g.stage)] = g._count?._all ?? 0;

    const pagina = crmPaginaValida(filtros.pagina, total, porPagina);
    [crudas, hoyTocaCrudas, gruposSinTocar] = await Promise.all([
      prisma.crmProspect.findMany({
        where,
        orderBy,
        skip: vista === "tablero" ? 0 : (pagina - 1) * porPagina,
        take: porPagina,
      }),
      hoyTocaPromesa,
      sinTocarPromesa,
    ]);
    filtros = { ...filtros, pagina };
  } else {
    // Con texto: la base reduce con los filtros de catálogo y el barrido
    // se hace aquí, con las MISMAS reglas de `crmCoincide` de siempre.
    const [candidatas, hoy, sinTocar] = await Promise.all([
      prisma.crmProspect.findMany({ where, orderBy, take: CRM_ESCANEO_MAX + 1 }),
      hoyTocaPromesa,
      sinTocarPromesa,
    ]);
    hoyTocaCrudas = hoy;
    gruposSinTocar = sinTocar;

    const seCorto = candidatas.length > CRM_ESCANEO_MAX;
    const revisadas = seCorto ? candidatas.slice(0, CRM_ESCANEO_MAX) : candidatas;

    // Sólo el TEXTO se compara aquí. El giro, la fuente, la etapa, el
    // origen y la situación ya vinieron resueltos por el `where`, y
    // volver a filtrarlos en memoria sólo podría quitar filas que la
    // base sí dejó pasar: una sola autoridad por cada cosa.
    const coincidentes = revisadas.filter((p) => crmCoincide(p as any, filtros.q));
    coincidentes.sort(crmComparar(filtros.orden, ahora) as any);

    total = coincidentes.length;
    for (const p of coincidentes) {
      const id = String(p.stage);
      porEtapa[id] = (porEtapa[id] ?? 0) + 1;
    }

    const pagina = crmPaginaValida(filtros.pagina, total, porPagina);
    const desde = vista === "tablero" ? 0 : (pagina - 1) * porPagina;
    crudas = coincidentes.slice(desde, desde + porPagina);
    filtros = { ...filtros, pagina };

    if (seCorto) {
      // Cuántos había en total que cumplían los filtros de catálogo. Es
      // una consulta más, y sólo pasa en el caso raro: mejor una consulta
      // extra que decirle a alguien "hay muchos" sin un número.
      const de = await prisma.crmProspect.count({ where }).catch(() => CRM_ESCANEO_MAX);
      escaneoTruncado = { escaneados: CRM_ESCANEO_MAX, de };
    }
  }

  const tableroTruncado =
    vista === "tablero" && total > crudas.length ? { pintadas: crudas.length, de: total } : null;

  // ── Ronda 3: lo accesorio, SÓLO de lo que se va a pintar ─────────────
  const paraEnriquecer = [...crudas, ...hoyTocaCrudas];
  // `groupBy` no promete ningún orden, así que se ordena ANTES de recortar:
  // sin esto, con más de CRM_SOCIOS_MAX socios el selector enseñaría 200
  // cualesquiera, y podrían ser otros 200 en la siguiente carga de la MISMA
  // URL. Se ordenan por cuántos ha traído cada uno: si hay que dejar fuera
  // a alguien, que sean los que menos han recomendado.
  const sociosOrdenados = (gruposSocios as any[])
    .slice()
    .sort((a, b) => (b._count?._all ?? 0) - (a._count?._all ?? 0))
    .slice(0, CRM_SOCIOS_MAX);
  const sinTocarOrdenados = (gruposSinTocar as any[])
    .slice()
    .sort((a, b) => (b._count?._all ?? 0) - (a._count?._all ?? 0));

  const idsSocios = Array.from(
    new Set([
      ...paraEnriquecer.map((f) => f.affiliateId),
      ...sociosOrdenados.map((g) => g.affiliateId),
      ...sinTocarOrdenados.slice(0, 3).map((g) => g.affiliateId),
    ]),
  );

  const [conteos, nombresSocios] = await Promise.all([
    contarActividades(paraEnriquecer.map((f) => f.id)),
    nombresDeAfiliados(idsSocios),
  ]);

  const aFila = (f: any) =>
    aDTO(f, conteos.get(f.id) ?? 0, f.affiliateId ? nombresSocios.get(f.affiliateId) ?? null : null);

  const socios: CrmSocioListado[] = sociosOrdenados
    .map((g) => ({
      id: String(g.affiliateId),
      nombre: nombresSocios.get(String(g.affiliateId)) ?? "Socio dado de baja",
      cuantos: g._count?._all ?? 0,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const recomendacionesSinTocar = {
    total: sinTocarOrdenados.reduce((s, g) => s + (g._count?._all ?? 0), 0),
    // Los tres que MÁS han mandado sin que nadie los toque, no tres
    // cualesquiera: el aviso sirve para saber a quién le estamos quedando mal.
    socios: sinTocarOrdenados
      .slice(0, 3)
      .map((g) => nombresSocios.get(String(g.affiliateId)) ?? "un socio dado de baja"),
  };

  return {
    filas: crudas.map(aFila),
    total,
    totalGeneral,
    filtros,
    vista,
    totalPaginas: crmTotalPaginas(total, porPagina),
    porEtapa,
    resumen,
    hoyToca: hoyTocaCrudas.map(aFila),
    socios,
    recomendacionesSinTocar,
    escaneoTruncado,
    tableroTruncado,
  };
}

/**
 * Cuántas cosas hay anotadas en la bitácora de cada uno, en UNA consulta.
 * Con su propio catch: el número de anotaciones es informativo y perderlo
 * jamás justifica dejar sin pantalla a DaleControl.
 */
async function contarActividades(ids: string[]): Promise<Map<string, number>> {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  if (unicos.length === 0) return new Map();
  const grupos = await prisma.crmActivity
    .groupBy({
      by: ["prospectId"],
      _count: { _all: true },
      where: { prospectId: { in: unicos } },
    })
    .catch(() => [] as any[]);
  const mapa = new Map<string, number>();
  for (const g of grupos as any[]) mapa.set(g.prospectId, g._count?._all ?? 0);
  return mapa;
}

/**
 * Nombre de cada socio, por id. Devuelve un mapa vacío ante cualquier fallo:
 * el origen de un prospecto es informativo, y perderlo nunca justifica
 * tumbar la pantalla que lo enseña.
 */
async function nombresDeAfiliados(ids: (string | null)[]): Promise<Map<string, string>> {
  const unicos = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unicos.length === 0) return new Map();
  try {
    const filas = await prisma.affiliate.findMany({
      where: { id: { in: unicos } },
      select: { id: true, name: true },
    });
    return new Map(filas.map((a) => [a.id, a.name]));
  } catch (e) {
    console.error("[crm] no se pudieron resolver los nombres de los socios:", e);
    return new Map();
  }
}

export interface CrmFicha {
  prospecto: CrmProspectoDTO;
  actividades: CrmActividadDTO[];
  /** Nombre de la clínica que nació de este prospecto, si ya cerró y se vinculó. */
  clinica: { id: string; name: string } | null;
}

export async function crmObtener(id: string): Promise<CrmFicha | null> {
  if (!id) return null;
  const p = await prisma.crmProspect.findUnique({ where: { id } });
  if (!p) return null;

  const actividades = await prisma.crmActivity
    .findMany({
      where: { prospectId: id },
      orderBy: [{ happenedAt: "desc" }, { createdAt: "desc" }],
      take: 300,
    })
    .catch(() => [] as any[]);

  // Consulta APARTE y con su propio catch: que el CRM no encuentre la
  // clínica vinculada (se borró, o el id quedó colgando) no puede tumbar
  // la ficha entera.
  let clinica: { id: string; name: string } | null = null;
  if (p.clinicId) {
    clinica = await prisma.clinic
      .findUnique({ where: { id: p.clinicId }, select: { id: true, name: true } })
      .catch(() => null);
  }

  const socios = await nombresDeAfiliados([p.affiliateId]);

  return {
    prospecto: aDTO(p, undefined, p.affiliateId ? socios.get(p.affiliateId) ?? null : null),
    actividades: (actividades as any[]).map(actividadDTO),
    clinica,
  };
}

/**
 * Cuántos seguimientos están vencidos o son para hoy. Lo pinta el badge del
 * menú de /admin. Con su propio try/catch: mientras el SQL no esté aplicado
 * la consulta lanza, y un badge JAMÁS puede tumbar el sidebar entero.
 */
export async function crmContarPendientes(ahora: Date = new Date()): Promise<number> {
  try {
    return await prisma.crmProspect.count({
      where: {
        nextActionAt: { lt: crmFinDelDiaMx(ahora) },
        stage: { notIn: ["GANADO", "PERDIDO"] },
      },
    });
  } catch {
    return 0;
  }
}

// ── Escritura ───────────────────────────────────────────────────────────

export interface CrmResultado<T = undefined> {
  ok: boolean;
  error?: string;
  mensaje?: string;
  datos?: T;
}

/**
 * Traduce la entrada del formulario a columnas. Lo que llega vacío se
 * guarda como NULL, no como "": una cadena vacía en `email` haría que la
 * ficha pinte un botón de correo que no lleva a ningún lado.
 */
function aColumnas(entrada: CrmProspectoEntrada): Record<string, any> {
  const datos: Record<string, any> = {};
  if (entrada.name !== undefined) datos.name = String(entrada.name).trim().slice(0, CRM_NOMBRE_MAX);
  if (entrada.vertical !== undefined) datos.vertical = crmEsVertical(entrada.vertical) ? entrada.vertical : "OTRO";
  if (entrada.source !== undefined) datos.source = crmEsFuente(entrada.source) ? entrada.source : null;
  if (entrada.contactName !== undefined) datos.contactName = crmTextoOpcional(entrada.contactName, 120);
  if (entrada.contactRole !== undefined) datos.contactRole = crmTextoOpcional(entrada.contactRole, 80);
  if (entrada.phone !== undefined) datos.phone = crmTextoOpcional(entrada.phone, 40);
  if (entrada.email !== undefined) datos.email = crmTextoOpcional(entrada.email, 160);
  if (entrada.city !== undefined) datos.city = crmTextoOpcional(entrada.city, 80);
  if (entrada.state !== undefined) datos.state = crmTextoOpcional(entrada.state, 80);
  if (entrada.country !== undefined) datos.country = crmTextoOpcional(entrada.country, 80);
  if (entrada.website !== undefined) datos.website = crmTextoOpcional(entrada.website, 300);
  if (entrada.size !== undefined) {
    const n = crmNumeroOpcional(entrada.size);
    datos.size = n === null ? null : Math.round(n);
  }
  if (entrada.monthlyValue !== undefined) datos.monthlyValue = crmNumeroOpcional(entrada.monthlyValue);
  if (entrada.nextActionAt !== undefined) datos.nextActionAt = crmFechaDeCalendario(entrada.nextActionAt);
  if (entrada.nextActionNote !== undefined) datos.nextActionNote = crmTextoOpcional(entrada.nextActionNote, 500);
  if (entrada.notes !== undefined) datos.notes = crmTextoOpcional(entrada.notes);
  if (entrada.lostReason !== undefined) datos.lostReason = crmTextoOpcional(entrada.lostReason, 300);
  if (entrada.clinicId !== undefined) datos.clinicId = crmTextoOpcional(entrada.clinicId, 60);
  if ((entrada as any).tags !== undefined) datos.tags = crmNormalizarEtiquetas((entrada as any).tags);
  return datos;
}

export async function crmCrear(
  entrada: CrmProspectoEntrada & { tags?: string[] | string },
  autorEmail: string | null,
): Promise<CrmResultado<CrmProspectoDTO>> {
  const invalido = crmValidarProspecto(entrada);
  if (invalido) return { ok: false, error: invalido };

  const datos = aColumnas(entrada);
  datos.stage = crmEsEtapa(entrada.stage) ? entrada.stage : "NUEVO";
  datos.createdByEmail = autorEmail ?? null;
  if (datos.vertical === undefined) datos.vertical = "DENTAL";
  // Nace cerrado (se dio de alta un caso viejo): la fecha de cierre es hoy.
  if (datos.stage === "GANADO") datos.wonAt = new Date();
  if (datos.stage === "PERDIDO") datos.lostAt = new Date();

  const creado = await prisma.crmProspect.create({ data: datos as any });
  return { ok: true, datos: aDTO(creado, 0), mensaje: `"${creado.name}" quedó en la lista.` };
}

export async function crmActualizar(
  id: string,
  entrada: CrmProspectoEntrada & { tags?: string[] | string },
): Promise<CrmResultado<CrmProspectoDTO>> {
  if (!id) return { ok: false, error: "Falta el prospecto." };

  const actual = await prisma.crmProspect.findUnique({ where: { id } });
  if (!actual) return { ok: false, error: "Ese prospecto ya no existe." };

  // Se valida la MEZCLA, no sólo lo que llegó: un formulario parcial que
  // borra el nombre tiene que fallar aquí, no dejar una fila sin nombre.
  //
  // `nextActionAt` se toma SÓLO de lo que llegó del formulario: en la fila
  // guardada es un Date y el validador espera el texto "YYYY-MM-DD" de un
  // <input type="date">, así que mezclarlo daría "fecha inválida" en cada
  // guardado que no toque el próximo paso.
  const invalido = crmValidarProspecto({
    ...(actual as any),
    ...entrada,
    stage: entrada.stage ?? actual.stage,
    nextActionAt: entrada.nextActionAt ?? null,
  });
  if (invalido) return { ok: false, error: invalido };

  const datos = aColumnas(entrada);
  // La ETAPA no se cambia por aquí aunque alguien la mande: tiene su propia
  // acción, que además escribe la bitácora y las fechas de cierre (ver
  // crmMoverEtapa).
  delete datos.stage;

  const guardado = await prisma.crmProspect.update({ where: { id }, data: datos as any });
  return { ok: true, datos: aDTO(guardado), mensaje: "Guardado." };
}

export async function crmEliminar(id: string): Promise<CrmResultado> {
  if (!id) return { ok: false, error: "Falta el prospecto." };
  const p = await prisma.crmProspect.findUnique({ where: { id }, select: { name: true } });
  if (!p) return { ok: false, error: "Ese prospecto ya no existe." };
  // La bitácora se va con él (onDelete: Cascade en el esquema).
  await prisma.crmProspect.delete({ where: { id } });
  return { ok: true, mensaje: `Se eliminó "${p.name}" y su bitácora.` };
}

/**
 * Mueve de etapa, deja constancia y acomoda las fechas de cierre. Es el
 * ÚNICO camino para cambiar `stage`: si la pantalla pudiera escribirlo
 * directo, el tablero avanzaría sin que quede rastro de cuándo ni por qué.
 */
export async function crmMoverEtapa(
  id: string,
  etapa: string,
  autorEmail: string | null,
  opciones?: { nota?: string | null; motivoPerdida?: string | null; automatico?: boolean },
): Promise<CrmResultado<CrmProspectoDTO>> {
  if (!id) return { ok: false, error: "Falta el prospecto." };
  if (!crmEsEtapa(etapa)) return { ok: false, error: "Esa etapa no existe en el catálogo." };

  const actual = await prisma.crmProspect.findUnique({ where: { id } });
  if (!actual) return { ok: false, error: "Ese prospecto ya no existe." };
  if (actual.stage === etapa) return { ok: true, datos: aDTO(actual), mensaje: "Ya estaba en esa etapa." };

  const ahora = new Date();
  const datos: Record<string, any> = { stage: etapa };

  if (etapa === "GANADO") {
    datos.wonAt = actual.wonAt ?? ahora;
    datos.lostAt = null;
    datos.lostReason = null;
  } else if (etapa === "PERDIDO") {
    datos.lostAt = actual.lostAt ?? ahora;
    datos.wonAt = null;
    if (opciones?.motivoPerdida !== undefined) {
      datos.lostReason = crmTextoOpcional(opciones.motivoPerdida, 300);
    }
  } else {
    // Vuelve a estar vivo: se le quitan las fechas de cierre para que no
    // siga contando como ganado o perdido en el resumen.
    datos.wonAt = null;
    datos.lostAt = null;
  }

  // Regla 3: cerrado ya no tiene próximo paso.
  if (etapa === "GANADO" || etapa === "PERDIDO") {
    datos.nextActionAt = null;
    datos.nextActionNote = null;
  }

  const [guardado] = await prisma.$transaction([
    prisma.crmProspect.update({ where: { id }, data: datos as any }),
    prisma.crmActivity.create({
      data: {
        prospectId: id,
        kind: "ETAPA",
        stageFrom: actual.stage,
        stageTo: etapa,
        body: crmTextoOpcional(
          opciones?.nota ??
            (opciones?.automatico ? "Se movió solo al registrar el primer contacto." : null),
          500,
        ),
        happenedAt: ahora,
        authorEmail: autorEmail ?? null,
      },
    }),
  ]);

  return { ok: true, datos: aDTO(guardado), mensaje: "Etapa actualizada." };
}

export interface CrmActividadEntrada {
  kind: string;
  body?: string | null;
  outcome?: string | null;
  /** Fecha de calendario ("2026-09-15") para registrar algo de días atrás. */
  fecha?: string | null;
}

/**
 * Anota algo en la bitácora. Devuelve también si el prospecto CAMBIÓ de
 * etapa solo (regla 1), para que la pantalla lo pueda decir en vez de que
 * la tarjeta se mueva sin explicación.
 */
export async function crmRegistrarActividad(
  prospectId: string,
  entrada: CrmActividadEntrada,
  autorEmail: string | null,
): Promise<CrmResultado<{ actividad: CrmActividadDTO; etapaNueva: string | null }>> {
  if (!prospectId) return { ok: false, error: "Falta el prospecto." };
  if (!crmEsActividad(entrada?.kind) || entrada.kind === "ETAPA") {
    return { ok: false, error: "Ese tipo de anotación no existe." };
  }
  if (entrada.outcome && !crmEsResultado(entrada.outcome)) {
    return { ok: false, error: "Ese resultado no existe en el catálogo." };
  }

  const actual = await prisma.crmProspect.findUnique({ where: { id: prospectId } });
  if (!actual) return { ok: false, error: "Ese prospecto ya no existe." };

  // Sin fecha = ahora. Con fecha = mediodía UTC de ese día, y nunca en el
  // futuro: la bitácora registra lo que YA pasó.
  const ahora = new Date();
  const elegida = crmFechaDeCalendario(entrada.fecha);
  const happenedAt = elegida && elegida.getTime() < ahora.getTime() ? elegida : ahora;

  const cuenta = crmActividadCuentaComoContacto(entrada.kind);
  const datosProspecto: Record<string, any> = {};

  // Regla 2: `lastContactAt` se queda con el contacto MÁS RECIENTE.
  if (cuenta && (!actual.lastContactAt || happenedAt.getTime() > actual.lastContactAt.getTime())) {
    datosProspecto.lastContactAt = happenedAt;
  }

  // Regla 1: un contacto saca al prospecto de "Sin contactar".
  const debeAvanzar = cuenta && actual.stage === "NUEVO";

  // La anotación y el `lastContactAt` van JUNTOS: media escritura dejaría
  // un prospecto que dice "contactado hace 5 minutos" sin nada anotado, o
  // al revés.
  const escrituras: any[] = [
    prisma.crmActivity.create({
      data: {
        prospectId,
        kind: entrada.kind,
        body: crmTextoOpcional(entrada.body),
        outcome: entrada.outcome || null,
        happenedAt,
        authorEmail: autorEmail ?? null,
      },
    }),
  ];
  if (Object.keys(datosProspecto).length > 0) {
    escrituras.push(
      prisma.crmProspect.update({ where: { id: prospectId }, data: datosProspecto as any }),
    );
  }
  const [actividad] = await prisma.$transaction(escrituras);

  let etapaNueva: string | null = null;
  if (debeAvanzar) {
    const movido = await crmMoverEtapa(prospectId, "CONTACTADO", autorEmail, { automatico: true });
    if (movido.ok) etapaNueva = "CONTACTADO";
  }

  return { ok: true, datos: { actividad: actividadDTO(actividad), etapaNueva }, mensaje: "Anotado." };
}

/** Pone (o quita, con fecha vacía) el próximo paso y su recordatorio. */
export async function crmProgramarSeguimiento(
  id: string,
  fecha: string | null,
  nota: string | null,
): Promise<CrmResultado<CrmProspectoDTO>> {
  if (!id) return { ok: false, error: "Falta el prospecto." };
  const cuando = fecha ? crmFechaDeCalendario(fecha) : null;
  if (fecha && !cuando) return { ok: false, error: "La fecha del próximo paso no es válida." };

  const actual = await prisma.crmProspect.findUnique({ where: { id }, select: { id: true, stage: true } });
  if (!actual) return { ok: false, error: "Ese prospecto ya no existe." };
  if (cuando && crmEtapaEsTerminal(actual.stage)) {
    return { ok: false, error: "Este prospecto ya está cerrado. Reábrelo antes de agendarle algo." };
  }

  const guardado = await prisma.crmProspect.update({
    where: { id },
    data: { nextActionAt: cuando, nextActionNote: crmTextoOpcional(nota, 500) },
  });
  return {
    ok: true,
    datos: aDTO(guardado),
    mensaje: cuando ? "Próximo paso agendado." : "Se quitó el próximo paso.",
  };
}

// ── Importación ─────────────────────────────────────────────────────────

export interface CrmImportResumen {
  creados: number;
  repetidos: number;
  /** Nombres que ya existían, para decirlos por su nombre y no en un número. */
  ejemplosRepetidos: string[];
}

/**
 * Da de alta lo que se pegó. Lo importante es lo que NO hace: no pisa nada.
 * Un prospecto que ya está en la lista se cuenta como repetido y se deja
 * intacto — una importación no puede borrar la bitácora ni la etapa de algo
 * que ya se estaba trabajando.
 *
 * "Repetido" = mismo teléfono (por dígitos, no por cómo se escribió) o
 * mismo nombre normalizado.
 */
export async function crmImportar(
  filas: CrmFilaImportada[],
  comunes: { vertical?: string; source?: string; stage?: string },
  autorEmail: string | null,
): Promise<CrmResultado<CrmImportResumen>> {
  const lista = (filas ?? []).slice(0, CRM_IMPORT_MAX).filter((f) => f && String(f.name ?? "").trim());
  if (lista.length === 0) return { ok: false, error: "No hay nada que importar." };

  const vertical = crmEsVertical(comunes?.vertical) ? comunes.vertical : "DENTAL";
  const source = crmEsFuente(comunes?.source) ? comunes.source : null;
  const stage = crmEsEtapa(comunes?.stage) ? comunes.stage : "NUEVO";

  const existentes = await prisma.crmProspect.findMany({ select: { name: true, phone: true } });
  const nombres = new Set(existentes.map((e) => normalizarNombre(e.name)));
  const telefonos = new Set(
    existentes.map((e) => soloDigitos(e.phone)).filter((d): d is string => !!d),
  );

  const aCrear: Record<string, any>[] = [];
  const ejemplosRepetidos: string[] = [];
  let repetidos = 0;

  for (const fila of lista) {
    const nombre = String(fila.name).trim().slice(0, CRM_NOMBRE_MAX);
    const claveNombre = normalizarNombre(nombre);
    const claveTel = soloDigitos(fila.phone);

    if (nombres.has(claveNombre) || (claveTel && telefonos.has(claveTel))) {
      repetidos += 1;
      if (ejemplosRepetidos.length < 5) ejemplosRepetidos.push(nombre);
      continue;
    }
    nombres.add(claveNombre);
    if (claveTel) telefonos.add(claveTel);

    aCrear.push({
      name: nombre,
      vertical,
      stage,
      source,
      contactName: crmTextoOpcional(fila.contactName, 120),
      phone: crmTextoOpcional(fila.phone, 40),
      email: crmTextoOpcional(fila.email, 160),
      city: crmTextoOpcional(fila.city, 80),
      notes: crmTextoOpcional(fila.notes),
      createdByEmail: autorEmail ?? null,
    });
  }

  if (aCrear.length > 0) {
    await prisma.crmProspect.createMany({ data: aCrear as any });
  }

  return {
    ok: true,
    datos: { creados: aCrear.length, repetidos, ejemplosRepetidos },
    mensaje:
      aCrear.length === 0
        ? "Ya estaban todos en la lista; no se dio de alta ninguno."
        : `Se dieron de alta ${aCrear.length} ${aCrear.length === 1 ? "prospecto" : "prospectos"}.` +
          (repetidos > 0 ? ` ${repetidos} ya estaban y se dejaron como estaban.` : ""),
  };
}

/**
 * Sin acentos, sin puntuación, en minúsculas: la llave con la que se
 * comparan dos nombres al importar. "Clínica Dental Sonrisa" y "clinica
 * dental sonrisa." son el mismo negocio y no se dan de alta dos veces.
 * Reusa el mismo aplanado que el buscador de la pantalla: si compararan
 * distinto, se colaría un duplicado que la búsqueda sí encuentra.
 */
function normalizarNombre(v: string | null | undefined): string {
  return crmTextoPlano(v)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function soloDigitos(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.slice(-10);
}
