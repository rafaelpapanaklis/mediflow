/**
 * Fechas del consentimiento informado en la zona de la clínica.
 *
 * Lo que se prueba aquí salió de un QA real: la página pública decía "13 de
 * agosto, 11:43 p.m." y el PDF del MISMO documento imprimía "14/08/2026 05:43
 * a.m.". La página la formatea el navegador (México); el PDF lo formateaba el
 * servidor sin `timeZone`, y en Vercel eso es UTC. Un consentimiento con la
 * hora corrida seis horas —y con la fecha de otro día— no acredita nada.
 *
 * EL CASO QUE IMPORTA es el segundo test: con la zona en UTC la MISMA marca de
 * tiempo tiene que salir como 14/08 05:43. Sin él, esta prueba pasaría en una
 * máquina de México aunque el `timeZone` no se estuviera aplicando, que es
 * exactamente cómo el bug llegó a producción.
 *
 * Run: npm run test:consent-dates
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSENT_DEFAULT_TZ,
  consentTimeZone,
  formatConsentDate,
  formatConsentDateTime,
} from "../dates";
import { buildConsentContent, GENERAL_CONSENT_KEY } from "../templates";

/** El instante exacto del QA: 13 ago 2026, 23:43 en México = 14 ago 05:43 UTC. */
const QA_INSTANT = "2026-08-14T05:43:00.000Z";
const MX = "America/Mexico_City";

test("la firma del QA se imprime el 13 a las 11:43 p.m., no el 14 a las 5:43 a.m.", () => {
  const out = formatConsentDateTime(QA_INSTANT, MX);

  assert.ok(out.startsWith("13/08/2026 "), `esperaba el día 13, salió: ${out}`);
  assert.ok(out.includes("11:43"), `esperaba las 11:43, salió: ${out}`);
  assert.ok(!out.includes("14/08/2026"), `sigue fechando en UTC: ${out}`);
  assert.ok(!out.includes("05:43"), `sigue en hora UTC: ${out}`);
});

test("la MISMA marca en UTC sí sale 14/08 05:43 (la zona se aplica de verdad)", () => {
  const out = formatConsentDateTime(QA_INSTANT, "UTC");

  assert.ok(out.startsWith("14/08/2026 "), `esperaba el día 14 en UTC, salió: ${out}`);
  assert.ok(out.includes("05:43"), `esperaba las 05:43 en UTC, salió: ${out}`);
});

test("la fecha larga del membrete cambia de día con la zona", () => {
  assert.equal(formatConsentDate(QA_INSTANT, MX), "13 de agosto de 2026");
  assert.equal(formatConsentDate(QA_INSTANT, "UTC"), "14 de agosto de 2026");
});

test("sin fecha se imprime la raya, nunca 'Invalid Date'", () => {
  assert.equal(formatConsentDate(null, MX), "—");
  assert.equal(formatConsentDateTime(null, MX), "—");
  assert.equal(formatConsentDateTime("no es una fecha", MX), "—");
});

test("zona vacía o corrupta cae al default nacional en vez de tumbar el PDF", () => {
  assert.equal(CONSENT_DEFAULT_TZ, MX);
  assert.equal(consentTimeZone(null), MX);
  assert.equal(consentTimeZone(""), MX);
  assert.equal(consentTimeZone("   "), MX);
  assert.equal(consentTimeZone("Zona/Inventada"), MX);
  assert.equal(consentTimeZone("America/Tijuana"), "America/Tijuana");
  // Segunda pasada: el resultado se cachea y tiene que seguir siendo el mismo.
  assert.equal(consentTimeZone("Zona/Inventada"), MX);
});

test("el 'Lugar y fecha' de la carta usa la zona de la clínica", () => {
  const tz = "Asia/Tokyo"; // muy lejos de UTC: si no se aplicara, el día no cuadra
  // El día puede cambiar entre ambas lecturas si el test corre justo a la
  // medianoche de Tokio: se acepta cualquiera de las dos, nunca la de UTC.
  const before = formatConsentDate(new Date(), tz);
  const letter = buildConsentContent(GENERAL_CONSENT_KEY, {
    clinicName: "Clínica Demo",
    clinicCity: "Ciudad de México",
    patientName: "Ana López",
    timezone: tz,
  });
  const after = formatConsentDate(new Date(), tz);

  const line = letter.split("\n").find((l) => l.startsWith("Lugar y fecha:"));
  assert.ok(line, "la carta perdió la línea de lugar y fecha");
  assert.ok(
    line.endsWith(`, a ${before}`) || line.endsWith(`, a ${after}`),
    `la fecha no es la de ${tz}: ${line}`,
  );
});

test("una fecha pasada a mano sigue mandando sobre la zona", () => {
  const letter = buildConsentContent(GENERAL_CONSENT_KEY, {
    clinicName: "Clínica Demo",
    clinicCity: "Mérida",
    patientName: "Ana López",
    timezone: MX,
    date: "1 de enero de 2020",
  });

  assert.ok(letter.includes("Lugar y fecha: Mérida, a 1 de enero de 2020"));
});
