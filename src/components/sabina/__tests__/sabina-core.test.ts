import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeQuestion,
  titleFromQuestion,
  formatToolsUsed,
  humanizeToolName,
  classifySabinaError,
  SABINA_ERROR_COPY,
  parseSabinaMarkdown,
  classifyParagraphTone,
  tokenizeInline,
  SABINA_QUESTION_MAX_CHARS,
} from "../sabina-core";
import { filasConMonto, formatearPesos, partirFilaConMonto } from "../sabina-listas";

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

test("classifySabinaError — el 403 de la CLÍNICA que apagó a Sabina no es el del Super Admin", () => {
  // Cuerpo real de /api/sabina cuando la clínica la apagó en Saldo de IA (ws1-t1).
  assert.equal(classifySabinaError(403, { error: "…", funcionApagada: "sabina" }), "apagada_clinica");
  assert.equal(SABINA_ERROR_COPY.apagada_clinica.retryable, false);
  // El del Super Admin sigue siendo el suyo, y otro 403 no es ninguno de los dos.
  assert.equal(classifySabinaError(403, { sabinaApagada: true }), "apagada");
  assert.equal(classifySabinaError(403, { funcionApagada: "chat" }), "unknown");
  assert.equal(classifySabinaError(403, { error: "forbidden" }), "unknown");
});

test("classifySabinaError — el 429 del CUPO DEL PLAN no es el de «muchas preguntas seguidas»", () => {
  // Cuerpo real de /api/sabina cuando aiTokenLimitError corta (plan sin IA o cupo agotado).
  const cupo = { error: "Tu plan no incluye esta función de IA o agotaste el cupo mensual. Sube de plan.", limitReached: true };
  assert.equal(classifySabinaError(429, cupo), "plan_limit");
  // Reintentar no lo arregla: la pantalla no puede ofrecerlo.
  assert.equal(SABINA_ERROR_COPY.plan_limit.retryable, false);
  // El freno por ráfaga (persistentRateLimit) sigue siendo reintentable.
  assert.equal(classifySabinaError(429, { error: "Demasiadas solicitudes" }), "rate_limited");
  assert.equal(classifySabinaError(429, null), "rate_limited");
  assert.equal(classifySabinaError(429), "rate_limited");
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

test("tokenizeInline — enlaces solo hacia rutas de la app (el comprobante), nunca hacia fuera", () => {
  assert.deepEqual(tokenizeInline("Aquí está [el comprobante MF-0043](/api/invoices/inv_1/print)."), [
    { text: "Aquí está " },
    { text: "el comprobante MF-0043", href: "/api/invoices/inv_1/print" },
    { text: "." },
  ]);
  for (const malo of [
    "[clic](https://otro.sitio/robo)",
    "[clic](javascript:alert(1))",
    "[clic](//otro.sitio/api/x)",
    "[clic](/api/../../etc)",
    "[clic](/login)",
  ]) {
    assert.ok(tokenizeInline(malo).every((t) => !t.href), malo);
  }
});

test("tokenizeInline — texto sin marcado devuelve un único token plano", () => {
  assert.deepEqual(tokenizeInline("sin nada especial"), [{ text: "sin nada especial" }]);
});

/* ── Listas, cantidades y tablas (14-sep-2026) ─────────────────────────────
 * Rafael pidió «enlista los pacientes que deben» y le llegó una tira separada
 * por comas. Estas pruebas fijan lo que la PANTALLA ya no aplasta: listas
 * numeradas, líneas sueltas de «nombre — $cantidad», tablas; y lo que no hace
 * al revés: inventar una lista de una frase con comas, o pintar una viñeta sola.
 */

test("parseSabinaMarkdown — la lista numerada es lista (antes salía «1. Ana… 2. Luis…» en un párrafo)", () => {
  const blocks = parseSabinaMarkdown("Te deben:\n1. Paula Restringida — $7,777\n2. Beto Munoz — $3,000\n3. Carla Gomez — $500");
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { kind: "paragraph", text: "Te deben:", tone: "plain" });
  assert.deepEqual(blocks[1], {
    kind: "bullets",
    items: ["Paula Restringida — $7,777", "Beto Munoz — $3,000", "Carla Gomez — $500"],
    tone: "plain",
    ordered: true,
  });
});

test("parseSabinaMarkdown — «* » también es viñeta, y un renglón en blanco entre elementos no parte la lista", () => {
  const blocks = parseSabinaMarkdown("* Resina\n* Limpieza\n\n* Endodoncia");
  assert.deepEqual(blocks, [{ kind: "bullets", items: ["Resina", "Limpieza", "Endodoncia"], tone: "plain" }]);
  const numerada = parseSabinaMarkdown("1. Ana\n\n2. Luis");
  assert.deepEqual(numerada, [{ kind: "bullets", items: ["Ana", "Luis"], tone: "plain", ordered: true }]);
});

test("parseSabinaMarkdown — líneas «nombre — $cantidad» SIN viñeta se vuelven lista; ya no se juntan en una línea", () => {
  const blocks = parseSabinaMarkdown("4 pacientes te deben $12,277:\nPaula Restringida — $7,777\nBeto Munoz: $3,000\nDora Sanchez — $1,000");
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { kind: "paragraph", text: "4 pacientes te deben $12,277:", tone: "plain" });
  assert.equal(blocks[1].kind, "bullets");
  assert.equal((blocks[1] as { items: string[] }).items.length, 3);
});

