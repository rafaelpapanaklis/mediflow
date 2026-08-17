/**
 * Tests de la PÁGINA PERSONAL del socio (/socio/<slug>).
 *
 * Run: npm run test:afiliados-pagina
 *
 * Foco crítico: este código decide QUÉ VE UN DESCONOCIDO en dalecontrol.com.
 * Lo que se publica se lee como dicho por DaleControl, así que los tres
 * estados tienen que ser indiscutibles:
 *
 *   1. SIN PERSONALIZAR — la página tiene que verse EXACTAMENTE como antes de
 *      que esto existiera. Un afiliado que nunca abrió la pantalla no puede
 *      notar la diferencia.
 *   2. EN REVISIÓN — lo pendiente NO se publica. Ni por un jsonb raro, ni
 *      porque el borrador esté más completo, ni por una lectura descuidada.
 *      Mientras se revisa, el público sigue viendo lo último APROBADO.
 *   3. APROBADA — lo aprobado es lo que se ve, y el borrador quedó limpio.
 *
 * Y la trampa que motivó el diseño de hasDraft(): un socio que BORRA su foto y
 * su texto en el borrador deja los dos campos pendientes en null. Si "hay
 * borrador" se dedujera de "algún pendiente no es null", ese caso se leería
 * como "no ha editado nada" y la pantalla le devolvería su contenido publicado
 * como si fuera su borrador — deshaciéndole el borrado delante de los ojos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIO_MAX_CHARS,
  MOVABLE_SECTIONS,
  PARTNER_SECTIONS,
  bioLength,
  buildDraftPatch,
  canEditPage,
  defaultSections,
  draftPage,
  hasDraft,
  isPublishedEmpty,
  normalizeSections,
  normalizeStatus,
  publishedPage,
  sanitizeBio,
  visibleSectionIds,
  type PartnerPageRow,
} from "./page-config";

/** Fila de un afiliado que jamás tocó nada. */
function virginRow(): PartnerPageRow {
  return {
    photoUrl: null,
    bio: null,
    sectionsConfig: null,
    pageStatus: "draft",
    photoUrlPending: null,
    bioPending: null,
    sectionsConfigPending: null,
  };
}

const CATALOG_ORDER = MOVABLE_SECTIONS.map((s) => s.id);

/* ═══════════════════════════════════════════════════════════════════════
   ESTADO 1 — SIN PERSONALIZAR
   ═══════════════════════════════════════════════════════════════════════ */

test("sin personalizar: la página pública queda igual que siempre", () => {
  const row = virginRow();
  const pub = publishedPage(row);

  assert.equal(pub.photoUrl, null);
  assert.equal(pub.bio, null);
  // Todas encendidas y en el orden del catálogo = la página de hoy.
  assert.deepEqual(visibleSectionIds(pub.sections), CATALOG_ORDER);
  assert.equal(pub.sections.length, MOVABLE_SECTIONS.length);
  assert.ok(isPublishedEmpty(row));
});

test("sin personalizar: no hay borrador, y editar parte de lo publicado", () => {
  const row = virginRow();
  assert.equal(hasDraft(row), false);
  assert.deepEqual(draftPage(row), publishedPage(row));
});

