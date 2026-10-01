// ws1-t3 (auditoría del bot) — piezas puras de la entrada del webhook:
// #10 (todo lo que Meta agrupa), #19 (sin phone_number_id no hay clínica),
// #11 (un turno del bot por hilo) y #20 (límite por clave, no por request).
//
// Correr: npm run test:wa-webhook-entrada

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extraerEventosDelWebhook, phoneNumberIdDe } from "../webhook-eventos";
import { conTurnoDelHilo, type DepsTurno } from "../bot-turno";
import { buildBotReplyExternalId, parseSystemKind, BOT_REPLY_EXTERNAL_ID_PREFIX } from "../system-message";

describe("#10 — extraerEventosDelWebhook recorre todo", () => {
  it("varias entradas, cambios y mensajes, en orden", () => {
    const v = (pnid: string, msgs: string[]) => ({
      metadata: { phone_number_id: pnid },
      messages: msgs.map((id) => ({ id, from: "1", type: "text", text: { body: id } })),
    });
    const ev = extraerEventosDelWebhook({
      entry: [
        { id: "w1", changes: [{ field: "messages", value: v("a", ["m1", "m2"]) }, { field: "messages", value: v("a", ["m3"]) }] },
        { id: "w2", changes: [{ field: "messages", value: v("b", ["m4"]) }] },
      ],
    });
    assert.deepEqual(ev.map((x) => (x.tipo === "mensaje" ? x.msg.id : x.tipo)), ["m1", "m2", "m3", "m4"]);
  });

  it("estados, ecos y plantillas salen con su tipo; los estados antes que los mensajes del mismo cambio", () => {
    const ev = extraerEventosDelWebhook({
      entry: [
        {
          id: "waba-9",
          changes: [
            { field: "smb_message_echoes", value: { message_echoes: [{}] } },
            { field: "message_template_status_update", value: { event: "APPROVED" } },
            { field: "messages", value: { statuses: [{ id: "s" }], messages: [{ id: "m" }] } },
          ],
        },
      ],
    });
    assert.deepEqual(ev.map((x) => x.tipo), ["ecos", "plantilla", "estados", "mensaje"]);
    assert.equal((ev[1] as any).entryId, "waba-9");
  });

  it("basura no truena", () => {
    for (const b of [null, undefined, 42, "x", {}, { entry: "no" }, { entry: [{ changes: [null, { value: null }] }] }]) {
      assert.deepEqual(extraerEventosDelWebhook(b), []);
    }
  });
});

