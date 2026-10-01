/**
 * El bot aprende de cada clínica (ws1-t11) — reglas puras: anonimizado,
 * «no apto» (clínico / personal), detección de «el bot no supo → el equipo
 * contestó», temas, reporte y ejemplos de tono.
 *
 * Run: npm run test:bot-aprende
 *
 * Datos 100 % inventados; nada de base, WhatsApp ni Anthropic.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  anonimizar,
  evaluarPar,
  motivoClinico,
  motivoPersonal,
  problemaDeTextoDeFaq,
  tieneMarcadores,
} from "../anonimizar";
import {
  detectarEventos,
  esDelEquipo,
  esDisparador,
  esRespuestaDelBot,
  PREFIJO_NOTA_HANDOFF,
  PREFIJO_RESPUESTA_BOT,
  type MensajeHilo,
} from "../detectar";
import * as systemMessage from "@/lib/whatsapp/system-message";
import { temaDePregunta } from "../temas";
import { armarReporte } from "../reporte";
import { bloqueEjemplosDeTono, MAX_EJEMPLOS_TONO, motivoTonoNoApto } from "../tono";

describe("anonimizar", () => {
  test("quita nombre y apellido conocidos del paciente, con o sin acentos", () => {
    const t = anonimizar("Hola, soy paciente. Mi hijo Mateo y yo, Lucía Pérez, queremos cita", {
      nombres: ["Lucía", "Pérez"],
    });
    assert.ok(!/Luc[ií]a|P[eé]rez/.test(t), t);
    assert.ok(t.includes("[nombre]"));
    const sinAcento = anonimizar("lucia perez pregunta por el precio", { nombres: ["Lucía", "Pérez"] });
    assert.ok(!/lucia|perez/i.test(sinAcento), sinAcento);
  });

  test("«me llamo X», «soy X» y saludo + nombre aunque no se conozca el nombre", () => {
    assert.equal(anonimizar("Me llamo Ana Sofía Ruiz y quiero info"), "Me llamo [nombre] y quiero info");
    assert.equal(anonimizar("Hola Juan, claro que sí"), "Hola [nombre], claro que sí");
    assert.equal(anonimizar("Buenas tardes Ana, abrimos a las 9"), "Buenas tardes [nombre], abrimos a las 9");
    assert.equal(anonimizar("hola buenas tardes Ana"), "hola buenas tardes [nombre]");
    assert.equal(anonimizar("Gracias Sra. López"), "Gracias Sra. [nombre]");
  });

  test("no confunde palabras comunes con nombres", () => {
    assert.equal(anonimizar("Hola Doctora, ¿atienden el sábado?"), "Hola Doctora, ¿atienden el sábado?");
    assert.equal(anonimizar("soy paciente nuevo"), "soy paciente nuevo");
    assert.equal(anonimizar("Hola, buen día"), "Hola, buen día");
    // El nombre del dentista de la clínica es información pública.
    assert.equal(anonimizar("La Dra. Martínez hace ortodoncia"), "La Dra. Martínez hace ortodoncia");
  });

  test("teléfonos, correos, enlaces, CURP", () => {
    const t = anonimizar("Mi cel es 55 1234 5678 o +52 (81) 2345-6789, correo ana.ruiz@gmail.com, liga https://mpago.la/abc123 CURP RUPA900312MDFZRN09");
    assert.ok(!/\d{4}/.test(t.replace("[", "")), t);
    assert.ok(t.includes("[teléfono]") && t.includes("[correo]") && t.includes("[enlace]") && t.includes("[documento]"), t);
  });

  test("conserva el teléfono y el correo PÚBLICOS de la clínica", () => {
    const t = anonimizar("Llámanos al 55-8888-9999 o escribe a hola@clinicaprueba.mx", {
      conservar: ["5588889999", "hola@clinicaprueba.mx"],
    });
    assert.equal(t, "Llámanos al 55-8888-9999 o escribe a hola@clinicaprueba.mx");
  });

  test("fechas (nacimiento y cualquier fecha completa), no los días de la semana", () => {
    assert.equal(anonimizar("nací el 12/03/1990"), "nací el [fecha]");
    assert.equal(anonimizar("mi cumpleaños es el 4 de julio de 1988"), "mi cumpleaños es el [fecha]");
    assert.equal(anonimizar("Abrimos de lunes a viernes"), "Abrimos de lunes a viernes");
  });

  test("montos personales sí, precios de lista no", () => {
    assert.equal(anonimizar("tu saldo es de $1,500"), "tu saldo es de [monto]");
    assert.equal(anonimizar("debes 2300 pesos"), "debes [monto]");
    assert.equal(anonimizar("La limpieza cuesta $600"), "La limpieza cuesta $600");
  });

  test("tieneMarcadores", () => {
    assert.equal(tieneMarcadores("Hola [nombre]"), true);
    assert.equal(tieneMarcadores("Hola"), false);
  });
});

describe("contenido clínico y personal", () => {
  test("síntomas, medicamentos, padecimientos e indicaciones son clínicos", () => {
    for (const t of [
      "Me duele mucho la muela, ¿qué tomo?",
      "Tómate ibuprofeno 400 mg cada 8 horas",
      "Estoy embarazada, ¿me pueden hacer limpieza?",
      "Soy alérgica a la penicilina",
      "Me sangran las encías",
      "Pon hielo en la zona y no escupas",
      "Se me cayó la resina",
    ]) {
      assert.ok(motivoClinico(t), `debería ser clínico: ${t}`);
    }
  });

  test("el nombre de un tratamiento NO es clínico (es catálogo)", () => {
    for (const t of ["¿Cuánto cuesta una extracción?", "¿Hacen ortodoncia?", "¿Tienen blanqueamiento?", "¿Aceptan tarjeta?"]) {
      assert.equal(motivoClinico(t), null, t);
    }
  });

  test("respuesta sobre UN paciente es personal", () => {
    assert.ok(motivoPersonal("Tu cita quedó el martes a las 10"));
    assert.ok(motivoPersonal("Te agendé con la doctora"));
    assert.equal(motivoPersonal("Atendemos de lunes a sábado de 9 a 7"), null);
  });

  test("evaluarPar: clínico → no apto SIN texto; apto → anonimizado", () => {
    const c = evaluarPar("Me duele la muela del juicio", "Tómate paracetamol y ven mañana");
    assert.deepEqual(c, { apto: false, motivo: "clinico", detalle: "síntomas" });
    assert.ok(!("pregunta" in c));

    assert.deepEqual(evaluarPar("¿Dónde están?", "Ya quedó tu cita del jueves"), { apto: false, motivo: "personal", detalle: null });
    assert.deepEqual(evaluarPar("¿Abren el sábado?", "sí"), { apto: false, motivo: "corta", detalle: null });

    const ok = evaluarPar("Hola, soy Marta. ¿Tienen estacionamiento?", "Hola Marta, sí: hay estacionamiento gratis en el sótano.", {
      nombres: ["Marta"],
    });
    assert.equal(ok.apto, true);
    if (ok.apto) {
      assert.ok(!ok.pregunta.includes("Marta") && !ok.respuesta.includes("Marta"));
      assert.match(ok.respuesta, /estacionamiento gratis/);
    }
  });

  test("problemaDeTextoDeFaq: marcadores y clínico no pasan", () => {
    assert.equal(problemaDeTextoDeFaq("¿Tienen estacionamiento?", "Sí, gratis en el sótano."), null);
    assert.equal(problemaDeTextoDeFaq("¿Me llaman?", "Te llamamos al [teléfono]")?.code, "marcadores");
    assert.equal(problemaDeTextoDeFaq("¿Qué tomo para el dolor?", "Ibuprofeno")?.code, "clinico");
    assert.equal(problemaDeTextoDeFaq("", "x")?.code, "faltan_textos");
  });
});

// ── Detección ────────────────────────────────────────────────────────────────

let n = 0;
const T0 = new Date("2026-09-28T15:00:00Z").getTime();
function msg(min: number, p: Partial<MensajeHilo>): MensajeHilo {
  return {
    id: `m${++n}`,
    threadId: "h1",
    direction: "IN",
    body: "",
    sentAt: new Date(T0 + min * 60_000),
    sentById: null,
    externalId: null,
    isInternal: false,
    attachments: null,
    ...p,
  };
}
const paciente = (min: number, body: string) => msg(min, { direction: "IN", body, externalId: `wamid.in${n}` });
const bot = (min: number, body: string) => msg(min, { direction: "OUT", body, externalId: `sys:bot:wamid.${n}` });
const nota = (min: number) =>
  msg(min, { direction: "OUT", isInternal: true, body: `${PREFIJO_NOTA_HANDOFF} del equipo: el paciente espera respuesta.`, externalId: "sys:system:x" });
const equipo = (min: number, body: string) => msg(min, { direction: "OUT", body, sentById: "u1" });
const ecoCelular = (min: number, body: string) => msg(min, { direction: "OUT", body, externalId: "wamid.HBgM" });

describe("detectar", () => {
  test("la nota de handoff de verdad empieza con el prefijo que se busca", () => {
    const fuente = fs.readFileSync(path.resolve(__dirname, "../../handoff.ts"), "utf8");
    const m = fuente.match(/HANDOFF_NOTA_INTERNA =\s*\n?\s*"([^"]+)"/);
    assert.ok(m, "no se encontró HANDOFF_NOTA_INTERNA en bot/handoff.ts");
    assert.ok(m![1].startsWith(PREFIJO_NOTA_HANDOFF), m![1]);
  });

  test("el prefijo de las respuestas del bot es el mismo que usa el webhook (ws1-t3 #7)", () => {
    assert.equal(PREFIJO_RESPUESTA_BOT, "sys:bot:");
    const delWebhook = (systemMessage as Record<string, unknown>).BOT_REPLY_EXTERNAL_ID_PREFIX;
    // Mientras ws1-t3 no lo commitee la constante puede no existir; si existe, debe coincidir.
    if (delWebhook !== undefined) assert.equal(delWebhook, PREFIJO_RESPUESTA_BOT);
  });

  test("quién es quién", () => {
    assert.equal(esRespuestaDelBot(bot(0, "hola")), true);
    assert.equal(esRespuestaDelBot(msg(0, { direction: "OUT", body: "x", externalId: "sys:reminder:1" })), false);
    assert.equal(esDelEquipo(equipo(0, "hola")), true);
    assert.equal(esDelEquipo(ecoCelular(0, "hola")), true);
    assert.equal(esDelEquipo(bot(0, "hola")), false);
    assert.equal(esDisparador(nota(0)), true);
    assert.equal(esDisparador(bot(0, "Te comunico con el equipo de la clínica, en breve te responden. 🙋")), true);
    assert.equal(esDisparador(bot(0, "Abrimos de 9 a 7")), false);
  });

  test("handoff (aviso + nota) → UN evento con la pregunta y la respuesta del equipo", () => {
    const hilo = [
      paciente(0, "Hola"),
      bot(0.1, "¡Hola! ¿En qué te ayudo?"),
      paciente(1, "¿Tienen estacionamiento?"),
      paciente(1.2, "voy en coche"),
      bot(1.3, "Te comunico con el equipo de la clínica, en breve te responden. 🙋"),
      nota(1.31),
      equipo(40, "Sí, hay estacionamiento gratis en el sótano."),
      equipo(41, "Entrada por la calle de atrás."),
      paciente(60, "gracias"),
    ];
    const ev = detectarEventos(hilo);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].pregunta, "¿Tienen estacionamiento?\nvoy en coche");
    assert.equal(ev[0].respuesta, "Sí, hay estacionamiento gratis en el sótano.\nEntrada por la calle de atrás.");
    assert.equal(ev[0].disparadorId, hilo[4].id);
  });

  test("sin respuesta del equipo: el evento existe (para el reporte) con respuesta null", () => {
    const ev = detectarEventos([paciente(0, "¿Hacen carillas?"), nota(0.2)]);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].respuesta, null);
  });

  test("el eco del celular de la clínica cuenta como respuesta del equipo; los adjuntos no", () => {
    const ev = detectarEventos([
      paciente(0, "¿Hacen guardas?"),
      nota(0.1),
      msg(5, { direction: "OUT", body: "[Foto]", sentById: "u1", attachments: [{ mediaId: "1" }] }),
      ecoCelular(6, "Sí, la guarda nocturna se hace en 2 citas."),
    ]);
    assert.equal(ev[0].respuesta, "Sí, la guarda nocturna se hace en 2 citas.");
  });

  test("la respuesta del equipo más de 48 h después no se liga", () => {
    const ev = detectarEventos([paciente(0, "¿Hacen guardas?"), nota(0.1), equipo(49 * 60, "Sí")]);
    assert.equal(ev[0].respuesta, null);
  });

  test("dos «no supe» separados en el mismo hilo → dos eventos", () => {
    const ev = detectarEventos([
      paciente(0, "¿Hacen guardas?"),
      nota(0.1),
      equipo(10, "Sí, en dos citas."),
      paciente(120, "¿Y aceptan seguro?"),
      nota(120.1),
      equipo(130, "Trabajamos con reembolso de aseguradoras."),
    ]);
    assert.equal(ev.length, 2);
    assert.equal(ev[1].pregunta, "¿Y aceptan seguro?");
    assert.equal(ev[1].respuesta, "Trabajamos con reembolso de aseguradoras.");
  });
});

describe("temas y reporte", () => {
  test("temas", () => {
    assert.equal(temaDePregunta("¿Aceptan tarjeta?"), "pagos");
    assert.equal(temaDePregunta("¿Cuánto cuesta la limpieza?"), "precios");
    assert.equal(temaDePregunta("¿Abren los sábados?"), "horarios");
    assert.equal(temaDePregunta("¿Dónde están ubicados?"), "ubicacion");
    assert.equal(temaDePregunta("¿Hacen carillas?"), "tratamientos");
    assert.equal(temaDePregunta("Me duele la muela"), "clinico");
    assert.equal(temaDePregunta("¿Tienen wifi?"), "otros");
  });

  test("agrupa por tema con conteo, anonimiza, oculta lo clínico y lo que ya tiene FAQ", () => {
    const base = { threadId: "h", preguntaIds: [], respuestaIds: [] };
    const grupos = armarReporte(
      [
        { ...base, disparadorId: "a", at: new Date(T0), pregunta: "Hola soy Pedro, ¿cuánto cuesta la limpieza?", respuesta: "Hola Pedro, $600.", anonimizar: { nombres: ["Pedro"] } },
        { ...base, disparadorId: "b", at: new Date(T0 + 1), pregunta: "¿Cuánto cuesta un blanqueamiento?", respuesta: null },
        { ...base, disparadorId: "c", at: new Date(T0 + 2), pregunta: "Me sangra la encía", respuesta: "Ven hoy" },
        { ...base, disparadorId: "d", at: new Date(T0 + 3), pregunta: "¿Abren el sábado?", respuesta: null },
      ],
      { yaTieneRespuesta: (p) => /sábado/.test(p) },
    );
    assert.deepEqual(grupos.map((g) => [g.tema, g.total]), [["precios", 2], ["clinico", 1]]);
    const precios = grupos[0];
    assert.ok(precios.preguntas.every((p) => !p.pregunta.includes("Pedro")));
    assert.equal(precios.preguntas.find((p) => p.id === "a")?.respuestaEquipo, "Hola [nombre], $600.");
    assert.deepEqual(grupos[1].preguntas, []); // lo clínico solo se cuenta
  });
});

describe("tono", () => {
  test("bloque vacío sin ejemplos; con ejemplos, tope y aviso de marcadores", () => {
    assert.equal(bloqueEjemplosDeTono([]), "");
    const muchos = Array.from({ length: 12 }, (_, i) => `¡Hola [nombre]! Con gusto te ayudamos ${i} 😊`);
    const b = bloqueEjemplosDeTono(muchos);
    assert.equal((b.match(/^- «/gm) ?? []).length, MAX_EJEMPLOS_TONO);
    assert.match(b, /ESTILO/);
    assert.match(b, /nunca lo inventes/);
  });

  test("no aptos: clínico, personal, corto, largo", () => {
    assert.equal(motivoTonoNoApto("Tómate el antibiótico cada 8 horas"), "clinico");
    assert.equal(motivoTonoNoApto("Tu cita es mañana a las 10"), "personal");
    assert.equal(motivoTonoNoApto("ok"), "corto");
    assert.equal(motivoTonoNoApto("a".repeat(300)), "largo");
    assert.equal(motivoTonoNoApto("¡Claro! Aquí te esperamos con gusto 😊"), null);
  });
});
