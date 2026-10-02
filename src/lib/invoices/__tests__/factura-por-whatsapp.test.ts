// ws1-t6 (punto 8 del tercer ticket): «Enviar la factura» por WhatsApp llegaba como aviso de
// deuda («Tienes un saldo pendiente de $300»), sin folio ni link, y quien la creaba no veía
// el texto antes de guardar.
// Correr: npm run test:factura-whatsapp
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMensajeFactura } from "../invoice-message";
import { masReciente, motivoDeLaClinica, vistaEnvioFactura, type DatosVistaEnvio } from "../envio-factura-vista";
import { catalogEntryFor, checkCatalogEntry, countTemplateVariables, DEFAULT_CATALOG_KINDS } from "@/lib/whatsapp/templates-catalog";
import { decideSendMode } from "@/lib/whatsapp/send-mode";
import { WHATSAPP_SEND_KINDS } from "@/lib/whatsapp/system-message";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const base = {
  saludo: { firstName: "María", lastName: "López" },
  clinicName: "Clínica Sonrisa",
  clinicPhone: "555 123 4567",
  invoiceNumber: "MF-0249",
  total: 300,
  balance: 300,
  items: [{ description: "Limpieza dental" }],
};

const rellenar = (body: string, params: string[]) => body.replace(/\{\{(\d+)\}\}/g, (_m, n) => params[Number(n) - 1]);

test("el texto de la nota lleva folio, concepto, monto y cómo pagar; no habla de deuda", () => {
  const m = buildMensajeFactura(base);
  assert.match(m.body, /tu nota MF-0249/);
  assert.match(m.body, /Limpieza dental/);
  assert.match(m.body, /\$300\.00 MXN/);
  assert.match(m.body, /555 123 4567/);
  assert.doesNotMatch(m.body, /saldo pendiente/i);
});

test("con Mercado Pago, el link viaja en el texto Y en la plantilla", () => {
  const m = buildMensajeFactura({ ...base, linkPago: { url: "https://mpago.la/abc123", monto: 300 } });
  assert.match(m.body, /https:\/\/mpago\.la\/abc123/);
  const entrada = catalogEntryFor("invoice_ready")!;
  const recibido = rellenar(entrada.body, m.templateParams);
  assert.match(recibido, /MF-0249/);
  assert.match(recibido, /\$300\.00 MXN/);
  assert.match(recibido, /https:\/\/mpago\.la\/abc123/);
  assert.doesNotMatch(recibido, /saldo pendiente/i);
});

test("con anticipo aplicado, dice el total y lo que queda por pagar", () => {
  const m = buildMensajeFactura({ ...base, total: 1000, balance: 700 });
  assert.match(m.templateParams[3], /\$1,000\.00 MXN \(por pagar: \$700\.00 MXN\)/);
});

test("al responsable de pago se le saluda a él y se dice de quién es la nota", () => {
  const m = buildMensajeFactura({ ...base, saludo: { firstName: "Ana" }, aNombreDe: "Pedro López" });
  assert.match(m.body, /^Hola Ana, .*la nota MF-0249 de Pedro López/);
});

test("la plantilla dc_factura_lista: válida para Meta, de utilidad, se crea sola y sus params encajan", () => {
  const e = catalogEntryFor("invoice_ready");
  assert.ok(e);
  assert.equal(e!.name, "dc_factura_lista");
  assert.equal(e!.category, "UTILITY");
  assert.equal(checkCatalogEntry(e!), null);
  assert.ok(DEFAULT_CATALOG_KINDS.includes("invoice_ready"));
  assert.ok(WHATSAPP_SEND_KINDS.includes("invoice_ready"));
  const m = buildMensajeFactura({ ...base, linkPago: { url: "https://mpago.la/x", monto: 300 } });
  assert.equal(m.templateParams.length, countTemplateVariables(e!.body));
  // Meta rechaza parámetros con saltos de línea.
  for (const p of m.templateParams) assert.doesNotMatch(p, /[\n\t]| {5,}/);
  const d = decideSendMode({ kind: "invoice_ready", windowOpen: false, templates: { invoice_ready: { name: "dc_factura_lista", lang: "es_MX", status: "APPROVED" } as any }, params: m.templateParams });
  assert.equal(d.mode, "template");
});

