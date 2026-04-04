/**
 * Facturapi integration for CFDI 4.0
 * Docs: https://docs.facturapi.io
 * 
 * Architecture: MediFlow has ONE Facturapi account.
 * Each clinic is an "Organization" in Facturapi (multi-RFC).
 * The clinic configures their RFC/CSD once in Settings.
 * We call Facturapi on their behalf using their orgId.
 */

const FACTURAPI_BASE = "https://www.facturapi.io/v2";

// User key = master key for creating organizations
const USER_KEY = process.env.FACTURAPI_USER_KEY!;

// Claves SAT para servicios médicos
export const CLAVES_SAT_MEDICOS = {
  // Servicios médicos generales
  consulta:        { clave: "85101500", descripcion: "Servicios de consulta médica" },
  dental:          { clave: "85121500", descripcion: "Servicios de odontología" },
  psicologia:      { clave: "85122200", descripcion: "Servicios de psicología" },
  nutricion:       { clave: "85181600", descripcion: "Servicios de nutriología" },
  laboratorio:     { clave: "85101700", descripcion: "Servicios de laboratorio clínico" },
  radiologia:      { clave: "85101800", descripcion: "Servicios de radiología" },
  cirugia:         { clave: "85102200", descripcion: "Servicios quirúrgicos" },
  otro:            { clave: "85101500", descripcion: "Servicios médicos" },
};

export const UNIDAD_SAT = "E48"; // Unidad de servicio

export const REGIMENES_FISCALES = [
  { clave: "601", descripcion: "General de Ley Personas Morales" },
  { clave: "603", descripcion: "Personas Morales con Fines no Lucrativos" },
  { clave: "605", descripcion: "Sueldos y Salarios e Ingresos Asimilados a Salarios" },
  { clave: "606", descripcion: "Arrendamiento" },
  { clave: "607", descripcion: "Régimen de Enajenación o Adquisición de Bienes" },
  { clave: "608", descripcion: "Demás ingresos" },
  { clave: "610", descripcion: "Residentes en el Extranjero sin Establecimiento Permanente en México" },
  { clave: "611", descripcion: "Ingresos por Dividendos (socios y accionistas)" },
  { clave: "612", descripcion: "Personas Físicas con Actividades Empresariales y Profesionales" },
  { clave: "614", descripcion: "Ingresos por intereses" },
  { clave: "615", descripcion: "Régimen de los ingresos por obtención de premios" },
  { clave: "616", descripcion: "Sin obligaciones fiscales" },
  { clave: "621", descripcion: "Incorporación Fiscal" },
  { clave: "622", descripcion: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras" },
  { clave: "623", descripcion: "Opcional para Grupos de Sociedades" },
  { clave: "624", descripcion: "Coordinados" },
  { clave: "625", descripcion: "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas" },
  { clave: "626", descripcion: "Régimen Simplificado de Confianza" },
];

export const USOS_CFDI = [
  { clave: "G03", descripcion: "Gastos en general" },
  { clave: "D01", descripcion: "Honorarios médicos, dentales y gastos hospitalarios" },
  { clave: "D02", descripcion: "Gastos médicos por incapacidad o discapacidad" },
  { clave: "D04", descripcion: "Donativos" },
  { clave: "D07", descripcion: "Primas por seguros de gastos médicos" },
  { clave: "S01", descripcion: "Sin efectos fiscales" },
  { clave: "CP01", descripcion: "Pagos" },
];

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

export async function updateOrgLegal(orgId: string, legalData: {
  name: string; rfc: string; regimen_fiscal: string; address: {
    street?: string; exterior?: string; zip: string;
    city?: string; state?: string; country?: string;
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
  legal_name: string; rfc: string; tax_system: string; email?: string;
  address: { zip: string }
}): Promise<string> {
  // Try to find existing
  const searchRes = await fetch(`${FACTURAPI_BASE}/customers?q=${customer.rfc}`, {
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

// Get org API key (each org has its own key)
export async function getOrgApiKey(orgId: string): Promise<string> {
  const res = await fetch(`${FACTURAPI_BASE}/organizations/${orgId}/apikeys`, {
    headers: { "Authorization": `Bearer ${USER_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Error obteniendo API key de la organización");
  return data.secret_key;
}

// Validate RFC with SAT via Facturapi
export async function validateRfc(rfc: string): Promise<{ valid: boolean; name?: string }> {
  try {
    const res = await fetch(`${FACTURAPI_BASE}/tools/validate_rfc?rfc=${rfc}`, {
      headers: { "Authorization": `Bearer ${USER_KEY}` },
    });
    const data = await res.json();
    return { valid: data.is_valid, name: data.sat_name };
  } catch {
    return { valid: false };
  }
}
