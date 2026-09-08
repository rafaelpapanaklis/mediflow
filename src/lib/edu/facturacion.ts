/**
 * DaleControl INSTITUCIONAL — FACTURACIÓN CFDI contra la base y contra
 * Facturapi.
 *
 * SERVIDOR: importa prisma y habla por red. No lo importe un componente
 * "use client" (la aritmética y las validaciones puras están en
 * facturacion-core.ts, que sí es client-safe).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * LAS CINCO REGLAS DE ESTE ARCHIVO
 *
 * 1. 🔴 institutionId SIEMPRE del contexto de sesión. Ninguna función de
 *    aquí lo acepta suelto.
 *
 * 2. 🔴 EL ALCANCE ES EL DEL DINERO. Facturar es leer y escribir dinero:
 *    se pasa por `eduVisibility(ctx, "charges")`, el mismo punto único de
 *    la Ola 5. NO se inventa un recurso "invoices" — sería un segundo
 *    sitio donde equivocarse, y el archivo de visibilidad ya explica por
 *    qué eso es un error (ver su encabezado).
 *
 * 3. 🔴 UN COBRO NO SE FACTURA DOS VECES, y el candado NO es este archivo:
 *    es el índice único (institutionId, activeChargeId) de edu_invoices.
 *    Aquí se INSERTA la reserva antes de llamar a Facturapi y se traduce
 *    el P2002 a un 409 legible. Dos clics simultáneos chocan en Postgres,
 *    que es el único árbitro que no tiene condiciones de carrera.
 *
 * 4. 🔴 LOS IMPORTES SALEN DEL COBRO CONGELADO y se comprueban con
 *    `eduCuadreDelCobro` antes de gastar un timbre. Jamás se consulta el
 *    tarifario.
 *
 * 5. 🔴 EL AMBIENTE SALE DE LA CONFIGURACIÓN. Este archivo NO importa
 *    `facturapiEnv()` del dental: esa función lee una variable de entorno
 *    global, y el instituto tiene la suya en la base. Todo lo demás del
 *    cliente de Facturapi SÍ se reusa tal cual (`@/lib/facturapi`), que
 *    para eso está.
 * ═══════════════════════════════════════════════════════════════════════
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptField, decryptField } from "@/lib/crypto/envelope";
import {
  cancelInvoice,
  createInvoice,
  createOrUpdateCustomer,
  createOrganization,
  downloadInvoiceFile,
  getOrganizationStatus,
  updateOrgLegal,
  validateRfc,
} from "@/lib/facturapi";
import { EduPadronError } from "@/lib/edu/padron";
import {
  eduCleanId,
  eduSafeTimeZone,
  eduShiftDayISO,
  eduZonedToUtc,
} from "@/lib/edu/agenda-core";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
import { eduSearchTokens } from "@/lib/edu/padron-core";
import { eduUserDisplayName } from "@/lib/edu-auth";
import {
  eduChargeScopeWhere,
  eduPatientScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import { eduMoney } from "@/lib/edu/dinero-core";
import {
  EDU_FORMA_PAGO_POR_DEFINIR,
  EDU_INVOICE_MAX_ROWS,
  eduConceptosDeCobro,
  eduCuadreDelCobro,
  eduItemsFacturapi,
  eduMetodoPagoDeCobro,
  eduNextInvoiceFolio,
  eduSugerirFormaPago,
  esEduCancelMotive,
  esEduFiscalEnv,
  esEduFormaPago,
  esEduProductKey,
  esEduTaxMode,
  esEduUsoCfdi,
  normalizeEduLegalName,
  normalizeEduRfc,
  normalizeEduZip,
  parseEduReceptor,
  type EduConceptoCfdi,
  type EduCobroFacturable,
  type EduFiscalConfigView,
  type EduFiscalEnv,
  type EduFiscalReadiness,
  type EduInvoiceFilters,
  type EduInvoiceRow,
  type EduInvoicesPage,
  type EduReceptorFiscal,
  type EduTaxMode,
} from "@/lib/edu/facturacion-core";
import { esEduTaxRegime } from "@/lib/edu/facturacion-core";

export { EduPadronError as EduFacturacionError };

const FACTURAPI_BASE = "https://www.facturapi.io/v2";

/**
 * Cuántos minutos vale la RESERVA de una cancelación (H-66).
 *
 * Es el tiempo que una factura queda marcada mientras se le pregunta al
 * SAT. Ni tan corto que dos peticiones simultáneas se crucen —cancelar
 * tarda segundos—, ni tan largo que una petición muerta deje la factura sin
 * salida: pasado el plazo, se puede volver a intentar.
 */
const EDU_CANCEL_RESERVA_MIN = 5;

// ═══════════════════════════════════════════════════════════════════════
// 0 · LAS PUERTAS
// ═══════════════════════════════════════════════════════════════════════

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

/**
 * La puerta del dinero, la MISMA de la caja. Se llama al principio de TODA
 * función de este archivo, lecturas incluidas: facturar es dinero, y un
 * alumno con "facturacion.view" encendido por error tiene que chocar aquí
 * aunque el permiso diga que sí.
 */
