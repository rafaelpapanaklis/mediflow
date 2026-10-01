// ws1-t3 — botones y listas de WhatsApp: armado dentro de los límites de Meta,
// lectura de lo que tocó el paciente y la plantilla de recordatorio con
// botones. Puro: sin base ni red. Correr: npm run test:wa-botones
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accionDeBotonRecordatorio,
  botonesRecordatorio,
  componentesDeRespuestaRapida,
  construirInteractivo,
  interactivoParaOpciones,
  leerEleccion,
  lineaDeOpciones,
  payloadAltaPlantillaConBotones,
  payloadsDeBotonesDePlantilla,
  PLANTILLA_RECORDATORIO_CON_BOTONES,
  textoBandejaDeEleccion,
  WA_LIMITES,
} from "../interactivo";
import { checkTemplateBody, countTemplateVariables, catalogEntryFor } from "../templates-catalog";

const op = (n: number, titulo = `Opción ${n}`) => ({ id: `id${n}`, titulo });

describe("construirInteractivo — límites de la Cloud API", () => {
  it("3 botones: formato `button` con reply {id,title}", () => {
    const p: any = construirInteractivo("¿Confirmas?", {
      tipo: "botones",
      botones: [op(1, "✅ Sí"), op(2, "❌ No")],
    });
    assert.equal(p.type, "button");
    assert.equal(p.body.text, "¿Confirmas?");
    assert.deepEqual(p.action.buttons[0], { type: "reply", reply: { id: "id1", title: "✅ Sí" } });
  });

  it("más de 3 botones, cuerpo de más de 1024 o ids repetidos → null (sale texto)", () => {
    assert.equal(construirInteractivo("x", { tipo: "botones", botones: [op(1), op(2), op(3), op(4)] }), null);
    assert.equal(construirInteractivo("a".repeat(1025), { tipo: "botones", botones: [op(1)] }), null);
    assert.equal(construirInteractivo("x", { tipo: "botones", botones: [op(1), { id: "id1", titulo: "otra" }] }), null);
    assert.equal(construirInteractivo("   ", { tipo: "botones", botones: [op(1)] }), null);
  });

  it("título de botón de más de 20 se recorta con «…»", () => {
    const p: any = construirInteractivo("x", { tipo: "botones", botones: [op(1, "Un título de botón larguísimo")] });
    const t = p.action.buttons[0].reply.title as string;
    assert.ok(Array.from(t).length <= WA_LIMITES.BOTON_TITULO, t);
    assert.ok(t.endsWith("…"));
  });

  it("lista: ≤10 filas, título ≤24 y el texto entero pasa a la descripción (≤72)", () => {
    const largo = "Limpieza dental profunda con ultrasonido (45 min)";
    const p: any = construirInteractivo("¿Qué servicio?", {
      tipo: "lista",
      boton: "Ver opciones",
      filas: [op(1, largo), op(2, "Resina")],
    });
    assert.equal(p.type, "list");
    assert.equal(p.action.button, "Ver opciones");
    const [f1, f2] = p.action.sections[0].rows;
    assert.ok(Array.from(f1.title as string).length <= WA_LIMITES.FILA_TITULO);
    assert.equal(f1.description, largo);
    assert.equal(f2.description, undefined, "si cupo, sin descripción");
    assert.equal(
      construirInteractivo("x", { tipo: "lista", boton: "Ver", filas: Array.from({ length: 11 }, (_, i) => op(i)) }),
      null,
    );
  });

  it("un id más largo que el límite NO se recorta: se cae a texto", () => {
    assert.equal(
      construirInteractivo("x", { tipo: "lista", boton: "Ver", filas: [{ id: "x".repeat(201), titulo: "a" }] }),
      null,
    );
  });

  it("interactivoParaOpciones: ≤3 cortas → botones; 4–10 → lista; >10 → nada", () => {
    assert.equal(interactivoParaOpciones([op(1), op(2)])?.tipo, "botones");
    assert.equal(interactivoParaOpciones([op(1, "Un título que no cabe en un botón")])?.tipo, "lista");
    assert.equal(interactivoParaOpciones([op(1), op(2), op(3), op(4)])?.tipo, "lista");
    assert.equal(interactivoParaOpciones(Array.from({ length: 11 }, (_, i) => op(i))), null);
    assert.equal(interactivoParaOpciones([]), null);
  });
});

