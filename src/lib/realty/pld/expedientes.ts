// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PLD — LOS EXPEDIENTES (lectura y escritura).
//
// 🔴 AISLAMIENTO. Toda consulta de este archivo lleva `accountId:
// ctx.accountId` en el `where`, y el accountId sale SIEMPRE del contexto de
// sesión, nunca del body ni del query. Ojo con Prisma: un `undefined` en un
// campo del where BORRA el filtro y devuelve la tabla entera de todos los
// inquilinos. Por eso los filtros opcionales se arman a mano y nunca con
// `campo: valor ?? undefined`.
//
// 🔴 LAS ESCRITURAS NO USAN `update({ where: { id } })` A SECAS. Un id de
// otra cuenta pasaría el filtro. Se usa `updateMany` con accountId en el
// where —que devuelve `count: 0` si la fila no era tuya— o se comprueba la
// pertenencia ANTES. Es la diferencia entre "no encontrado" y "acabo de
// editar el expediente de otra inmobiliaria".
//
// El ESTADO del expediente (incompleto / completo / vencido) y el RIESGO se
// CALCULAN aquí a partir de umbrales.ts. Ninguno se lee de una columna: la
// columna `risk` existe solo para poder ordenar y filtrar en SQL, y se
// reescribe cada vez que el expediente cambia.
// ═══════════════════════════════════════════════════════════════════════
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RealtyContext } from "@/lib/realty-auth";
import type {
  BeneficiarioControlador,
  DocumentoRow,
  ExpedienteRow,
  PldDocKind,
  PldPepKind,
  PldPersonKind,
} from "./contrato";
import {
  estadoDeExpediente,
  riesgoDeExpediente,
  sumarAnios,
  type PldParams,
} from "./umbrales";

// ── Lectura ────────────────────────────────────────────────────────────

/**
 * Los campos que salen del expediente. LISTA BLANCA explícita y no un
 * `include` a secas: el día que alguien agregue una columna al modelo, esa
 * columna NO se va sola al navegador (ver la fuga de la fila completa de
 * Clinic). Aquí no hay credenciales, pero sí datos personales de terceros.
 */
const SELECT_EXPEDIENTE = {
  id: true,
  contactId: true,
  personKind: true,
  rfc: true,
  curp: true,
  birthDate: true,
  nationality: true,
  occupation: true,
  address: true,
  pep: true,
  pepDetail: true,
  pepAskedAt: true,
  beneficialOwners: true,
  risk: true,
  riskNote: true,
  reviewedAt: true,
  reviewedByName: true,
  notes: true,
  updatedAt: true,
  contact: { select: { id: true, name: true, phone: true } },
  documents: {
    select: {
      id: true,
      kind: true,
      name: true,
      bytes: true,
      issuedAt: true,
      expiresAt: true,
      retainUntil: true,
      archivedAt: true,
      uploadedByName: true,
      createdAt: true,
    },
    orderBy: [{ archivedAt: "asc" }, { createdAt: "desc" }],
  },
} satisfies Prisma.RealtyPldFileSelect;

type FilaExpediente = Prisma.RealtyPldFileGetPayload<{ select: typeof SELECT_EXPEDIENTE }>;

/**
 * El Json de beneficiarios, saneado. Lo que hay en la columna es lo que
 * alguien mandó por la API hace meses: se vuelve a validar al LEER, no solo
 * al escribir. Una fila vieja con otra forma no puede tumbar la pantalla.
 */
export function leerBeneficiarios(raw: Prisma.JsonValue | null): BeneficiarioControlador[] {
  if (!Array.isArray(raw)) return [];
  const out: BeneficiarioControlador[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) continue;
    out.push({
      name: name.slice(0, 160),
      rfc: typeof o.rfc === "string" ? o.rfc.trim().slice(0, 20) || null : null,
      curp: typeof o.curp === "string" ? o.curp.trim().slice(0, 20) || null : null,
      pct:
        typeof o.pct === "number" && Number.isFinite(o.pct)
          ? Math.min(100, Math.max(0, o.pct))
          : null,
      pep: esPepKind(o.pep) ? o.pep : null,
    });
    if (out.length >= 20) break;
  }
  return out;
}

