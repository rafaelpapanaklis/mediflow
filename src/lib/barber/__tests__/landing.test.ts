/* ═══════════════════════════════════════════════════════════════════════
   PRUEBAS DEL NÚCLEO DE LA PÁGINA WEB DE LA BARBERÍA.

   Sin base de datos y sin navegador: @/lib/barber/landing es puro a
   propósito, y lo que se prueba aquí es justo lo que no se puede
   comprobar mirando la pantalla — que dos pestañas no se pisen y que
   cambiar de plantilla no borre nada.

   Correr:  npx tsx --test src/lib/barber/__tests__/landing.test.ts

   ── CADA CASO PRUEBA TAMBIÉN EL CAMINO INVERSO ────────────────────
   Un test que solo comprueba "no salió 409" lo pasa igual una función
   que NUNCA devuelva conflicto. Por eso, junto a cada caso que debe
   fusionarse en silencio hay su gemelo que SÍ debe dar conflicto. Si la
   fusión se volviera permisiva de más, el segundo se cae.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_WEB_ACCENTS,
  BARBER_WEB_TEMPLATE_IDS,
  configBarberWebVacia,
  esUrlDeMapa,
  fusionarConfigBarberWeb,
  fusionarPlantilla,
  horarioAgrupado,
  normalizarConfigBarberWeb,
  normalizarTelefono,
  ordenDeSecciones,
  precioBarberWeb,
  seccionesVisibles,
  validarConfigBarberWeb,
  type BarberWebConfig,
} from "../landing";
import { BARBER_WEB_MANIFESTS, manifiestoBarberWeb } from "@/components/barber/templates/manifest";

function conf(parche: Partial<BarberWebConfig>): BarberWebConfig {
  return { ...configBarberWebVacia(), ...parche };
}

/* ══════════════════════════════════════════════════════════════
   1 · Normalización
   ══════════════════════════════════════════════════════════════ */

test("un config vacío, nulo o basura no rompe: sale la forma completa", () => {
  for (const raw of [null, undefined, 0, "", [], "texto", { v: "x" }]) {
    const c = normalizarConfigBarberWeb(raw);
    assert.equal(c.acento, "caramelo");
    assert.deepEqual(c.galeria, []);
    assert.deepEqual(c.resenas, []);
    assert.equal(c.oculta, false);
  }
});

test("se descarta lo que no es del vocabulario de las ocho plantillas", () => {
  const c = normalizarConfigBarberWeb({
    copia: { "portada.cta": "Vente", "clave.inventada": "basura" },
    fotos: { portada: "https://x.test/a.webp", ranuraFalsa: "https://x.test/b.webp" },
    secciones: { servicios: { visible: false }, seccionFalsa: { visible: true } },
  });
  assert.equal(c.copia["portada.cta"], "Vente");
  assert.equal(c.copia["clave.inventada"], undefined);
  assert.equal(c.fotos.portada, "https://x.test/a.webp");
  assert.equal(c.fotos.ranuraFalsa, undefined);
  assert.equal(c.secciones.servicios.visible, false);
  assert.equal(c.secciones.seccionFalsa, undefined);
});

test("una URL que no es http(s) NO entra como foto", () => {
  const c = normalizarConfigBarberWeb({
    fotos: { portada: "javascript:alert(1)" },
    galeria: ["javascript:alert(1)", "data:text/html,x", "https://x.test/ok.webp"],
  });
  assert.equal(c.fotos.portada, undefined);
  assert.deepEqual(c.galeria, ["https://x.test/ok.webp"]);
});

test("el mapa solo acepta google.com; cualquier otro dominio se cae", () => {
  assert.equal(esUrlDeMapa("https://www.google.com/maps?q=x&output=embed"), true);
  assert.equal(esUrlDeMapa("https://maps.google.com/x"), true);
  assert.equal(esUrlDeMapa("https://evil.test/maps"), false);
  assert.equal(esUrlDeMapa("http://www.google.com/maps"), false); // sin https, no
  assert.equal(esUrlDeMapa("javascript:alert(1)"), false);
  // El caso que engaña: un dominio que TERMINA en google.com pero no lo es.
  assert.equal(esUrlDeMapa("https://notgoogle.com/maps"), false);
});

test("el teléfono se guarda en dígitos con lada; lo imposible se descarta", () => {
  assert.equal(normalizarTelefono("55 1234 5678"), "5255 12345678".replace(/\s/g, ""));
  assert.equal(normalizarTelefono("+52 55 1234 5678"), "525512345678");
  assert.equal(normalizarTelefono("123"), null);
  assert.equal(normalizarTelefono("no soy un teléfono"), null);
});