test("un sectionsConfig corrupto NO deja media página", () => {
  // Un jsonb que nadie escribió a propósito: texto suelto, ids inventados,
  // duplicados y objetos sin forma. Todos caen en la página por defecto.
  for (const basura of [
    "no soy un array",
    42,
    {},
    [null, 7, "x"],
    [{ id: "seccion-que-no-existe", visible: true, orden: 1 }],
  ]) {
    const pub = publishedPage({ ...virginRow(), sectionsConfig: basura });
    assert.deepEqual(visibleSectionIds(pub.sections), CATALOG_ORDER, String(basura));
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   ESTADO 2 — EN REVISIÓN
   ═══════════════════════════════════════════════════════════════════════ */

function pendingRow(): PartnerPageRow {
  return {
    // Lo APROBADO en su día.
    photoUrl: "https://cdn.example/aprobada.webp",
    bio: "Texto ya aprobado.",
    sectionsConfig: [
      { id: "funciones", visible: true, orden: 1 },
      { id: "prueba-social", visible: true, orden: 2 },
    ],
    pageStatus: "pending",
    // Lo que espera revisión.
    photoUrlPending: "https://cdn.example/propuesta.webp",
    bioPending: "Texto nuevo, sin revisar.",
    sectionsConfigPending: [
      { id: "testimonios", visible: false, orden: 1 },
      { id: "comparativa", visible: true, orden: 2 },
    ],
  };
}

test("en revisión: el público NO ve nada de lo pendiente", () => {
  const pub = publishedPage(pendingRow());

  assert.equal(pub.photoUrl, "https://cdn.example/aprobada.webp");
  assert.equal(pub.bio, "Texto ya aprobado.");
  // El orden aprobado: funciones antes que prueba-social, no el propuesto.
  assert.deepEqual(pub.sections.slice(0, 2).map((s) => s.id), ["funciones", "prueba-social"]);
  // Y la sección que el borrador APAGA sigue encendida en lo publicado.
  assert.ok(visibleSectionIds(pub.sections).includes("testimonios"));
});

test("en revisión: el afiliado ve su borrador, y no puede editarlo", () => {
  const row = pendingRow();
  const draft = draftPage(row);

  assert.equal(draft.photoUrl, "https://cdn.example/propuesta.webp");
  assert.equal(draft.bio, "Texto nuevo, sin revisar.");
  assert.equal(draft.sections[0].id, "testimonios");
  assert.equal(draft.sections[0].visible, false);

  assert.equal(canEditPage("pending"), false);
  assert.ok(hasDraft(row));
});

/* ═══════════════════════════════════════════════════════════════════════
   ESTADO 3 — APROBADA
   ═══════════════════════════════════════════════════════════════════════ */

test("aprobada: se publica lo aprobado y el borrador quedó limpio", () => {
  const row: PartnerPageRow = {
    photoUrl: "https://cdn.example/final.webp",
    bio: "Mi presentación publicada.",
    sectionsConfig: [{ id: "testimonios", visible: false, orden: 1 }],
    pageStatus: "approved",
    photoUrlPending: null,
    bioPending: null,
    sectionsConfigPending: null,
  };

  const pub = publishedPage(row);
  assert.equal(pub.photoUrl, "https://cdn.example/final.webp");
  assert.equal(pub.bio, "Mi presentación publicada.");
  assert.equal(visibleSectionIds(pub.sections).includes("testimonios"), false);

  assert.equal(hasDraft(row), false);
  assert.equal(canEditPage("approved"), true);
  assert.equal(isPublishedEmpty(row), false);
  // Sin borrador, lo que edita es una copia de lo publicado.
  assert.deepEqual(draftPage(row), pub);
});

/* ═══════════════════════════════════════════════════════════════════════
   LA TRAMPA — borrar foto y texto en el borrador
   ═══════════════════════════════════════════════════════════════════════ */

test("borrar foto y texto en el borrador NO se lee como 'no editó nada'", () => {
  const row: PartnerPageRow = {
    photoUrl: "https://cdn.example/aprobada.webp",
    bio: "Lo que hay publicado.",
    sectionsConfig: null,
    pageStatus: "draft",
    // Quitó las dos cosas. sectionsConfigPending es lo que delata el borrador.
    photoUrlPending: null,
    bioPending: null,
    sectionsConfigPending: defaultSections(),
  };

  assert.ok(hasDraft(row), "el borrador existe aunque foto y texto sean null");
  const draft = draftPage(row);
  assert.equal(draft.photoUrl, null, "no debe resucitar la foto publicada");
  assert.equal(draft.bio, null, "no debe resucitar el texto publicado");
  // Y lo publicado sigue intacto: el borrado tampoco se publicó solo.
  assert.equal(publishedPage(row).photoUrl, "https://cdn.example/aprobada.webp");
});

/* ═══════════════════════════════════════════════════════════════════════
   buildDraftPatch — el borrador es una FOTO FIJA, nunca un diff
   ═══════════════════════════════════════════════════════════════════════ */

test("un cambio parcial guarda los TRES campos del borrador", () => {
  const row: PartnerPageRow = {
    photoUrl: "https://cdn.example/foto.webp",
    bio: "Bio publicada.",
    sectionsConfig: null,
    pageStatus: "approved",
    photoUrlPending: null,
    bioPending: null,
    sectionsConfigPending: null,
  };

  // Solo cambia el texto: la foto y las secciones se copian de lo publicado.
  const patch = buildDraftPatch(row, { bio: "Bio nueva." });
  assert.equal(patch.bioPending, "Bio nueva.");
  assert.equal(patch.photoUrlPending, "https://cdn.example/foto.webp");
  assert.equal(patch.sectionsConfigPending.length, MOVABLE_SECTIONS.length);
  // Tocar algo aprobado lo devuelve a borrador: ya no coincide con lo público.
  assert.equal(patch.pageStatus, "draft");
});

test("editar tras un rechazo NO borra el motivo de la pantalla", () => {
  const row: PartnerPageRow = {
    ...virginRow(),
    pageStatus: "rejected",
    sectionsConfigPending: defaultSections(),
  };
  // Sin cambio de estado: sigue 'rejected' hasta que reenvíe, para que el
  // motivo del rechazo siga a la vista mientras corrige.
  assert.equal(buildDraftPatch(row, { bio: "Corregido." }).pageStatus, undefined);
});

/* ═══════════════════════════════════════════════════════════════════════
   normalizeSections
   ═══════════════════════════════════════════════════════════════════════ */

test("normalizeSections respeta el orden guardado y renumera sin huecos", () => {
  const out = normalizeSections([
    { id: "preguntas", visible: true, orden: 10 },
    { id: "funciones", visible: false, orden: 3 },
  ]);

  assert.equal(out[0].id, "funciones");
  assert.equal(out[0].orden, 1);
  assert.equal(out[0].visible, false);
  assert.equal(out[1].id, "preguntas");
  assert.equal(out[1].orden, 2);
  // Y las que faltaban entran al final, ENCENDIDAS: una sección nueva del
  // producto aparece sola en las páginas ya configuradas.
  assert.equal(out.length, MOVABLE_SECTIONS.length);
  for (const s of out.slice(2)) assert.equal(s.visible, true);
  assert.deepEqual(out.map((s) => s.orden), out.map((_, i) => i + 1));
});

test("normalizeSections descarta duplicados y secciones fijas", () => {
  const out = normalizeSections([
    { id: "funciones", visible: true, orden: 1 },
    { id: "funciones", visible: false, orden: 2 },
    // Las fijas jamás entran a la config: llevan botón de registro.
    { id: "portada", visible: false, orden: 3 },
    { id: "cierre", visible: false, orden: 4 },
  ]);

  assert.equal(out.filter((s) => s.id === "funciones").length, 1);
  assert.equal(out.find((s) => s.id === "funciones")?.visible, true, "gana la primera");
  assert.equal(out.some((s) => s.id === "portada" || s.id === "cierre"), false);
  assert.equal(out.length, MOVABLE_SECTIONS.length);
});

test("solo un false explícito apaga una sección", () => {
  const out = normalizeSections([
    { id: "funciones", orden: 1 },
    { id: "testimonios", visible: 0, orden: 2 },
    { id: "comparativa", visible: false, orden: 3 },
  ]);
  assert.equal(out.find((s) => s.id === "funciones")?.visible, true, "sin la clave, encendida");
  assert.equal(out.find((s) => s.id === "testimonios")?.visible, true, "0 no es false");
  assert.equal(out.find((s) => s.id === "comparativa")?.visible, false);
});

/* ═══════════════════════════════════════════════════════════════════════
   sanitizeBio
   ═══════════════════════════════════════════════════════════════════════ */

test("sanitizeBio conserva los párrafos y limpia lo invisible", () => {
  const NL = String.fromCharCode(10);
  const NUL = String.fromCharCode(0);
  const raw = `  Primer párrafo.${NL}${NL}${NL}${NL}Segundo${NUL} párrafo.  `;
  const out = sanitizeBio(raw);

  assert.equal(out, `Primer párrafo.${NL}${NL}Segundo párrafo.`);
  assert.equal(out?.includes(NUL), false);
});

test("sanitizeBio: vacío es null, no cadena vacía", () => {
  assert.equal(sanitizeBio(""), null);
  assert.equal(sanitizeBio("   "), null);
  assert.equal(sanitizeBio(null), null);
  assert.equal(sanitizeBio(123), null);
});

test("sanitizeBio NO interpreta marcado: se guarda literal", () => {
  // La página lo pinta como texto plano (React escapa), así que esto se lee
  // tal cual y, sobre todo, es lo que Rafael ve al moderar.
  const raw = "<b>hola</b> <script>alert(1)</script>";
  assert.equal(sanitizeBio(raw), raw);
});

test("sanitizeBio recorta por caracteres visibles, no por unidades UTF-16", () => {
  const emoji = String.fromCodePoint(128512); // 2 unidades UTF-16, 1 carácter
  const largo = emoji.repeat(BIO_MAX_CHARS + 50);
  const out = sanitizeBio(largo);

  assert.equal(bioLength(out ?? ""), BIO_MAX_CHARS);
  // Y no se partió un par suplente por la mitad.
  assert.equal(out?.endsWith(emoji), true);
});

/* ═══════════════════════════════════════════════════════════════════════
   Estados y catálogo
   ═══════════════════════════════════════════════════════════════════════ */

test("un estado desconocido cae en 'draft': ante la duda, no publicar", () => {
  assert.equal(normalizeStatus("publicado"), "draft");
  assert.equal(normalizeStatus(null), "draft");
  assert.equal(normalizeStatus(""), "draft");
  assert.equal(normalizeStatus("approved"), "approved");
});

test("toda sección fija explica por qué lo es", () => {
  for (const s of PARTNER_SECTIONS) {
    if (s.slot === "movable") {
      assert.equal(s.fixedReason, undefined, `${s.id} es movible y no necesita motivo`);
    } else {
      assert.ok(s.fixedReason && s.fixedReason.length > 20, `${s.id} necesita un motivo escrito`);
    }
  }
});
