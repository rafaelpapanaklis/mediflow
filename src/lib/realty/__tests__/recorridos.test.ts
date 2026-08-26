// ═══════════════════════════════════════════════════════════════════════
// RECORRIDOS VIRTUALES — la liga que se guarda y la que se embebe.
//
//   npx tsx --test src/lib/realty/__tests__/recorridos.test.ts
//
// 🔴 EL BUG QUE ESTAS PRUEBAS FIJAN. Rafael pegó una liga de Matterport, el
// sistema la aceptó, y la ficha mostró el marco gris con el icono de
// recurso roto. NO era la CSP: se verificó en vivo que `frame-src` en
// producción ya incluye matterport.com y *.matterport.com, y que un iframe
// real a my.matterport.com/show/?m=… carga perfecto dentro de dalecontrol.com.
//
// La causa: **Matterport solo permite embeber su liga de COMPARTIR**
// (`https://my.matterport.com/show/?m=<id>`). Cualquier otra liga del mismo
// dominio —`/discover/space/…`, las de la app, un espacio privado— pasa la
// validación de DOMINIO y el iframe no puede mostrarla.
//
// De ahí las dos preguntas que estas pruebas separan una y otra vez:
//   · ¿el dominio está en la allowlist?  → detectRealtyTourProvider
//   · ¿el proveedor deja embeber ESTA liga? → realtyTourEmbedUrl / check
// La primera no implica la segunda. Confundirlas fue el bug.
//
// Todo es PURO: sin Postgres, sin navegador, sin red.
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REALTY_TOUR_MATTERPORT_ERROR,
  checkRealtyTourUrl,
  detectRealtyTourProvider,
  matterportSpaceId,
  normalizeRealtyTourUrl,
  realtyTourEmbedUrl,
} from "@/lib/realty/tours";

/** Un id de Matterport de los de verdad: 11 alfanuméricos. */
const ID = "SxQL3iGyoDo";
const COMPARTIR = `https://my.matterport.com/show/?m=${ID}`;

/* ══════════════════════════════════════════════════════════════════
   1 · MATTERPORT — el caso que destapó todo
   ══════════════════════════════════════════════════════════════════ */

test("la liga de Compartir se queda como está", () => {
  assert.equal(normalizeRealtyTourUrl(COMPARTIR), COMPARTIR);
  assert.equal(realtyTourEmbedUrl(COMPARTIR), COMPARTIR);
});

test("las variantes que SÍ traen el identificador se canonizan a /show/?m=", () => {
  const variantes = [
    // el subdominio de siempre, con parámetros de más que Matterport agrega
    `https://my.matterport.com/show/?m=${ID}&play=1&brand=0`,
    // sin subdominio
    `https://matterport.com/show/?m=${ID}`,
    // con www
    `https://www.matterport.com/show/?m=${ID}`,
    // la ruta /models/<id>, que también trae el id
    `https://my.matterport.com/models/${ID}`,
    // la del panel de administración del espacio
    `https://my.matterport.com/models/${ID}/edit`,
  ];
  for (const v of variantes) {
    assert.equal(
      realtyTourEmbedUrl(v),
      COMPARTIR,
      `no se canonizó a la liga de Compartir: ${v}`,
    );
  }
});

test("los parámetros de más NO viajan al iframe (la liga guardada es UNA)", () => {
  // Importa para la deduplicación del route handler: dos pegadas de la
  // misma casa con distinto `?play=` son el MISMO recorrido, y si se
  // guardaran distintas el 409 de "ya está agregado" no saltaría.
  assert.equal(
    normalizeRealtyTourUrl(`https://my.matterport.com/show/?m=${ID}&play=1`),
    normalizeRealtyTourUrl(`https://my.matterport.com/show/?m=${ID}&brand=0&help=2`),
  );
});

test("una liga de Matterport SIN identificador se rechaza, no se guarda rota", () => {
  const sinId = [
    "https://matterport.com/discover/space/casa-en-lomas-de-chapultepec",
    "https://matterport.com/discover",
    "https://my.matterport.com/",
    "https://matterport.com/es/industrias/residencial",
  ];
  for (const u of sinId) {
    // El DOMINIO sí pasa — por eso el bug era invisible.
    assert.ok(detectRealtyTourProvider(u), `el dominio debería reconocerse: ${u}`);
    // Pero embeberla es imposible, así que no hay iframe que pintar…
    assert.equal(realtyTourEmbedUrl(u), null, `no debería ser embebible: ${u}`);
    // …y la puerta de entrada la rechaza ENSEÑANDO qué copiar.
    const check = checkRealtyTourUrl(u);
    assert.equal(check.ok, false, `debería rechazarse: ${u}`);
    assert.equal(check.url, null, "una liga rechazada no se guarda");
    assert.equal(check.error, REALTY_TOUR_MATTERPORT_ERROR);
    assert.ok(
      (check.error ?? "").includes("my.matterport.com/show/?m="),
      "el mensaje tiene que enseñar la forma de la liga buena",
    );
  }
});

test("matterportSpaceId: de dónde sale el identificador y de dónde no", () => {
  assert.equal(matterportSpaceId(COMPARTIR), ID);
  assert.equal(matterportSpaceId(`https://my.matterport.com/models/${ID}`), ID);
  assert.equal(matterportSpaceId("https://matterport.com/discover/space/casa-bonita"), null);
  assert.equal(matterportSpaceId("no-es-una-url"), null);
  // Un `m=` vacío o de basura no cuenta como identificador.
  assert.equal(matterportSpaceId("https://my.matterport.com/show/?m="), null);
  assert.equal(matterportSpaceId("https://my.matterport.com/show/?m=ab"), null);
});

/* ══════════════════════════════════════════════════════════════════
   2 · LOS OTROS PROVEEDORES
   ══════════════════════════════════════════════════════════════════ */

