/**
 * Mandar el CFDI al paciente (ws1-t8, auditoría CFDI F-17) y facturar a un extranjero (F-22).
 * Run: npm run test:cfdi-envio
 *
 * Facturapi simulado con un `fetch` doble: nunca se llama a la red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarCorreos, enmascararCorreo, enmascararTelefono, mensajeWhatsAppCfdi, cfdiSePuedeEnviar,
  motivoFueraDeVentana, DIAS_VIGENCIA_ENLACE,
} from "@/lib/cfdi/envio";
import { rutaDescargaCfdi, verificarEnlaceCfdi, caducidadDesde } from "@/lib/cfdi/enlace-descarga.server";
import { enviarCfdiPorCorreo, EnvioCorreoError, rfcDeLaOrganizacion, _olvidarRfcDeOrganizaciones } from "@/lib/cfdi/facturapi-extra.server";
import {
  clienteFacturapiDelReceptor, errorDeReceptorExtranjero, receptorExtranjero, esReceptorExtranjero,
  RFC_EXTRANJERO, RECEPTOR_EXTRANJERO_HABILITADO,
} from "@/lib/cfdi/extranjero";

function fetchDoble(respuesta: { status: number; body?: unknown }) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(respuesta.body === undefined ? null : JSON.stringify(respuesta.body), { status: respuesta.status });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

// ── Correos ────────────────────────────────────────────────────────────────

test("correos: separa por coma, punto y coma o espacio; minúsculas y sin repetir", () => {
  assert.deepEqual(normalizarCorreos(" Maria@Correo.com ; conta@despacho.mx, maria@correo.com"), { ok: true, correos: ["maria@correo.com", "conta@despacho.mx"] });
  assert.deepEqual(normalizarCorreos(["a@b.mx"]), { ok: true, correos: ["a@b.mx"] });
});

test("correos: vacío, inválido o más de 3 → error claro (sin llamar a Facturapi)", () => {
  assert.match((normalizarCorreos("") as any).error, /Escribe el correo/);
  assert.match((normalizarCorreos("maria@") as any).error, /«maria@» no es un correo válido/);
  assert.match((normalizarCorreos("a@b.mx,c@d.mx,e@f.mx,g@h.mx") as any).error, /Máximo 3/);
  assert.match((normalizarCorreos("x", "en") as any).error, /not a valid email/);
});

test("enmascarar para la bitácora: «maria.lopez@gmail.com» → «m***@gmail.com»; teléfono → últimos 4", () => {
  assert.equal(enmascararCorreo("maria.lopez@gmail.com"), "m***@gmail.com");
  assert.equal(enmascararTelefono("+52 55 1234 5678"), "•••• 5678");
});

test("Facturapi: POST /v2/invoices/{id}/email con { email } (uno) o lista (varios) y la llave de la org", async () => {
  const { f, llamadas } = fetchDoble({ status: 200, body: { ok: true } });
  await enviarCfdiPorCorreo({ apiKey: "sk_test_org", facturapiId: "fapi_123", correos: ["maria@correo.com"], fetchImpl: f });
  assert.equal(llamadas[0].url, "https://www.facturapi.io/v2/invoices/fapi_123/email");
  assert.equal(llamadas[0].init.method, "POST");
  assert.equal((llamadas[0].init.headers as any).Authorization, "Bearer sk_test_org");
  assert.deepEqual(JSON.parse(String(llamadas[0].init.body)), { email: "maria@correo.com" });
  await enviarCfdiPorCorreo({ apiKey: "k", facturapiId: "f", correos: ["a@b.mx", "c@d.mx"], fetchImpl: f });
  assert.deepEqual(JSON.parse(String(llamadas[1].init.body)), { email: ["a@b.mx", "c@d.mx"] });
});

test("Facturapi rechaza (400 con mensaje) → EnvioCorreoError con SU motivo; sin respuesta → 504 y no reintenta", async () => {
  const { f } = fetchDoble({ status: 400, body: { message: "El correo no es válido" } });
  await assert.rejects(enviarCfdiPorCorreo({ apiKey: "k", facturapiId: "f", correos: ["a@b.mx"], fetchImpl: f }),
    (e: unknown) => e instanceof EnvioCorreoError && e.status === 400 && e.message === "El correo no es válido");
  let intentos = 0;
  const caido = (async () => { intentos += 1; throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await assert.rejects(enviarCfdiPorCorreo({ apiKey: "k", facturapiId: "f", correos: ["a@b.mx"], fetchImpl: caido }),
    (e: unknown) => e instanceof EnvioCorreoError && e.status === 504);
  assert.equal(intentos, 1, "un solo intento: reintentar a ciegas podría mandar el correo dos veces");
});

test("RFC de la organización (legal.tax_id) en mayúsculas; error de Facturapi → null, nunca lanza", async () => {
  process.env.FACTURAPI_USER_KEY = "sk_user_prueba";
  _olvidarRfcDeOrganizaciones();
  const ok = fetchDoble({ status: 200, body: { id: "org1", legal: { tax_id: "vada800927dj3" } } });
  assert.equal(await rfcDeLaOrganizacion("org1", { fetchImpl: ok.f }), "VADA800927DJ3");
  _olvidarRfcDeOrganizaciones();
  assert.equal(await rfcDeLaOrganizacion("org2", { fetchImpl: fetchDoble({ status: 500 }).f }), null);
});

// ── WhatsApp: texto y enlace firmado ───────────────────────────────────────

test("mensaje de WhatsApp: nombre, clínica, monto con centavos, nota, UUID y los dos enlaces", () => {
  const m = mensajeWhatsAppCfdi({
    nombre: "María López", clinica: "Clínica Sonrisa", folio: "MF-1042", total: 1600,
    uuid: "AAAA-BBBB", linkPdf: "https://x/pdf", linkXml: "https://x/xml",
  });
  assert.match(m, /^Hola María, Clínica Sonrisa te comparte tu factura \(CFDI\) por \$1,600\.00 MXN \(nota MF-1042\)\./);
  assert.match(m, /Folio fiscal \(UUID\): AAAA-BBBB/);
  assert.match(m, /PDF: https:\/\/x\/pdf\nXML: https:\/\/x\/xml/);
  assert.match(m, new RegExp(`sirven ${DIAS_VIGENCIA_ENLACE} días`));
  assert.doesNotMatch(m, /pagarla/i, "un CFDI ya está pagado: no se dice «Puedes pagarla»");
});

test("enlace firmado: abre con su firma; otra firma, otro CFDI o caducado → no", () => {
  const ahora = new Date("2026-10-03T12:00:00Z");
  const e = caducidadDesde(ahora);
  assert.equal(e - Math.floor(ahora.getTime() / 1000), 7 * 24 * 3600);
  const ruta = rutaDescargaCfdi("cfdi_1", "pdf", e, "secreto");
  const u = new URL(`https://x${ruta}`);
  assert.equal(u.pathname, "/api/cfdi/descarga/cfdi_1");
  assert.equal(u.searchParams.get("f"), "pdf");
  const t = u.searchParams.get("t");
  const ver = (args: Partial<Parameters<typeof verificarEnlaceCfdi>[0]>) =>
    verificarEnlaceCfdi({ cfdiId: "cfdi_1", caduca: String(e), token: t, ahora, secreto: "secreto", ...args });
  assert.equal(ver({}), "ok");
  assert.equal(ver({ cfdiId: "cfdi_2" }), "invalido", "la firma es de OTRO CFDI");
  assert.equal(ver({ caduca: String(e + 3600) }), "invalido", "alargar la caducidad rompe la firma");
  assert.equal(ver({ secreto: "otro" }), "invalido");
  assert.equal(ver({ token: null }), "invalido");
  assert.equal(ver({ ahora: new Date((e + 1) * 1000) }), "caducado");
});

test("solo un CFDI vigente se manda; fuera de la ventana de 24 h el motivo manda al correo", () => {
  assert.equal(cfdiSePuedeEnviar("valid"), true);
  assert.equal(cfdiSePuedeEnviar("cancelled"), false);
  assert.equal(cfdiSePuedeEnviar("pending_cancellation"), false);
  assert.match(motivoFueraDeVentana("es"), /24 h.*Mándala por correo/);
});

// ── Extranjero (F-22) ──────────────────────────────────────────────────────

test("extranjero: receptor con XEXX010101000, 616, país y NumRegIdTrib normalizados", () => {
  const r = receptorExtranjero({ nombre: " John Smith ", zip: "92101", email: "john@mail.com", pais: "usa", numRegIdTrib: " 123-45-6789 " });
  assert.deepEqual(r, {
    rfc: RFC_EXTRANJERO, nombre: "John Smith", regimenFiscal: "616", cp: "92101", email: "john@mail.com",
    extranjero: { pais: "USA", numRegIdTrib: "123-45-6789" },
  });
  assert.equal(esReceptorExtranjero(r), true);
});

test("extranjero: cliente de Facturapi con tax_id = su ID fiscal y address.country (Facturapi pone el XEXX)", () => {
  const r = receptorExtranjero({ nombre: "John Smith", zip: "92101", pais: "USA", numRegIdTrib: "123456789" });
  assert.deepEqual(clienteFacturapiDelReceptor(r, "respaldo@mail.com"), {
    legal_name: "John Smith", tax_id: "123456789", email: "respaldo@mail.com", address: { zip: "92101", country: "USA" },
  });
});

test("nacional: el cliente de Facturapi queda EXACTAMENTE como lo arma hoy el timbrado", () => {
  const r = { rfc: "VADA800927DJ3", nombre: "MARIA LOPEZ", regimenFiscal: "612", cp: "06600" };
  assert.deepEqual(clienteFacturapiDelReceptor(r, "paciente@mail.com"), {
    legal_name: "MARIA LOPEZ", tax_id: "VADA800927DJ3", tax_system: "612", email: "paciente@mail.com", address: { zip: "06600" },
  });
  assert.deepEqual(clienteFacturapiDelReceptor({ ...r, email: "otro@mail.com" }, null).email, "otro@mail.com");
});

test("extranjero: sin país, con MEX, sin ID o ID de más de 40 → error; completo → null", () => {
  const base = { nombre: "John", cp: "92101" };
  assert.match(errorDeReceptorExtranjero({ ...base, extranjero: { pais: "", numRegIdTrib: "1" } })!, /país/);
  assert.match(errorDeReceptorExtranjero({ ...base, extranjero: { pais: "MEX", numRegIdTrib: "1" } })!, /con su RFC/);
  assert.match(errorDeReceptorExtranjero({ ...base, extranjero: { pais: "USA", numRegIdTrib: "" } })!, /identificación fiscal/);
  assert.match(errorDeReceptorExtranjero({ ...base, extranjero: { pais: "USA", numRegIdTrib: "1".repeat(41) } })!, /40/);
  assert.match(errorDeReceptorExtranjero({ nombre: "John", cp: "", extranjero: { pais: "USA", numRegIdTrib: "1" } })!, /código postal/);
  assert.equal(errorDeReceptorExtranjero({ ...base, extranjero: { pais: "CAN", numRegIdTrib: "123456789" } }), null);
});

test("extranjero: encendido — los dos timbrados (ws1-t4, vuelta 2) arman el cliente con clienteFacturapiDelReceptor", () => {
  assert.equal(RECEPTOR_EXTRANJERO_HABILITADO, true);
});
