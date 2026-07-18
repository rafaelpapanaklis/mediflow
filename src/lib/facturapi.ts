/**
 * Facturapi integration for CFDI 4.0
 * Docs: https://docs.facturapi.io
 * 
 * Architecture: DaleControl has ONE Facturapi account.
 * Each clinic is an "Organization" in Facturapi (multi-RFC).
 * The clinic configures their RFC/CSD once in Settings.
 * We call Facturapi on their behalf using their orgId.
 */

const FACTURAPI_BASE = "https://www.facturapi.io/v2";

// User key = master key for creating organizations
const USER_KEY = process.env.FACTURAPI_USER_KEY!;

// Catálogos SAT (client-safe) — definidos en ./cfdi-catalogs y re-exportados aquí
// para no romper los imports server-side existentes (`@/lib/facturapi`).
export { CLAVES_SAT_MEDICOS, UNIDAD_SAT, REGIMENES_FISCALES, USOS_CFDI } from "./cfdi-catalogs";

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
  notes?: string;
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
    body: JSON.stringify({
      type: "I", // Ingreso
      customer: params.customerId,
      use: params.usoCfdi,
      payment_form: params.paymentForm ?? "03", // Transferencia por defecto
      payment_method: "PUE", // Pago en una sola exhibición
      items: params.items,
      notes: params.notes,
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

// ── Org API keys (por organización) ─────────────────────────────────────────────
// Ambiente de trabajo del CFDI. Hoy TODO corre en PRUEBAS (timbres de prueba, no
// van al SAT). Para activar Live, cambiar a "live" y ajustar getOrgApiKey.
const CFDI_ENV: "test" | "live" = "test";

/**
 * Obtiene la Secret Key de la organización, con la que se timbra y se descargan
 * los CFDI (POST /invoices, GET /invoices/{id}/pdf|xml).
 *
 * TEST (actual): GET /v2/organizations/{id}/test-api-key → Test Secret Key.
 *   Facturapi devuelve la llave como string JSON directo (no un objeto);
 *   parseamos defensivamente por si algún entorno la envolviera.
 * LIVE (futuro): GET /v2/organizations/{id}/apikeys/live lista las Live API
 *   Keys; PUT /apikeys/live genera una nueva (invalida la anterior).
 *
 * Se autentica con la USER_KEY (llave de cuenta), NO con la org key.
 */
export async function getOrgApiKey(orgId: string): Promise<string> {
  if (CFDI_ENV !== "test") {
    // Switch a Live: GET /organizations/{id}/apikeys/live y tomar la llave activa.
    throw new Error("CFDI Live aún no está habilitado");
  }

  const res = await fetch(`${FACTURAPI_BASE}/organizations/${orgId}/apikeys/test`, {
    headers: { "Authorization": `Bearer ${USER_KEY}` },
  });
  if (!res.ok) {
    let msg = "Error obteniendo la API key de prueba de la organización";
    try { const d = await res.json(); msg = d?.message ?? msg; } catch { /* body vacío/binario */ }
    throw new Error(msg);
  }

  // /test-api-key responde la llave como string JSON directo.
  const data = await res.json();
  const key = typeof data === "string"
    ? data
    : (data?.secret_key ?? data?.key ?? data?.value ?? null);
  if (typeof key !== "string" || !key) {
    throw new Error("Respuesta inesperada al obtener la API key de prueba de Facturapi");
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
 * Endpoint Facturapi: PUT /v2/organizations/{id}/csd — multipart/form-data
 * con los campos `cer`, `key` y `password`. Se autentica con la USER_KEY (operación
 * de cuenta), NO con la org key. Devuelve el estado del certificado.
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
  const res = await fetch(`${FACTURAPI_BASE}/organizations/${orgId}/csd`, {
    method:  "PUT",
    headers: { "Authorization": `Bearer ${USER_KEY}` },
    body:    form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Error subiendo el certificado CSD");

  const cert = data.certificate ?? {};
  return {
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