function requireDinero(ctx: EduClinicaContext): string {
  const institutionId = requireInstitution(ctx);
  if (eduScopeIsEmpty(eduVisibility(ctx, "charges"))) {
    throw new EduPadronError("Tu rol no ve el dinero de la clínica.", 403);
  }
  return institutionId;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function persona(
  u: { firstName: string; lastName: string; email: string } | null | undefined,
): string {
  return u ? eduUserDisplayName(u) : "—";
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA CONFIGURACIÓN FISCAL DEL INSTITUTO
// ═══════════════════════════════════════════════════════════════════════

const CONFIG_SELECT = {
  id: true,
  rfc: true,
  legalName: true,
  taxRegime: true,
  zipCode: true,
  environment: true,
  isEnabled: true,
  facturapiOrgId: true,
  csdUploadedAt: true,
  taxMode: true,
  defaultUsoCfdi: true,
  defaultProductKey: true,
  folioPrefix: true,
  updatedAt: true,
  updatedBy: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.EduFiscalConfigSelect;

type ConfigRow = Prisma.EduFiscalConfigGetPayload<{ select: typeof CONFIG_SELECT }>;

function toConfigView(c: ConfigRow): EduFiscalConfigView {
  return {
    rfc: c.rfc,
    legalName: c.legalName,
    taxRegime: c.taxRegime,
    zipCode: c.zipCode,
    environment: c.environment as EduFiscalEnv,
    isEnabled: c.isEnabled,
    hasOrg: Boolean(c.facturapiOrgId),
    csdUploadedAt: iso(c.csdUploadedAt),
    taxMode: c.taxMode as EduTaxMode,
    defaultUsoCfdi: c.defaultUsoCfdi,
    defaultProductKey: c.defaultProductKey,
    folioPrefix: c.folioPrefix,
    updatedByName: c.updatedBy ? persona(c.updatedBy) : null,
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** La configuración fiscal del instituto, SIN secretos. null = sin capturar. */
export async function getEduFiscalConfig(
  ctx: EduClinicaContext,
): Promise<EduFiscalConfigView | null> {
  const institutionId = requireDinero(ctx);
  const c = await prisma.eduFiscalConfig.findUnique({
    where: { institutionId },
    select: CONFIG_SELECT,
  });
  return c ? toConfigView(c) : null;
}

/**
 * La fila COMPLETA, con la organización y la llave cifrada. Es interna:
 * nunca sale de este archivo hacia una pantalla.
 */
async function fiscalConfigRaw(institutionId: string) {
  return prisma.eduFiscalConfig.findUnique({ where: { institutionId } });
}

export interface EduFiscalConfigInput {
  rfc?: unknown;
  legalName?: unknown;
  taxRegime?: unknown;
  zipCode?: unknown;
  environment?: unknown;
  isEnabled?: unknown;
  taxMode?: unknown;
  defaultUsoCfdi?: unknown;
  defaultProductKey?: unknown;
  folioPrefix?: unknown;
}

/**
 * Guarda los datos fiscales del instituto y sincroniza la organización de
 * Facturapi (la crea la primera vez, y le manda los datos legales cada vez
 * que cambian).
 *
 * 🔴 PASAR A "EN VIVO" ES UNA DECISIÓN, NO UN EFECTO SECUNDARIO. Se exige
 * que Facturapi diga que la organización puede emitir en producción
 * (`is_production_ready`); si no, se rechaza el cambio con los pasos que
 * faltan. Encenderlo "a ver si jala" sería descubrir que no jala con el
 * paciente en el mostrador y un timbre gastado.
 *
 * ⚠️ Si Facturapi no responde, los datos SE GUARDAN igual y se avisa: la
 * escuela tiene que poder capturar su RFC aunque el proveedor esté caído.
 * Lo único que no pasa sin confirmación de Facturapi es el salto a LIVE.
 */
export async function saveEduFiscalConfig(
  ctx: EduClinicaContext,
  input: EduFiscalConfigInput,
): Promise<{ config: EduFiscalConfigView; aviso: string | null }> {
  const institutionId = requireDinero(ctx);

  const previo = await fiscalConfigRaw(institutionId);

  // 🔴 H-80 · Y LOS CUATRO OBLIGATORIOS SIGUEN LA MISMA REGLA. Si un
  // cuerpo trae solo `{isEnabled:false}` no está diciendo "bórrame el
  // RFC": está diciendo "apaga la facturación". Ausente = se conserva lo
  // guardado; presente y malo = 400; y en la PRIMERA captura, donde no hay
  // nada que conservar, siguen siendo obligatorios.
  const ausente = (v: unknown) => v === undefined || v === null || v === "";

  const rfc = ausente(input.rfc) ? (previo?.rfc ?? null) : normalizeEduRfc(input.rfc);
  if (!rfc) {
    throw new EduPadronError(
      ausente(input.rfc)
        ? "Falta el RFC del instituto: todavía no hay ninguno guardado."
        : "El RFC del instituto no tiene forma de RFC. Son 12 caracteres (persona moral) o 13 (persona física), sin guiones ni espacios.",
      400,
    );
  }
  const legalName = ausente(input.legalName)
    ? (previo?.legalName ?? null)
    : normalizeEduLegalName(input.legalName);
  if (!legalName) {
    throw new EduPadronError(
      ausente(input.legalName)
        ? "Falta la razón social del instituto: todavía no hay ninguna guardada."
        : "Falta la razón social del instituto. Cópiala EXACTAMENTE como aparece en su Constancia de Situación Fiscal.",
      400,
    );
  }
  if (!ausente(input.taxRegime) && !esEduTaxRegime(input.taxRegime)) {
    throw new EduPadronError("Ese régimen fiscal no está en el catálogo del SAT.", 400);
  }
  const taxRegime = ausente(input.taxRegime)
    ? (previo?.taxRegime ?? null)
    : (input.taxRegime as string);
  if (!taxRegime) {
    throw new EduPadronError("Elige el régimen fiscal del instituto.", 400);
  }
  const zipCode = ausente(input.zipCode)
    ? (previo?.zipCode ?? null)
    : normalizeEduZip(input.zipCode);
  if (!zipCode) {
    throw new EduPadronError(
      ausente(input.zipCode)
        ? "Falta el código postal del domicilio fiscal: todavía no hay ninguno guardado."
        : "El código postal del domicilio fiscal son cinco dígitos.",
      400,
    );
  }

  // ── 🔴 H-80 · NI UN DEFAULT SILENCIOSO SOBRE UNA CONFIGURACIÓN QUE YA
  // EXISTE ─────────────────────────────────────────────────────────────
  // Esto era un reemplazo total: un cuerpo al que le faltara `isEnabled`
  // APAGABA la facturación, y uno al que le faltara `environment` devolvía
  // el instituto a PRUEBAS. Sin decir nada, y sin que nadie lo hubiera
  // pedido. Hoy no mordía porque la pantalla manda los diez campos — o
  // sea: la única cerradura era que nadie más llamara al endpoint.
  //
  // La regla ahora es la de siempre en el vertical: AUSENTE = no lo tocas
  // (se conserva lo guardado), PRESENTE Y MALO = 400. El default solo
  // aplica en la PRIMERA captura, cuando no hay nada que conservar.
  // El validador se pide igual que en las cuatro de arriba: el llamador ya
  // rechazó lo malo con su mensaje, y esto es el segundo cerrojo.
  function conservar<T>(raw: unknown, ok: (v: unknown) => boolean, guardado: T | null, inicial: T): T {
    if (ausente(raw)) return guardado === null || guardado === undefined ? inicial : guardado;
    if (!ok(raw)) throw new EduPadronError("Ese valor no es válido para la facturación.", 400);
    return raw as T;
  }

  if (input.environment !== undefined && !esEduFiscalEnv(input.environment)) {
    throw new EduPadronError("El ambiente de timbrado solo puede ser PRUEBAS o EN VIVO.", 400);
  }
  const environment: EduFiscalEnv = conservar<EduFiscalEnv>(
    input.environment,
    esEduFiscalEnv,
    (previo?.environment as EduFiscalEnv) ?? null,
    "TEST",
  );
  const isEnabled =
    input.isEnabled === undefined || input.isEnabled === null
      ? (previo?.isEnabled ?? false)
      : input.isEnabled === true;
  if (input.taxMode !== undefined && !esEduTaxMode(input.taxMode)) {
    throw new EduPadronError("Ese modo de IVA no existe.", 400);
  }
  const taxMode: EduTaxMode = conservar<EduTaxMode>(
    input.taxMode,
    esEduTaxMode,
    (previo?.taxMode as EduTaxMode) ?? null,
    "EXENTO",
  );
  if (input.defaultUsoCfdi !== undefined && !esEduUsoCfdi(input.defaultUsoCfdi)) {
    throw new EduPadronError("Ese uso del CFDI no está en el catálogo del SAT.", 400);
  }
  const defaultUsoCfdi = conservar<string>(
    input.defaultUsoCfdi,
    esEduUsoCfdi,
    previo?.defaultUsoCfdi ?? null,
    "D01",
  );
  if (input.defaultProductKey !== undefined && !esEduProductKey(input.defaultProductKey)) {
    throw new EduPadronError("La clave de producto del SAT son ocho dígitos.", 400);
  }
  const defaultProductKey = conservar<string>(
    input.defaultProductKey,
    esEduProductKey,
    previo?.defaultProductKey ?? null,
    "85121600",
  );
  const folioPrefixRaw =
    typeof input.folioPrefix === "string" ? input.folioPrefix.trim().toUpperCase() : "";
  if (folioPrefixRaw && !/^[A-Z]{1,6}$/.test(folioPrefixRaw)) {
    throw new EduPadronError(
      "El prefijo del folio son de una a seis letras, sin números ni signos.",
      400,
    );
  }
  const folioPrefix = folioPrefixRaw || previo?.folioPrefix || "F";

  // ── La organización en Facturapi ────────────────────────────────────
  let orgId = previo?.facturapiOrgId ?? null;
  let aviso: string | null = null;
  try {
    if (!orgId) {
      orgId = await createOrganization(legalName);
    }
    await updateOrgLegal(orgId, {
      legal_name: legalName,
      tax_system: taxRegime,
      address: { zip: zipCode },
    });
  } catch (err) {
    // Los datos se guardan igual. Sin organización no se puede timbrar, y
    // eso lo dice la pantalla al intentarlo — no se pierde la captura.
    aviso = `Los datos quedaron guardados, pero Facturapi no respondió: ${mensajeDe(
      err,
    )}. No se podrá timbrar hasta que responda.`;
  }

  // ── 🔴 El salto a EN VIVO ───────────────────────────────────────────
  if (environment === "LIVE" && previo?.environment !== "LIVE") {
    if (!orgId) {
      throw new EduPadronError(
        "No se puede pasar a timbrado EN VIVO: todavía no hay organización creada en Facturapi. Guarda primero los datos fiscales con Facturapi disponible.",
        409,
      );
    }
    const estado = await getOrganizationStatus(orgId, { refresh: true }).catch(() => null);
    if (!estado) {
      throw new EduPadronError(
        "No se pudo confirmar con Facturapi que el instituto ya puede timbrar ante el SAT. Vuelve a intentarlo: pasar a EN VIVO sin confirmarlo es descubrir que no se puede con el paciente enfrente.",
        503,
      );
    }
    if (!estado.exists) {
      throw new EduPadronError(
        "La organización fiscal del instituto ya no existe en Facturapi. Vuelve a guardar los datos fiscales para recrearla.",
        409,
      );
    }
    if (!estado.isProductionReady) {
      const faltan: string[] = [];
      if (estado.hasLegal === false) faltan.push("completar los datos fiscales en Facturapi");
      if (estado.hasCertificate === false) faltan.push("subir el CSD (.cer y .key del SAT)");
      if (estado.manifestSigned === false) faltan.push("firmar la Carta Manifiesto con la e.firma");
      if (estado.hasLogo === false) faltan.push("subir el logo de la organización");
      if (faltan.length === 0) {
        faltan.push(
          ...estado.pendingSteps.map((s) => s.description || s.type).filter(Boolean),
        );
      }
      throw new EduPadronError(
        faltan.length > 0
          ? `Todavía no se puede timbrar ante el SAT. Falta: ${faltan.join("; ")}.`
          : "Facturapi reporta que la organización del instituto no está lista para producción, pero no dijo qué falta. Revísalo en el panel de Facturapi.",
        409,
      );
    }
  }

  const data = {
    rfc,
    legalName,
    taxRegime,
    zipCode,
    environment,
    isEnabled,
    taxMode,
    defaultUsoCfdi,
    defaultProductKey,
    folioPrefix,
    facturapiOrgId: orgId,
    updatedByUserId: ctx.eduUserId,
  };

  const saved = await prisma.eduFiscalConfig.upsert({
    where: { institutionId },
    create: { institutionId, ...data },
    update: data,
    select: CONFIG_SELECT,
  });

  // 🔴 H-80 · BAJAR de EN VIVO a PRUEBAS no se puede impedir (una escuela
  // puede querer volver a practicar), pero no puede ser MUDO: subir tiene
  // tres comprobaciones y bajar no tenía ninguna, y lo que se apaga es la
  // validez fiscal de todo lo que se emita a partir de ese momento.
  if (previo?.environment === "LIVE" && environment === "TEST") {
    const nota =
      "Ojo: el instituto pasó de EN VIVO a PRUEBAS. Lo que se timbre a partir de ahora NO tendrá validez fiscal y no le sirve al paciente para deducir.";
    aviso = aviso ? `${aviso} ${nota}` : nota;
  }

  return { config: toConfigView(saved), aviso };
}

/**
 * Qué le falta a la organización para timbrar EN VIVO, preguntándoselo a
 * Facturapi (que es quien lo sabe). Nunca revienta: si no se puede
 * consultar, la pantalla lo DICE en vez de pintar todo en verde.
 */
export async function getEduFiscalReadiness(
  ctx: EduClinicaContext,
): Promise<EduFiscalReadiness> {
  const institutionId = requireDinero(ctx);
  const config = await fiscalConfigRaw(institutionId);
  if (!config?.facturapiOrgId) {
    return {
      productionReady: null,
      pendingSteps: [],
      certificateExpiresAt: null,
      unavailableReason:
        "Todavía no hay organización creada en Facturapi. Se crea al guardar los datos fiscales.",
    };
  }
  try {
    const s = await getOrganizationStatus(config.facturapiOrgId);
    if (!s.exists) {
      return {
        productionReady: false,
        pendingSteps: [],
        certificateExpiresAt: null,
        unavailableReason:
          "La organización del instituto ya no existe en Facturapi. Vuelve a guardar los datos fiscales.",
      };
    }
    return {
      productionReady: s.isProductionReady,
      pendingSteps: s.pendingSteps,
      certificateExpiresAt: s.certificateExpiresAt,
      unavailableReason: null,
    };
  } catch (err) {
    return {
      productionReady: null,
      pendingSteps: [],
      certificateExpiresAt: null,
      unavailableReason: `No se pudo consultar a Facturapi: ${mensajeDe(err)}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA LLAVE DE LA ORGANIZACIÓN, SEGÚN EL AMBIENTE DEL INSTITUTO
//
// 🔴 Aquí está la única razón por la que este archivo habla con Facturapi
// por su cuenta en vez de usar `getOrgApiKey` del dental: esa función
// decide TEST/LIVE con `process.env.FACTURAPI_ENV`, una variable global
// del despliegue. El instituto tiene su propio ambiente en la base, y
// mezclarlos haría que encender el dental en vivo encendiera también, sin
// avisar, la facturación de todas las escuelas.
//
// Todo LO DEMÁS del cliente (crear la factura, cancelarla, descargar el
// PDF, validar el RFC) sí se importa del dental tal cual: esas funciones
// reciben la llave como argumento y no opinan del ambiente.
// ═══════════════════════════════════════════════════════════════════════

function userKey(): string {
  const k = process.env.FACTURAPI_USER_KEY;
  if (!k) {
    throw new EduPadronError(
      "Falta la llave de cuenta de Facturapi (FACTURAPI_USER_KEY) en el servidor. Sin ella no se puede timbrar ni en pruebas.",
      503,
    );
  }
  return k;
}

/** Facturapi devuelve la llave como string JSON pelado; se parsea a la defensiva. */
function leerLlave(data: unknown): string | null {
  if (typeof data === "string" && data) return data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const campo of ["secret_key", "key", "value"]) {
      if (typeof d[campo] === "string" && d[campo]) return d[campo] as string;
    }
  }
  return null;
}

async function llaveDePruebas(orgId: string): Promise<string> {
  const res = await fetch(`${FACTURAPI_BASE}/organizations/${orgId}/apikeys/test`, {
    headers: { Authorization: `Bearer ${userKey()}` },
  });
  if (!res.ok) {
    throw new EduPadronError(
      `Facturapi no entregó la llave de PRUEBAS de la organización (${res.status}).`,
      502,
    );
  }
  const key = leerLlave(await res.json().catch(() => null));
  if (!key) {
    throw new EduPadronError("Respuesta inesperada de Facturapi al pedir la llave de pruebas.", 502);
  }
  return key;
}

/**
 * La llave LIVE no se puede volver a leer: `PUT /apikeys/live` la devuelve
 * completa UNA vez y por eso se guarda cifrada en la configuración. Ese PUT
 * NO invalida las llaves anteriores (documentado), así que regenerarla es
 * seguro. Misma mecánica que el dental, con la llave guardada en la tabla
 * del instituto en vez de en la de la clínica.
 */
async function llaveEnVivo(institutionId: string, orgId: string): Promise<string> {
  const config = await fiscalConfigRaw(institutionId);
  const guardada = abrirLlave(config?.facturapiLiveKey);
  if (guardada) return guardada;

  const res = await fetch(`${FACTURAPI_BASE}/organizations/${orgId}/apikeys/live`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${userKey()}` },
  });
  if (!res.ok) {
    throw new EduPadronError(
      `Facturapi no entregó la llave de PRODUCCIÓN de la organización (${res.status}).`,
      502,
    );
  }
  const key = leerLlave(await res.json().catch(() => null));
  if (!key) {
    throw new EduPadronError(
      "Respuesta inesperada de Facturapi al generar la llave de producción.",
      502,
    );
  }
  await prisma.eduFiscalConfig.update({
    where: { institutionId },
    data: { facturapiLiveKey: sellarLlave(key) },
  });
  return key;
}

/**
 * Cifra la llave para guardarla. `encryptField` TIRA si falta
 * DATA_ENCRYPTION_KEY; en ese caso se guarda en claro y se avisa en el log,
 * porque dejar al instituto sin poder timbrar es peor que el riesgo del
 * texto plano (que además es lo que ya hacen otros secretos del producto).
 */
function sellarLlave(key: string): string {
  try {
    return encryptField(key) ?? key;
  } catch {
    console.warn(
      "[instituto/facturacion] DATA_ENCRYPTION_KEY ausente o inválida: la Live Secret Key se guarda SIN cifrar",
    );
    return key;
  }
}

function abrirLlave(guardada: string | null | undefined): string | null {
  if (!guardada) return null;
  try {
    return decryptField(guardada) || null;
  } catch {
    console.warn(
      "[instituto/facturacion] Live Secret Key ilegible (¿DATA_ENCRYPTION_KEY rotada?): se generará una nueva",
    );
    return null;
  }
}

/** La llave con la que se timbra, según el ambiente GUARDADO del instituto. */
async function llaveDeLaOrganizacion(
  institutionId: string,
  orgId: string,
  environment: EduFiscalEnv,
): Promise<string> {
  return environment === "LIVE"
    ? llaveEnVivo(institutionId, orgId)
    : llaveDePruebas(orgId);
}

function mensajeDe(err: unknown): string {
  if (err instanceof Error && err.message) return err.message.slice(0, 300);
  return "error desconocido";
}

/**
 * ¿El fallo fue de RED (no sabemos si el timbre salió) o una respuesta de
 * Facturapi diciendo que NO timbró?
 *
 * 🔴 La diferencia decide si el cobro se libera. `fetch` lanza TypeError
 * ("fetch failed", "network error", AbortError) cuando la petición no llegó
 * o se cortó; una respuesta con error viene como Error con el mensaje del
 * proveedor. Ante la DUDA se responde `true` (fue de red) — dejar un cobro
 * bloqueado es molesto; liberarlo cuando el SAT sí timbró es un CFDI
 * duplicado que hay que cancelar ante el SAT.
 */
function pudoHaberTimbrado(err: unknown): boolean {
  if (err instanceof EduPadronError) return false; // ni siquiera se llamó
  if (!(err instanceof Error)) return true;
  if (err.name === "TypeError" || err.name === "AbortError") return true;
  const m = err.message.toLowerCase();
  if (/fetch failed|network|socket|timeout|timed out|econn|enotfound|aborted/.test(m)) {
    return true;
  }
  // Un mensaje escrito por Facturapi ("El RFC no es válido") es una
  // respuesta: hubo ida y vuelta y no hubo timbre.
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LOS DATOS FISCALES DEL PACIENTE
// ═══════════════════════════════════════════════════════════════════════

/**
 * El paciente, SI le toca a quien pregunta. Se usa el alcance de
 * "patients": quien factura (dirección y caja) lo tiene completo, y aun así
 * el `where` se arma con el punto único en vez de a mano.
 */
async function pacienteVisible(ctx: EduClinicaContext, patientId: string) {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(patientId);
  if (!id) return null;
  return prisma.eduPatient.findFirst({
    where: {
      ...eduPatientScopeWhere({
        institutionId,
        scope: eduVisibility(ctx, "patients"),
        now: new Date(),
      }),
      id,
    },
    select: { id: true, folio: true, firstName: true, lastName: true, email: true },
  });
}

export interface EduTaxProfileView extends EduReceptorFiscal {
  patientId: string;
  updatedByName: string | null;
  updatedAt: string;
}

export async function getEduPatientTaxProfile(
  ctx: EduClinicaContext,
  patientId: string,
): Promise<EduTaxProfileView | null> {
  const institutionId = requireDinero(ctx);
  const paciente = await pacienteVisible(ctx, patientId);
  if (!paciente) return null;

  const p = await prisma.eduPatientTaxProfile.findFirst({
    where: { institutionId, patientId: paciente.id },
    include: { updatedBy: { select: { firstName: true, lastName: true, email: true } } },
  });
  if (!p) return null;
  return {
    patientId: p.patientId,
    rfc: p.rfc,
    legalName: p.legalName,
    taxRegime: p.taxRegime,
    zipCode: p.zipCode,
    email: p.email,
    usoCfdi: p.usoCfdi,
    updatedByName: p.updatedBy ? persona(p.updatedBy) : null,
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * Guarda (o corrige) los datos fiscales del paciente.
 *
 * ⚠️ Corregirlos NO cambia ninguna factura ya emitida: el receptor se
 * congela en EduInvoice al timbrar. Es a propósito — un CFDI dice a nombre
 * de quién se emitió, no a nombre de quién se emitiría hoy.
 */
export async function saveEduPatientTaxProfile(
  ctx: EduClinicaContext,
  patientId: string,
  input: Record<string, unknown>,
): Promise<EduTaxProfileView> {
  const institutionId = requireDinero(ctx);
  const paciente = await pacienteVisible(ctx, patientId);
  if (!paciente) throw new EduPadronError("No se encontró ese paciente.", 404);

  const config = await fiscalConfigRaw(institutionId);
  const parsed = parseEduReceptor(input, { usoCfdi: config?.defaultUsoCfdi ?? "D01" });
  if (!parsed.ok) throw new EduPadronError(parsed.error!, 400);
  const r = parsed.receptor!;

  const data = {
    institutionId,
    rfc: r.rfc,
    legalName: r.legalName,
    taxRegime: r.taxRegime,
    zipCode: r.zipCode,
    email: r.email,
    usoCfdi: r.usoCfdi,
    updatedByUserId: ctx.eduUserId,
  };

  const saved = await prisma.eduPatientTaxProfile.upsert({
    where: { patientId: paciente.id },
    create: { patientId: paciente.id, ...data },
    update: data,
    include: { updatedBy: { select: { firstName: true, lastName: true, email: true } } },
  });

  return {
    patientId: saved.patientId,
    rfc: saved.rfc,
    legalName: saved.legalName,
    taxRegime: saved.taxRegime,
    zipCode: saved.zipCode,
    email: saved.email,
    usoCfdi: saved.usoCfdi,
    updatedByName: saved.updatedBy ? persona(saved.updatedBy) : null,
    updatedAt: saved.updatedAt.toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LEER FACTURAS
// ═══════════════════════════════════════════════════════════════════════

const INVOICE_SELECT = {
  id: true,
  folio: true,
  status: true,
  environment: true,
  chargeId: true,
  patientId: true,
  receptorRfc: true,
  receptorLegalName: true,
  // H-81 · el receptor CONGELADO, entero. Régimen, CP y correo se
  // guardaban y no salían a ninguna pantalla, así que no se podía
  // comprobar contra la Constancia del paciente qué se timbró de verdad.
  receptorTaxRegime: true,
  receptorZip: true,
  receptorEmail: true,
  usoCfdi: true,
  paymentForm: true,
  taxMode: true,
  subtotalCents: true,
  discountCents: true,
  totalCents: true,
  conceptos: true,
  facturapiId: true,
  uuid: true,
  stampedAt: true,
  xml: true,
  issuedAt: true,
  cancelledAt: true,
  cancelMotive: true,
  cancelReason: true,
  errorMessage: true,
  charge: { select: { folio: true } },
  patient: { select: { folio: true, firstName: true, lastName: true } },
  issuedBy: { select: { firstName: true, lastName: true, email: true } },
  cancelledBy: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.EduInvoiceSelect;

type InvoiceRow = Prisma.EduInvoiceGetPayload<{ select: typeof INVOICE_SELECT }>;

/**
 * H-81 · El formateador de instantes, UNA vez por lectura y en la zona del
 * INSTITUTO. Construirlo por fila serían doscientos objetos Intl para
 * pintar una lista de doscientas facturas.
 *
 * La zona por defecto es la misma con la que nacen los institutos, para el
 * llamador que todavía no la pasa: sin ella, `eduSafeTimeZone(undefined)`
 * cae a UTC y una factura de las 19:00 se leería como del día siguiente.
 */
function invoiceFmt(timeZone?: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: eduSafeTimeZone(timeZone ?? "America/Mexico_City"),
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toInvoiceRow(i: InvoiceRow, fmt: Intl.DateTimeFormat = invoiceFmt()): EduInvoiceRow {
  return {
    id: i.id,
    folio: i.folio,
    status: i.status as EduInvoiceRow["status"],
    environment: i.environment as EduFiscalEnv,
    chargeId: i.chargeId,
    chargeFolio: i.charge?.folio ?? "—",
    patientId: i.patientId,
    patientName: i.patient ? eduPatientFullName(i.patient) : "—",
    patientFolio: i.patient?.folio ?? "—",
    receptorRfc: i.receptorRfc,
    receptorLegalName: i.receptorLegalName,
    receptorTaxRegime: i.receptorTaxRegime,
    receptorZip: i.receptorZip,
    receptorEmail: i.receptorEmail,
    usoCfdi: i.usoCfdi,
    paymentForm: i.paymentForm,
    taxMode: i.taxMode as EduTaxMode,
    subtotalCents: i.subtotalCents,
    discountCents: i.discountCents,
    totalCents: i.totalCents,
    conceptos: Array.isArray(i.conceptos) ? (i.conceptos as unknown as EduConceptoCfdi[]) : [],
    uuid: i.uuid,
    stampedAt: iso(i.stampedAt),
    issuedAt: i.issuedAt.toISOString(),
    issuedAtLabel: fmt.format(i.issuedAt),
    issuedByName: persona(i.issuedBy),
    cancelledAt: iso(i.cancelledAt),
    cancelledByName: i.cancelledBy ? persona(i.cancelledBy) : null,
    cancelMotive: i.cancelMotive,
    cancelReason: i.cancelReason,
    errorMessage: i.errorMessage,
    // 🔴 El XML NO viaja a la pantalla: pesa y no se pinta. Solo se dice si
    // está, para saber si el botón de descarga funciona sin Facturapi.
    hasXml: Boolean(i.xml),
    hasDocument: Boolean(i.facturapiId),
  };
}

function invoicesWhere(
  institutionId: string,
  filters: EduInvoiceFilters,
  timeZone: string,
): Prisma.EduInvoiceWhereInput {
  const where: Prisma.EduInvoiceWhereInput = { institutionId };
  if (filters.status) where.status = filters.status;

  // 🔴 H-78 · El rango de fechas se traduce a INSTANTES en la zona del
  // INSTITUTO, igual que la agenda y el corte: en UTC, una factura emitida
  // a las 19:00 de un 31 de marzo en México caería en abril y el mes no
  // cuadraría contra el corte de caja. El `hasta` es inclusivo para quien
  // lo teclea y exclusivo en el `where` (medianoche del día siguiente).
  const rango: Prisma.DateTimeFilter = {};
  if (filters.desde) {
    const desde = eduZonedToUtc(filters.desde, 0, timeZone);
    if (desde) rango.gte = desde;
  }
  if (filters.hasta) {
    const hasta = eduZonedToUtc(eduShiftDayISO(filters.hasta, 1), 0, timeZone);
    if (hasta) rango.lt = hasta;
  }
  if (rango.gte || rango.lt) where.issuedAt = rango;

  const q = filters.q.trim();
  if (q) {
    // Los tokens se trocean con el MISMO partidor del padrón y los
    // pacientes: si el buscador de facturas partiera el término a su
    // manera, "Rodríguez Pérez" encontraría cosas distintas aquí que en la
    // lista de pacientes.
    const tokens = eduSearchTokens(q);
    const upper = q.toUpperCase().replace(/[\s.\-_]/g, "");
    where.OR = [
      { folio: { contains: q, mode: "insensitive" } },
      { uuid: { contains: q, mode: "insensitive" } },
      { receptorRfc: { contains: upper, mode: "insensitive" } },
      { receptorLegalName: { contains: q, mode: "insensitive" } },
      { charge: { folio: { contains: q, mode: "insensitive" } } },
      ...(tokens.length > 0
        ? [{ patient: { searchIndex: { contains: tokens[0] } } } as Prisma.EduInvoiceWhereInput]
        : []),
    ];
  }
  return where;
}

export async function listEduInvoices(
  ctx: EduClinicaContext,
  filters: EduInvoiceFilters,
  /** La zona del INSTITUTO, para que "del 1 al 31 de marzo" sea de marzo. */
  options: { timeZone?: string } = {},
): Promise<EduInvoicesPage> {
  const institutionId = requireDinero(ctx);
  const rows = await prisma.eduInvoice.findMany({
    where: invoicesWhere(institutionId, filters, eduSafeTimeZone(options.timeZone)),
    orderBy: [{ issuedAt: "desc" }],
    take: EDU_INVOICE_MAX_ROWS + 1,
    select: INVOICE_SELECT,
  });

  const fmt = invoiceFmt(options.timeZone);
  const visibles = rows.slice(0, EDU_INVOICE_MAX_ROWS).map((r) => toInvoiceRow(r, fmt));

  // 🔴 Las canceladas y las fallidas NO suman. Una factura cancelada no es
  // ingreso facturado, igual que un cobro cancelado no es dinero.
  const totals = visibles.reduce(
    (acc, r) => {
      if (r.status === "VALID") {
        acc.vivas += 1;
        acc.totalCents += r.totalCents;
        // H-70 · y en el cubo de SU ambiente. Lo timbrado en pruebas no es
        // ingreso facturado: no llega al SAT y no se puede deducir.
        const cubo = r.environment === "LIVE" ? acc.live : acc.test;
        cubo.vivas += 1;
        cubo.totalCents += r.totalCents;
      } else if (r.status === "CANCELLED") {
        acc.canceladas += 1;
      }
      return acc;
    },
    {
      vivas: 0,
      totalCents: 0,
      canceladas: 0,
      live: { vivas: 0, totalCents: 0 },
      test: { vivas: 0, totalCents: 0 },
    },
  );

  return { rows: visibles, truncated: rows.length > EDU_INVOICE_MAX_ROWS, totals };
}

export async function getEduInvoice(
  ctx: EduClinicaContext,
  invoiceId: string,
  /** La zona del INSTITUTO: sin ella, la fecha de emisión sale en la de México. */
  options: { timeZone?: string } = {},
): Promise<EduInvoiceRow | null> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(invoiceId);
  if (!id) return null;
  const i = await prisma.eduInvoice.findFirst({
    where: { institutionId, id },
    select: INVOICE_SELECT,
  });
  return i ? toInvoiceRow(i, invoiceFmt(options.timeZone)) : null;
}

/**
 * Los cobros que se pueden facturar: emitidos, no cancelados y sin una
 * factura VIVA. Se listan con la factura viva al lado cuando la tienen,
 * para que la pantalla pueda decir "este ya está facturado" en vez de
 * esconderlo y dejar a quien busca preguntándose dónde quedó.
 */
export async function listEduCobrosFacturables(
  ctx: EduClinicaContext,
  q: string,
): Promise<EduCobroFacturable[]> {
  const institutionId = requireDinero(ctx);
  const scope = eduVisibility(ctx, "charges");
  const termino = (q ?? "").trim();

  const where: Prisma.EduChargeWhereInput = {
    // 🔴 H-69 · LA SEDE, igual que en la lista de Caja. Este buscador
    // ignoraba el selector de la barra superior: una cajera del Norte con
    // su sede puesta veía —y podía timbrar— cobros del Sur, con nombre de
    // paciente y monto. Es exactamente el mismo `campusIds` del contexto
    // que ya aplica `chargesWhere` en caja.ts; sin él, el recorte que la
    // pantalla anuncia no existía en esta lista.
    ...eduChargeScopeWhere({ institutionId, scope, campusIds: ctx.campusIds }),
    status: { not: "CANCELLED" },
  };
  if (termino) {
    const tokens = eduSearchTokens(termino);
    where.OR = [
      { folio: { contains: termino, mode: "insensitive" } },
      ...(tokens.length > 0
        ? [{ patient: { searchIndex: { contains: tokens[0] } } } as Prisma.EduChargeWhereInput]
        : []),
    ];
  }

  const rows = await prisma.eduCharge.findMany({
    where,
    orderBy: [{ chargedAt: "desc" }],
    take: 40,
    select: {
      id: true,
      folio: true,
      patientId: true,
      totalCents: true,
      paidCents: true,
      balanceCents: true,
      chargedAt: true,
      patient: { select: { folio: true, firstName: true, lastName: true } },
      // 🔴 H-71 · CON QUÉ SE PAGÓ. `eduSugerirFormaPago` estaba escrita y
      // probada desde la Ola 10 y no tenía un solo llamador fuera de los
      // tests: caja elegía a mano entre las ~20 formas del SAT en cada
      // factura, con el paciente delante y el voucher en la otra mano.
      payments: { select: { method: true, isRefund: true, paidAt: true, amountCents: true } },
      // La factura VIVA, si la hay. `activeChargeId` no nulo es exactamente
      // la definición de "viva" (ver el índice único de EduInvoice).
      invoices: {
        where: { activeChargeId: { not: null } },
        select: { folio: true, status: true },
        take: 1,
      },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    folio: c.folio,
    patientId: c.patientId,
    patientName: c.patient ? eduPatientFullName(c.patient) : "—",
    patientFolio: c.patient?.folio ?? "—",
    totalCents: c.totalCents,
    paidCents: c.paidCents,
    balanceCents: c.balanceCents,
    chargedAt: c.chargedAt.toISOString(),
    // H-71 · la forma del SAT que corresponde al método con MAYOR monto
    // neto. Es una PROPUESTA: el modal la deja cambiar.
    formaPagoSugerida: eduSugerirFormaPago(c.payments),
    facturaFolio: c.invoices[0]?.folio ?? null,
    facturaStatus: (c.invoices[0]?.status as EduInvoiceRow["status"]) ?? null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · 🔴 EMITIR: EL TIMBRADO, CON SU CANDADO
// ═══════════════════════════════════════════════════════════════════════

export interface EduEmitInput {
  chargeId?: unknown;
  receptor?: Record<string, unknown>;
  /** Guardar el receptor como los datos fiscales del paciente. Default: sí. */
  guardarReceptor?: unknown;
  paymentForm?: unknown;
  taxMode?: unknown;
}

async function siguienteFolio(institutionId: string, prefix: string): Promise<string> {
  // 🔴 H-68 · LAS DOS PREGUNTAS, porque ninguna sola basta.
  // El orden de Postgres es ALFABÉTICO: con el relleno a cuatro dígitos
  // coincide con el numérico hasta F-9999 y después deja de coincidir
  // ("F-10000" < "F-9999" como texto), así que el "último" se congelaba en
  // F-9999 y toda emisión posterior moría en 409 contra el índice único.
  // El CONTEO no tiene ese techo. Se usa el mayor de los dos.
  const where = { institutionId, folio: { startsWith: `${prefix}-` } };
  const [ultimo, emitidas] = await Promise.all([
    prisma.eduInvoice.findFirst({ where, orderBy: { folio: "desc" }, select: { folio: true } }),
    prisma.eduInvoice.count({ where }),
  ]);
  return eduNextInvoiceFolio(prefix, ultimo?.folio ?? null, emitidas);
}

function esConflictoDeUnico(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      (err as { code?: unknown }).code === "P2002",
  );
}

/**
 * Factura un cobro.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * EL ORDEN IMPORTA, Y ES ÉSTE:
 *
 *  1. se valida TODO lo que se puede validar sin gastar un timbre (la
 *     configuración, el cobro, el cuadre de importes, el receptor);
 *  2. se INSERTA la reserva (status STAMPING, activeChargeId = chargeId).
 *     Aquí es donde el segundo clic muere: choca con el índice único;
 *  3. se llama a Facturapi;
 *  4. se guarda el resultado.
 *
 * Si el paso 3 devuelve un error del proveedor → FAILED y el cobro se
 * libera (no hubo timbre). Si el paso 3 se cae por red → la fila SE QUEDA
 * en STAMPING y el cobro NO se libera: no sabemos si el SAT timbró.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function emitEduInvoice(
  ctx: EduClinicaContext,
  input: EduEmitInput,
): Promise<{ id: string; folio: string; uuid: string | null; environment: EduFiscalEnv }> {
  const institutionId = requireDinero(ctx);

  // ── 1a · la configuración ───────────────────────────────────────────
  const config = await fiscalConfigRaw(institutionId);
  if (!config) {
    throw new EduPadronError(
      "El instituto todavía no tiene datos fiscales. Captúralos en Facturación → Datos fiscales antes de emitir.",
      409,
    );
  }
  if (!config.isEnabled) {
    throw new EduPadronError(
      "La facturación del instituto está apagada. Enciéndela en Facturación → Datos fiscales.",
      409,
    );
  }
  if (!config.facturapiOrgId) {
    throw new EduPadronError(
      "El instituto no tiene organización en Facturapi. Vuelve a guardar los datos fiscales para crearla.",
      409,
    );
  }
  const environment = config.environment as EduFiscalEnv;

  // ── 1b · el cobro, con el alcance del dinero ────────────────────────
  const chargeId = eduCleanId(input.chargeId);
  if (!chargeId) throw new EduPadronError("Falta el cobro que se va a facturar.", 400);

  const charge = await prisma.eduCharge.findFirst({
    where: {
      // 🔴 H-69 · Y LA SEDE TAMBIÉN AQUÍ. Recortar solo el buscador tapaba
      // la lista pero no la puerta: un POST con el id de un cobro del Sur
      // se timbraba igual desde el Norte. Timbrar no es leer — emite un
      // documento fiscal— así que el alcance se aplica en la ESCRITURA.
      ...eduChargeScopeWhere({
        institutionId,
        scope: eduVisibility(ctx, "charges"),
        campusIds: ctx.campusIds,
      }),
      id: chargeId,
    },
    select: {
      id: true,
      folio: true,
      patientId: true,
      status: true,
      subtotalCents: true,
      discountCents: true,
      totalCents: true,
      // 🔴 H-12 · EL SALDO. Es lo que decide PUE o PPD, y hasta esta ola no
      // se leía siquiera: todo salía PUE, incluidos los tratamientos a
      // meses sin un peso pagado.
      paidCents: true,
      balanceCents: true,
      items: {
        select: {
          description: true,
          quantity: true,
          unitPriceCents: true,
          discountCents: true,
          totalCents: true,
        },
        orderBy: { createdAt: "asc" },
      },
      payments: { select: { method: true, isRefund: true, paidAt: true } },
    },
  });
  if (!charge) throw new EduPadronError("No se encontró ese cobro.", 404);
  if (charge.status === "CANCELLED") {
    throw new EduPadronError("Ese cobro está cancelado: no se factura un cobro anulado.", 409);
  }

  // ── 1c · 🔴 EL CUADRE. Antes de gastar un timbre ────────────────────
  const cuadre = eduCuadreDelCobro(charge, charge.items);
  if (!cuadre.ok) throw new EduPadronError(cuadre.error!, 409);

  // ── 1d · el receptor ────────────────────────────────────────────────
  const guardado = await prisma.eduPatientTaxProfile.findFirst({
    where: { institutionId, patientId: charge.patientId },
  });
  const entrada =
    input.receptor && typeof input.receptor === "object"
      ? input.receptor
      : guardado
        ? {
            rfc: guardado.rfc,
            legalName: guardado.legalName,
            taxRegime: guardado.taxRegime,
            zipCode: guardado.zipCode,
            email: guardado.email,
            usoCfdi: guardado.usoCfdi,
          }
        : null;
  if (!entrada) {
    throw new EduPadronError(
      "Faltan los datos fiscales del paciente (RFC, razón social, régimen y código postal). Captúralos para poder facturar.",
      400,
    );
  }
  const parsed = parseEduReceptor(entrada, { usoCfdi: config.defaultUsoCfdi });
  if (!parsed.ok) throw new EduPadronError(parsed.error!, 400);
  const receptor = parsed.receptor!;

  // ── 1e · forma de pago e impuestos ──────────────────────────────────
  // 🔴 H-12 · La forma de pago solo se EXIGE cuando el cobro está
  // liquidado. Con saldo abierto el comprobante es PPD y el SAT obliga a
  // "99 · Por definir": pedirle a la cajera que elija una forma que no va
  // a viajar sería pedirle un dato falso.
  if (charge.balanceCents <= 0 && !esEduFormaPago(input.paymentForm)) {
    throw new EduPadronError(
      "Elige la forma de pago del SAT. No se adivina: es el dato con el que el SAT cruza el comprobante contra el depósito.",
      400,
    );
  }
  const taxMode: EduTaxMode = esEduTaxMode(input.taxMode)
    ? input.taxMode
    : (config.taxMode as EduTaxMode);
  const conceptos = eduConceptosDeCobro(charge.items, config.defaultProductKey);

  // ── 1f · 🔴 H-12 · PUE o PPD, SEGÚN EL SALDO DEL COBRO ──────────────
  // La decisión no es del que timbra: sale del cobro congelado. Con saldo
  // abierto el comprobante es PPD y —lo exige el SAT en CFDI 4.0— su forma
  // de pago pasa a ser "99 · Por definir", porque todavía no se sabe con
  // qué se va a liquidar. Las dos cosas salen juntas de la misma función
  // pura, que es también la que la pantalla usa para avisar ANTES.
  const metodoPago = eduMetodoPagoDeCobro({
    balanceCents: charge.balanceCents,
    paymentForm: esEduFormaPago(input.paymentForm)
      ? input.paymentForm
      : EDU_FORMA_PAGO_POR_DEFINIR,
  });
  const paymentForm = metodoPago.paymentForm;

  // ── 2 · 🔴 LA RESERVA. Aquí muere el segundo clic ───────────────────
  const folio = await siguienteFolio(institutionId, config.folioPrefix);
  let reserva;
  try {
    reserva = await prisma.eduInvoice.create({
      data: {
        institutionId,
        chargeId: charge.id,
        activeChargeId: charge.id,
        patientId: charge.patientId,
        folio,
        status: "STAMPING",
        environment,
        receptorRfc: receptor.rfc,
        receptorLegalName: receptor.legalName,
        receptorTaxRegime: receptor.taxRegime,
        receptorZip: receptor.zipCode,
        receptorEmail: receptor.email,
        usoCfdi: receptor.usoCfdi,
        paymentForm,
        taxMode,
        subtotalCents: charge.subtotalCents,
        discountCents: charge.discountCents,
        totalCents: charge.totalCents,
        conceptos: conceptos as unknown as Prisma.InputJsonValue,
        issuedByUserId: ctx.eduUserId,
      },
      select: { id: true, folio: true },
    });
  } catch (err) {
    if (esConflictoDeUnico(err)) {
      // Puede ser el candado del cobro (dos clics) o una colisión de folio
      // (dos facturas distintas a la vez). Las dos se resuelven igual:
      // reintentar. El mensaje dice cuál es la más probable.
      const viva = await prisma.eduInvoice.findFirst({
        where: { institutionId, activeChargeId: charge.id },
        select: { folio: true, status: true },
      });
      if (viva) {
        throw new EduPadronError(
          viva.status === "STAMPING"
            ? `El cobro ${charge.folio} ya se está facturando en este momento (${viva.folio}). Espera a que termine antes de volver a intentarlo.`
            : `El cobro ${charge.folio} ya tiene la factura ${viva.folio}. Para volver a facturarlo, cancela esa primero.`,
          409,
        );
      }
      throw new EduPadronError(
        "Dos facturas se emitieron al mismo tiempo y chocaron por el folio. Vuelve a intentarlo.",
        409,
      );
    }
    throw err;
  }

  // ── 3 · el timbrado ─────────────────────────────────────────────────
  try {
    const orgApiKey = await llaveDeLaOrganizacion(
      institutionId,
      config.facturapiOrgId,
      environment,
    );

    // Lista negra EFOS del SAT (art. 69-B). FAIL-OPEN: solo bloquea si el
    // SAT lo marca explícito; un RFC inexistente lo rechaza el timbrado.
    const efos = await validateRfc(orgApiKey, receptor.rfc);
    if (!efos.ok) {
      throw new Error(
        `El RFC ${receptor.rfc} aparece en la lista negra del SAT (EFOS, art. 69-B); no se le puede facturar.`,
      );
    }

    const customerId = await createOrUpdateCustomer(orgApiKey, {
      legal_name: receptor.legalName,
      tax_id: receptor.rfc,
      tax_system: receptor.taxRegime,
      email: receptor.email ?? undefined,
      address: { zip: receptor.zipCode },
    });

    const result = await createInvoice({
      orgApiKey,
      customerId,
      usoCfdi: receptor.usoCfdi,
      paymentForm,
      // 🔴 H-12 · PUE / PPD. El default del helper compartido sigue siendo
      // "PUE", así que el dental no cambia una línea.
      paymentMethod: metodoPago.metodo,
      items: eduItemsFacturapi(conceptos, taxMode),
    });

    // ── 🔴 H-74 · ¿LO TIMBRADO ES LO COBRADO? ─────────────────────────
    // El cuadre de antes compara las LÍNEAS contra el cobro; nadie
    // comparaba lo que Facturapi dice que timbró contra el total del
    // cobro. Si difieren, el comprobante ya existe y no se puede deshacer
    // desde aquí: se DEJA ESCRITO en la factura para que la escuela lo
    // vea y decida, en vez de descubrirlo el día de la conciliación.
    // ⚠️ CON TOLERANCIA, y descartando el total fantasma. Es la misma
    // lección que el dental ya aprendió en `src/lib/invoice-totals.ts`: con
    // IVA incluido, Facturapi redondea CONCEPTO A CONCEPTO, así que una
    // factura correcta puede diferir un centavo por línea; y un `total`
    // ausente o cero en la respuesta es un dato que falta, no un
    // descuadre. Marcar como sospechosa una factura sana es peor que no
    // marcar nada: el aviso deja de leerse.
    const timbradoCents = Math.round(Number(result.total) * 100);
    const toleranciaCents = 1 + conceptos.length;
    const descuadre =
      Number.isFinite(timbradoCents) &&
      timbradoCents > 0 &&
      Math.abs(timbradoCents - charge.totalCents) > toleranciaCents
        ? `El CFDI se timbró por ${eduMoney(timbradoCents)} y el cobro ${charge.folio} dice ${eduMoney(charge.totalCents)}. Revísalo con tu contador: el comprobante ya está emitido.`
        : null;

    // El XML se baja y se guarda AQUÍ mismo: es el documento fiscal, pesa
    // unos kilobytes y no puede depender de que Facturapi siga en pie
    // dentro de cinco años. Si la descarga falla, la factura NO se
    // invalida: queda con su UUID y el XML se baja luego bajo demanda.
    let xml: string | null = null;
    try {
      const buf = await downloadInvoiceFile(orgApiKey, result.id, "xml");
      xml = new TextDecoder("utf-8").decode(buf);
    } catch (err) {
      console.warn(
        `[instituto/facturacion] timbrado OK pero no se pudo guardar el XML de ${result.uuid}:`,
        mensajeDe(err),
      );
    }

    await prisma.eduInvoice.update({
      where: { id: reserva.id },
      data: {
        status: "VALID",
        facturapiId: result.id,
        uuid: result.uuid,
        stampedAt: new Date(),
        xml,
        xmlUrl: result.xml_url ?? null,
        pdfUrl: result.pdf_url ?? null,
        errorMessage: descuadre,
      },
    });

    // ── 🔴 H-67 · EL RECEPTOR SE GUARDA CUANDO YA SE SABE QUE SIRVIÓ ───
    // Este upsert corría ANTES de la reserva y antes de Facturapi, así que
    // un RFC con forma válida pero rechazado (la lista negra EFOS del SAT,
    // o un cobro que ya estaba facturado) dejaba el RFC malo GUARDADO en
    // el paciente: la siguiente factura salía a nombre de quien no era.
    // Ahora se escribe aquí, con el timbre en la mano — y si el guardado
    // fallara, la factura no se toca: ya está emitida.
    if (input.guardarReceptor !== false) {
      const perfil = {
        institutionId,
        rfc: receptor.rfc,
        legalName: receptor.legalName,
        taxRegime: receptor.taxRegime,
        zipCode: receptor.zipCode,
        email: receptor.email,
        usoCfdi: receptor.usoCfdi,
        updatedByUserId: ctx.eduUserId,
      };
      await prisma.eduPatientTaxProfile
        .upsert({
          where: { patientId: charge.patientId },
          create: { patientId: charge.patientId, ...perfil },
          update: perfil,
        })
        .catch((err) => {
          console.warn(
            `[instituto/facturacion] timbrado OK pero no se pudo guardar el perfil fiscal de ${charge.patientId}:`,
            mensajeDe(err),
          );
        });
    }

    return { id: reserva.id, folio: reserva.folio, uuid: result.uuid, environment };
  } catch (err) {
    const dudoso = pudoHaberTimbrado(err);
    if (dudoso) {
      // 🔴 NO se libera el cobro. La fila se queda en STAMPING con el
      // motivo escrito: alguien tiene que mirar Facturapi antes de volver
      // a facturar ese cobro, porque el timbre pudo haber salido.
      await prisma.eduInvoice
        .update({
          where: { id: reserva.id },
          data: {
            errorMessage:
              `La llamada a Facturapi se cortó y NO se sabe si el timbre salió: ${mensajeDe(err)}`.slice(
                0,
                500,
              ),
          },
        })
        .catch(() => undefined);
      throw new EduPadronError(
        `La conexión con Facturapi se cortó y no se sabe si el comprobante llegó a timbrarse. La factura ${reserva.folio} quedó marcada como "Timbrando" y el cobro NO se liberó a propósito: revísalo en el panel de Facturapi antes de volver a facturarlo.`,
        502,
      );
    }

    // Respuesta del proveedor: no hubo timbre. El cobro se libera.
    await prisma.eduInvoice
      .update({
        where: { id: reserva.id },
        data: {
          status: "FAILED",
          activeChargeId: null,
          errorMessage: mensajeDe(err).slice(0, 500),
        },
      })
      .catch(() => undefined);
    throw new EduPadronError(`No se pudo timbrar: ${mensajeDe(err)}`, 422);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · CANCELAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cancela una factura ante Facturapi (y ante el SAT, si el instituto está
 * EN VIVO) y deja el motivo escrito.
 *
 * 🔴 NO BORRA NADA. La fila se queda con su UUID, su XML y sus conceptos:
 * un comprobante cancelado sigue existiendo, y la contabilidad de la
 * escuela tiene que poder verlo. Lo único que cambia es `activeChargeId`,
 * que pasa a NULL — y eso es lo que deja volver a facturar el cobro.
 */
export async function cancelEduInvoice(
  ctx: EduClinicaContext,
  invoiceId: string,
  input: { motive?: unknown; reason?: unknown },
  /** La zona del INSTITUTO, para que la fila que vuelve diga el mismo día
   *  que la lista. En Tijuana, una factura de las 23:30 cambiaba de día. */
  options: { timeZone?: string } = {},
): Promise<EduInvoiceRow> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(invoiceId);
  if (!id) throw new EduPadronError("Falta la factura que se va a cancelar.", 400);

  if (!esEduCancelMotive(input.motive)) {
    throw new EduPadronError(
      "Elige el motivo de cancelación del SAT. Sin motivo el SAT no acepta la cancelación.",
      400,
    );
  }
  const motive = input.motive;
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  if (reason.length < 5) {
    throw new EduPadronError(
      "Escribe con tus palabras por qué se cancela. Un motivo del catálogo no explica nada a quien lo lea en seis meses.",
      400,
    );
  }

  const factura = await prisma.eduInvoice.findFirst({ where: { institutionId, id } });
  if (!factura) throw new EduPadronError("No se encontró esa factura.", 404);
  if (factura.status === "CANCELLED") {
    throw new EduPadronError("Esa factura ya está cancelada.", 409);
  }
  if (factura.status !== "VALID") {
    throw new EduPadronError(
      factura.status === "STAMPING"
        ? "Esa factura se quedó a medias y no tiene folio fiscal confirmado. Revísala en Facturapi antes de cancelarla."
        : "Esa factura nunca se timbró: no hay nada que cancelar ante el SAT.",
      409,
    );
  }

  const config = await fiscalConfigRaw(institutionId);
  if (!config?.facturapiOrgId) {
    throw new EduPadronError(
      "El instituto no tiene organización en Facturapi: no se puede cancelar desde aquí.",
      409,
    );
  }
  if (!factura.facturapiId) {
    throw new EduPadronError(
      "Esa factura no guardó su identificador de Facturapi, así que no se puede cancelar desde aquí. Cancélala en el panel de Facturapi.",
      409,
    );
  }

  // 🔴 Se cancela con la llave del ambiente EN QUE SE TIMBRÓ, no con el
  // ambiente actual del instituto: una factura de pruebas no se cancela
  // con la llave de producción, y al revés tampoco.
  const orgApiKey = await llaveDeLaOrganizacion(
    institutionId,
    config.facturapiOrgId,
    factura.environment as EduFiscalEnv,
  );

  // ── 🔴 H-66 · LA RESERVA, ANTES DE HABLAR CON EL SAT ────────────────
  // Esto era un check-then-act de manual: se leía la factura VALID, se
  // llamaba a Facturapi y se escribía con `update({where:{id}})` a secas.
  // Dos peticiones a la vez mandaban DOS cancelaciones al SAT y el segundo
  // motivo pisaba al primero — y el motivo escrito ES el historial, no hay
  // otro. Emitir sí heredó la lección (el índice único de `activeChargeId`)
  // y cancelar no, aunque `caja.ts` la aplica y la explica quince líneas
  // más abajo de donde faltaba.
  //
  // El candado es el ESTADO en el `where`: la primera petición se lleva la
  // fila marcando `cancelledAt`, la segunda cuenta 0 y se entera. El
  // `status` NO se toca todavía: hasta que el SAT conteste, esa factura
  // sigue siendo VÁLIDA y así se lee en toda pantalla.
  // ⚠️ Y LA RESERVA CADUCA. Si el proceso muere entre la reserva y la
  // respuesta del SAT —o si el rollback de abajo tampoco puede escribir—,
  // una reserva eterna dejaría esa factura en 409 PARA SIEMPRE, sin ninguna
  // vía de recuperación (`resolveEduStuckInvoice` solo toca las STAMPING).
  // Con la ventana, dos peticiones simultáneas siguen serializadas —una
  // cancelación tarda segundos— y una abandonada se puede reintentar
  // pasados los EDU_CANCEL_RESERVA_MIN minutos.
  const ahora = new Date();
  const caducada = new Date(ahora.getTime() - EDU_CANCEL_RESERVA_MIN * 60_000);
  const reserva = await prisma.eduInvoice.updateMany({
    where: {
      id: factura.id,
      institutionId,
      status: "VALID",
      OR: [{ cancelledAt: null }, { cancelledAt: { lt: caducada } }],
    },
    data: {
      cancelledAt: ahora,
      cancelledByUserId: ctx.eduUserId,
      cancelMotive: motive,
      cancelReason: reason,
    },
  });
  if (reserva.count === 0) {
    throw new EduPadronError(
      `Esa factura ya se está cancelando (o alguien la canceló mientras escribías el motivo). Espera ${EDU_CANCEL_RESERVA_MIN} minutos y recarga la pantalla antes de volver a intentarlo: una segunda cancelación ante el SAT no se puede deshacer.`,
      409,
    );
  }

  try {
    await cancelInvoice(orgApiKey, factura.facturapiId, motive);
  } catch (err) {
    // 🔴 "RECHAZÓ" Y "NO CONTESTÓ" NO SON LO MISMO — la misma distinción
    // que ya hace el timbrado con `pudoHaberTimbrado`. Si la llamada se
    // cortó a media red, la cancelación PUDO llegar al SAT: soltar la
    // reserva y decir "la rechazaron" sería mentir, y dejaría a alguien
    // mandando una segunda cancelación a ciegas.
    if (pudoHaberTimbrado(err)) {
      await prisma.eduInvoice
        .update({
          where: { id: factura.id },
          data: {
            errorMessage:
              `La cancelación se mandó y la conexión se cortó: NO se sabe si el SAT la aceptó. Revísala en el panel de Facturapi antes de volver a cancelarla. (${mensajeDe(err)})`.slice(
                0,
                500,
              ),
          },
        })
        .catch(() => undefined);
      throw new EduPadronError(
        `La conexión con Facturapi se cortó y no se sabe si la cancelación llegó al SAT. La factura ${factura.folio} quedó marcada: revísala en el panel de Facturapi antes de volver a intentarlo.`,
        502,
      );
    }

    // El SAT (o Facturapi) dijo que no: se SUELTA la reserva para que se
    // pueda volver a intentar. Si esta escritura fallara también, la
    // reserva caduca sola por la ventana de arriba; se grita en el log
    // igual, porque es un síntoma.
    await prisma.eduInvoice
      .update({
        where: { id: factura.id },
        data: {
          cancelledAt: null,
          cancelledByUserId: null,
          cancelMotive: null,
          cancelReason: null,
        },
      })
      .catch((err2) => {
        console.error(
          `[instituto/facturacion] la cancelación de ${factura.folio} falló y NO se pudo soltar la reserva:`,
          mensajeDe(err2),
        );
      });
    throw new EduPadronError(`El SAT o Facturapi rechazaron la cancelación: ${mensajeDe(err)}`, 422);
  }

  const actualizada = await prisma.eduInvoice.update({
    where: { id: factura.id },
    data: {
      status: "CANCELLED",
      // 🔴 Esto —y solo esto— es lo que libera el cobro.
      activeChargeId: null,
    },
    select: INVOICE_SELECT,
  });
  return toInvoiceRow(actualizada, invoiceFmt(options.timeZone));
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · DESATORAR UNA FACTURA QUE SE QUEDÓ A MEDIAS
//
// Es la contraparte honesta de la regla "ante la duda no se libera el
// cobro": si nunca hubiera forma de resolver un STAMPING, ese cobro
// quedaría bloqueado para siempre.
//
// Quien lo resuelve tiene que MIRAR Facturapi y decir qué encontró:
//   · encontró el timbre  → pega el UUID y la factura pasa a VALID;
//   · no hay ningún timbre → la marca como fallida y el cobro se libera.
//
// No se adivina desde el servidor a propósito: la única consulta posible
// sería buscar por RFC y fecha en Facturapi, y confundirse de comprobante
// ahí es peor que pedirle a una persona que lo verifique.
// ═══════════════════════════════════════════════════════════════════════

export async function resolveEduStuckInvoice(
  ctx: EduClinicaContext,
  invoiceId: string,
  input: { uuid?: unknown; sinTimbre?: unknown },
  /** La zona del INSTITUTO. Ver `cancelEduInvoice`. */
  options: { timeZone?: string } = {},
): Promise<EduInvoiceRow> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(invoiceId);
  if (!id) throw new EduPadronError("Falta la factura que se va a resolver.", 400);

  const factura = await prisma.eduInvoice.findFirst({ where: { institutionId, id } });
  if (!factura) throw new EduPadronError("No se encontró esa factura.", 404);
  if (factura.status !== "STAMPING") {
    throw new EduPadronError(
      "Esa factura no está a medias: solo se resuelven las que quedaron en «Timbrando».",
      409,
    );
  }

  if (input.sinTimbre === true) {
    const actualizada = await prisma.eduInvoice.update({
      where: { id: factura.id },
      data: {
        status: "FAILED",
        activeChargeId: null,
        errorMessage:
          `Revisada a mano: en Facturapi no aparece ningún comprobante para este cobro. El cobro quedó libre.`.slice(
            0,
            500,
          ),
      },
      select: INVOICE_SELECT,
    });
    return toInvoiceRow(actualizada, invoiceFmt(options.timeZone));
  }

  const uuid = typeof input.uuid === "string" ? input.uuid.trim().toUpperCase() : "";
  if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(uuid)) {
    throw new EduPadronError(
      "Pega el folio fiscal (UUID) tal como aparece en Facturapi, o marca que no se timbró nada.",
      400,
    );
  }

  try {
    const actualizada = await prisma.eduInvoice.update({
      where: { id: factura.id },
      data: {
        status: "VALID",
        uuid,
        stampedAt: factura.stampedAt ?? new Date(),
        errorMessage:
          "Recuperada a mano: el comprobante SÍ se había timbrado y el folio fiscal se capturó desde Facturapi.",
      },
      select: INVOICE_SELECT,
    });
    return toInvoiceRow(actualizada, invoiceFmt(options.timeZone));
  } catch (err) {
    if (esConflictoDeUnico(err)) {
      throw new EduPadronError(
        "Ese folio fiscal ya está registrado en otra factura del instituto. Revisa que sea el UUID correcto.",
        409,
      );
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · DESCARGAR EL XML Y EL PDF
// ═══════════════════════════════════════════════════════════════════════

export interface EduInvoiceFile {
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
}

/**
 * El archivo de una factura.
 *
 * El XML sale de la BASE cuando está guardado (que es lo normal): no se le
 * pide a Facturapi algo que ya tenemos, y así el histórico sobrevive a que
 * el proveedor cambie. El PDF siempre se pide a Facturapi — es una
 * representación que se puede regenerar, y guardar megabytes de PDF en
 * Postgres es cómo se mata una base.
 *
 * 🔴 Se descarga con la llave del ambiente EN QUE SE TIMBRÓ. Un CFDI vive
 * en el ambiente donde nació: al pasar el instituto a EN VIVO, los de
 * pruebas seguirían descargándose porque cada fila recuerda el suyo.
 */
export async function downloadEduInvoiceFile(
  ctx: EduClinicaContext,
  invoiceId: string,
  format: "xml" | "pdf",
): Promise<EduInvoiceFile> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(invoiceId);
  if (!id) throw new EduPadronError("Falta la factura.", 400);

  const factura = await prisma.eduInvoice.findFirst({ where: { institutionId, id } });
  if (!factura) throw new EduPadronError("No se encontró esa factura.", 404);

  const nombre = `${factura.folio}${factura.uuid ? `-${factura.uuid}` : ""}.${format}`;

  if (format === "xml" && factura.xml) {
    return {
      bytes: new TextEncoder().encode(factura.xml).buffer as ArrayBuffer,
      filename: nombre,
      contentType: "application/xml; charset=utf-8",
    };
  }

  if (!factura.facturapiId) {
    throw new EduPadronError(
      "Esa factura no llegó a timbrarse, así que no hay documento que descargar.",
      404,
    );
  }
  const config = await fiscalConfigRaw(institutionId);
  if (!config?.facturapiOrgId) {
    throw new EduPadronError("El instituto no tiene organización en Facturapi.", 409);
  }

  const orgApiKey = await llaveDeLaOrganizacion(
    institutionId,
    config.facturapiOrgId,
    factura.environment as EduFiscalEnv,
  );

  try {
    const bytes = await downloadInvoiceFile(orgApiKey, factura.facturapiId, format);
    return {
      bytes,
      filename: nombre,
      contentType:
        format === "pdf" ? "application/pdf" : "application/xml; charset=utf-8",
    };
  } catch (err) {
    throw new EduPadronError(
      `No se pudo descargar el ${format.toUpperCase()} desde Facturapi: ${mensajeDe(err)}`,
      502,
    );
  }
}
