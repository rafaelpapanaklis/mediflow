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
  crmValidarProspecto,
  CRM_IMPORT_MAX,
  CRM_NOMBRE_MAX,
  type CrmFilaImportada,
  type CrmProspectoEntrada,
} from "./crm-core";

/**
 * Tope de filas que se mandan a la pantalla. El tablero necesita TODAS las
 * tarjetas para poder repartirlas por columna, así que no hay paginación:
 * hay tope, y cuando se pasa la pantalla lo dice en voz alta en vez de
 * esconder prospectos. Con la libreta de una persona queda lejísimos.
 */
export const CRM_LISTA_MAX = 2000;

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

export interface CrmListado {
  filas: CrmProspectoDTO[];
  total: number;
  /** true cuando hay más prospectos que `CRM_LISTA_MAX` y la lista se cortó. */
  truncado: boolean;
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
 * Todos los prospectos, los más movidos arriba. El filtrado y la búsqueda
 * los hace la pantalla en memoria a propósito: el tablero ya necesita el
 * conjunto completo para repartirlo por columnas, y buscar en el navegador
 * evita dos trampas conocidas de Prisma — `contains` no escapa los comodines
 * de LIKE y no sabe que "55-1234-5678" y "5512345678" son el mismo número.
 */
export async function crmListar(): Promise<CrmListado> {
  const [total, filas] = await Promise.all([
    prisma.crmProspect.count(),
    prisma.crmProspect.findMany({
      orderBy: { updatedAt: "desc" },
      take: CRM_LISTA_MAX,
    }),
  ]);

  // Cuántas anotaciones tiene cada uno, en UNA consulta. La tarjeta enseña
  // "3 anotaciones" y sin esto serían N consultas para pintar el tablero.
  const conteos = new Map<string, number>();
  if (filas.length > 0) {
    const grupos = await prisma.crmActivity
      .groupBy({
        by: ["prospectId"],
        _count: { _all: true },
        where: { prospectId: { in: filas.map((f) => f.id) } },
      })
      .catch(() => [] as any[]);
    for (const g of grupos as any[]) conteos.set(g.prospectId, g._count?._all ?? 0);
  }

  // Y quién recomendó cada uno. Consulta APARTE (no hay llave foránea) y
  // con su propio catch: que no se pueda leer la tabla de socios no puede
  // dejar sin tablero a DaleControl.
  const socios = await nombresDeAfiliados(filas.map((f) => f.affiliateId));

  return {
    filas: filas.map((f) =>
      aDTO(f, conteos.get(f.id) ?? 0, f.affiliateId ? socios.get(f.affiliateId) ?? null : null),
    ),
    total,
    truncado: total > filas.length,
  };
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
