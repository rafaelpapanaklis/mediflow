/**
 * Pruebas del núcleo de "Mis textos" — el guion de venta del CRM.
 *
 * Correr: npm run test:crm-textos
 *
 * Qué protege — lo que, si se rompe, NO truena nada y sólo hace que se
 * mande un mensaje malo a un cliente de verdad:
 *
 *  1. EL HUECO VACÍO. Un prospecto sin persona de contacto no puede
 *     producir "Hola ," ni " ." sueltos. Y lo que faltó tiene que salir en
 *     la lista de faltantes, para que la pantalla lo diga ANTES de copiar.
 *  2. EL HUECO MAL ESCRITO. {{nomre}} tiene que rechazarse AL GUARDAR:
 *     descubrirlo pegado en WhatsApp es descubrirlo tarde.
 *  3. LO QUE SE SUGIERE. Un texto de barbería no puede salir el primero en
 *     una clínica dental — pero tampoco puede desaparecer.
 *  4. EL ORDEN. Dos textos recién creados nacen con el mismo sortOrder; sin
 *     desempate se intercambiarían de sitio entre recargas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crmAgruparTextos,
  crmAlcanceTexto,
  crmHuecosDelTexto,
  crmHuecosDesconocidos,
  crmLimpiarTexto,
  crmOrdenarTextos,
  crmRellenarTexto,
  crmSaludo,
  crmTextoCoincide,
  crmTextosParaProspecto,
  crmValidarTexto,
  CRM_HUECOS,
  CRM_TEXTO_TITULO_MAX,
  type CrmTextoDTO,
} from "../textos-core";

// ── Ayudas ──────────────────────────────────────────────────────────────

function texto(over: Partial<CrmTextoDTO> = {}): CrmTextoDTO {
  return {
    id: over.id ?? "t1",
    title: over.title ?? "Primer contacto",
    body: over.body ?? "{{saludo}} le escribo de DaleControl.",
    vertical: over.vertical ?? null,
    stage: over.stage ?? null,
    sortOrder: over.sortOrder ?? 0,
    createdByEmail: over.createdByEmail ?? null,
    createdAt: over.createdAt ?? "2026-09-01T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-09-01T00:00:00.000Z",
  };
}

const DENTAL = {
  name: "Clínica Dental Sonrisa",
  contactName: "Dra. Ana Ruiz",
  city: "Puebla",
  state: "Puebla",
  vertical: "DENTAL",
  size: 4,
};

// ── 1. El hueco vacío ───────────────────────────────────────────────────

test("el saludo cae a 'buen día' cuando no hay persona de contacto", () => {
  assert.equal(crmSaludo("Dra. Ana"), "Hola Dra. Ana,");
  assert.equal(crmSaludo(""), "Hola, buen día:");
  assert.equal(crmSaludo(null), "Hola, buen día:");
  assert.equal(crmSaludo("   "), "Hola, buen día:");
});

test("un hueco vacío NO deja 'Hola ,' ni el espacio delante de la coma", () => {
  const r = crmRellenarTexto("Hola {{contacto}}, le escribo.", { ...DENTAL, contactName: null });
  assert.equal(r.texto, "Hola, le escribo.");
});

test("un hueco vacío no deja el punto separado ni espacios dobles", () => {
  const r = crmRellenarTexto("Le escribo de {{ciudad}} . Un gusto  saludarle.", {
    ...DENTAL,
    city: null,
  });
  assert.equal(r.texto, "Le escribo de. Un gusto saludarle.");
});

test("lo que faltó sale en `faltantes`, con su etiqueta legible", () => {
  const r = crmRellenarTexto("{{saludo}} en {{ciudad}} con {{tamano}} {{medida}}.", {
    ...DENTAL,
    city: null,
    size: null,
  });
  assert.deepEqual(r.faltantes.sort(), ["Ciudad", "Su tamaño"]);
});

test("sin huecos vacíos, `faltantes` viene vacío", () => {
  const r = crmRellenarTexto("{{saludo}} le escribo de {{negocio}} en {{ciudad}}.", DENTAL);
  assert.deepEqual(r.faltantes, []);
  assert.equal(r.texto, "Hola Dra. Ana Ruiz, le escribo de Clínica Dental Sonrisa en Puebla.");
});

test("el producto y la medida salen del giro, no del texto", () => {
  const r = crmRellenarTexto("{{producto}} para sus {{tamano}} {{medida}}.", {
    ...DENTAL,
    vertical: "INSTITUCION",
    size: 300,
  });
  assert.equal(r.texto, "DaleControl Institucional para sus 300 estudiantes.");
});

test("un giro fuera del catálogo no rompe: cae al producto genérico", () => {
  const r = crmRellenarTexto("{{producto}} · {{giro}}", { ...DENTAL, vertical: "PANADERIA" });
  assert.equal(r.texto, "DaleControl · PANADERIA");
  assert.deepEqual(r.faltantes, []);
});

test("los saltos de línea del mensaje NO se juntan", () => {
  const r = crmRellenarTexto("Primera línea.\n\nSegunda línea.", DENTAL);
  assert.equal(r.texto, "Primera línea.\n\nSegunda línea.");
});

test("crmLimpiarTexto no toca el '50 %' que se escribe con espacio", () => {
  assert.equal(crmLimpiarTexto("Sube 50 % al mes."), "Sube 50 % al mes.");
});

test("los espacios dentro de las llaves y las mayúsculas se aceptan", () => {
  const r = crmRellenarTexto("{{ NEGOCIO }} y {{Ciudad}}", DENTAL);
  assert.equal(r.texto, "Clínica Dental Sonrisa y Puebla");
});

// ── 2. El hueco mal escrito ─────────────────────────────────────────────

test("crmHuecosDelTexto encuentra cada hueco una sola vez", () => {
  assert.deepEqual(crmHuecosDelTexto("{{negocio}} {{ciudad}} {{negocio}}"), [
    "negocio",
    "ciudad",
  ]);
  assert.deepEqual(crmHuecosDelTexto("sin huecos"), []);
  assert.deepEqual(crmHuecosDelTexto(null), []);
});

test("un hueco fuera del catálogo se detecta", () => {
  assert.deepEqual(crmHuecosDesconocidos("{{nomre}} y {{negocio}}"), ["nomre"]);
  assert.deepEqual(crmHuecosDesconocidos("{{negocio}}"), []);
});

test("guardar un texto con un hueco inventado se RECHAZA, y lo nombra", () => {
  const error = crmValidarTexto({ title: "Prueba", body: "Hola {{nomre}}" });
  assert.ok(error, "tenía que fallar");
  assert.ok(error!.includes("{{nomre}}"), `el error no nombra el hueco malo: ${error}`);
  assert.ok(error!.includes("{{negocio}}"), "el error no lista los huecos válidos");
});

test("un hueco inventado se deja TAL CUAL al rellenar, para que se vea", () => {
  const r = crmRellenarTexto("Hola {{nomre}}", DENTAL);
  assert.equal(r.texto, "Hola {{nomre}}");
  assert.deepEqual(r.desconocidos, ["nomre"]);
});

test("el validador pide título y cuerpo, y respeta el tope del título", () => {
  assert.ok(crmValidarTexto({ title: "", body: "algo" }));
  assert.ok(crmValidarTexto({ title: "algo", body: "   " }));
  assert.ok(crmValidarTexto({ title: "x".repeat(CRM_TEXTO_TITULO_MAX + 1), body: "algo" }));
  assert.equal(crmValidarTexto({ title: "Bien", body: "{{saludo}} qué tal" }), null);
});

test("el validador rechaza un giro o una etapa fuera del catálogo", () => {
  assert.ok(crmValidarTexto({ title: "t", body: "b", vertical: "PANADERIA" }));
  assert.ok(crmValidarTexto({ title: "t", body: "b", stage: "REGATEANDO" }));
  assert.equal(crmValidarTexto({ title: "t", body: "b", vertical: "DENTAL", stage: "DEMO" }), null);
  // null = "sirve para cualquiera", y tiene que pasar.
  assert.equal(crmValidarTexto({ title: "t", body: "b", vertical: null, stage: null }), null);
});

test("todos los huecos del catálogo se rellenan de verdad", () => {
  const cuerpo = CRM_HUECOS.map((h) => `{{${h.clave}}}`).join(" | ");
  assert.equal(crmHuecosDesconocidos(cuerpo).length, 0);
  const r = crmRellenarTexto(cuerpo, DENTAL);
  assert.deepEqual(r.faltantes, [], "con todos los datos no debería faltar ninguno");
  assert.ok(!r.texto.includes("{{"), `quedó un hueco sin sustituir: ${r.texto}`);
});

test("los huecos marcados como `siempre` nunca se quedan vacíos", () => {
  const vacio = { name: "Negocio", contactName: null, city: null, state: null, vertical: null, size: null };
  for (const h of CRM_HUECOS.filter((x) => x.siempre)) {
    const r = crmRellenarTexto(`{{${h.clave}}}`, vacio);
    assert.deepEqual(r.faltantes, [], `{{${h.clave}}} se quedó vacío con un prospecto pelado`);
    assert.notEqual(r.texto, "", `{{${h.clave}}} produjo texto vacío`);
  }
});

// ── 3. Lo que se sugiere ────────────────────────────────────────────────

test("un texto de otro giro NO se sugiere, pero tampoco se esconde", () => {
  const dental = texto({ id: "d", title: "Dental", vertical: "DENTAL" });
  const barber = texto({ id: "b", title: "Barber", vertical: "BARBERIA" });
  const r = crmTextosParaProspecto([dental, barber], { vertical: "DENTAL", stage: "NUEVO" });
  assert.deepEqual(r.sugeridos.map((t) => t.id), ["d"]);
  assert.deepEqual(r.otros.map((t) => t.id), ["b"]);
});

test("el más específico se sugiere primero", () => {
  const generico = texto({ id: "g", sortOrder: 0 });
  const porGiro = texto({ id: "v", vertical: "DENTAL", sortOrder: 1 });
  const porTodo = texto({ id: "t", vertical: "DENTAL", stage: "NUEVO", sortOrder: 2 });
  const r = crmTextosParaProspecto([generico, porGiro, porTodo], {
    vertical: "DENTAL",
    stage: "NUEVO",
  });
  assert.deepEqual(r.sugeridos.map((t) => t.id), ["t", "v", "g"]);
  assert.deepEqual(r.otros, []);
});

test("un texto de otra ETAPA del mismo giro tampoco se sugiere", () => {
  const t = texto({ id: "x", vertical: "DENTAL", stage: "GANADO" });
  const r = crmTextosParaProspecto([t], { vertical: "DENTAL", stage: "NUEVO" });
  assert.deepEqual(r.sugeridos, []);
  assert.deepEqual(r.otros.map((x) => x.id), ["x"]);
});

// ── 4. El orden y los grupos ────────────────────────────────────────────

test("dos textos con el mismo sortOrder no bailan: desempata el título", () => {
  const a = texto({ id: "a", title: "Zeta", sortOrder: 0 });
  const b = texto({ id: "b", title: "Alfa", sortOrder: 0 });
  assert.deepEqual(crmOrdenarTextos([a, b]).map((t) => t.id), ["b", "a"]);
  assert.deepEqual(crmOrdenarTextos([b, a]).map((t) => t.id), ["b", "a"]);
});

test("crmOrdenarTextos no muta la lista que recibe", () => {
  const lista = [texto({ id: "a", title: "Zeta" }), texto({ id: "b", title: "Alfa" })];
  crmOrdenarTextos(lista);
  assert.deepEqual(lista.map((t) => t.id), ["a", "b"]);
});

test("los genéricos van primero y los giros en el orden del catálogo", () => {
  const grupos = crmAgruparTextos([
    texto({ id: "b", title: "B", vertical: "BARBERIA", sortOrder: 0 }),
    texto({ id: "d", title: "D", vertical: "DENTAL", sortOrder: 1 }),
    texto({ id: "g", title: "G", vertical: null, sortOrder: 2 }),
  ]);
  assert.deepEqual(grupos.map((g) => g.verticalId), ["", "DENTAL", "BARBERIA"]);
  assert.deepEqual(grupos.map((g) => g.textos.length), [1, 1, 1]);
});

test("ningún texto se pierde al agrupar, ni con un giro retirado", () => {
  const lista = [
    texto({ id: "a", vertical: "DENTAL" }),
    texto({ id: "b", vertical: "PANADERIA" }),
    texto({ id: "c", vertical: null }),
  ];
  const grupos = crmAgruparTextos(lista);
  const ids = grupos.flatMap((g) => g.textos.map((t) => t.id)).sort();
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("buscar ignora acentos y busca también en el cuerpo", () => {
  const t = texto({ title: "Clínica fría", body: "Le escribo de Puebla" });
  assert.equal(crmTextoCoincide(t, "clinica"), true);
  assert.equal(crmTextoCoincide(t, "puebla"), true);
  assert.equal(crmTextoCoincide(t, "fria clinica"), true);
  assert.equal(crmTextoCoincide(t, "monterrey"), false);
  assert.equal(crmTextoCoincide(t, "  "), true);
});

test("el alcance se lee en palabras, no en códigos", () => {
  assert.equal(crmAlcanceTexto({ vertical: null, stage: null }), "Cualquier giro · Cualquier momento");
  assert.equal(crmAlcanceTexto({ vertical: "DENTAL", stage: "DEMO" }), "Clínica dental · Junta / demo");
});
