// ═══════════════════════════════════════════════════════════════════════
// EL CRM VISTO POR UN AFILIADO — /afiliados/crm.
//
// Los socios recomiendan clínicas, universidades y demás negocios; lo que
// dan de alta aquí cae en la MISMA tabla que usa DaleControl en /admin/crm,
// marcado con su `affiliateId`. No hay una libreta paralela: si la hubiera,
// el equipo de ventas tendría que ir a buscarla, y las recomendaciones se
// quedarían ahí muriéndose.
//
// 🔴 LA REGLA DURA DE ESTE ARCHIVO: `affiliateId` SIEMPRE es el primer
// argumento y SIEMPRE sale de la sesión (`getAffiliateContext`), jamás del
// cuerpo de una petición. Toda consulta lo lleva en el `where`, y
// `assertAffiliateId` truena ANTES de tocar la base — en Prisma un
// `affiliateId: undefined` no filtra: BORRA el filtro y devuelve los
// prospectos de todos los socios. Es la misma guarda que
// src/lib/realty/leads.ts.
//
// ── LO QUE EL SOCIO NO VE, A PROPÓSITO ────────────────────────────────
// El DTO de aquí es un SUBCONJUNTO estrecho de la fila. Fuera quedan el
// valor mensual estimado, el próximo paso, la fecha del último contacto,
// el motivo de pérdida y la bitácora entera: son la conversación comercial
// de DaleControl. Lo que sí ve es lo que él capturó, más UN estado
// resumido en cuatro palabras (ver `crmEstadoParaAfiliado`). Recortar en
// el componente no sirve: lo que viaja en el payload del servidor ya está
// en el navegador de quien lo pida.
//
// La excepción es `notes`: son las notas que él mismo escribió y las
// comparte con DaleControl. Lo interno del equipo va a la BITÁCORA, que
// ningún socio puede leer.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import {
  crmEsVertical,
  crmEtapa,
  crmTextoOpcional,
  crmTextoPlano,
  crmValidarProspecto,
  CRM_NOMBRE_MAX,
} from "@/lib/admin/crm/crm-core";

/** Tope de filas que ve un socio de una sentada. Nadie recomienda tantas. */
export const CRM_AFILIADO_MAX = 500;

/**
 * Sólo estos campos escribe un socio. El resto de la fila (etapa, valor,
 * seguimiento, etiquetas) lo maneja DaleControl. La lista está aquí y no
 * en la pantalla porque es una regla de acceso, no de diseño.
 */
export interface CrmAfiliadoEntrada {
  name?: string | null;
  vertical?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  website?: string | null;
  contactName?: string | null;
  notes?: string | null;
}

export interface CrmProspectoAfiliadoDTO {
  id: string;
  name: string;
  vertical: string;
  /** La etapa CRUDA. La pantalla la traduce con `crmEstadoParaAfiliado`. */
  stage: string;
  city: string | null;
  country: string | null;
  phone: string | null;
  website: string | null;
  contactName: string | null;
  notes: string | null;
  createdAt: string;
}

/** Las únicas columnas que salen de la base para un socio. */
const SELECT_AFILIADO = {
  id: true,
  name: true,
  vertical: true,
  stage: true,
  city: true,
  country: true,
  phone: true,
  website: true,
  contactName: true,
  notes: true,
  createdAt: true,
} as const;

export interface CrmAfiliadoResultado<T = undefined> {
  ok: boolean;
  error?: string;
  mensaje?: string;
  datos?: T;
}

/**
 * Un affiliateId vacío o undefined en un `where` de Prisma NO filtra:
 * devuelve TODO. Cortar aquí convierte una fuga entre socios en un error
 * ruidoso que se ve en los logs.
 */
function assertAffiliateId(affiliateId: string): string {
  if (!affiliateId || typeof affiliateId !== "string") {
    throw new Error("afiliados/crm: falta el affiliateId — la consulta habría cruzado socios");
  }
  return affiliateId;
}

