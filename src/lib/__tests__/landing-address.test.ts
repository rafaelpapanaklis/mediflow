/* ============================================================
   LA FRONTERA DEL EDITOR VISUAL.

     npm run test:landing-address

   `leerDireccion` es lo único que separa "la clínica hizo clic en un
   título" de "alguien pidió escribir donde le dio la gana". Todo lo
   que le llega viene de un postMessage, y aunque el emisor sea nuestro
   propio iframe, el juego de formas que acepta tiene que ser cerrado y
   demostrablemente cerrado.

   `aplicarDireccion` es la otra mitad: traduce a UNA columna ya
   permitida y nunca materializa el texto por defecto de la plantilla.
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarDireccion, leerDireccion,
  dirClinica, dirCopia, dirFaq, dirSeccion, dirServicio, dirTestimonio,
  type BorradorLanding,
} from "../landing-address";

const vacio = (): BorradorLanding => ({
  name: "Clínica", phone: null, address: null, description: null,
  landingTagline: null, landingPatients: null, landingUrgentText: null,
  landingSections: null, landingServices: null, landingFaqs: null,
  landingTestimonials: null, landingPhotos: null, landingCopy: null,
});

const conListas = (): BorradorLanding => ({
  ...vacio(),
  landingServices: [{ name: "Limpieza", price: "$800", desc: "Ultrasonido" }],
  landingFaqs: [{ question: "¿Aceptan tarjeta?", answer: "Sí." }],
  landingTestimonials: [{ name: "Ana", text: "Muy bien.", rating: 5 }],
});

/* ── lo que NO se acepta ─────────────────────────────────────── */

test("rechaza cualquier forma que no sea del juego cerrado", () => {
  const basura = [
    null, undefined, 42, {}, [],
    "", "clinica", "clinica:", "clinica:slug", "clinica:waAccessToken",
    // `in` recorre la cadena de prototipos; hasOwnProperty no.
    "clinica:constructor", "clinica:__proto__", "clinica:toString",
    "sec:servicios", "sec:servicios:visible", "sec:servicios:orden",
    // sección que ninguna plantilla pinta
    "sec:inventada:titulo",
    "servicio:x:name", "servicio:-1:name", "servicio:60:name", "servicio:0:icon",
    "faq:0:pregunta", "testimonio:0:rating",
    "foto:noexiste", "foto:../../etc/passwd",
    "otracosa:0:name",
    "a".repeat(200),
  ];
  for (const x of basura) {
    assert.equal(leerDireccion(x), null, `debería rechazar ${JSON.stringify(x)}`);
  }
});

test("acepta exactamente las formas que las plantillas construyen", () => {
  assert.deepEqual(leerDireccion(dirClinica("landingTagline")), { tipo: "clinica", columna: "landingTagline" });
  assert.deepEqual(leerDireccion(dirSeccion("servicios", "subtitulo")), { tipo: "seccion", seccion: "servicios", campo: "subtitulo" });
  assert.deepEqual(leerDireccion(dirServicio(2, "price")), { tipo: "servicio", indice: 2, campo: "price" });
  assert.deepEqual(leerDireccion(dirFaq(0, "a")), { tipo: "faq", indice: 0, campo: "a" });
  assert.deepEqual(leerDireccion(dirTestimonio(1, "meta")), { tipo: "testimonio", indice: 1, campo: "meta" });
  assert.deepEqual(leerDireccion("foto:portada"), { tipo: "foto", ranura: "portada" });
});

/* ── dónde aterriza cada cosa ────────────────────────────────── */

test("toda dirección escribe en una columna de primer nivel permitida", () => {
  const b = conListas();
  const casos: [string, string | null, string][] = [
    [dirClinica("landingTagline"), "Hola", "landingTagline"],
    [dirSeccion("servicios", "titulo"), "Precios", "landingSections"],
    [dirServicio(0, "price"), "$900", "landingServices"],
    [dirFaq(0, "a"), "Claro que sí.", "landingFaqs"],
    [dirTestimonio(0, "meta"), "hace un mes", "landingTestimonials"],
    ["foto:portada", "https://x.test/a.webp", "landingPhotos"],
  ];
  for (const [dir, valor, columna] of casos) {
    const d = leerDireccion(dir);
    assert.ok(d, dir);
    assert.equal(aplicarDireccion(b, d!, valor)?.columna, columna, dir);
  }
});

/* ── los defaults nunca se materializan ──────────────────────── */

test("vaciar un título de sección guarda null, no el texto de la plantilla", () => {
  const d = leerDireccion(dirSeccion("servicios", "titulo"))!;
  const escrito = aplicarDireccion(vacio(), d, "Mi título")!;
  assert.deepEqual(escrito.valor, [{ id: "servicios", visible: true, orden: 0, titulo: "Mi título" }]);

  const borrado = aplicarDireccion({ ...vacio(), landingSections: escrito.valor }, d, "   ")!;
  assert.equal((borrado.valor as any[])[0].titulo, null);
});

test("un texto en blanco es null en cualquier columna suelta", () => {
  const d = leerDireccion(dirClinica("landingTagline"))!;
  assert.equal(aplicarDireccion(vacio(), d, "")?.valor, null);
  assert.equal(aplicarDireccion(vacio(), d, "\n  \t ")?.valor, null);
});

/* ── lo que no se deja romper ────────────────────────────────── */

