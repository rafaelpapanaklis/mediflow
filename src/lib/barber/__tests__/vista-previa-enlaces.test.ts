/* ═══════════════════════════════════════════════════════════════════════
   LA VISTA PREVIA DE «MI WEB» NO SACA AL DUEÑO DEL EDITOR.

     npx tsx --test "src/lib/barber/__tests__/vista-previa-enlaces.test.ts"

   QA de cierre B (16-nov, panel.108): tocar «Reservar cita» dentro de la
   vista previa llevaba la pestaña a /b/<slug>/reservar. La regla y su
   cableado en vista-previa.tsx quedan fijados aquí.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { destinoEnlaceVistaPrevia } from "../vista-previa-enlaces";

test("lo que lleva a otra página se abre en pestaña nueva", () => {
  for (const href of [
    "/b/el-roble/reservar",
    "/b/el-roble/reservar?servicio=abc",
    "/b/el-roble/reservar?barbero=abc",
    "/b/el-roble/tienda",
    "/b/el-roble/tienda/prod1",
    "/b/el-roble/mi-cuenta",
    "https://www.dalecontrol.com",
  ]) {
    assert.equal(destinoEnlaceVistaPrevia(href), "pestana-nueva", href);
  }
});

test("las anclas de la propia página se dejan: el lienzo se desplaza", () => {
  for (const href of ["#servicios", "#contacto", "#portada", "#", "", null, undefined]) {
    assert.equal(destinoEnlaceVistaPrevia(href), "dejar", String(href));
  }
});

test("lo que ya abre aparte (WhatsApp, mapa, redes) no se toca", () => {
  assert.equal(destinoEnlaceVistaPrevia("https://wa.me/529990001122?text=Hola", "_blank"), "dejar");
  assert.equal(destinoEnlaceVistaPrevia("https://instagram.com/x", "_BLANK"), "dejar");
});

test("llamar o escribir no cambia de página", () => {
  assert.equal(destinoEnlaceVistaPrevia("tel:9990001122"), "dejar");
  assert.equal(destinoEnlaceVistaPrevia("mailto:a@example.com"), "dejar");
});

test("la vista previa del editor usa la regla en la fase de captura y abre aparte", () => {
  const tsx = readFileSync(
    path.resolve(__dirname, "..", "..", "..", "components", "barber", "landing", "vista-previa.tsx"),
    "utf8",
  );
  const lienzo = tsx.slice(tsx.indexOf('className="dcbwe-lienzo"'), tsx.indexOf("<LimiteVistaPrevia"));
  assert.match(lienzo, /onClickCapture/);
  assert.match(lienzo, /destinoEnlaceVistaPrevia\(/);
  assert.match(lienzo, /preventDefault\(\)/);
  assert.match(lienzo, /window\.open\(a\.href, "_blank", "noopener,noreferrer"\)/);
});