function aDTO(p: any): CrmProspectoAfiliadoDTO {
  return {
    id: p.id,
    name: p.name,
    vertical: p.vertical,
    stage: p.stage,
    city: p.city ?? null,
    country: p.country ?? null,
    phone: p.phone ?? null,
    website: p.website ?? null,
    contactName: p.contactName ?? null,
    notes: p.notes ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

// ── Lectura ─────────────────────────────────────────────────────────────

export interface CrmAfiliadoListado {
  filas: CrmProspectoAfiliadoDTO[];
  total: number;
  truncado: boolean;
  /** Cuántos de los suyos ya son clientes: es de lo que cobra. */
  ganados: number;
  /** Los que siguen vivos (ni ganados ni perdidos). */
  enProceso: number;
}

export async function crmAfiliadoListar(affiliateId: string): Promise<CrmAfiliadoListado> {
  const id = assertAffiliateId(affiliateId);
  const [total, filas] = await Promise.all([
    prisma.crmProspect.count({ where: { affiliateId: id } }),
    prisma.crmProspect.findMany({
      where: { affiliateId: id },
      orderBy: { createdAt: "desc" },
      take: CRM_AFILIADO_MAX,
      select: SELECT_AFILIADO,
    }),
  ]);

  // Los conteos se sacan de lo que ya se trajo cuando cabe entero; si la
  // lista está cortada se preguntan a la base, para no enseñar un número
  // que sólo cuenta las primeras 500.
  let ganados: number;
  let enProceso: number;
  if (total <= filas.length) {
    ganados = filas.filter((f) => f.stage === "GANADO").length;
    enProceso = filas.filter((f) => !crmEtapa(f.stage).terminal).length;
  } else {
    [ganados, enProceso] = await Promise.all([
      prisma.crmProspect.count({ where: { affiliateId: id, stage: "GANADO" } }),
      prisma.crmProspect.count({
        where: { affiliateId: id, stage: { notIn: ["GANADO", "PERDIDO"] } },
      }),
    ]);
  }

  return {
    filas: filas.map(aDTO),
    total,
    truncado: total > filas.length,
    ganados,
    enProceso,
  };
}

// ── Escritura ───────────────────────────────────────────────────────────

function aColumnas(entrada: CrmAfiliadoEntrada): Record<string, any> {
  const datos: Record<string, any> = {};
  if (entrada.name !== undefined) datos.name = String(entrada.name).trim().slice(0, CRM_NOMBRE_MAX);
  if (entrada.vertical !== undefined) {
    datos.vertical = crmEsVertical(entrada.vertical) ? entrada.vertical : "OTRO";
  }
  if (entrada.city !== undefined) datos.city = crmTextoOpcional(entrada.city, 80);
  if (entrada.country !== undefined) datos.country = crmTextoOpcional(entrada.country, 80);
  if (entrada.phone !== undefined) datos.phone = crmTextoOpcional(entrada.phone, 40);
  if (entrada.website !== undefined) datos.website = crmTextoOpcional(entrada.website, 300);
  if (entrada.contactName !== undefined) datos.contactName = crmTextoOpcional(entrada.contactName, 120);
  if (entrada.notes !== undefined) datos.notes = crmTextoOpcional(entrada.notes);
  return datos;
}

/** Nombre normalizado: la llave con la que se detecta un repetido. */
function claveNombre(v: string | null | undefined): string {
  return crmTextoPlano(v)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function claveTelefono(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

/**
 * Da de alta una recomendación.
 *
 * 🔴 SI YA ESTABA, NO SE DUPLICA NI SE REASIGNA. Un negocio que ya está en
 * la libreta —lo haya metido DaleControl u otro socio— se rechaza con un
 * mensaje claro. Dos motivos: en un programa de afiliados la recomendación
 * es del primero que llega, y permitir reasignar convertiría este
 * formulario en una forma de robarse comisiones ajenas. El mensaje NO dice
 * quién lo tiene ni en qué etapa va: eso convertiría el alta en una manera
 * de ir adivinando la cartera de DaleControl.
 */
export async function crmAfiliadoCrear(
  affiliateId: string,
  entrada: CrmAfiliadoEntrada,
): Promise<CrmAfiliadoResultado<CrmProspectoAfiliadoDTO>> {
  const id = assertAffiliateId(affiliateId);

  const invalido = crmValidarProspecto(entrada);
  if (invalido) return { ok: false, error: invalido };

  const nombre = String(entrada.name).trim().slice(0, CRM_NOMBRE_MAX);
  const tel = claveTelefono(entrada.phone);

  // El repetido se busca contra TODA la libreta, no sólo contra la del
  // socio: el prospecto es de DaleControl, aunque lo recomiende quien sea.
  //
  // Se traen las dos columnas y se compara en memoria, SIN tope, porque la
  // comparación no se puede hacer en SQL: los nombres hay que aplanarlos
  // (acentos, puntuación) y los teléfonos se guardan tal como se teclearon
  // —"(55) 1234-5678" y "5512345678" son el mismo número y ningún LIKE los
  // empareja. Un tope sería peor que el costo: dejaría pasar el duplicado
  // que está más allá, y un duplicado aquí es una discusión de comisiones.
  // Son dos columnas de texto; con el volumen de esta libreta no pesa.
  const candidatos = await prisma.crmProspect.findMany({
    select: { id: true, name: true, phone: true },
  });
  const clave = claveNombre(nombre);
  const repetido = candidatos.find(
    (c) => claveNombre(c.name) === clave || (tel && claveTelefono(c.phone) === tel),
  );
  if (repetido) {
    return {
      ok: false,
      error:
        "Ese negocio ya está registrado en DaleControl. Si crees que es un error, escríbenos por Soporte.",
    };
  }

  const datos = aColumnas(entrada);
  datos.affiliateId = id;
  // La etapa y la fuente NO las elige el socio: entra sin contactar y con
  // el origen marcado, que es lo que después alimenta las comisiones.
  datos.stage = "NUEVO";
  datos.source = "AFILIADO";
  if (datos.vertical === undefined) datos.vertical = "DENTAL";

  const creado = await prisma.crmProspect.create({ data: datos as any, select: SELECT_AFILIADO });
  return {
    ok: true,
    datos: aDTO(creado),
    mensaje: `Listo: "${creado.name}" ya le llegó al equipo de DaleControl.`,
  };
}

/**
 * Corrige los datos de una recomendación SUYA. El `where` lleva las dos
 * llaves (id + affiliateId) en la misma consulta: así, el id de otro socio
 * no encuentra nada en vez de encontrar y luego comprobar.
 */
export async function crmAfiliadoActualizar(
  affiliateId: string,
  prospectId: string,
  entrada: CrmAfiliadoEntrada,
): Promise<CrmAfiliadoResultado<CrmProspectoAfiliadoDTO>> {
  const id = assertAffiliateId(affiliateId);
  if (!prospectId) return { ok: false, error: "Falta el prospecto." };

  const actual = await prisma.crmProspect.findFirst({
    where: { id: prospectId, affiliateId: id },
    select: SELECT_AFILIADO,
  });
  if (!actual) return { ok: false, error: "Esa recomendación no es tuya o ya no existe." };

  const invalido = crmValidarProspecto({ ...(actual as any), ...entrada });
  if (invalido) return { ok: false, error: invalido };

  const guardado = await prisma.crmProspect.update({
    where: { id: prospectId },
    data: aColumnas(entrada) as any,
    select: SELECT_AFILIADO,
  });
  return { ok: true, datos: aDTO(guardado), mensaje: "Guardado." };
}

/**
 * Borrar sólo mientras siga SIN CONTACTAR. Sirve para deshacer un alta
 * recién hecha (el nombre mal escrito, el duplicado propio); en cuanto
 * DaleControl ya movió el prospecto deja de ser posible, porque para
 * entonces hay trabajo del equipo colgando de esa fila y borrarla se
 * llevaría la bitácora entera.
 */
export async function crmAfiliadoEliminar(
  affiliateId: string,
  prospectId: string,
): Promise<CrmAfiliadoResultado> {
  const id = assertAffiliateId(affiliateId);
  if (!prospectId) return { ok: false, error: "Falta el prospecto." };

  const actual = await prisma.crmProspect.findFirst({
    where: { id: prospectId, affiliateId: id },
    select: { id: true, name: true, stage: true },
  });
  if (!actual) return { ok: false, error: "Esa recomendación no es tuya o ya no existe." };
  if (actual.stage !== "NUEVO") {
    return {
      ok: false,
      error: "DaleControl ya empezó a trabajar esta recomendación, así que ya no se puede quitar.",
    };
  }

  await prisma.crmProspect.delete({ where: { id: prospectId } });
  return { ok: true, mensaje: `Se quitó "${actual.name}" de tus recomendaciones.` };
}