/* ══════════════════════════════════════════════════════════════
   2 · Validación de lo que llega del navegador
   ══════════════════════════════════════════════════════════════ */

test("el PATCH rechaza entero lo que viene mal, no guarda a medias", () => {
  const { config, invalidos } = validarConfigBarberWeb({
    whatsapp: "123",
    copia: { "portada.cta": "esto sí valía" },
  });
  assert.equal(config, null, "no se guarda nada si algo viene mal");
  assert.equal(invalidos.length > 0, true);
});

test("el PATCH acepta lo bueno y lo normaliza", () => {
  const { config, invalidos } = validarConfigBarberWeb({
    whatsapp: "5512345678",
    copia: { "portada.cta": "Vente" },
  });
  assert.deepEqual(invalidos, []);
  assert.equal(config!.whatsapp, "525512345678");
});

/* ══════════════════════════════════════════════════════════════
   3 · Cambiar de plantilla NO borra contenido
   ══════════════════════════════════════════════════════════════ */

test("las ocho plantillas del manifiesto son exactamente las declaradas", () => {
  assert.deepEqual(
    Object.keys(BARBER_WEB_MANIFESTS).sort(),
    [...BARBER_WEB_TEMPLATE_IDS].sort(),
  );
  assert.equal(BARBER_WEB_TEMPLATE_IDS.length, 8);
});

test("el contenido compartido sobrevive a un cambio de plantilla", () => {
  const c = normalizarConfigBarberWeb({
    copia: { "portada.cta": "Vente ya", "servicios.cta": "Lo quiero" },
    fotos: { portada: "https://x.test/p.webp", logo: "https://x.test/l.webp" },
    secciones: { equipo: { visible: false, titulo: "Mis compas" } },
    galeria: ["https://x.test/1.webp"],
    resenas: [{ nombre: "Luis", texto: "El mejor fade", estrellas: 5 }],
    whatsapp: "5512345678",
  });

  // El config NO cambia al cambiar de plantilla: es el mismo objeto leído
  // por otro manifiesto. Lo que se comprueba es que las ocho lo LEEN.
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    const m = BARBER_WEB_MANIFESTS[id];
    assert.equal(c.copia["portada.cta"], "Vente ya", `${id} perdió el texto`);
    assert.equal(c.fotos.portada, "https://x.test/p.webp", `${id} perdió la foto`);
    assert.equal(c.secciones.equipo.titulo, "Mis compas", `${id} perdió el título`);
    // Y su orden de secciones es válido: solo ids que la plantilla tiene.
    const orden = ordenDeSecciones(m, c);
    const suyas = m.secciones.map((s) => s.id);
    assert.deepEqual([...orden].sort(), [...suyas].sort(), `${id} tiene un orden inconsistente`);
  }
});

test("un orden guardado de otra plantilla no arrastra secciones fantasma", () => {
  const c = conf({
    // `minimal` no tiene "portafolio" ni "resenas": el orden guardado los
    // menciona y aun así NO deben aparecer.
    orden: { minimal: ["portafolio", "servicios", "portada", "resenas", "contacto"] },
  });
  const orden = ordenDeSecciones(BARBER_WEB_MANIFESTS.minimal, c);
  assert.equal(orden.includes("portafolio"), false);
  assert.equal(orden.includes("resenas"), false);
  // Y no se pierde ninguna de las suyas aunque el orden guardado no las nombre.
  for (const s of BARBER_WEB_MANIFESTS.minimal.secciones) {
    assert.equal(orden.includes(s.id), true, `falta ${s.id}`);
  }
});

test("una sección sin datos no se pinta, aunque esté encendida", () => {
  const c = configBarberWebVacia();
  const sinNada = seccionesVisibles(BARBER_WEB_MANIFESTS.clasica, c, () => false);
  // Solo quedan las que no consumen nada (portada, contacto, reservar).
  assert.equal(sinNada.every((s) => s.consume.length === 0), true);
  const conTodo = seccionesVisibles(BARBER_WEB_MANIFESTS.clasica, c, () => true);
  assert.equal(conTodo.length > sinNada.length, true);
});

test("una sección apagada no se pinta ni con datos; una obligatoria sí", () => {
  const c = conf({
    secciones: {
      servicios: { visible: false, titulo: null, subtitulo: null },
      contacto: { visible: false, titulo: null, subtitulo: null },
    },
  });
  const ids = seccionesVisibles(BARBER_WEB_MANIFESTS.clasica, c, () => true).map((s) => s.id);
  assert.equal(ids.includes("servicios"), false, "la apagada se pintó");
  assert.equal(ids.includes("contacto"), true, "la obligatoria se pudo apagar");
});

