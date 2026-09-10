import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeQuestion,
  titleFromQuestion,
  formatToolsUsed,
  humanizeToolName,
  classifySabinaError,
  parseSabinaMarkdown,
  classifyParagraphTone,
  tokenizeInline,
  SABINA_QUESTION_MAX_CHARS,
} from "../sabina-core";

test("sanitizeQuestion — colapsa espacios y recorta al tope", () => {
  assert.equal(sanitizeQuestion("  ¿quién   me\n\ndebe?  "), "¿quién me debe?");
  assert.equal(sanitizeQuestion("   "), null);
  assert.equal(sanitizeQuestion(""), null);
  const larga = "a".repeat(SABINA_QUESTION_MAX_CHARS + 500);
  assert.equal(sanitizeQuestion(larga)!.length, SABINA_QUESTION_MAX_CHARS);
});

test("titleFromQuestion — corta a 60 y cae a un título por defecto si no hay texto", () => {
  assert.equal(titleFromQuestion("¿Cuántas citas tengo hoy?"), "¿Cuántas citas tengo hoy?");
  assert.equal(titleFromQuestion("   "), "Consulta a Sabina");
  assert.equal(titleFromQuestion("x".repeat(200)).length, 60);
});

test("formatToolsUsed — frase en español con 'y' antes del último", () => {
  assert.equal(formatToolsUsed([]), null);
  assert.equal(formatToolsUsed(null), null);
  assert.equal(formatToolsUsed(["citas_del_dia"]), "citas del día");
  assert.equal(formatToolsUsed(["citas_del_dia", "ingresos_por_periodo"]), "citas del día y ingresos del periodo");
  assert.equal(
    formatToolsUsed(["citas_del_dia", "ingresos_por_periodo", "pacientes_con_deuda"]),
    "citas del día, ingresos del periodo y pacientes con deuda",
  );
});

test("humanizeToolName — cae a snake_case→palabras cuando la herramienta no está en el catálogo", () => {
  assert.equal(humanizeToolName("citas_del_dia"), "citas del día");
  assert.equal(humanizeToolName("nueva_herramienta_futura"), "nueva herramienta futura");
});

test("classifySabinaError — mapea cada código del contrato, y null a 'network'", () => {
  assert.equal(classifySabinaError(401), "auth");
  assert.equal(classifySabinaError(402), "no_balance");
  assert.equal(classifySabinaError(429), "rate_limited");
  assert.equal(classifySabinaError(503), "model_down");
  assert.equal(classifySabinaError(null), "network");
  assert.equal(classifySabinaError(500), "unknown");
  assert.equal(classifySabinaError(200), "unknown");
});

test("classifyParagraphTone — reconoce el vocabulario de sugerencia y de hecho medido", () => {
  assert.equal(classifyParagraphTone("Sugerencia: mueve ortodoncia a los martes."), "opinion");
  assert.equal(classifyParagraphTone("Yo movería ortodoncia a los martes."), "opinion");
  assert.equal(classifyParagraphTone("Según la agenda, los martes tienes 40% de ocupación."), "fact");
  assert.equal(classifyParagraphTone("Tienes 8 citas hoy."), "plain");
});

test("parseSabinaMarkdown — separa encabezados, listas y párrafos, cada uno con su tono", () => {
  const raw = [
    "## Lo que medí",
    "Según la agenda, los martes tienes 40% de ocupación.",
    "",
    "- Lunes: 80%",
    "- Martes: 40%",
    "",
    "Sugerencia: mueve ortodoncia a los martes.",
  ].join("\n");

  const blocks = parseSabinaMarkdown(raw);
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks[0], { kind: "heading", level: 2, text: "Lo que medí" });
  assert.equal(blocks[1].kind, "paragraph");
  assert.equal((blocks[1] as { tone: string }).tone, "fact");
  assert.deepEqual(blocks[2], { kind: "bullets", items: ["Lunes: 80%", "Martes: 40%"], tone: "plain" });
  assert.equal(blocks[3].kind, "paragraph");
  assert.equal((blocks[3] as { tone: string }).tone, "opinion");
});

test("parseSabinaMarkdown — dos saltos de línea seguidos no dejan un párrafo vacío", () => {
  const blocks = parseSabinaMarkdown("Hola.\n\n\nAdiós.");
  assert.equal(blocks.length, 2);
});

test("tokenizeInline — separa negrita, itálica y código sin perder el texto plano", () => {
  const tokens = tokenizeInline("Tienes **8 citas** hoy, revisa `agenda_ocupacion` y *cuida el martes*.");
  assert.deepEqual(tokens, [
    { text: "Tienes " },
    { text: "8 citas", bold: true },
    { text: " hoy, revisa " },
    { text: "agenda_ocupacion", code: true },
    { text: " y " },
    { text: "cuida el martes", italic: true },
    { text: "." },
  ]);
});

test("tokenizeInline — texto sin marcado devuelve un único token plano", () => {
  assert.deepEqual(tokenizeInline("sin nada especial"), [{ text: "sin nada especial" }]);
});