test("no se puede vaciar lo que hace desaparecer el elemento", () => {
  const b = conListas();
  // Sin nombre, serviceList lo filtra: la tarjeta se esfuma y ya no hay dónde
  // volver a hacer clic.
  assert.equal(aplicarDireccion(b, leerDireccion(dirServicio(0, "name"))!, ""), null);
  assert.equal(aplicarDireccion(b, leerDireccion(dirFaq(0, "q"))!, ""), null);
  assert.equal(aplicarDireccion(b, leerDireccion(dirTestimonio(0, "text"))!, ""), null);
  // Los opcionales sí se pueden vaciar.
  assert.ok(aplicarDireccion(b, leerDireccion(dirServicio(0, "desc"))!, ""));
});

test("un índice que ya no existe no escribe nada", () => {
  const b = conListas();
  assert.equal(aplicarDireccion(b, leerDireccion(dirServicio(9, "price"))!, "$1"), null);
  assert.equal(aplicarDireccion(vacio(), leerDireccion(dirFaq(0, "a"))!, "algo"), null);
});

test("el nombre de la clínica no se puede dejar en blanco", () => {
  assert.equal(aplicarDireccion(vacio(), leerDireccion(dirClinica("name"))!, ""), null);
  assert.equal(aplicarDireccion(vacio(), leerDireccion(dirClinica("name"))!, "Otra")?.valor, "Otra");
});

test("un valor larguísimo se descarta en vez de guardarse recortado", () => {
  const d = leerDireccion(dirClinica("landingTagline"))!;
  assert.equal(aplicarDireccion(vacio(), d, "x".repeat(301)), null);
  assert.ok(aplicarDireccion(vacio(), d, "x".repeat(300)));
});

/* ── formas viejas ───────────────────────────────────────────── */

test("una FAQ vieja {question, answer} se migra sin perder el otro campo", () => {
  const b = conListas();
  const escrito = aplicarDireccion(b, leerDireccion(dirFaq(0, "q"))!, "¿Aceptan transferencia?")!;
  const item = (escrito.valor as any[])[0];
  assert.equal(item.q, "¿Aceptan transferencia?");
  assert.equal(item.a, "Sí.", "la respuesta vieja tenía que sobrevivir a la migración");
  assert.equal("question" in item, false);
  assert.equal("answer" in item, false);
});

test("escribir en una lista no toca a sus vecinos", () => {
  const b = { ...conListas() };
  b.landingServices = [{ name: "A", price: "$1" }, { name: "B", price: "$2" }];
  const escrito = aplicarDireccion(b, leerDireccion(dirServicio(1, "price"))!, "$9")!;
  assert.deepEqual(escrito.valor, [{ name: "A", price: "$1" }, { name: "B", price: "$9" }]);
  // Y el borrador original se queda como estaba: nada de mutar en sitio.
  assert.deepEqual(b.landingServices, [{ name: "A", price: "$1" }, { name: "B", price: "$2" }]);
});

test("quitar una foto borra su llave en vez de dejarla vacía", () => {
  const b = { ...vacio(), landingPhotos: { portada: "https://x.test/a.webp", doctor: "https://x.test/b.webp" } };
  const escrito = aplicarDireccion(b, leerDireccion("foto:portada")!, null)!;
  assert.deepEqual(escrito.valor, { doctor: "https://x.test/b.webp" });
});

/* ══════════════════════════════════════════════════════════════
   El texto suelto (landingCopy)
   ══════════════════════════════════════════════════════════════ */

test("una clave declarada por el manifiesto aterriza en landingCopy", () => {
  const b = vacio();
  const dir = leerDireccion(dirCopia("hero.cta"));
  assert.deepEqual(dir, { tipo: "copia", clave: "hero.cta" });
  const escrito = aplicarDireccion(b, dir!, "Reserva ahora")!;
  assert.equal(escrito.columna, "landingCopy");
  assert.deepEqual(escrito.valor, { "hero.cta": "Reserva ahora" });
});

test("una clave que NINGÚN manifiesto declara se tira", () => {
  assert.equal(leerDireccion(dirCopia("lo.que.se.me.ocurra")), null);
  assert.equal(leerDireccion("copia:__proto__"), null);
  assert.equal(leerDireccion("copia:constructor"), null);
});

test("vaciar un texto suelto BORRA la clave, no guarda el texto por defecto", () => {
  const b = { ...vacio(), landingCopy: { "hero.cta": "Reserva ahora", "faq.kicker": "Dudas" } };
  const escrito = aplicarDireccion(b, leerDireccion(dirCopia("hero.cta"))!, "")!;
  assert.deepEqual(escrito.valor, { "faq.kicker": "Dudas" },
    "si se guardara el default, cambiar de plantilla arrastraría el copy de la anterior");
});

test("un texto suelto más largo que su tope no se escribe", () => {
  const b = vacio();
  // "hero.cta" está declarado con maxLen 60 en classic y en equipo.
  assert.equal(aplicarDireccion(b, leerDireccion(dirCopia("hero.cta"))!, "x".repeat(61)), null);
  assert.ok(aplicarDireccion(b, leerDireccion(dirCopia("hero.cta"))!, "x".repeat(60)));
});

test("escribir un texto suelto no toca a los demás", () => {
  const b = { ...vacio(), landingCopy: { "faq.kicker": "Dudas" } };
  const escrito = aplicarDireccion(b, leerDireccion(dirCopia("hero.cta"))!, "Reserva")!;
  assert.deepEqual(escrito.valor, { "faq.kicker": "Dudas", "hero.cta": "Reserva" });
  assert.deepEqual(b.landingCopy, { "faq.kicker": "Dudas" }, "nada de mutar en sitio");
});

test("un titular de dos líneas conserva el salto", () => {
  const b = vacio();
  const dos = "Tu salud, nuestra" + String.fromCharCode(10) + "prioridad";
  const escrito = aplicarDireccion(b, leerDireccion(dirCopia("reservar.titulo"))!, dos)!;
  assert.deepEqual(escrito.valor, { "reservar.titulo": dos });
});