const PEP_KINDS: PldPepKind[] = ["NO", "PEP", "FAMILIAR", "ASOCIADO"];
function esPepKind(v: unknown): v is PldPepKind {
  return typeof v === "string" && (PEP_KINDS as string[]).includes(v);
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Convierte una fila en el renglón que consume la pantalla, con el estado y
 * el riesgo YA calculados.
 *
 * `rebasaUmbral` y `efectivoProhibido` los aporta quien llama: dependen de
 * las OPERACIONES de esa persona, que este archivo no consulta. Cuando no
 * se saben (una lista sin operaciones cargadas) van en false y el riesgo
 * pintado es el del expediente solo — nunca se inventa una alerta.
 */
export function armarExpediente(
  f: FilaExpediente,
  senales: { rebasaUmbral: boolean; efectivoProhibido: boolean },
  hoy: Date,
): ExpedienteRow {
  const beneficiarios = leerBeneficiarios(f.beneficialOwners);
  const documentos = f.documents;

  const calc = estadoDeExpediente(
    {
      personKind: f.personKind,
      rfc: f.rfc,
      curp: f.curp,
      occupation: f.occupation,
      address: f.address,
      pep: f.pep,
      pepAskedAt: f.pepAskedAt,
      beneficialOwnersCount: beneficiarios.length,
    },
    documentos.map((d) => ({
      kind: d.kind,
      expiresAt: d.expiresAt,
      archivedAt: d.archivedAt,
    })),
    hoy,
  );

  const riesgo = riesgoDeExpediente({
    pep: f.pep,
    estado: calc.estado,
    rebasaUmbral: senales.rebasaUmbral,
    efectivoProhibido: senales.efectivoProhibido,
  });

  const docs: DocumentoRow[] = documentos.map((d) => ({
    id: d.id,
    kind: d.kind,
    name: d.name,
    bytes: d.bytes,
    issuedAt: iso(d.issuedAt),
    expiresAt: iso(d.expiresAt),
    retainUntil: d.retainUntil.toISOString(),
    archivedAt: iso(d.archivedAt),
    uploadedByName: d.uploadedByName,
    createdAt: d.createdAt.toISOString(),
    vencido: !!d.expiresAt && d.expiresAt.getTime() < hoy.getTime(),
    puedeBorrarse: d.retainUntil.getTime() < hoy.getTime(),
  }));

  return {
    id: f.id,
    contactId: f.contactId,
    contactName: f.contact.name,
    contactPhone: f.contact.phone,
    personKind: f.personKind,
    rfc: f.rfc,
    curp: f.curp,
    birthDate: iso(f.birthDate),
    nationality: f.nationality,
    occupation: f.occupation,
    address: f.address,
    pep: f.pep,
    pepDetail: f.pepDetail,
    pepAskedAt: iso(f.pepAskedAt),
    beneficialOwners: beneficiarios,
    // El riesgo que se PINTA es el recién calculado, no el de la columna: la
    // columna puede venir de antes de que subieran el último papel.
    risk: riesgo.risk,
    riskNote: f.riskNote,
    reviewedAt: iso(f.reviewedAt),
    reviewedByName: f.reviewedByName,
    notes: f.notes,
    updatedAt: f.updatedAt.toISOString(),
    documents: docs,
    estado: calc.estado,
    faltantes: calc.faltantes,
    vencidos: calc.vencidos,
    motivosRiesgo: riesgo.motivos,
  };
}

export interface SenalesPorContacto {
  /** contactId → tiene alguna operación por encima del umbral. */
  rebasa: Set<string>;
  /** contactId → tiene alguna operación con efectivo prohibido. */
  efectivo: Set<string>;
}

/** Todos los expedientes de la cuenta, ordenados por riesgo y actualización. */
export async function listarExpedientes(
  ctx: RealtyContext,
  senales: SenalesPorContacto,
  hoy: Date,
): Promise<ExpedienteRow[]> {
  const filas = await prisma.realtyPldFile.findMany({
    where: { accountId: ctx.accountId },
    select: SELECT_EXPEDIENTE,
    orderBy: [{ updatedAt: "desc" }],
    take: 400,
  });
  return filas.map((f) =>
    armarExpediente(
      f,
      {
        rebasaUmbral: senales.rebasa.has(f.contactId),
        efectivoProhibido: senales.efectivo.has(f.contactId),
      },
      hoy,
    ),
  );
}

/** Un expediente por su id, SIEMPRE recortado a la cuenta. */
export async function leerExpediente(
  ctx: RealtyContext,
  fileId: string,
  senales: { rebasaUmbral: boolean; efectivoProhibido: boolean },
  hoy: Date,
): Promise<ExpedienteRow | null> {
  const f = await prisma.realtyPldFile.findFirst({
    where: { id: fileId, accountId: ctx.accountId },
    select: SELECT_EXPEDIENTE,
  });
  return f ? armarExpediente(f, senales, hoy) : null;
}

// ── Escritura ──────────────────────────────────────────────────────────

/** Lo que la API acepta capturar. Ni un campo más: nunca un spread del body. */
export interface ParcheExpediente {
  personKind?: PldPersonKind;
  rfc?: string | null;
  curp?: string | null;
  birthDate?: string | null;
  nationality?: string | null;
  occupation?: string | null;
  address?: string | null;
  pep?: PldPepKind;
  pepDetail?: string | null;
  beneficialOwners?: BeneficiarioControlador[];
  notes?: string | null;
}

const PERSON_KINDS: PldPersonKind[] = ["FISICA", "MORAL", "FIDEICOMISO"];

function limpiar(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Valida el body de la API. Devuelve el parche o un mensaje de error.
 *
 * `undefined` (la llave no vino) y `null` (la llave vino vacía) NO son lo
 * mismo: lo primero deja el campo como estaba, lo segundo lo BORRA. Un
 * formulario que manda solo lo que cambió tiene que poder vaciar un campo.
 */
export function parsearParcheExpediente(
  body: Record<string, unknown>,
): { parche: ParcheExpediente } | { error: string } {
  const parche: ParcheExpediente = {};

  if ("personKind" in body) {
    const pk = body.personKind;
    if (typeof pk !== "string" || !(PERSON_KINDS as string[]).includes(pk)) {
      return { error: "Ese tipo de persona no existe." };
    }
    parche.personKind = pk as PldPersonKind;
  }
  if ("pep" in body) {
    if (!esPepKind(body.pep)) return { error: "Esa respuesta del cuestionario PEP no existe." };
    parche.pep = body.pep;
  }
  if ("rfc" in body) parche.rfc = limpiar(body.rfc, 20);
  if ("curp" in body) parche.curp = limpiar(body.curp, 20);
  if ("nationality" in body) parche.nationality = limpiar(body.nationality, 60);
  if ("occupation" in body) parche.occupation = limpiar(body.occupation, 160);
  if ("address" in body) parche.address = limpiar(body.address, 400);
  if ("pepDetail" in body) parche.pepDetail = limpiar(body.pepDetail, 800);
  if ("notes" in body) parche.notes = limpiar(body.notes, 2000);

  if ("birthDate" in body) {
    const raw = body.birthDate;
    if (raw === null || raw === "") {
      parche.birthDate = null;
    } else if (typeof raw === "string" && !Number.isNaN(Date.parse(raw))) {
      parche.birthDate = raw;
    } else {
      return { error: "Esa fecha de nacimiento no se entiende." };
    }
  }

  if ("beneficialOwners" in body) {
    // Se sanea con el MISMO lector que usa la lectura: una sola definición
    // de qué es un beneficiario válido, no dos que se separen con el tiempo.
    parche.beneficialOwners = leerBeneficiarios(
      (body.beneficialOwners ?? null) as Prisma.JsonValue,
    );
  }

  return { parche };
}

function datosDelParche(
  parche: ParcheExpediente,
  ctx: RealtyContext,
  nombreUsuario: string,
): Prisma.RealtyPldFileUncheckedUpdateInput {
  const data: Prisma.RealtyPldFileUncheckedUpdateInput = {
    reviewedAt: new Date(),
    reviewedById: ctx.realtyUserId,
    reviewedByName: nombreUsuario,
  };
  if (parche.personKind !== undefined) data.personKind = parche.personKind;
  if (parche.rfc !== undefined) data.rfc = parche.rfc;
  if (parche.curp !== undefined) data.curp = parche.curp;
  if (parche.nationality !== undefined) data.nationality = parche.nationality;
  if (parche.occupation !== undefined) data.occupation = parche.occupation;
  if (parche.address !== undefined) data.address = parche.address;
  if (parche.notes !== undefined) data.notes = parche.notes;
  if (parche.birthDate !== undefined) {
    data.birthDate = parche.birthDate ? new Date(parche.birthDate) : null;
  }
  if (parche.beneficialOwners !== undefined) {
    // 🔴 Json + null en Prisma: `null` a secas es JsonNull (el valor JSON
    // `null` DENTRO de la columna) y no vacía nada. Para vaciar de verdad
    // hay que escribir un arreglo vacío, que además es lo que la lectura
    // espera encontrar.
    data.beneficialOwners = parche.beneficialOwners as unknown as Prisma.InputJsonValue;
  }
  if (parche.pep !== undefined) {
    data.pep = parche.pep;
    // Contestar el cuestionario es lo que sella la fecha. Sin este sello,
    // estadoDeExpediente() no da el expediente por integrado — y "NO" por
    // omisión no puede valer como "NO" declarado.
    data.pepAskedAt = new Date();
  }
  if (parche.pepDetail !== undefined) data.pepDetail = parche.pepDetail;
  return data;
}

/**
 * Crea el expediente de un contacto si no existía, o le aplica el parche.
 *
 * 🔴 El `contactId` se comprueba contra la cuenta ANTES de escribir: sin
 * eso, un id de otra inmobiliaria crearía aquí un expediente que apunta a
 * su contacto. La unicidad (accountId, contactId) hace el resto.
 */
export async function guardarExpediente(
  ctx: RealtyContext,
  contactId: string,
  parche: ParcheExpediente,
  nombreUsuario: string,
): Promise<{ id: string } | { error: string }> {
  const contacto = await prisma.realtyContact.findFirst({
    where: { id: contactId, accountId: ctx.accountId },
    select: { id: true },
  });
  if (!contacto) return { error: "Ese contacto ya no existe." };

  const existente = await prisma.realtyPldFile.findFirst({
    where: { accountId: ctx.accountId, contactId },
    select: { id: true },
  });

  const nombre = nombreUsuario;
  if (existente) {
    // updateMany con accountId, no update por id: defensa en profundidad.
    await prisma.realtyPldFile.updateMany({
      where: { id: existente.id, accountId: ctx.accountId },
      data: datosDelParche(parche, ctx, nombre) as Prisma.RealtyPldFileUpdateManyMutationInput,
    });
    await recalcularRiesgo(ctx, existente.id);
    return { id: existente.id };
  }

  const creado = await prisma.realtyPldFile.create({
    data: {
      accountId: ctx.accountId,
      contactId,
      personKind: parche.personKind ?? "FISICA",
      rfc: parche.rfc ?? null,
      curp: parche.curp ?? null,
      birthDate: parche.birthDate ? new Date(parche.birthDate) : null,
      nationality: parche.nationality ?? null,
      occupation: parche.occupation ?? null,
      address: parche.address ?? null,
      pep: parche.pep ?? "NO",
      pepDetail: parche.pepDetail ?? null,
      // Solo se sella si el cuestionario vino en el alta. Un expediente
      // creado desde el tablero, sin preguntar nada, nace SIN sello.
      pepAskedAt: parche.pep !== undefined ? new Date() : null,
      beneficialOwners: (parche.beneficialOwners ?? []) as unknown as Prisma.InputJsonValue,
      notes: parche.notes ?? null,
      reviewedAt: new Date(),
      reviewedById: ctx.realtyUserId,
      reviewedByName: nombre,
    },
    select: { id: true },
  });
  await recalcularRiesgo(ctx, creado.id);
  return { id: creado.id };
}

/**
 * Reescribe la columna `risk` a partir de lo que hay ahora.
 *
 * La columna existe para ORDENAR y CONTAR en SQL (un tablero que tuviera
 * que traerse los 400 expedientes para contar los de riesgo alto no
 * escala). La verdad que se PINTA siempre se recalcula al leer, así que una
 * columna que se quedara vieja no engaña a nadie en pantalla — pero sí
 * ensuciaría los conteos, y por eso se refresca en cada escritura.
 *
 * Las señales de operaciones NO entran aquí: son caras de consultar y
 * cambian por su cuenta. La columna guarda el riesgo del EXPEDIENTE; el
 * tablero suma las señales encima.
 */
export async function recalcularRiesgo(ctx: RealtyContext, fileId: string): Promise<void> {
  try {
    const f = await prisma.realtyPldFile.findFirst({
      where: { id: fileId, accountId: ctx.accountId },
      select: {
        personKind: true,
        rfc: true,
        curp: true,
        occupation: true,
        address: true,
        pep: true,
        pepAskedAt: true,
        beneficialOwners: true,
        documents: { select: { kind: true, expiresAt: true, archivedAt: true } },
      },
    });
    if (!f) return;
    const calc = estadoDeExpediente(
      {
        personKind: f.personKind,
        rfc: f.rfc,
        curp: f.curp,
        occupation: f.occupation,
        address: f.address,
        pep: f.pep,
        pepAskedAt: f.pepAskedAt,
        beneficialOwnersCount: leerBeneficiarios(f.beneficialOwners).length,
      },
      f.documents,
      new Date(),
    );
    const riesgo = riesgoDeExpediente({
      pep: f.pep,
      estado: calc.estado,
      rebasaUmbral: false,
      efectivoProhibido: false,
    });
    await prisma.realtyPldFile.updateMany({
      where: { id: fileId, accountId: ctx.accountId },
      data: { risk: riesgo.risk, riskNote: riesgo.motivos.join(" ") },
    });
  } catch (e) {
    // El riesgo pintado se recalcula al leer, así que fallar aquí degrada
    // los conteos del tablero, no la verdad de la pantalla.
    console.error("[realty-pld] no se pudo recalcular el riesgo:", e);
  }
}

// ── Documentos del expediente ──────────────────────────────────────────

export const PLD_DOC_KINDS: PldDocKind[] = [
  "IDENTIFICACION",
  "COMPROBANTE_DOMICILIO",
  "CONSTANCIA_FISCAL",
  "CURP",
  "ACTA_CONSTITUTIVA",
  "PODER",
  "BENEFICIARIO_CONTROLADOR",
  "OTRO",
];

/**
 * Hasta cuándo hay que conservar un papel que se sube HOY.
 *
 * 🔴 El plazo sale del parámetro, no de un 10 escrito aquí. Si el parámetro
 * no está capturado, se devuelve null y quien llama DEBE rechazar la
 * subida: guardar un papel sin saber cuánto hay que conservarlo es peor que
 * no guardarlo, porque la UI creería que puede borrarlo.
 */
export function calcularConservacion(params: PldParams | null, desde: Date): Date | null {
  if (!params) return null;
  return sumarAnios(desde, params.aniosConservacion);
}

/**
 * Vigencia por omisión de un papel según su tipo.
 *
 * Solo el comprobante de domicilio caduca solo, y su plazo también sale del
 * parámetro. Los demás no llevan vencimiento automático: una credencial
 * trae su propia fecha impresa y la captura la persona.
 */
export function vigenciaPorOmision(
  kind: PldDocKind,
  params: PldParams | null,
  issuedAt: Date | null,
): Date | null {
  if (kind !== "COMPROBANTE_DOMICILIO" || !params || !issuedAt) return null;
  const out = new Date(issuedAt.getTime());
  out.setUTCMonth(out.getUTCMonth() + params.mesesVigenciaComprobante);
  return out;
}