describe("leerEleccion — lo que llega al webhook", () => {
  it("button_reply, list_reply y botón de plantilla, con context.id", () => {
    assert.deepEqual(
      leerEleccion({ type: "interactive", context: { id: "wamid.A" }, interactive: { type: "button_reply", button_reply: { id: "bk.confirm.si", title: "✅ Sí, confirmo" } } }),
      { id: "bk.confirm.si", titulo: "✅ Sí, confirmo", origen: "boton", contextoId: "wamid.A" },
    );
    assert.deepEqual(
      leerEleccion({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "bk.slot.10:30", title: "10:30", description: "" } } }),
      { id: "bk.slot.10:30", titulo: "10:30", origen: "lista", contextoId: null },
    );
    assert.deepEqual(
      leerEleccion({ type: "button", context: { id: "wamid.T" }, button: { payload: "rec.cancelar:r1", text: "❌ Cancelar" } }),
      { id: "rec.cancelar:r1", titulo: "❌ Cancelar", origen: "plantilla", contextoId: "wamid.T" },
    );
  });

  it("texto, audio o un interactive sin id → null", () => {
    assert.equal(leerEleccion({ type: "text", text: { body: "hola" } }), null);
    assert.equal(leerEleccion({ type: "audio", audio: { id: "m1" } }), null);
    assert.equal(leerEleccion({ type: "interactive", interactive: { type: "nfm_reply" } }), null);
    assert.equal(leerEleccion(null), null);
  });

  it("la bandeja dice qué tocó", () => {
    assert.equal(
      textoBandejaDeEleccion({ id: "x", titulo: "✅ Confirmar", origen: "boton", contextoId: null }),
      "🔘 Tocó el botón «✅ Confirmar»",
    );
    assert.equal(
      textoBandejaDeEleccion({ id: "x", titulo: "10:30", origen: "lista", contextoId: null }),
      "🔘 Eligió de la lista: «10:30»",
    );
    assert.equal(lineaDeOpciones({ tipo: "botones", botones: [op(1, "Sí"), op(2, "No")] }), "🔘 Opciones: Sí · No");
  });
});

describe("botones del recordatorio", () => {
  it("cada botón lleva el id del recordatorio y su acción exacta", () => {
    const [c, r, x] = botonesRecordatorio("rem42");
    const el = (id: string) => ({ id, titulo: "", origen: "boton" as const, contextoId: null });
    assert.deepEqual(accionDeBotonRecordatorio(el(c.id)), { accion: "confirm", reminderId: "rem42" });
    assert.deepEqual(accionDeBotonRecordatorio(el(r.id)), { accion: "reschedule", reminderId: "rem42" });
    assert.deepEqual(accionDeBotonRecordatorio(el(x.id)), { accion: "cancel", reminderId: "rem42" });
  });

  it("un botón de plantilla sin payload propio se reconoce por su texto exacto, y nada más", () => {
    const pl = (titulo: string) => ({ id: titulo, titulo, origen: "plantilla" as const, contextoId: null });
    assert.deepEqual(accionDeBotonRecordatorio(pl("❌ Cancelar")), { accion: "cancel", reminderId: null });
    assert.deepEqual(accionDeBotonRecordatorio(pl("Confirmar")), { accion: "confirm", reminderId: null });
    assert.equal(accionDeBotonRecordatorio(pl("No puedo ir")), null);
    // Un toque de LISTA con título «Cancelar» no es un botón de recordatorio.
    assert.equal(accionDeBotonRecordatorio({ id: "bk.service.x", titulo: "Cancelar", origen: "lista", contextoId: null }), null);
  });

  it("los 3 botones caben como botones de respuesta (≤20) y como QUICK_REPLY (≤25)", () => {
    const p: any = construirInteractivo("Recordatorio", { tipo: "botones", botones: botonesRecordatorio("cmabc123def456ghi789jkl") });
    assert.equal(p.action.buttons.length, 3);
    for (const b of PLANTILLA_RECORDATORIO_CON_BOTONES.botones) {
      assert.ok(Array.from(b.texto).length <= WA_LIMITES.PLANTILLA_BOTON_TEXTO);
    }
  });
});

describe("plantilla propuesta con botones (sin romper la actual)", () => {
  it("mismo número de variables que dc_recordatorio_cita y cuerpo válido para Meta", () => {
    const actual = catalogEntryFor("reminder")!;
    assert.equal(countTemplateVariables(PLANTILLA_RECORDATORIO_CON_BOTONES.body), countTemplateVariables(actual.body));
    assert.equal(checkTemplateBody(PLANTILLA_RECORDATORIO_CON_BOTONES.body), null);
    const alta: any = payloadAltaPlantillaConBotones();
    assert.equal(alta.components[1].type, "BUTTONS");
    assert.deepEqual(alta.components[1].buttons.map((b: any) => b.type), ["QUICK_REPLY", "QUICK_REPLY", "QUICK_REPLY"]);
  });

  it("la plantilla actual no lleva botones; la nueva lleva los del recordatorio concreto", () => {
    assert.deepEqual(payloadsDeBotonesDePlantilla("dc_recordatorio_cita"), []);
    assert.deepEqual(payloadsDeBotonesDePlantilla("dc_recordatorio_cita_botones"), [
      "rec.confirmar",
      "rec.reagendar",
      "rec.cancelar",
    ]);
    assert.deepEqual(
      payloadsDeBotonesDePlantilla("dc_recordatorio_cita_botones", { tipo: "botones", botones: botonesRecordatorio("r9") }),
      ["rec.confirmar:r9", "rec.reagendar:r9", "rec.cancelar:r9"],
    );
    assert.deepEqual(componentesDeRespuestaRapida(["a"]), [
      { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "a" }] },
    ]);
  });
});