test("fuera de ventana SIN plantilla de nota aprobada no se manda — nunca cae a la de saldo", () => {
  // Una clínica que solo tiene dc_aviso_saldo aprobada (el caso del ticket).
  const templates = { payment_notice: { name: "dc_aviso_saldo", lang: "es_MX", status: "APPROVED" } } as any;
  const m = buildMensajeFactura(base);
  assert.equal(decideSendMode({ kind: "invoice_ready", windowOpen: false, templates, params: m.templateParams }).mode, "blocked");
});

const datos = (o: Partial<DatosVistaEnvio> = {}): DatosVistaEnvio => ({
  clinica: {
    name: "Clínica Sonrisa", phone: "555 123 4567", timezone: "America/Mexico_City",
    waConnected: true, waPhoneNumberId: "pn", conToken: true,
    waTemplates: { payment_notice: { name: "dc_aviso_saldo", lang: "es_MX", status: "APPROVED" } },
  },
  paciente: { firstName: "María", lastName: "López", phone: "5511111111" },
  ultimoEntrante: null,
  ultimoCobro: null,
  ahora: new Date("2026-10-02T18:00:00Z"),
  ...o,
});

test("vista antes de guardar: ventana abierta → mensaje normal", () => {
  const v = vistaEnvioFactura(datos({ ultimoEntrante: new Date("2026-10-02T10:00:00Z") }));
  assert.equal(v.modo, "text");
  assert.equal(v.paciente.firstName, "María");
});

