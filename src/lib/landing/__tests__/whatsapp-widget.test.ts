/**
 * Botón de WhatsApp de la portada: validación del número y del nombre, enlace
 * de «Iniciar conversación» y aviso al equipo.
 * Run: npm run test:whatsapp-widget
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avisoLeadWhatsapp,
  enlaceIniciarConversacion,
  normalizarNombre,
  ladaDePais,
  normalizarNumeroWhatsapp,
  registroLeadNoEnviado,
  ORIGEN_WIDGET_WHATSAPP,
} from "../whatsapp-widget";
import { WHATSAPP_CTA } from "@/components/public/landing/sales/v2/landing-data";

test("número mexicano de 10 dígitos, con espacios, guiones o paréntesis", () => {
  for (const n of ["9991234567", "999 123 4567", "(999) 123-4567", "999.123.4567"]) {
    const r = normalizarNumeroWhatsapp(n);
    assert.ok(r.ok, n);
    if (r.ok) {
      assert.equal(r.e164, "529991234567");
      assert.equal(r.legible, "+52 999 123 4567");
    }
  }
});

test("con lada de México: 52…, +52…, +521… (formato móvil viejo) y 0052…", () => {
  for (const n of ["529991234567", "+52 999 123 4567", "+52 1 999 123 4567", "5219991234567", "00529991234567"]) {
    const r = normalizarNumeroWhatsapp(n);
    assert.ok(r.ok, n);
    if (r.ok) assert.equal(r.e164, "529991234567", n);
  }
});

test("otro país solo con +: se acepta de 8 a 15 dígitos", () => {
  const r = normalizarNumeroWhatsapp("+57 300 123 4567", "intl");
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.e164, r.legible], ["573001234567", "+573001234567"]);
  assert.equal(normalizarNumeroWhatsapp("+1 415 555 2671", "intl").ok, true);
});

test("rechaza con mensaje claro: vacío, letras, cortos, largos, sin + y de otro largo", () => {
  for (const n of ["", "   ", "abc", "99912345", "99912345678", "999 123 456", "+52 999 123", "+1234567890123456", "0991234567", "1991234567", "999-123-4567 ext 2"]) {
    const r = normalizarNumeroWhatsapp(n);
    assert.equal(r.ok, false, JSON.stringify(n));
    if (!r.ok) assert.ok(r.error.length > 10);
  }
});

test("nombre: limpia espacios y controles, y rechaza vacío, largo, enlaces y correos", () => {
  const ok = normalizarNombre("  Ana \n  López  ");
  assert.deepEqual(ok, { ok: true, nombre: "Ana López" });
  for (const n of ["", " ", "A", "x".repeat(81), "http://spam.mx", "ana@correo.com", "<b>Ana</b>"]) {
    assert.equal(normalizarNombre(n).ok, false, JSON.stringify(n));
  }
});

test("«Iniciar conversación» usa el número de WHATSAPP_CTA y el mensaje pedido", () => {
  assert.equal(
    enlaceIniciarConversacion(WHATSAPP_CTA.numberE164),
    "https://wa.me/529994387769?text=Hola%2C%20me%20interesa%20DaleControl!",
  );
});

test("el aviso al equipo lleva nombre, número, enlace para escribirle y el origen whatsapp-widget", () => {
  const a = avisoLeadWhatsapp({ nombre: "Ana", e164: "529991234567", legible: "+52 999 123 4567", pagina: "/blog" });
  assert.match(a.asunto, /Ana/);
  const t = a.lineas.join("\n");
  assert.match(t, /\+52 999 123 4567/);
  assert.match(t, /https:\/\/wa\.me\/529991234567/);
  assert.match(t, new RegExp(`Origen: ${ORIGEN_WIDGET_WHATSAPP} · página: /blog`));
});

test("W3: con «+» y sin lada de país (10 dígitos) o con «+» repetidos/fuera de lugar se rechaza", () => {
  for (const n of ["+999 123 4567", "+12345678", "+-+-+-9991234567", "++529991234567", "52+9991234567", "+9991234567"]) {
    const r = normalizarNumeroWhatsapp(n);
    assert.equal(r.ok, false, n);
  }
  const r = normalizarNumeroWhatsapp("+999 123 4567", "intl");
  assert.ok("error" in r && /«\+999»/.test(r.error) && /no corresponde a ningún país/.test(r.error));
  const m = normalizarNumeroWhatsapp("+999 123 4567");
  assert.ok("error" in m && /¿Otro país\?/.test(m.error), "en modo México, un + que no es +52 manda a «¿Otro país?»");
});

test("N-W3: con «+» se aceptan números reales de 10 dígitos de otros países y se rechazan ladas que no existen", () => {
  const buenos: Array<[string, string]> = [
    ["+501 612 3456", "5016123456"],     // Belice
    ["+47 123 45 678", "4712345678"],    // Noruega
    ["+65 6123 4567", "6561234567"],     // Singapur
    ["+45 12 34 56 78", "4512345678"],   // Dinamarca
    ["+1 415 555 2671", "14155552671"],
    ["+57 300 123 4567", "573001234567"],
    ["+34 612 345 678", "34612345678"],
    ["+7 912 345 6789", "79123456789"],
  ];
  for (const [crudo, e164] of buenos) {
    const r = normalizarNumeroWhatsapp(crudo, "intl");
    assert.ok(r.ok, crudo);
    if (r.ok) assert.equal(r.e164, e164, crudo);
  }
  for (const n of ["+999 123 4567", "+998 12", "+960", "+1 415 555 267", "+292 1234567", "+800 1234 5678"]) {
    assert.equal(normalizarNumeroWhatsapp(n, "intl").ok, false, n);
  }
  assert.equal(ladaDePais("5016123456"), "501");
  assert.equal(ladaDePais("9991234567"), null);
});

test("W1: la línea de log de un aviso que no salió lleva nombre y número (JSON recuperable)", () => {
  const l = registroLeadNoEnviado({ nombre: "Ana López", e164: "529991234567", legible: "+52 999 123 4567", pagina: "/blog" });
  assert.match(l, /AVISO NO ENVIADO/);
  const json = JSON.parse(l.slice(l.indexOf("{")));
  assert.deepEqual(json, { origen: "whatsapp-widget", nombre: "Ana López", whatsapp: "+52 999 123 4567", e164: "529991234567", pagina: "/blog" });
});

test("N3-W1: en modo México (campo con +52 fijo) un mexicano nunca queda tomado por otro país", () => {
  // Ladas mexicanas que coinciden con una lada de país: CDMX/55 Brasil, GDL/33 Francia, MTY/81 Japón, Cancún/998 Uzbekistán, Toluca/722 Rusia.
  for (const n of ["5512345678", "3312345678", "8112345678", "9981234567", "7221234567", "55 1234 5678", "(33) 1234-5678"]) {
    const r = normalizarNumeroWhatsapp(n);
    assert.ok(r.ok, n);
    if (r.ok) assert.equal(r.e164, `52${n.replace(/\D/g, "")}`, n);
  }
  // Pegados con +52 / 52 / 521 también.
  for (const n of ["+52 55 1234 5678", "525512345678", "+52 1 55 1234 5678"]) {
    const r = normalizarNumeroWhatsapp(n);
    assert.ok(r.ok, n);
    if (r.ok) assert.equal(r.e164, "525512345678", n);
  }
  // Con «+» y otra lada, en modo México se rechaza en vez de aceptarlo como Brasil/Francia/Japón.
  for (const n of ["+55 1234 5678", "+33 1234 5678", "+81 1234 5678", "+998 123 4567", "+722 123 4567"]) {
    const r = normalizarNumeroWhatsapp(n);
    assert.ok("error" in r && /¿Otro país\?/.test(r.error), n);
  }
  // 9 dígitos o más de 10 sin +: mensaje de qué falta.
  assert.equal(normalizarNumeroWhatsapp("999123456").ok, false);
  assert.equal(normalizarNumeroWhatsapp("99912345678").ok, false);
  // Modo internacional: exige «+» y valida +52 como México.
  assert.equal(normalizarNumeroWhatsapp("3001234567", "intl").ok, false);
  const mx = normalizarNumeroWhatsapp("+52 55 1234 5678", "intl");
  assert.ok(mx.ok && mx.e164 === "525512345678");
  const br = normalizarNumeroWhatsapp("+55 11 91234 5678", "intl");
  assert.ok(br.ok && br.e164 === "5511912345678");
});
