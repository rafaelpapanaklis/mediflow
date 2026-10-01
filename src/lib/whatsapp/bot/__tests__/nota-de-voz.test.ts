/**
 * Notas de voz al bot de WhatsApp (ws1-t5) — el núcleo con dobles.
 *
 * `npm run test:wa-bot-voz`
 *
 * Nada sale a Meta ni a OpenAI: todas las dependencias son dobles que anotan
 * lo que se les pidió. Lo que se fija aquí: qué puertas impiden gastar, que se
 * cobra con la tarifa del dictado, que un audio largo no se paga, que ningún
 * fallo truena y que la bandeja queda con «🎤 Nota de voz: …».
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITE_SEGUNDOS,
  MAX_BYTES,
  MSG_DEMASIADO_LARGO,
  MSG_NO_PUDE,
  duracionOgg,
  nombreDeArchivo,
  procesarNotaDeVoz,
  type DepsNotaDeVoz,
  type EntradaNotaDeVoz,
} from "../nota-de-voz-core";
import { AUDIO_TOKENS_PER_MINUTE, tokensDeAudio } from "@/lib/integrations/whisper-tarifa";

// ── Un OGG Opus de mentira con la duración que se pida ──────────────────────
function paginaOgg(granulo: bigint, datos: Uint8Array, tipo = 0): Uint8Array {
  const cab = new Uint8Array(27 + 1);
  cab.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
  cab[4] = 0;
  cab[5] = tipo;
  new DataView(cab.buffer).setBigInt64(6, granulo, true);
  cab[26] = 1;
  cab[27] = datos.length;
  const out = new Uint8Array(cab.length + datos.length);
  out.set(cab, 0);
  out.set(datos, cab.length);
  return out;
}
function oggOpus(segundos: number, preSkip = 312): Buffer {
  const head = new Uint8Array(19);
  head.set(Array.from("OpusHead", (c) => c.charCodeAt(0)), 0);
  head[8] = 1;
  head[9] = 1;
  head[10] = preSkip & 0xff;
  head[11] = preSkip >> 8;
  const p1 = paginaOgg(0n, head, 2);
  const medio = paginaOgg(BigInt(preSkip + Math.round((segundos / 2) * 48000)), new Uint8Array(40).fill(7));
  const sinFin = paginaOgg(-1n, new Uint8Array(30).fill(9));
  const ultima = paginaOgg(BigInt(preSkip + Math.round(segundos * 48000)), new Uint8Array(40).fill(8), 4);
  return Buffer.concat([p1, medio, ultima, sinFin]);
}

// ── Dobles ───────────────────────────────────────────────────────────────────
function dobles(over: Partial<DepsNotaDeVoz> = {}, audio: Buffer = oggOpus(12)) {
  const anotado = {
    cobros: [] as Array<{ clinicId: string; segundos: number }>,
    reescrituras: [] as Array<{ clinicId: string; inMsgId: string; body: string }>,
    transcripciones: 0,
    descargas: 0,
    metas: 0,
    logs: [] as Array<{ evento: string; datos: Record<string, unknown> }>,
  };
  const deps: DepsNotaDeVoz = {
    botEncendido: async () => true,
    dictadoApagado: async () => false,
    sinCupo: async () => false,
    permitirRemitente: async () => true,
    transcriptorConfigurado: () => true,
    metaDelAudio: async () => {
      anotado.metas++;
      return { url: "https://lookaside.example/x", mimeType: "audio/ogg", fileSize: audio.length };
    },
    descargar: async () => {
      anotado.descargas++;
      return audio;
    },
    transcribir: async () => {
      anotado.transcripciones++;
      return { text: "  Hola, quiero agendar una limpieza\n para mañana ", duration: 12 };
    },
    cobrar: async (clinicId, segundos) => void anotado.cobros.push({ clinicId, segundos }),
    reescribirEntrada: async (clinicId, inMsgId, body) => void anotado.reescrituras.push({ clinicId, inMsgId, body }),
    log: (evento, datos) => void anotado.logs.push({ evento, datos }),
    ...over,
  };
  return { deps, anotado };
}

const entrada = (over: Partial<EntradaNotaDeVoz> = {}): EntradaNotaDeVoz => ({
  clinicId: "cl-1",
  threadId: "th-1",
  inMsgId: "in-1",
  from: "5215511111111",
  audio: { id: "media-1", mime_type: "audio/ogg; codecs=opus", voice: true },
  botActive: true,
  accessToken: "tok",
  ...over,
});

describe("nota de voz — el camino feliz", () => {
  it("transcribe, cobra con la tarifa del dictado y deja «🎤 Nota de voz: …» en la bandeja", async () => {
    const { deps, anotado } = dobles();
    const r = await procesarNotaDeVoz(entrada(), deps);
    assert.deepEqual(r, { accion: "texto", texto: "Hola, quiero agendar una limpieza para mañana" });
    assert.deepEqual(anotado.cobros, [{ clinicId: "cl-1", segundos: 12 }]);
    assert.deepEqual(anotado.reescrituras, [
      { clinicId: "cl-1", inMsgId: "in-1", body: "🎤 Nota de voz: Hola, quiero agendar una limpieza para mañana" },
    ]);
  });

  it("un audio reenviado (no nota de voz) se marca «🎵 Audio: …»", async () => {
    const { deps, anotado } = dobles();
    await procesarNotaDeVoz(entrada({ audio: { id: "m", mime_type: "audio/mpeg", voice: false } }), deps);
    assert.match(anotado.reescrituras[0].body, /^🎵 Audio: /);
  });

  it("ni el texto ni el audio van a los logs", async () => {
    const { deps, anotado } = dobles();
    await procesarNotaDeVoz(entrada(), deps);
    const todo = JSON.stringify(anotado.logs);
    assert.ok(!todo.includes("limpieza"), todo);
  });
});

describe("nota de voz — puertas: no se gasta nada", () => {
  const casos: Array<[string, Partial<EntradaNotaDeVoz>, Partial<DepsNotaDeVoz>, string]> = [
    ["hilo en pausa (lo atiende una persona)", { botActive: false }, {}, "bot_en_pausa"],
    ["bot apagado en la clínica", {}, { botEncendido: async () => false }, "bot_apagado"],
    ["«Dictado por voz» apagado en Saldo IA", {}, { dictadoApagado: async () => true }, "dictado_apagado"],
    ["sin cupo de IA", {}, { sinCupo: async () => true }, "sin_cupo"],
    ["clínica sin token de WhatsApp", { accessToken: null }, {}, "sin_token"],
    ["sin clave de OpenAI", {}, { transcriptorConfigurado: () => false }, "sin_transcriptor"],
    ["demasiados audios del mismo número", {}, { permitirRemitente: async () => false }, "limite_remitente"],
    ["mensaje sin media id", { audio: { voice: true } }, {}, "sin_audio"],
  ];
  for (const [nombre, ent, over, motivo] of casos) {
    it(nombre, async () => {
      const { deps, anotado } = dobles(over);
      const r = await procesarNotaDeVoz(entrada(ent), deps);
      assert.deepEqual(r, { accion: "como_antes", motivo });
      assert.equal(anotado.metas + anotado.descargas + anotado.transcripciones, 0, "no toca Meta ni Whisper");
      assert.equal(anotado.cobros.length, 0);
      assert.equal(anotado.reescrituras.length, 0, "la bandeja se queda como hoy");
    });
  }

  it("si una puerta revienta, no truena: queda como antes", async () => {
    const { deps } = dobles({ botEncendido: async () => { throw new Error("db caída"); } });
    const r = await procesarNotaDeVoz(entrada(), deps);
    assert.equal(r.accion, "como_antes");
  });

  it("el tope por remitente solo se consume si todo lo demás deja pasar", async () => {
    let consumidos = 0;
    const { deps } = dobles({ sinCupo: async () => true, permitirRemitente: async () => (consumidos++, true) });
    await procesarNotaDeVoz(entrada(), deps);
    assert.equal(consumidos, 0);
  });
});

describe("nota de voz — demasiado larga: aviso amable y no se paga", () => {
  it(`OGG de ${LIMITE_SEGUNDOS + 20} s → aviso, sin transcribir ni cobrar`, async () => {
    const { deps, anotado } = dobles({}, oggOpus(LIMITE_SEGUNDOS + 20));
    const r = await procesarNotaDeVoz(entrada(), deps);
    assert.deepEqual(r, { accion: "avisar", mensaje: MSG_DEMASIADO_LARGO, motivo: "largo" });
    assert.equal(anotado.transcripciones, 0);
    assert.equal(anotado.cobros.length, 0);
    assert.match(anotado.reescrituras[0].body, /más de 3 min/);
  });

  it("archivo más pesado que el tope → aviso sin descargarlo", async () => {
    const { deps, anotado } = dobles({
      metaDelAudio: async () => ({ url: "u", mimeType: "audio/ogg", fileSize: MAX_BYTES + 1 }),
    });
    const r = await procesarNotaDeVoz(entrada(), deps);
    assert.equal(r.accion, "avisar");
    assert.equal(anotado.descargas, 0);
  });

  it(`justo ${LIMITE_SEGUNDOS} s sí se transcribe`, async () => {
    const { deps } = dobles({}, oggOpus(LIMITE_SEGUNDOS));
    const r = await procesarNotaDeVoz(entrada(), deps);
    assert.equal(r.accion, "texto");
  });
});

describe("nota de voz — errores: «No pude escuchar tu audio, ¿me lo escribes?» y nada truena", () => {
  const fallos: Array<[string, Partial<DepsNotaDeVoz>, boolean]> = [
    ["Meta caído al pedir la URL", { metaDelAudio: async () => { throw new Error("502"); } }, false],
    ["el audio ya caducó en Meta", { metaDelAudio: async () => null }, false],
    ["la descarga falla", { descargar: async () => { throw new Error("descarga_500"); } }, false],
    ["audio vacío", { descargar: async () => Buffer.alloc(0) }, false],
    ["Whisper no lo entiende (audio dañado)", { transcribir: async () => ({ text: "", error: "whisper_400: invalid file" }) }, false],
    ["Whisper lanza", { transcribir: async () => { throw new Error("socket"); } }, false],
    ["Whisper devuelve texto vacío (silencio): se cobra lo escuchado", { transcribir: async () => ({ text: "  ", duration: 4 }) }, true],
  ];
  for (const [nombre, over, cobra] of fallos) {
    it(nombre, async () => {
      const { deps, anotado } = dobles(over);
      const r = await procesarNotaDeVoz(entrada(), deps);
      assert.equal(r.accion, "avisar");
      assert.equal((r as { mensaje: string }).mensaje, MSG_NO_PUDE);
      assert.equal(anotado.cobros.length, cobra ? 1 : 0);
      assert.match(anotado.reescrituras.at(-1)!.body, /el bot no pudo escucharla/);
    });
  }

  it("el mensaje es el que pidió Rafael", () => {
    assert.ok(MSG_NO_PUDE.startsWith("No pude escuchar tu audio, ¿me lo escribes?"));
  });

  it("sin clave de OpenAI a mitad (mock) → como antes y sin cobro", async () => {
    const { deps, anotado } = dobles({ transcribir: async () => ({ text: "", mock: true }) });
    const r = await procesarNotaDeVoz(entrada(), deps);
    assert.deepEqual(r, { accion: "como_antes", motivo: "sin_transcriptor" });
    assert.equal(anotado.cobros.length, 0);
  });

  it("si cobrar o reescribir la bandeja fallan, el paciente igual recibe respuesta", async () => {
    const { deps } = dobles({
      cobrar: async () => { throw new Error("db"); },
      reescribirEntrada: async () => { throw new Error("db"); },
    });
    const r = await procesarNotaDeVoz(entrada(), deps);
    assert.equal(r.accion, "texto");
  });
});

describe("nota de voz — duración y cobro", () => {
  it("lee la duración de un OGG Opus descontando el pre-skip", () => {
    const d = duracionOgg(oggOpus(42.5));
    assert.ok(d !== null && Math.abs(d - 42.5) < 0.01, String(d));
  });

  it("lo que no es OGG no tiene duración (decide Whisper)", () => {
    assert.equal(duracionOgg(Buffer.from("ID3\x03\x00 mp3 cualquiera...........................")), null);
    assert.equal(duracionOgg(Buffer.alloc(3)), null);
  });

  it("sin duración de Whisper se cobra la del OGG", async () => {
    const { deps, anotado } = dobles({ transcribir: async () => ({ text: "hola" }) }, oggOpus(30));
    await procesarNotaDeVoz(entrada(), deps);
    assert.ok(Math.abs(anotado.cobros[0].segundos - 30) < 0.01);
  });

  it("tarifa del dictado: 2 000 tokens por minuto, mínimo 1", () => {
    assert.equal(AUDIO_TOKENS_PER_MINUTE, 2000);
    assert.equal(tokensDeAudio(60), 2000);
    assert.equal(tokensDeAudio(12), 400);
    assert.equal(tokensDeAudio(0.01), 1);
  });

  it("extensión que Whisper reconoce según el mime de Meta", () => {
    assert.equal(nombreDeArchivo("audio/ogg; codecs=opus"), "nota.ogg");
    assert.equal(nombreDeArchivo("audio/mpeg"), "nota.mp3");
    assert.equal(nombreDeArchivo("audio/mp4"), "nota.m4a");
    assert.equal(nombreDeArchivo("audio/amr"), "nota.amr");
  });
});