test("parseSabinaMarkdown — dos FRASES con una cifra cada una siguen siendo párrafo, no una falsa lista", () => {
  // Contraejemplo del refutador (14-sep-2026): con la coma como separador esto salía en dos columnas.
  for (const texto of [
    "Facturaste bien este mes, $45,000 en total.\nEl próximo mes pinta mejor, $52,000 proyectados.",
    "Este mes facturaste lo que esperabas: $45,000 en total.\nEl que viene pinta mejor: $52,000 proyectados.",
    "Cobraste más que en agosto — $45,000.\nY te deben menos — $12,000.",
  ]) {
    assert.deepEqual(parseSabinaMarkdown(texto), [{ kind: "paragraph", text: texto, tone: "plain" }], texto);
  }
  // Una cuenta corta sí: «Cobrado: $45,000» / «Pendiente: $12,000 (3 facturas)».
  assert.equal(parseSabinaMarkdown("Cobrado: $45,000\nPendiente: $12,000 (3 facturas)")[0].kind, "bullets");
});

test("parseSabinaMarkdown — un párrafo conserva sus saltos de línea", () => {
  const blocks = parseSabinaMarkdown("Hoy tienes 4 citas.\nLa próxima es a las 16:00.");
  assert.deepEqual(blocks, [{ kind: "paragraph", text: "Hoy tienes 4 citas.\nLa próxima es a las 16:00.", tone: "plain" }]);
});

test("parseSabinaMarkdown — NO exagera: una lista de un elemento es frase, y una frase con comas sigue siendo frase", () => {
  assert.deepEqual(parseSabinaMarkdown("- Tienes 4 citas hoy."), [{ kind: "paragraph", text: "Tienes 4 citas hoy.", tone: "plain" }]);
  // El número se queda: un paso numerado solo sigue siendo un paso.
  assert.deepEqual(parseSabinaMarkdown("1. Llama a Ana."), [{ kind: "paragraph", text: "1. Llama a Ana.", tone: "plain" }]);
  // La pantalla no adivina listas dentro de una frase: eso es trabajo del prompt y del resumen.
  const frase = "Te deben Paula Restringida $7,777, Beto Munoz $3,000 y Carla Gomez $500.";
  assert.deepEqual(parseSabinaMarkdown(frase), [{ kind: "paragraph", text: frase, tone: "plain" }]);
  // Una sola línea «Total — $12,277» tampoco es lista.
  assert.equal(parseSabinaMarkdown("Total — $12,277")[0].kind, "paragraph");
});