test("vista antes de guardar: ventana cerrada y solo la plantilla de saldo → bloqueado con motivo claro", () => {
  const v = vistaEnvioFactura(datos());
  assert.equal(v.modo, "blocked");
  assert.match(v.motivo ?? "", /no ha escrito en las últimas 24 h/);
  assert.match(v.motivo ?? "", /correo o compártele el link/);
  // Revisión ws1-t2 #5: sin la «y» que sobraba del motivo de decideSendMode.
  assert.match(v.motivo ?? "", /todavía no se puede usar \(falta configurar la plantilla/);
  assert.doesNotMatch(v.motivo ?? "", /\(y /);
});

test("vista antes de guardar: ventana cerrada con dc_factura_lista aprobada → plantilla", () => {
  const v = vistaEnvioFactura(datos({ clinica: { ...datos().clinica, waTemplates: { invoice_ready: { name: "dc_factura_lista", lang: "es_MX", status: "APPROVED" } } } }));
  assert.equal(v.modo, "template");
});

test("vista antes de guardar: en revisión de Meta → bloqueado, dice que está en revisión", () => {
  const v = vistaEnvioFactura(datos({ clinica: { ...datos().clinica, waTemplates: { invoice_ready: { name: "dc_factura_lista", lang: "es_MX", status: "PENDING" } } } }));
  assert.equal(v.modo, "blocked");
  assert.match(v.motivo ?? "", /todavía no se puede usar \(Meta todavía no aprueba/);
});

test("vista antes de guardar: ya salió un cobro hoy → bloqueado aunque la ventana esté abierta", () => {
  const v = vistaEnvioFactura(datos({ ultimoEntrante: new Date("2026-10-02T17:00:00Z"), ultimoCobro: new Date("2026-10-02T17:30:00Z") }));
  assert.equal(v.modo, "blocked");
  assert.match(v.motivo ?? "", /aviso de cobro/);
});

test("vista antes de guardar: sin WhatsApp conectado o sin teléfono de la clínica → bloqueado", () => {
  assert.equal(vistaEnvioFactura(datos({ clinica: { ...datos().clinica, conToken: false } })).modo, "blocked");
  assert.equal(vistaEnvioFactura(datos({ clinica: { ...datos().clinica, phone: " " } })).modo, "blocked");
});

test("«Enviar la factura» (popup y ficha) pide la NOTA; la ruta la manda como invoice_ready", () => {
  assert.match(leer("components/dashboard/factura-ficha-rediseno/extras.ts"), /via === "whatsapp" \? \{ tipo: "factura" \}/);
  const r = leer("app/api/invoices/[id]/send-whatsapp/route.ts");
  assert.match(r, /const esFactura = pedido\?\.tipo === "factura";/);
  assert.match(r, /kind: esFactura \? "invoice_ready" : "payment_notice"/);
  assert.match(r, /esFactura\s*\? buildMensajeFactura\(/);
});

test("el popup enseña el texto con el MISMO armador que la ruta y apaga WhatsApp si no sale", () => {
  const f = leer("components/dashboard/factura-ficha-rediseno/forma-de-pago.tsx");
  assert.match(f, /buildMensajeFactura\(/);
  assert.match(f, /catalogEntryFor\("invoice_ready"\)/);
  assert.match(f, /disabled=\{sinTelefono \|\| waBloqueado\}/);
  const e = leer("components/billing/invoice-editor-modal.tsx");
  assert.match(e, /envioElegido === "whatsapp" && contacto\?\.whatsapp\?\.modo === "blocked"/);
  assert.match(e, /vista=\{\{/);
  assert.match(leer("app/api/invoices/condiciones/route.ts"), /vistaEnvioFactura\(/);
});

/* ── Revisión ws1-t2 #5 y #6 ─────────────────────────────────────────── */

test("lo de la clínica (desconectado, sin teléfono) se decide aparte y es lo mismo que dice la vista", () => {
  assert.equal(motivoDeLaClinica(datos().clinica), null);
  const sinToken = { ...datos().clinica, conToken: false };
  assert.match(motivoDeLaClinica(sinToken) ?? "", /no está conectado/);
  assert.equal(vistaEnvioFactura(datos({ clinica: sinToken })).motivo, motivoDeLaClinica(sinToken));
  assert.match(motivoDeLaClinica({ ...datos().clinica, phone: "" }) ?? "", /Falta el teléfono de la clínica/);
  assert.equal(masReciente([null, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-02T00:00:00Z"), undefined])?.toISOString(), "2026-10-02T00:00:00.000Z");
  assert.equal(masReciente([null, undefined]), null);
});

test("la ficha de una factura ya creada apaga «Enviar por WhatsApp» y dice el motivo ANTES de pulsar, como el popup", () => {
  const f = leer("components/dashboard/factura-ficha-rediseno/fichas-factura.tsx");
  assert.match(f, /const waNoSale = ofreceWhatsApp && !sinTelefono && contacto\?\.whatsapp\?\.modo === "blocked";/);
  assert.match(f, /disabled=\{enviando !== null \|\| sinTelefono \|\| waNoSale \|\| esperando\}/);
  assert.match(f, /t\("facturaFicha\.waNoSale"\)\} \$\{contacto\.whatsapp\.motivo\}/);
  const r = leer("app/api/invoices/condiciones/route.ts");
  // Con la misma pieza que el popup, solo para las que ofrecen WhatsApp, y sin ráfagas al pooler.
  assert.match(r, /vistasWhatsAppDeFacturas\(ctx\.clinicId, conWhatsApp\)/);
  assert.match(r, /\.filter\(\(inv\) => sePuedeEnviarPorWhatsApp\(inv\.status\)\)/);
  assert.match(r, /if \(porClave\.size > MAX_TELEFONOS_VISTA\) return out;/);
  assert.match(r, /ultimoAvisoDeCobro\(clinicId, tel, ahora\)/);
});

test("la pista de «Por WhatsApp» solo promete «abajo ves el texto» cuando se va a ver", () => {
  const f = leer("components/dashboard/factura-ficha-rediseno/forma-de-pago.tsx");
  assert.match(f, /t\(conTexto \? "facturaFicha\.envioWhatsAppPista" : "facturaFicha\.envioWhatsAppPistaSinTexto"\)/);
  const es = JSON.parse(leer("i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("i18n/dictionaries/en.json"));
  for (const d of [es, en]) {
    assert.ok(d.facturaFicha.envioWhatsAppPistaSinTexto, "falta la clave en un idioma");
    assert.doesNotMatch(d.facturaFicha.envioWhatsAppPistaSinTexto, /Abajo|below/);
  }
});
