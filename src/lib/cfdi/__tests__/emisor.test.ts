/**
 * Emisor del CFDI (ws1-t8, auditoría CFDI F-15).
 * Run: npm run test:cfdi-emisor
 *
 * Con el código anterior nada de esto existía: el régimen no se validaba contra el tipo de persona,
 * una persona moral podía quedarse en «exento» sin aviso, el RFC del CSD no se comparaba con el del
 * panel y el vencimiento del CSD solo se mostraba (sin aviso a 30 días).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  errorDeRegimenEmisor, avisosDelEmisor, avisoExentoPersonaMoral, personaDelRfc, DIAS_AVISO_CSD,
} from "@/lib/cfdi/emisor";
import { leerCertificadoCsd, rfcDelSujeto } from "@/lib/cfdi/csd-certificado.server";

const RFC_FISICA = "VADA800927DJ3"; // 13
const RFC_MORAL = "EKU9003173C9"; // 12
const AHORA = new Date("2026-10-03T18:00:00Z");
const dias = (n: number) => new Date(AHORA.getTime() + n * 24 * 60 * 60 * 1000);

test("persona por el RFC: 12 = moral, 13 = física, basura = null", () => {
  assert.equal(personaDelRfc(RFC_MORAL), "moral");
  assert.equal(personaDelRfc(` ${RFC_FISICA.toLowerCase()} `), "fisica");
  assert.equal(personaDelRfc("123"), null);
});

test("régimen contra tipo de persona (c_RegimenFiscal): 601 con RFC de 13 se rechaza; 612 con RFC de 12 se rechaza", () => {
  assert.match(errorDeRegimenEmisor(RFC_FISICA, "601")!, /solo para personas morales/);
  assert.match(errorDeRegimenEmisor(RFC_MORAL, "612")!, /solo para personas físicas/);
  assert.match(errorDeRegimenEmisor(RFC_MORAL, "605")!, /12 caracteres es de persona moral/);
});

test("régimen válido: 626 RESICO aplica a física y moral; 612 física; 601 moral; 603 moral", () => {
  assert.equal(errorDeRegimenEmisor(RFC_FISICA, "626"), null);
  assert.equal(errorDeRegimenEmisor(RFC_MORAL, "626"), null);
  assert.equal(errorDeRegimenEmisor(RFC_FISICA, "612"), null);
  assert.equal(errorDeRegimenEmisor(RFC_MORAL, "601"), null);
  assert.equal(errorDeRegimenEmisor(RFC_MORAL, "603"), null);
});

test("régimen que no está en el catálogo (999, vacío) se rechaza; en inglés también", () => {
  assert.match(errorDeRegimenEmisor(RFC_FISICA, "999")!, /no está en el catálogo/);
  assert.match(errorDeRegimenEmisor(RFC_FISICA, "")!, /no está en el catálogo/);
  assert.match(errorDeRegimenEmisor(RFC_FISICA, "999", "en")!, /not in the SAT catalog/);
});

test("persona moral + «exento» → aviso (no bloqueo); con iva16 o persona física, nada", () => {
  const a = avisoExentoPersonaMoral(RFC_MORAL, "exempt");
  assert.equal(a?.code, "EXENTO_PERSONA_MORAL");
  assert.equal(a?.nivel, "alerta");
  assert.match(a!.texto, /15-XIV/);
  assert.equal(avisoExentoPersonaMoral(RFC_MORAL, "exento")?.code, "EXENTO_PERSONA_MORAL");
  assert.equal(avisoExentoPersonaMoral(RFC_MORAL, "iva16"), null);
  assert.equal(avisoExentoPersonaMoral(RFC_FISICA, "exempt"), null);
});

test(`CSD: vence en 10 días → «por vencer»; en ${DIAS_AVISO_CSD} → por vencer; en 31 → nada; ayer → vencido`, () => {
  const base = { rfcEmisor: RFC_FISICA, cfdiTaxMode: "exempt", csdUploaded: true, ahora: AHORA };
  const a10 = avisosDelEmisor({ ...base, csdValidUntil: dias(10) });
  assert.deepEqual(a10.map((a) => a.code), ["CSD_POR_VENCER"]);
  assert.match(a10[0].texto, /faltan 10 días/);
  assert.deepEqual(avisosDelEmisor({ ...base, csdValidUntil: dias(30) }).map((a) => a.code), ["CSD_POR_VENCER"]);
  assert.deepEqual(avisosDelEmisor({ ...base, csdValidUntil: dias(31) }), []);
  const vencido = avisosDelEmisor({ ...base, csdValidUntil: dias(-1) });
  assert.deepEqual(vencido.map((a) => [a.code, a.nivel]), [["CSD_VENCIDO", "peligro"]]);
  assert.match(avisosDelEmisor({ ...base, csdValidUntil: dias(1) })[0].texto, /falta 1 día/);
});

test("RFC del panel distinto al del CSD → peligro; igual (aunque venga en minúsculas) → nada", () => {
  const base = { cfdiTaxMode: "iva16", csdUploaded: true, csdValidUntil: dias(400), ahora: AHORA };
  const distinto = avisosDelEmisor({ ...base, rfcEmisor: RFC_FISICA, rfcDelCsd: RFC_MORAL });
  assert.deepEqual(distinto.map((a) => a.code), ["RFC_DISTINTO_AL_CSD"]);
  assert.match(distinto[0].texto, new RegExp(`${RFC_FISICA}.*${RFC_MORAL}`));
  assert.deepEqual(avisosDelEmisor({ ...base, rfcEmisor: RFC_FISICA, rfcDelCsd: ` ${RFC_FISICA.toLowerCase()}` }), []);
  // Sin CSD no hay nada contra qué comparar.
  assert.deepEqual(avisosDelEmisor({ ...base, rfcEmisor: RFC_FISICA, rfcDelCsd: RFC_MORAL, csdUploaded: false }), []);
});

test("todo junto, del más grave al menos: vencido, RFC distinto, persona moral exenta", () => {
  const r = avisosDelEmisor({ rfcEmisor: RFC_MORAL, cfdiTaxMode: "exempt", csdUploaded: true, csdValidUntil: dias(-5), rfcDelCsd: "AAA010101AAA", ahora: AHORA });
  assert.deepEqual(r.map((a) => a.code), ["CSD_VENCIDO", "RFC_DISTINTO_AL_CSD", "EXENTO_PERSONA_MORAL"]);
});

test("RFC del sujeto del .cer: persona moral «RFC / RFC_REPRESENTANTE» → el primero; física → el único", () => {
  assert.equal(rfcDelSujeto("CN=X\nx500UniqueIdentifier=EKU9003173C9 / VADA800927DJ3\nO=X"), "EKU9003173C9");
  assert.equal(rfcDelSujeto("x500UniqueIdentifier=VADA800927DJ3"), "VADA800927DJ3");
  assert.equal(rfcDelSujeto("CN=sin rfc"), null);
});

// Certificado de prueba hecho con openssl (sujeto con x500UniqueIdentifier = «EKU9003173C9 / VADA800927DJ3»,
// vence el 2-nov-2026 23:37:43 UTC). No es un CSD real del SAT; solo tiene su misma forma.
const CER_PRUEBA = "MIICzDCCAjWgAwIBAgIUW7yBeR+enWEfwvPS0304sxoPYPIwDQYJKoZIhvcNAQELBQAwgZAxIzAhBgNVBAMMGkNMSU5JQ0EgREUgUFJVRUJBIFNBIERFIENWMSUwIwYDVQQtDBxFS1U5MDAzMTczQzkgLyBWQURBODAwOTI3REozMR0wGwYDVQQFExQvIFZBREE4MDA5MjdIU1JTUkwwNTEjMCEGA1UECgwaQ0xJTklDQSBERSBQUlVFQkEgU0EgREUgQ1YwHhcNMjYxMDAzMjMzNzQzWhcNMjYxMTAyMjMzNzQzWjCBkDEjMCEGA1UEAwwaQ0xJTklDQSBERSBQUlVFQkEgU0EgREUgQ1YxJTAjBgNVBC0MHEVLVTkwMDMxNzNDOSAvIFZBREE4MDA5MjdESjMxHTAbBgNVBAUTFC8gVkFEQTgwMDkyN0hTUlNSTDA1MSMwIQYDVQQKDBpDTElOSUNBIERFIFBSVUVCQSBTQSBERSBDVjCBnzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEAoHrnLXfuIK2HJWtcUfTjcarQMi/zWrAyJWoy5m5M5bi2OIESUGKkufoY0RUSBWWh8YciM0wutEESzBQGGdn4AMHHWP/AoswG43LzC9v1krQ26e2X7vD7ofrkI/LVTzcVS+3GNIYfTfLh6F2l4tB7GcCaQnhU7yFO8WJUqAWkOFECAwEAAaMhMB8wHQYDVR0OBBYEFAmIFd2sgUC0IV/74y01IK+TxNcxMA0GCSqGSIb3DQEBCwUAA4GBAAHUmLFbosuDVusunjB109nLktfWNx2ZlgDrRhhcuLQiyxK7UhUbuDn4mqbTibii3xahoNYmWZCCP85SeD3mT8HmzlJ1xnDN92PO1K2wJnC4IR446t3SF6r4vJr+3iFB32yxgynMD24z70P6COobmJF8FJSK1n4X2kSWBjH492JJ";

test("el .cer (DER) se lee sin Facturapi: RFC del titular y vigencia", () => {
  const d = leerCertificadoCsd(Buffer.from(CER_PRUEBA, "base64"));
  assert.equal(d?.rfc, "EKU9003173C9");
  assert.equal(d?.validoHasta?.toISOString(), "2026-11-02T23:37:43.000Z");
  // El 3-oct le faltan 30 días y 6 h (cuenta como 31: sin aviso); el 10-oct, 24 → «por vencer».
  const con = (ahora: Date) => avisosDelEmisor({ rfcEmisor: "EKU9003173C9", cfdiTaxMode: "iva16", csdUploaded: true, csdValidUntil: d!.validoHasta, rfcDelCsd: d!.rfc, ahora });
  assert.deepEqual(con(AHORA), []);
  const el10 = con(new Date("2026-10-10T12:00:00Z"));
  assert.deepEqual(el10.map((a) => a.code), ["CSD_POR_VENCER"]);
  assert.match(el10[0].texto, /2 nov 2026/);
});

test("un archivo que no es certificado → null (lo rechazará Facturapi con su mensaje)", () => {
  assert.equal(leerCertificadoCsd(Buffer.from("no soy un cer")), null);
});