test("parseSabinaMarkdown — la tabla de markdown es tabla; la de UNA fila se lee como frase", () => {
  const tabla = parseSabinaMarkdown("| Paciente | Saldo |\n|---|---:|\n| Paula | $7,777 |\n| Beto | $3,000 |");
  assert.deepEqual(tabla, [{ kind: "table", header: ["Paciente", "Saldo"], rows: [["Paula", "$7,777"], ["Beto", "$3,000"]] }]);
  const una = parseSabinaMarkdown("| Citas hoy | Canceladas |\n|---|---|\n| 4 | 1 |");
  assert.deepEqual(una, [{ kind: "paragraph", text: "Citas hoy: 4 · Canceladas: 1", tone: "plain" }]);
  // Una barra suelta en una frase no es tabla.
  assert.equal(parseSabinaMarkdown("Ingresos | septiembre")[0].kind, "paragraph");
});

test("partirFilaConMonto — separa etiqueta, cantidad y detalle; conservador con lo que no es una cuenta", () => {
  assert.deepEqual(partirFilaConMonto("Beto Munoz — $3,000 (2 facturas)"), { etiqueta: "Beto Munoz", montoCrudo: "$3,000", detalle: "(2 facturas)" });
  assert.deepEqual(partirFilaConMonto("**Paula Restringida:** $7,777"), { etiqueta: "Paula Restringida", montoCrudo: "$7,777", detalle: "" });
  assert.equal(partirFilaConMonto("**Paula Restringida** — **$7,777**")?.etiqueta, "**Paula Restringida**");
  assert.equal(partirFilaConMonto("Beto — $3,000, vencido")?.detalle, "vencido");
  assert.equal(partirFilaConMonto("Facturaste bien este mes, $45,000 en total."), null); // la coma no separa
  // El menos pegado es del importe; el guion con espacio, del separador.
  assert.deepEqual(partirFilaConMonto("Ana López — -$500 (a favor)"), { etiqueta: "Ana López", montoCrudo: "-$500", detalle: "(a favor)" });
  assert.equal(partirFilaConMonto("Ana López - $500")?.montoCrudo, "$500");
  assert.equal(partirFilaConMonto("Ana debe $1,500 desde agosto"), null); // sin separador antes de la cantidad
  assert.equal(partirFilaConMonto("Cobrado — $1,500 de $3,000"), null); // dos cantidades: ¿cuál va a la columna?
  assert.equal(partirFilaConMonto("Meta — $1.5 millones"), null); // una escala, no un importe
  assert.equal(partirFilaConMonto("Limpieza — 12 veces"), null); // sin pesos
});

test("filasConMonto — todas las cantidades de una lista con la misma forma", () => {
  // Una trae centavos: todas los llevan, y los miles se separan aunque el modelo no lo hiciera.
  assert.deepEqual(
    filasConMonto(["Paula — $7777", "Beto — $820.5", "Dora — $1,000"])?.map((f) => f.monto),
    ["$7,777.00", "$820.50", "$1,000.00"],
  );
  // Ninguna los trae: ninguna los lleva.
  assert.deepEqual(filasConMonto(["Paula — $7,777", "Beto — $500"])?.map((f) => f.monto), ["$7,777", "$500"]);
  // Mezclada o de un solo elemento: no son filas.
  assert.equal(filasConMonto(["Paula — $7,777", "Beto sin saldo"]), null);
  assert.equal(filasConMonto(["Paula — $7,777"]), null);
  assert.equal(formatearPesos(1234567.5, 2), "$1,234,567.50");
  // Un saldo a favor no pierde el signo al normalizarse.
  assert.deepEqual(filasConMonto(["Paula — $7,777", "Ana — -$500", "Beto — $-20.5"])?.map((f) => f.monto), ["$7,777.00", "-$500.00", "-$20.50"]);
});