test("Kuula: /post/<id> es la página; se reescribe a la de compartir", () => {
  // Los ids de Kuula son CORTOS (cinco caracteres). El patrón único de
  // antes exigía seis y dejaba pasar esta liga sin reescribir.
  assert.equal(realtyTourEmbedUrl("https://kuula.co/post/7l8Rk"), "https://kuula.co/share/7l8Rk");
  assert.equal(realtyTourEmbedUrl("https://kuula.co/share/7l8Rk"), "https://kuula.co/share/7l8Rk");
  // Una colección ya viene en forma de compartir: NO se toca.
  assert.equal(
    realtyTourEmbedUrl("https://kuula.co/share/collection/7l8Rk"),
    "https://kuula.co/share/collection/7l8Rk",
  );
});

test("Luma: /capture/<uuid> es la página; /embed/<uuid> es el visor", () => {
  const uuid = "0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7";
  assert.equal(
    realtyTourEmbedUrl(`https://lumalabs.ai/capture/${uuid}`),
    `https://lumalabs.ai/embed/${uuid}`,
  );
  assert.equal(
    realtyTourEmbedUrl(`https://lumalabs.ai/embed/${uuid}`),
    `https://lumalabs.ai/embed/${uuid}`,
  );
});

test("de los que NO consta su forma de compartir, la liga se respeta TAL CUAL", () => {
  // 🔴 Regla deliberada: reescribir una liga que ya funciona es peor que no
  // reescribir la que no funciona. De CloudPano, EyeSpy360, GoIGuide y
  // Scaniverse no consta cuál es su forma embebible, así que no se inventa:
  // si alguna falla, la atrapa la red de RUNTIME (RealtyTourEmbed avisa y
  // ofrece abrirla aparte) y entonces se agrega su rama con el caso real.
  const tal_cual = [
    "https://app.cloudpano.com/tours/AbCdEf123",
    "https://eyespy360.com/en-us/View/12345",
    "https://goiguide.com/tour/abc-123",
    "https://scaniverse.com/scan/abcdef123456",
  ];
  for (const u of tal_cual) {
    assert.equal(normalizeRealtyTourUrl(u), u, `no debía reescribirse: ${u}`);
    assert.equal(realtyTourEmbedUrl(u), u, `debía embeberse tal cual: ${u}`);
    assert.equal(checkRealtyTourUrl(u).ok, true, `debía aceptarse: ${u}`);
  }
});

test("YouTube y Vimeo siguen convirtiéndose a su reproductor", () => {
  assert.equal(
    realtyTourEmbedUrl("https://youtu.be/dQw4w9WgXcQ"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
  );
  assert.equal(
    realtyTourEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
  );
  assert.equal(
    realtyTourEmbedUrl("https://vimeo.com/123456789"),
    "https://player.vimeo.com/video/123456789",
  );
});

/* ══════════════════════════════════════════════════════════════════
   3 · LA PUERTA DE ENTRADA: checkRealtyTourUrl
   ══════════════════════════════════════════════════════════════════ */

test("lo que la puerta acepta es EXACTAMENTE lo que se puede pintar", () => {
  // La pantalla habilita el botón con checkRealtyTourUrl y el route handler
  // guarda con checkRealtyTourUrl. Si `ok` fuera true y el embed null, la
  // pantalla dejaría guardar algo que la ficha no puede mostrar — que es el
  // bug entero, otra vez, por la puerta de atrás.
  const ligas = [
    COMPARTIR,
    "https://matterport.com/discover/space/casa",
    "https://kuula.co/post/7l8Rk",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://vimeo.com/123456789",
    "https://notmatterport.com/show/?m=abc123",
    "http://my.matterport.com/show/?m=SxQL3iGyoDo",
    "no-es-una-url",
    "",
    "   ",
  ];
  for (const u of ligas) {
    const check = checkRealtyTourUrl(u);
    const embed = realtyTourEmbedUrl(u);
    assert.equal(check.ok, embed !== null, `check.ok no coincide con el embed: "${u}"`);
    if (check.ok) {
      assert.equal(check.embedUrl, embed, `el embed de check no es el de verdad: "${u}"`);
      assert.ok(check.url, "una liga aceptada se guarda");
      assert.equal(check.error, null);
    } else {
      assert.equal(check.url, null, `una liga rechazada NO se guarda: "${u}"`);
      assert.ok(check.error && check.error.trim().length > 0, `sin motivo que enseñar: "${u}"`);
    }
  }
});

test("un mensaje de rechazo NUNCA sale vacío (sería un botón muerto sin explicación)", () => {
  for (const u of ["", "   ", "javascript:alert(1)", "https://evil.test/matterport.com"]) {
    const check = checkRealtyTourUrl(u);
    assert.equal(check.ok, false);
    assert.ok((check.error ?? "").length > 10, `mensaje pobre para "${u}": ${check.error}`);
  }
});

test("http:// nunca pasa, ni siquiera de un proveedor de la lista", () => {
  // Un recorrido por http dentro de una página https lo bloquea el
  // navegador por contenido mixto: marco en blanco, otra vez sin error.
  assert.equal(realtyTourEmbedUrl(`http://my.matterport.com/show/?m=${ID}`), null);
  assert.equal(checkRealtyTourUrl(`http://my.matterport.com/show/?m=${ID}`).ok, false);
});

test("un dominio que solo CONTIENE el del proveedor no cuela", () => {
  assert.equal(detectRealtyTourProvider("https://evil.test/matterport.com"), null);
  assert.equal(detectRealtyTourProvider("https://matterport.com.evil.test/show/?m=x"), null);
  assert.equal(checkRealtyTourUrl("https://matterport.com.evil.test/show/?m=x").ok, false);
});