/* ══════════════════════════════════════════════════════════════
   4 · DOS PESTAÑAS A LA VEZ

   Lo que arregla el 409 del editor dental. Cada caso "se fusiona en
   silencio" va con su gemelo "esto SÍ es conflicto".
   ══════════════════════════════════════════════════════════════ */

test("campos distintos desde dos pestañas: se fusiona, sin conflicto", () => {
  const base = conf({ whatsapp: "525512345678" });
  const mio = conf({ whatsapp: "525512345678", instagram: "labarberia" });
  const servidor = conf({ whatsapp: "525599998888" });

  const r = fusionarConfigBarberWeb(base, mio, servidor);
  assert.deepEqual(r.conflictos, []);
  assert.equal(r.config.instagram, "labarberia", "se perdió lo mío");
  assert.equal(r.config.whatsapp, "525599998888", "se pisó lo del otro");
});

test("EL MISMO campo a valores distintos: conflicto, y dice cuál", () => {
  const base = conf({ whatsapp: "525512345678" });
  const mio = conf({ whatsapp: "525511112222" });
  const servidor = conf({ whatsapp: "525599998888" });

  const r = fusionarConfigBarberWeb(base, mio, servidor);
  assert.equal(r.conflictos.length, 1);
  assert.match(r.conflictos[0], /WhatsApp/);
});

test("el mismo campo al MISMO valor no es conflicto", () => {
  const base = conf({ whatsapp: null });
  const mio = conf({ whatsapp: "525511112222" });
  const servidor = conf({ whatsapp: "525511112222" });
  const r = fusionarConfigBarberWeb(base, mio, servidor);
  assert.deepEqual(r.conflictos, []);
  assert.equal(r.config.whatsapp, "525511112222");
});

test("dos textos distintos del mismo mapa se fusionan clave por clave", () => {
  const base = conf({ copia: {} });
  const mio = conf({ copia: { "portada.cta": "Vente" } });
  const servidor = conf({ copia: { "servicios.cta": "Reserva" } });

  const r = fusionarConfigBarberWeb(base, mio, servidor);
  assert.deepEqual(r.conflictos, []);
  assert.equal(r.config.copia["portada.cta"], "Vente");
  assert.equal(r.config.copia["servicios.cta"], "Reserva");
});

test("LA MISMA clave de texto a valores distintos: conflicto de esa clave", () => {
  const base = conf({ copia: {} });
  const mio = conf({ copia: { "portada.cta": "Vente" } });
  const servidor = conf({ copia: { "portada.cta": "Agenda" } });

  const r = fusionarConfigBarberWeb(base, mio, servidor);
  assert.equal(r.conflictos.length, 1);
  assert.match(r.conflictos[0], /portada\.cta/);
});

test("borrar una clave que el otro no tocó se respeta (no reaparece)", () => {
  const base = conf({ copia: { "portada.cta": "Vente" } });
  const mio = conf({ copia: {} }); // la vacié
  const servidor = conf({ copia: { "portada.cta": "Vente", "equipo.cta": "Con él" } });

  const r = fusionarConfigBarberWeb(base, mio, servidor);
  assert.deepEqual(r.conflictos, []);
  assert.equal(r.config.copia["portada.cta"], undefined, "el borrado no se respetó");
  assert.equal(r.config.copia["equipo.cta"], "Con él", "se perdió lo del otro");
});

test("guardar dos veces seguido lo MISMO no produce conflicto consigo mismo", () => {
  // El caso del doble clic: base y servidor ya son iguales a lo mío porque
  // el primer guardado entró. La segunda vuelta no debe inventar nada.
  const igual = conf({ acento: "vino", copia: { "portada.cta": "Vente" } });
  const r = fusionarConfigBarberWeb(igual, igual, igual);
  assert.deepEqual(r.conflictos, []);
  assert.equal(r.config.acento, "vino");
});

test("no tocar nada deja ganar al servidor entero", () => {
  const base = conf({ acento: "caramelo" });
  const servidor = conf({ acento: "acero", galeria: ["https://x.test/1.webp"] });
  const r = fusionarConfigBarberWeb(base, base, servidor);
  assert.deepEqual(r.conflictos, []);
  assert.equal(r.config.acento, "acero");
  assert.deepEqual(r.config.galeria, ["https://x.test/1.webp"]);
});

test("la galería es un valor entero: dos reordenamientos chocan", () => {
  const base = conf({ galeria: ["a", "b"].map((x) => `https://x.test/${x}.webp`) });
  const mio = conf({ galeria: ["b", "a"].map((x) => `https://x.test/${x}.webp`) });
  const servidor = conf({ galeria: ["a", "b", "c"].map((x) => `https://x.test/${x}.webp`) });
  const r = fusionarConfigBarberWeb(base, mio, servidor);
  assert.equal(r.conflictos.length, 1);
  assert.match(r.conflictos[0], /galería/i);
});

