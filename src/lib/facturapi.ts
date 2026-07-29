/**
 * Facturapi integration for CFDI 4.0
 * Docs: https://docs.facturapi.io
 * 
 * Architecture: DaleControl has ONE Facturapi account.
 * Each clinic is an "Organization" in Facturapi (multi-RFC).
 * The clinic configures their RFC/CSD once in Settings.
 * We call Facturapi on their behalf using their orgId.
 */

import { prisma } from "./prisma";
import { encryptField, decryptField } from "./crypto/envelope";
import { facturapiEnv } from "./facturapi-env";

const FACTURAPI_BASE = "https://www.facturapi.io/v2";

// User key = master key for creating organizations
const USER_KEY = process.env.FACTURAPI_USER_KEY!;

// Catálogos SAT (client-safe) — definidos en ./cfdi-catalogs y re-exportados aquí
// para no romper los imports server-side existentes (`@/lib/facturapi`).
export { CLAVES_SAT_MEDICOS, UNIDAD_SAT, REGIMENES_FISCALES, USOS_CFDI, FORMAS_PAGO_SAT } from "./cfdi-catalogs";

// ── Organization management ────────────────────────────────────────────────────

export async function createOrganization(name: string): Promise<string> {
  const res = await fetch(`${FACTURAPI_BASE}/organizations`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${USER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Error creando organización");
  return data.id;
}

// Payload real de PUT /organizations/{id}/legal: legal_name + tax_system (+ name
// comercial opcional). El RFC de la org NO va aquí — lo determina el CSD al subirlo
// (en TEST, Facturapi timbra con su certificado de prueba EKU9003173C9).
export async function updateOrgLegal(orgId: string, legalData: {
  name?: string; legal_name: string; tax_system: string; address: {
    street?: string; exterior?: string; zip: string;
    city?: string; state?: string;
  }
}) {
  const res = await fetch(`${FACTURAPI_BASE}/organizations/${orgId}/legal`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${USER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(legalData),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.message ?? "Error actualizando datos fiscales");
  }
  // Los datos fiscales cambiaron → el estado cacheado de la org quedó viejo.
  orgStatusCache.delete(orgId);
}

// ── Customer (receptor) management ────────────────────────────────────────────

export async function createOrUpdateCustomer(orgApiKey: string, customer: {
  legal_name: string; tax_id: string; tax_system: string; email?: string;
  address: { zip: string }
}): Promise<string> {
  // Try to find existing
  const searchRes = await fetch(`${FACTURAPI_BASE}/customers?q=${customer.tax_id}`, {
    headers: { "Authorization": `Bearer ${orgApiKey}` },
  });
  const searchData = await searchRes.json();
  if (searchData.data?.length > 0) return searchData.data[0].id;

  // Create new
  const res = await fetch(`${FACTURAPI_BASE}/customers`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${orgApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(customer),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Error creando cliente fiscal");
  return data.id;
}

// ── Invoice creation ───────────────────────────────────────────────────────────

export interface InvoiceItem {
  product: {
    description: string;
    product_key: string;  // Clave SAT
    unit_key?: string;    // E48 = servicio
    price: number;
    tax_included?: boolean;
    // Impuestos del concepto (referencia oficial, guía de Productos):
    //   IVA 16% → [{ type: "IVA", rate: 0.16 }] (con tax_included según el caso)
    //   Exento  → [{ type: "IVA", factor: "Exento", rate: 0 }] + tax_included:false
    // Sin `taxes`, Facturapi desglosa IVA 16% por default — por eso ahora se
    // manda SIEMPRE explícito desde el timbrado.
    taxes?: { type: string; rate?: number; factor?: string; withholding?: boolean }[];
  };
  quantity: number;
  discount?: number;
}

export interface CreateInvoiceParams {
  orgApiKey: string;
  customerId: string;
  usoCfdi: string;
  items: InvoiceItem[];
  paymentForm?: string; // 01=efectivo, 03=transferencia, 04=tarjeta crédito, 28=tarjeta débito
}

export interface InvoiceResult {
  id: string;
  uuid: string;
  total: number;
  pdf_url?: string;
  xml_url?: string;
}

export async function createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult> {
  const res = await fetch(`${FACTURAPI_BASE}/invoices`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${params.orgApiKey}`,
      "Content-Type": "application/json",
    },
    // OJO: el payload de POST /invoices NO acepta "notes" — Facturapi lo
    // rechaza con 400 "El campo notes no está permitido".
    body: JSON.stringify({
      type: "I", // Ingreso
      customer: params.customerId,
      use: params.usoCfdi,
      payment_form: params.paymentForm ?? "03", // Transferencia por defecto
      payment_method: "PUE", // Pago en una sola exhibición
      items: params.items,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Error timbrado CFDI");
  return {
    id:      data.id,
    uuid:    data.uuid,
    total:   data.total,
    pdf_url: data.pdf_url,
    xml_url: data.xml_url,
  };
}

export async function cancelInvoice(orgApiKey: string, invoiceId: string, motive = "02"): Promise<void> {
  const res = await fetch(`${FACTURAPI_BASE}/invoices/${invoiceId}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${orgApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ motive }), // 01=comprobante emitido con errores con relación, 02=sin relación
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.message ?? "Error cancelando CFDI");
  }
}

// ── Estado de la organización (¿puede timbrar en Live?) ─────────────────────────

/**
 * Pasos que Facturapi reporta como pendientes para que la organización pueda
 * emitir en Live. El enum documentado es exactamente:
 *   legal       → datos fiscales (razón social, régimen, domicilio)
 *   certificate → CSD cargado
 *   manifiesto  → Carta Manifiesto firmada con la e.firma del RFC emisor
 *   logo        → logo de la organización (sale en el PDF)
 * `description` viene lista para mostrarse al usuario.
 */
export interface OrgPendingStep { type: string; description: string | null }

export interface OrgStatus {
  /** false = la organización registrada ya no existe en Facturapi (404). */
  exists:               boolean;
  isProductionReady:    boolean;
  pendingSteps:         OrgPendingStep[];
  /**
   * false = Facturapi dice que la org NO está lista pero no enumeró ni un paso
   * pendiente, así que no se sabe qué falta. Los booleans de abajo pasan a null:
   * ausencia de evidencia no es evidencia de que esté hecho.
   */
  stepsKnown:           boolean;
  hasLegal:             boolean | null;
  hasCertificate:       boolean | null;
  manifestSigned:       boolean | null;
  hasLogo:              boolean | null;
  certificateExpiresAt: string | null;
}

const ORG_STATUS_TTL_MS = 20_000;
const orgStatusCache = new Map<string, { at: number; status: OrgStatus }>();

/**
 * Lee el estado real de la organización en Facturapi (GET /v2/organizations/{id})
 * — `is_production_ready` + `pending_steps` son la FUENTE DE VERDAD de qué le
 * falta a la clínica para timbrar con validez fiscal.
 *
 * Se autentica con la USER_KEY. Cachea en memoria unos segundos para no pegarle
 * a Facturapi en cada render del panel ni en cada timbrado.
 */
export async function getOrganizationStatus(orgId: string, opts?: { refresh?: boolean }): Promise<OrgStatus> {
  const hit = orgStatusCache.get(orgId);
  if (!opts?.refresh && hit && Date.now() - hit.at < ORG_STATUS_TTL_MS) return hit.status;

  const res = await fetch(`${FACTURAPI_BASE}/organizations/${orgId}`, {
    headers: { "Authorization": `Bearer ${USER_KEY}` },
  });

  if (res.status === 404) {
    const missing: OrgStatus = {
      exists: false, isProductionReady: false, pendingSteps: [], stepsKnown: true,
      hasLegal: false, hasCertificate: false, manifestSigned: false, hasLogo: false,
      certificateExpiresAt: null,
    };
    orgStatusCache.set(orgId, { at: Date.now(), status: missing });
    return missing;
  }
  if (!res.ok) {
    let msg = "Error consultando el estado de tu organización en Facturapi";
    try { const d = await res.json(); msg = d?.message ?? msg; } catch { /* body vacío/binario */ }
    throw new Error(msg);
  }

  const org = await res.json();
  const rawSteps: any[] = Array.isArray(org?.pending_steps) ? org.pending_steps : [];
  const pendingSteps: OrgPendingStep[] = rawSteps.map((s: any) => (
    typeof s === "string"
      ? { type: s, description: null }
      : { type: String(s?.type ?? ""), description: s?.description ?? null }
  ));
  const pending = new Set(pendingSteps.map((s) => s.type));
  const ready = org?.is_production_ready === true;

  // pending_steps enumera TODO lo que falta, así que "no está en la lista" = hecho.
  // Pero si la org no está lista y la lista vino vacía (o no era un array), no se
  // sabe qué falta: se responde null en vez de pintar todo en verde y contradecir
  // el badge "Faltan pasos".
  const stepsKnown = ready || pendingSteps.length > 0;
  const step = (type: string): boolean | null => {
    if (ready) return true;
    if (pending.has(type)) return false;
    return stepsKnown ? true : null;
  };

  // has_certificate lo reporta Facturapi directo: es la señal PRIMARIA y manda
  // sobre pending_steps (un false explícito jamás debe quedar en verde porque el
  // paso no venga listado).
  const certReported = org?.certificate?.has_certificate;

  const status: OrgStatus = {
    exists:               true,
    isProductionReady:    ready,
    pendingSteps,
    stepsKnown,
    hasLegal:             step("legal"),
    hasCertificate:       certReported === true ? true : certReported === false ? false : step("certificate"),
    manifestSigned:       step("manifiesto"),
    hasLogo:              step("logo"),
    certificateExpiresAt: org?.certificate?.expires_at
      ? new Date(org.certificate.expires_at).toISOString()
      : null,
  };
  orgStatusCache.set(orgId, { at: Date.now(), status });
  return status;
}

// ── Org API keys (por organización) ─────────────────────────────────────────────

/**
 * Obtiene la Secret Key de la organización, con la que se timbra y se descargan
 * los CFDI (POST /invoices, GET /invoices/{id}/pdf|xml). El ambiente lo manda
 * FACTURAPI_ENV (ver lib/facturapi-env.ts): en "test" los timbres son de prueba
 * y no llegan al SAT; en "live" tienen validez fiscal.
 *
 * Se autentica con la USER_KEY (llave de cuenta), NO con la org key.
 */
export async function getOrgApiKey(orgId: string): Promise<string> {
  return facturapiEnv() === "live" ? getLiveOrgApiKey(orgId) : getTestOrgApiKey(orgId);
}

/**
 * TEST: GET /v2/organizations/{id}/apikeys/test → Test Secret Key.
 * Facturapi devuelve la llave como string JSON directo (no un objeto);
 * parseamos defensivamente por si algún entorno la envolviera.
 */
async function getTestOrgApiKey(orgId: string): Promise<string> {
  const res = await fetch(`${FACTURAPI_BASE}/organizations/${orgId}/apikeys/test`, {
    headers: { "Authorization": `Bearer ${USER_KEY}` },
  });
  if (!res.ok) {
    let msg = "Error obteniendo la API key de prueba de la organización";
    try { const d = await res.json(); msg = d?.message ?? msg; } catch { /* body vacío/binario */ }
    throw new Error(msg);
  }

  const data = await res.json();
  const key = typeof data === "string"
    ? data
    : (data?.secret_key ?? data?.key ?? data?.value ?? null);
  if (typeof key !== "string" || !key) {
    throw new Error("Respuesta inesperada al obtener la API key de prueba de Facturapi");
  }
  return key;
}

// Llave Live validada, memoizada por proceso: evita releer la BD y re-sondear la
// llave en cada request. No es un secreto nuevo — ya vive en el proceso.
//
// TTL corto a propósito: mientras dura, una llave revocada desde el panel de
// Facturapi se seguiría usando (el timbrado devolvería 401 de Facturapi). 2
// minutos acotan esa ventana y el costo es un GET de sonda cada 2 min por org.
const LIVE_KEY_TTL_MS = 2 * 60 * 1000;
const liveKeyCache = new Map<string, { at: number; key: string }>();

/**
 * LIVE: la Live Secret Key NO se puede volver a leer. GET /apikeys/live lista
 * solo METADATOS ({ first_12, created_at, id }) — nunca la llave usable. La única
 * vía es PUT /apikeys/live, que la devuelve completa UNA vez, así que se guarda
 * cifrada en Clinic.facturApiLiveKey y se reutiliza.
 *
 * Ese PUT jamás corre por request: solo cuando no hay llave guardada, o cuando la
 * guardada dejó de ser válida (revocada desde el panel de Facturapi → 401), y en
 * ese caso una sola vez. A diferencia del PUT de test, el de live NO invalida las
 * llaves anteriores (documentado): genera una nueva, así que regenerar no rompe
 * llamadas en vuelo.
 */
async function getLiveOrgApiKey(orgId: string): Promise<string> {
  const hit = liveKeyCache.get(orgId);
  if (hit && Date.now() - hit.at < LIVE_KEY_TTL_MS) return hit.key;

  const clinic = await prisma.clinic.findFirst({
    where:  { facturApiOrgId: orgId },
    select: { facturApiLiveKey: true },
  });

  const stored = openLiveKey(clinic?.facturApiLiveKey);
  if (stored) {
    const verdict = await liveKeyIsValid(orgId, stored);
    // Solo se memoiza una llave que la sonda CONFIRMÓ. Con "unknown" (red caída,
    // 5xx, 429) se usa pero no se cachea, así que el próximo request vuelve a
    // sondear en vez de arrastrar 2 minutos una llave sin verificar.
    if (verdict === "ok") {
      liveKeyCache.set(orgId, { at: Date.now(), key: stored });
      return stored;
    }
    if (verdict === "unknown") return stored;
  }

  const fresh = await createLiveOrgApiKey(orgId);
  const saved = await prisma.clinic.updateMany({
    where: { facturApiOrgId: orgId },
    data:  { facturApiLiveKey: sealLiveKey(fresh) },
  });
  if (saved.count === 0) {
    // No debería pasar: orgId siempre viene de una fila de Clinic. Si pasa, la
    // llave no quedó guardada y se regeneraría en cada arranque en frío — se
    // registra en vez de fallar en silencio.
    console.error(`[facturapi] Live Secret Key generada pero NO guardada: ninguna clínica con facturApiOrgId=${orgId}`);
  }
  liveKeyCache.set(orgId, { at: Date.now(), key: fresh });
  return fresh;
}

/**
 * Cifra la llave para guardarla (AES-256-GCM, el mismo envelope del token de
 * Twilio/WhatsApp). encryptField TIRA si DATA_ENCRYPTION_KEY no está
 * configurada: en ese caso se guarda en claro y se avisa en el log, porque
 * dejar a la clínica sin poder timbrar es peor que el riesgo del texto plano
 * (que además es lo que ya hacen otros secretos de esta tabla).
 */
function sealLiveKey(key: string): string {
  try {
    return encryptField(key) ?? key;
  } catch {
    console.warn("[facturapi] DATA_ENCRYPTION_KEY ausente o inválida: la Live Secret Key se guarda SIN cifrar");
    return key;
  }
}

/**
 * Lee la llave guardada. decryptField deja pasar el texto plano legado tal cual,
 * pero TIRA si el envelope está cifrado y la llave maestra falta o cambió: ahí se
 * devuelve null para regenerar (PUT /apikeys/live NO invalida las anteriores, así
 * que es seguro) en vez de romper el timbrado. Se auto-cura en un solo request.
 */
function openLiveKey(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    return decryptField(stored) || null;
  } catch {
    console.warn("[facturapi] Live Secret Key ilegible (¿DATA_ENCRYPTION_KEY rotada?): se generará una nueva");
    return null;
  }
}

/**
 * ¿La llave Live guardada sirve para ESTA organización? GET /v2/organizations/{id}
 * acepta la Live Secret Key de la propia org, así que sirve de sonda barata.
 *
 * No basta con mirar el status: una llave de OTRA organización no da 401, da 404
 * (no la ve), así que se exige además que el cuerpo traiga el id correcto. Un
 * fallo de red o un 5xx/429 se dan por válidos para no regenerar llaves por un
 * problema transitorio.
 */
async function liveKeyIsValid(orgId: string, key: string): Promise<"ok" | "invalid" | "unknown"> {
  try {
    const res = await fetch(`${FACTURAPI_BASE}/organizations/${orgId}`, {
      headers: { "Authorization": `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) return "invalid";
    if (!res.ok) return "unknown"; // 5xx / 429: transitorio, no se toca la llave
    const org = await res.json().catch(() => null);
    if (org?.id && org.id !== orgId) return "invalid";
    return "ok";
  } catch {
    return "unknown";
  }
}

/** PUT /v2/organizations/{id}/apikeys/live → devuelve la llave completa (string). */
async function createLiveOrgApiKey(orgId: string): Promise<string> {
  const res = await fetch(`${FACTURAPI_BASE}/organizations/${orgId}/apikeys/live`, {
    method:  "PUT",
    headers: { "Authorization": `Bearer ${USER_KEY}` },
  });
  if (!res.ok) {
    let msg = "Error generando la API key de producción de la organización";
    try { const d = await res.json(); msg = d?.message ?? msg; } catch { /* body vacío/binario */ }
    throw new Error(msg);
  }
  const data = await res.json();
  const key = typeof data === "string"
    ? data
    : (data?.secret_key ?? data?.key ?? data?.value ?? null);
  if (typeof key !== "string" || !key) {
    throw new Error("Respuesta inesperada al generar la API key de producción de Facturapi");
  }
  return key;
}

// ── Certificado de Sello Digital (CSD) ──────────────────────────────────────────

export interface CsdStatus {
  hasCertificate: boolean;
  validUntil:     string | null; // expires_at del certificado (ISO)
  serialNumber:   string | null; // número de serie del CSD
}

/**
 * Sube el CSD (Certificado de Sello Digital) de la clínica a su organización.
 * Endpoint Facturapi: PUT /v2/organizations/{id}/certificate — multipart/form-data
 * con los campos `cer`, `key` y `password` (los tres obligatorios). Se autentica
 * con la USER_KEY (operación de cuenta), NO con la org key. Responde el objeto
 * Organization modificado, de donde leemos `certificate`.
 *
 * OJO: la ruta es /certificate, NO /csd (esa nunca existió: la referencia oficial
 * solo la menciona en la descripción, "Upload certificates (CSD)"). Al subirlo,
 * Facturapi lee el RFC del .cer y lo asigna a legal.tax_id.
 *
 * Nota: en ambiente de PRUEBAS Facturapi timbra con certificados de prueba propios,
 * así que el timbrado funciona sin CSD reales. El CSD es obligatorio solo en Live.
 */
export async function uploadCertificate(
  orgId: string,
  cerBuffer: Buffer,
  keyBuffer: Buffer,
  password: string,
): Promise<CsdStatus> {
  const form = new FormData();
  form.append("cer", new Blob([new Uint8Array(cerBuffer)], { type: "application/octet-stream" }), "cer.cer");
  form.append("key", new Blob([new Uint8Array(keyBuffer)], { type: "application/octet-stream" }), "key.key");
  form.append("password", password);

  // Sin header Content-Type: fetch fija el boundary multipart automáticamente.
  const res = await fetch(`${FACTURAPI_BASE}/organizations/${orgId}/certificate`, {
    method:  "PUT",
    headers: { "Authorization": `Bearer ${USER_KEY}` },
    body:    form,
  });
  // res.ok ANTES de parsear: un PUT multipart de dos archivos es justo el que
  // puede volver con 413/502/504 y cuerpo vacío o HTML, y ahí res.json() tiraba
  // un SyntaxError que se le mostraba al usuario tal cual.
  if (!res.ok) {
    let msg = "Error subiendo el certificado CSD";
    try { const d = await res.json(); msg = d?.message ?? msg; } catch { /* body vacío/HTML */ }
    throw new Error(msg);
  }
  const data = await res.json().catch(() => ({}));

  // El CSD cambió → el estado cacheado de la org (pending_steps) quedó viejo.
  orgStatusCache.delete(orgId);

  const cert = data.certificate ?? {};
  return {
    // El 200 ya confirma que Facturapi aceptó el certificado; has_certificate es
    // la confirmación explícita cuando viene.
    hasCertificate: cert.has_certificate ?? true,
    validUntil:     cert.expires_at ? new Date(cert.expires_at).toISOString() : null,
    serialNumber:   cert.serial_number ?? null,
  };
}

/**
 * Descarga el PDF o XML de un CFDI timbrado desde Facturapi usando la org key.
 * Facturapi expone GET /v2/invoices/{id}/pdf y /xml autenticados con la secret
 * key de la organización. Devolvemos el ArrayBuffer para hacer proxy sin exponer
 * la org key al cliente.
 */
export async function downloadInvoiceFile(
  orgApiKey: string,
  facturapiId: string,
  format: "pdf" | "xml",
): Promise<ArrayBuffer> {
  const res = await fetch(`${FACTURAPI_BASE}/invoices/${facturapiId}/${format}`, {
    headers: { "Authorization": `Bearer ${orgApiKey}` },
  });
  if (!res.ok) {
    let msg = `Error descargando ${format.toUpperCase()} del CFDI`;
    try { const d = await res.json(); msg = d.message ?? msg; } catch { /* body binario o vacío */ }
    throw new Error(msg);
  }
  return res.arrayBuffer();
}

/**
 * Descarga el PDF/XML resolviendo la llave por sí misma, con un detalle importante:
 * un CFDI vive en el ambiente donde se timbró y los registros NO guardan cuál era.
 * Al encender Live, todos los CFDI timbrados en PRUEBAS dejarían de descargarse
 * (la llave live no los ve). Por eso en live, si falla, se reintenta UNA vez con la
 * llave de pruebas: así el histórico sigue disponible sin migrar datos.
 */
export async function downloadInvoiceFileForOrg(
  orgId: string,
  facturapiId: string,
  format: "pdf" | "xml",
): Promise<ArrayBuffer> {
  const primary = await getOrgApiKey(orgId);
  try {
    return await downloadInvoiceFile(primary, facturapiId, format);
  } catch (err) {
    if (facturapiEnv() !== "live") throw err;
    const testKey = await getTestOrgApiKey(orgId).catch(() => null);
    if (!testKey) throw err;
    return downloadInvoiceFile(testKey, facturapiId, format);
  }
}

// Valida el RFC contra la lista negra EFOS del SAT (art. 69-B) vía Facturapi.
// Endpoint real: GET /tools/tax_id_validation?tax_id= con la key de la ORG.
// FAIL-OPEN: solo bloquea si el SAT lo marca explícito en la lista negra; si la
// herramienta falla o responde distinto, se permite — el timbrado es el juez
// final del RFC (Facturapi lo rechaza con mensaje claro si no es válido).
export async function validateRfc(orgApiKey: string, rfc: string): Promise<{ ok: boolean; blacklisted?: boolean }> {
  try {
    const res = await fetch(`${FACTURAPI_BASE}/tools/tax_id_validation?tax_id=${encodeURIComponent(rfc)}`, {
      headers: { "Authorization": `Bearer ${orgApiKey}` },
    });
    if (!res.ok) return { ok: true };
    const data = await res.json();
    if (data?.efos?.is_valid === false) return { ok: false, blacklisted: true };
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
