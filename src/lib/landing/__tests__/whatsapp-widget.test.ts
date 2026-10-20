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
  normalizarNumeroWhatsapp,
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
  const r = normalizarNumeroWhatsapp("+57 300 123 4567");
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.e164, r.legible], ["573001234567", "+573001234567"]);
  assert.equal(normalizarNumeroWhatsapp("+1 415 555 2671").ok, true);
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