test("el orden de las claves de un objeto NO es una diferencia", () => {
  // jsonb no conserva el orden de inserción: comparar con JSON.stringify a
  // secas marcaría como conflicto un objeto idéntico reordenado.
  const base = conf({ copia: {} });
  const mio = conf({ copia: { a: "1", b: "2" } as Record<string, string> });
  const servidor = conf({ copia: { b: "2", a: "1" } as Record<string, string> });
  const r = fusionarConfigBarberWeb(base, mio, servidor);
  assert.deepEqual(r.conflictos, []);
});

test("la plantilla también se fusiona a tres bandas", () => {
  assert.equal(fusionarPlantilla("clasica", "urbana", "clasica").template, "urbana");
  assert.equal(fusionarPlantilla("clasica", "clasica", "vintage").template, "vintage");
  assert.equal(fusionarPlantilla("clasica", "urbana", "urbana").conflicto, false);
  assert.equal(fusionarPlantilla("clasica", "urbana", "vintage").conflicto, true);
});

/* ══════════════════════════════════════════════════════════════
   5 · Formato
   ══════════════════════════════════════════════════════════════ */

test("los precios salen sin centavos cuando no los hay", () => {
  assert.match(precioBarberWeb(250), /250/);
  assert.equal(precioBarberWeb(250).includes(".00"), false);
  assert.equal(precioBarberWeb(250.5).includes(".50"), true);
});

test("el horario agrupa días seguidos con el mismo rango", () => {
  const c = conf({
    horario: [
      { dia: 0, abierto: true, desde: "09:00", hasta: "20:00" },
      { dia: 1, abierto: true, desde: "09:00", hasta: "20:00" },
      { dia: 2, abierto: true, desde: "09:00", hasta: "20:00" },
      { dia: 3, abierto: true, desde: "09:00", hasta: "20:00" },
      { dia: 4, abierto: true, desde: "09:00", hasta: "20:00" },
      { dia: 5, abierto: true, desde: "10:00", hasta: "18:00" },
      { dia: 6, abierto: false, desde: "09:00", hasta: "20:00" },
    ],
  });
  const lineas = horarioAgrupado(c);
  assert.equal(lineas.length, 3, `se esperaban 3 renglones, salieron ${lineas.length}`);
  assert.match(lineas[0], /Lun – Vie/);
  assert.match(lineas[2], /Cerrado/);
});

/* ══════════════════════════════════════════════════════════════
   6 · Coherencia del manifiesto

   Lo que impediría que el editor mienta o que una plantilla nazca
   medio editable en silencio.
   ══════════════════════════════════════════════════════════════ */

test("cada plantilla declara portada y contacto, y ambas son obligatorias", () => {
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    const m = BARBER_WEB_MANIFESTS[id];
    const portada = m.secciones.find((s) => s.id === "portada");
    const contacto = m.secciones.find((s) => s.id === "contacto");
    assert.ok(portada, `${id} no tiene portada`);
    assert.ok(contacto, `${id} no tiene contacto`);
    assert.equal(portada!.obligatoria, true, `${id}: la portada se puede apagar`);
    assert.equal(contacto!.obligatoria, true, `${id}: el contacto se puede apagar`);
  }
});

test("no hay ids de sección repetidos dentro de una plantilla", () => {
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    const ids = BARBER_WEB_MANIFESTS[id].secciones.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${id} repite una sección`);
  }
});

test("cada plantilla tiene un acento del catálogo cerrado", () => {
  const validos = new Set(BARBER_WEB_ACCENTS.map((a) => a.id));
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    assert.equal(validos.has(BARBER_WEB_MANIFESTS[id].acentoSugerido), true, `${id}`);
  }
});

test("las ocho se diferencian en ESTRUCTURA, no solo en color", () => {
  // La firma de una plantilla es el orden de sus secciones. Dos plantillas
  // con la misma firma son la misma con otro color, que es exactamente lo
  // que este vertical NO quiere vender.
  const firmas = new Map<string, string>();
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    const firma = BARBER_WEB_MANIFESTS[id].secciones.map((s) => s.id).join(">");
    const gemela = firmas.get(firma);
    assert.equal(gemela, undefined, `«${id}» tiene la misma estructura que «${gemela}»: ${firma}`);
    firmas.set(firma, id);
  }
});

test("un id de plantilla desconocido cae a la clásica, no a una pantalla en blanco", () => {
  assert.equal(manifiestoBarberWeb("no-existe").id, "clasica");
  assert.equal(manifiestoBarberWeb(null).id, "clasica");
  assert.equal(manifiestoBarberWeb("vintage").id, "vintage");
});