describe("#19 — phoneNumberIdDe", () => {
  it("null si falta o viene vacío", () => {
    assert.equal(phoneNumberIdDe({}), null);
    assert.equal(phoneNumberIdDe({ metadata: {} }), null);
    assert.equal(phoneNumberIdDe({ metadata: { phone_number_id: "  " } }), null);
    assert.equal(phoneNumberIdDe(undefined), null);
  });
  it("el id cuando está", () => {
    assert.equal(phoneNumberIdDe({ metadata: { phone_number_id: "1234" } }), "1234");
  });
  it("la ruta no consulta la clínica con un phone_number_id sin comprobar", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/api/whatsapp/webhook/route.ts"), "utf8");
    assert.ok(!/value\?\.metadata\?\.phone_number_id/.test(src), "queda una lectura cruda de phone_number_id");
    assert.ok(!/clinic\.findFirst\(\{\s*where:\s*\{\s*waPhoneNumberId/.test(src), "queda un findFirst por waPhoneNumberId");
  });
});

/** Candado en memoria con reloj falso: lo mismo que hace failban sin Redis. */
function depsFalsas() {
  let reloj = 0;
  const tomados = new Set<string>();
  const deps: DepsTurno = {
    tomar: async (k) => (tomados.has(k) ? false : (tomados.add(k), true)),
    soltar: async (k) => void tomados.delete(k),
    esperar: async (ms) => {
      reloj += ms;
      await new Promise((r) => setImmediate(r));
    },
    ahora: () => reloj,
  };
  return { deps, tomados };
}

describe("#11 — conTurnoDelHilo", () => {
  it("dos turnos del mismo hilo no se solapan; el segundo corre después", async () => {
    const { deps } = depsFalsas();
    const orden: string[] = [];
    let soltarPrimero!: () => void;
    const primero = conTurnoDelHilo(
      "h1",
      async () => {
        orden.push("1-empieza");
        await new Promise<void>((r) => (soltarPrimero = r));
        orden.push("1-termina");
      },
      { esperaMaxMs: 1_000_000 },
      deps,
    );
    await new Promise((r) => setImmediate(r));
    const segundo = conTurnoDelHilo("h1", async () => void orden.push("2"), { esperaMaxMs: 1_000_000 }, deps);
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.deepEqual(orden, ["1-empieza"], "el segundo no puede entrar mientras el primero sigue");
    soltarPrimero();
    await Promise.all([primero, segundo]);
    assert.deepEqual(orden, ["1-empieza", "1-termina", "2"]);
  });

  it("hilos distintos no se esperan entre sí", async () => {
    const { deps } = depsFalsas();
    let bloqueado = true;
    const a = conTurnoDelHilo("hA", async () => { while (bloqueado) await new Promise((r) => setImmediate(r)); }, undefined, deps);
    const b = await conTurnoDelHilo("hB", async () => "listo", undefined, deps);
    assert.deepEqual(b, { corrio: true, valor: "listo" });
    bloqueado = false;
    await a;
  });

  it("si no consigue el turno a tiempo, no corre", async () => {
    const { deps, tomados } = depsFalsas();
    tomados.add("wa-bot-turno:h1");
    let corrio = false;
    const r = await conTurnoDelHilo("h1", async () => void (corrio = true), { esperaMaxMs: 1000, intervaloMs: 100 }, deps);
    assert.deepEqual(r, { corrio: false });
    assert.equal(corrio, false);
  });

  it("suelta el turno aunque el turno lance", async () => {
    const { deps, tomados } = depsFalsas();
    await assert.rejects(conTurnoDelHilo("h1", async () => { throw new Error("boom"); }, undefined, deps));
    assert.equal(tomados.size, 0);
  });

  it("con el candado REAL de failban (memoria, sin Upstash)", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    let enCurso = 0;
    let max = 0;
    const turno = () =>
      conTurnoDelHilo(
        "h-real",
        async () => {
          enCurso++;
          max = Math.max(max, enCurso);
          await new Promise((r) => setTimeout(r, 30));
          enCurso--;
        },
        { intervaloMs: 5 },
      );
    await Promise.all([turno(), turno(), turno()]);
    assert.equal(max, 1);
  });
});

describe("#20 — persistentRateLimitKey", () => {
  it("limita por clave (sin Upstash cae a memoria) y claves distintas no se pisan", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { persistentRateLimitKey } = await import("../../failban");
    const r: boolean[] = [];
    for (let i = 0; i < 4; i++) r.push(await persistentRateLimitKey("test:wa:x", 3, 60));
    assert.deepEqual(r, [true, true, true, false]);
    assert.equal(await persistentRateLimitKey("test:wa:y", 3, 60), true);
  });

  it("el bot ya no usa el limitador en memoria por instancia", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/api/whatsapp/webhook/route.ts"), "utf8");
    assert.ok(!/rateLimitKey\(/.test(src), "queda rateLimitKey en la ruta");
    assert.match(src, /persistentRateLimitKey\(`wa-bot:\$\{clinic\.id\}:\$\{from\}`, 6, 60\)/);
    assert.match(src, /persistentRateLimitKey\(`wa-bot-clinic:\$\{clinic\.id\}`, 60, 60\)/);
  });
});

describe("#7 — externalId de las respuestas del bot", () => {
  it("sys:bot:<wamid>, sin etiqueta de envío automático (el Inbox la pinta como siempre)", () => {
    assert.equal(buildBotReplyExternalId("wamid.ABC"), "sys:bot:wamid.ABC");
    assert.ok(buildBotReplyExternalId(null).startsWith(BOT_REPLY_EXTERNAL_ID_PREFIX));
    assert.notEqual(buildBotReplyExternalId(null), buildBotReplyExternalId(null));
    assert.equal(parseSystemKind("sys:bot:wamid.ABC"), null);
  });
});
