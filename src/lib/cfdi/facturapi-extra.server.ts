// Dos llamadas a Facturapi de ws1-t8 que viven fuera de lib/facturapi.ts a propósito: ese archivo
// lo están editando otras pantallas (cancelación, timbrado) y estas dos no comparten nada con él.
//
//   · enviarCfdiPorCorreo — POST /v2/invoices/{id}/email, cuerpo `{ email: string | string[] }`.
//     Facturapi manda el PDF y el XML del CFDI al correo indicado desde su servicio de correo
//     (doc: https://docs.facturapi.io/en/api/ → Invoices → «Send invoice by email»; SDK oficial
//     facturapi-node, `invoices.sendByEmail(id, { email })`, responde `{ ok: true }`).
//   · rfcDeLaOrganizacion — GET /v2/organizations/{id}: `legal.tax_id` es el RFC que Facturapi
//     tomó del CSD al subirlo (el que de verdad sale en cada CFDI). F-15: compararlo con el del panel.
//
// Las dependencias de red entran por parámetro para probarlas sin Facturapi.

const FACTURAPI_BASE = "https://www.facturapi.io/v2";

type Fetch = typeof fetch;

export class EnvioCorreoError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "EnvioCorreoError";
  }
}

/**
 * Pide a Facturapi que mande el CFDI (PDF + XML) a uno o más correos. Lanza `EnvioCorreoError`
 * con el motivo de Facturapi si no lo acepta. Nunca reintenta: un segundo intento tras un
 * timeout podría mandar el correo dos veces.
 */
export async function enviarCfdiPorCorreo(args: {
  apiKey: string;
  facturapiId: string;
  correos: string[];
  fetchImpl?: Fetch;
}): Promise<void> {
  const f = args.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${FACTURAPI_BASE}/invoices/${encodeURIComponent(args.facturapiId)}/email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: args.correos.length === 1 ? args.correos[0] : args.correos }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new EnvioCorreoError("Facturapi no respondió al pedirle el envío. Revisa en unos minutos si el correo llegó antes de volver a mandarlo.", 504);
  }
  if (!res.ok) {
    let motivo = `Facturapi respondió ${res.status} al mandar el correo.`;
    try {
      const d = await res.json();
      if (typeof d?.message === "string" && d.message) motivo = d.message;
    } catch { /* cuerpo vacío */ }
    throw new EnvioCorreoError(motivo, res.status);
  }
}

const TTL_RFC_MS = 60_000;
const rfcCache = new Map<string, { at: number; rfc: string | null }>();

/** RFC (legal.tax_id) de la organización, o null si no se sabe. Nunca lanza. */
export async function rfcDeLaOrganizacion(orgId: string, opts: { fetchImpl?: Fetch; refresh?: boolean } = {}): Promise<string | null> {
  const userKey = process.env.FACTURAPI_USER_KEY;
  if (!orgId || !userKey) return null;
  const hit = rfcCache.get(orgId);
  if (!opts.refresh && hit && Date.now() - hit.at < TTL_RFC_MS) return hit.rfc;
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${FACTURAPI_BASE}/organizations/${encodeURIComponent(orgId)}`, {
      headers: { Authorization: `Bearer ${userKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const org = await res.json().catch(() => null);
    const rfc = typeof org?.legal?.tax_id === "string" && org.legal.tax_id.trim() ? org.legal.tax_id.trim().toUpperCase() : null;
    rfcCache.set(orgId, { at: Date.now(), rfc });
    return rfc;
  } catch {
    return null;
  }
}

/** Solo pruebas. */
export function _olvidarRfcDeOrganizaciones(): void {
  rfcCache.clear();
}
