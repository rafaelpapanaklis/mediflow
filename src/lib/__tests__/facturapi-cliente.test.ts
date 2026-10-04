/**
 * F-05 y F-20 (ws1-t4, vuelta 2): el receptor en Facturapi y los datos fiscales del paciente.
 *
 * Run: npm run test:facturapi-cliente
 *
 * `fetch` simulado: aquí no se habla con Facturapi.
 *   · La búsqueda va CODIFICADA (un RFC con «&» cortaba `q=` y salía el cliente de otro).
 *   · Solo cuenta un cliente con ESE tax_id exacto.
 *   · El existente se ACTUALIZA con PUT con los datos de hoy (antes se usaba con los viejos).
 *   · El modal guarda los datos fiscales en la ficha DESPUÉS de timbrar, no antes.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createOrUpdateCustomer, urlBusquedaCliente, clienteExacto } from "@/lib/facturapi";
import { clienteFacturapiDelReceptor } from "@/lib/cfdi/extranjero";

type Llamada = { url: string; method: string; body: any };
let llamadas: Llamada[] = [];
let respuestas: Array<{ status: number; body: any }> = [];
const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  llamadas = [];
  respuestas = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    llamadas.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
    const r = respuestas.shift() ?? { status: 500, body: { message: "sin respuesta preparada" } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = fetchOriginal; });

const ANA = { legal_name: "ANA GOMEZ", tax_id: "GOMA800101AB1", tax_system: "612", address: { zip: "03100" } };

test("F-05 · la búsqueda va codificada: «A&B010101AB1» ya no se corta en «A»", () => {
  assert.match(urlBusquedaCliente("A&B010101AB1"), /\/customers\?q=A%26B010101AB1$/);
  assert.match(urlBusquedaCliente("ÑAÑO800101AB1"), /q=%C3%91A%C3%91O800101AB1$/);
});

test("F-05 · solo cuenta el cliente con ESE tax_id (texto libre de `q` devolvía a otro)", () => {
  const lista = [{ id: "cus_otro", tax_id: "AXB010101AB1" }, { id: "cus_bueno", tax_id: "a&b010101ab1" }];
  assert.equal(clienteExacto(lista, "A&B010101AB1"), "cus_bueno");
  assert.equal(clienteExacto([{ id: "cus_otro", tax_id: "AXB010101AB1" }], "A&B010101AB1"), null);
  assert.equal(clienteExacto(null, "A&B010101AB1"), null);
});

test("F-05 · RFC con «&» y la búsqueda solo trae a OTRO cliente: se crea el suyo, no se usa el ajeno", async () => {
  respuestas = [
    { status: 200, body: { data: [{ id: "cus_otro", tax_id: "ABC010101AB1" }] } },
    { status: 200, body: { id: "cus_nuevo" } },
  ];
  const id = await createOrUpdateCustomer("sk", { legal_name: "A & B SA", tax_id: "A&B010101AB1", tax_system: "601", address: { zip: "06600" } });
  assert.equal(id, "cus_nuevo");
  assert.match(llamadas[0].url, /q=A%26B010101AB1/);
  assert.equal(llamadas[1].method, "POST");
  assert.equal(llamadas.some((l) => l.method === "PUT"), false);
});

test("F-05 · el paciente cambió su CP de 06600 a 03100: el cliente existente se ACTUALIZA con PUT", async () => {
  respuestas = [
    { status: 200, body: { data: [{ id: "cus_ana", tax_id: "GOMA800101AB1", address: { zip: "06600" } }] } },
    { status: 200, body: { id: "cus_ana" } },
  ];
  const id = await createOrUpdateCustomer("sk", ANA);
  assert.equal(id, "cus_ana");
  assert.equal(llamadas[1].method, "PUT");
  assert.match(llamadas[1].url, /\/customers\/cus_ana$/);
  assert.equal(llamadas[1].body.address.zip, "03100");
  assert.equal(llamadas[1].body.tax_system, "612");
});

test("F-05 · si el SAT no acepta los datos nuevos, el error de Facturapi llega tal cual (no se timbra con los viejos)", async () => {
  respuestas = [
    { status: 200, body: { data: [{ id: "cus_ana", tax_id: "GOMA800101AB1" }] } },
    { status: 400, body: { message: "El código postal no coincide con el registrado en el SAT para este RFC" } },
  ];
  await assert.rejects(createOrUpdateCustomer("sk", ANA), /no coincide con el registrado en el SAT/);
});

test("F-05 · extranjero: se busca y actualiza por su ID fiscal, con su país", async () => {
  respuestas = [
    { status: 200, body: { data: [{ id: "cus_john", tax_id: "123-45-6789" }] } },
    { status: 200, body: { id: "cus_john" } },
  ];
  const cliente = clienteFacturapiDelReceptor({ rfc: "XEXX010101000", nombre: "JOHN DOE", regimenFiscal: "616", cp: "92101", extranjero: { pais: "USA", numRegIdTrib: "123-45-6789" } });
  assert.equal(await createOrUpdateCustomer("sk", cliente), "cus_john");
  assert.deepEqual(llamadas[1].body, { legal_name: "JOHN DOE", tax_id: "123-45-6789", address: { zip: "92101", country: "USA" } });
});

test("F-20 · el modal guarda los datos fiscales en la ficha DESPUÉS de timbrar, no antes", () => {
  const src = readFileSync(join(__dirname, "..", "..", "components", "dashboard", "billing", "invoice-detail-modal.tsx"), "utf8");
  const ini = src.indexOf("async function timbrarCfdi(");
  const fin = src.indexOf("\n  }\n", ini);
  const cuerpo = src.slice(ini, fin);
  const timbra = cuerpo.indexOf('fetch("/api/cfdi"');
  const exito = cuerpo.indexOf("setStampedUuid(data.uuid");
  const guardaPaciente = cuerpo.indexOf("fetch(`/api/patients/${invoice.patientId}`");
  const guardaResponsable = cuerpo.indexOf("/receptor-responsable`");
  assert.ok(timbra > 0 && exito > timbra, "timbra y luego marca el éxito");
  assert.ok(guardaPaciente > exito, "la ficha del paciente se toca solo tras un timbrado exitoso");
  assert.ok(guardaResponsable > exito, "la del responsable de pago, igual");
});
