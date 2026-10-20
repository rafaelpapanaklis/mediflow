/**
 * POST /api/public/whatsapp-lead: valida, filtra el honeypot, limita y avisa
 * al equipo por correo. Sin base de datos.
 * Run: npm run test:whatsapp-widget
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../route";

const correos: Array<{ to: string; subject: string; text?: string }> = [];
const original = globalThis.fetch;
let ipN = 0;

beforeEach(() => {
  correos.length = 0;
  process.env.RESEND_API_KEY = "test";
  process.env.ADMIN_NOTIFY_EMAIL = "equipo@dalecontrol.test";
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    const b = JSON.parse(String(init?.body));
    correos.push({ to: b.to[0], subject: b.subject, text: b.text });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

function pedir(body: unknown, ip = `10.0.0.${++ipN}`) {
  return POST(
    new NextRequest("http://localhost/api/public/whatsapp-lead", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

test("lead válido: 200 y un correo al buzón del equipo con el origen", async () => {
  const r = await pedir({ nombre: "Ana López", numero: "999 123 4567", pagina: "/" });
  assert.equal(r.status, 200);
  assert.equal(correos.length, 1);
  assert.equal(correos[0].to, "equipo@dalecontrol.test");
  assert.match(correos[0].text ?? "", /Origen: whatsapp-widget/);
  assert.match(correos[0].text ?? "", /wa\.me\/529991234567/);
});

test("honeypot lleno: responde 200 pero no manda nada", async () => {
  const r = await pedir({ nombre: "Bot", numero: "9991234568", empresa_web: "http://spam" });
  assert.equal(r.status, 200);
  assert.equal(correos.length, 0);
});

test("número o nombre inválidos: 400 con el campo y sin correo", async () => {
  const a = await pedir({ nombre: "Ana", numero: "123" });
  assert.equal(a.status, 400);
  assert.equal((await a.json()).campo, "numero");
  const b = await pedir({ nombre: "", numero: "9991234569" });
  assert.equal((await b.json()).campo, "nombre");
  assert.equal((await pedir("no es json")).status, 400);
  assert.equal(correos.length, 0);
});

test("límite por IP: a la sexta solicitud, 429", async () => {
  const ip = "192.0.2.77";
  const codigos: number[] = [];
  for (let i = 0; i < 6; i++) codigos.push((await pedir({ nombre: "Ana", numero: `99912345${i}0`.slice(0, 10) }, ip)).status);
  assert.equal(codigos[5], 429);
  assert.ok(codigos.slice(0, 5).every((c) => c === 200 || c === 400));
});

test("el mismo número no avisa más de 2 veces al día", async () => {
  const cuerpo = { nombre: "Luis", numero: "9997770000" };
  assert.equal((await pedir(cuerpo)).status, 200);
  assert.equal((await pedir(cuerpo)).status, 200);
  assert.equal((await pedir(cuerpo)).status, 429);
  assert.equal(correos.length, 2);
});

test("W1: si el correo no sale: 502, y nombre y número quedan en el log del servidor", async () => {
  globalThis.fetch = (async () => new Response("x", { status: 500 })) as typeof fetch;
  const errores: string[] = [];
  const logOriginal = console.error;
  console.error = (...a: unknown[]) => { errores.push(a.map(String).join(" ")); };
  try {
    const r = await pedir({ nombre: "Eva Ruiz", numero: "9996660000", pagina: "/" });
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /Iniciar conversación/);
  } finally {
    console.error = logOriginal;
  }
  const linea = errores.find((e) => e.includes("AVISO NO ENVIADO")) ?? "";
  assert.match(linea, /Eva Ruiz/);
  assert.match(linea, /529996660000/);
});

test("W1: los envíos fallidos no gastan el cupo del número: tras dos fallos, el tercer intento sí pasa", async () => {
  const cuerpo = { nombre: "Raúl", numero: "9995550000" };
  globalThis.fetch = (async () => new Response("x", { status: 500 })) as typeof fetch;
  const silenciar = console.error;
  console.error = () => {};
  try {
    assert.equal((await pedir(cuerpo)).status, 502);
    assert.equal((await pedir(cuerpo)).status, 502);
    assert.equal((await pedir(cuerpo)).status, 502, "sigue intentando enviar, no responde 429");
  } finally {
    console.error = silenciar;
  }
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    const b = JSON.parse(String(init?.body));
    correos.push({ to: b.to[0], subject: b.subject, text: b.text });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  assert.equal((await pedir(cuerpo)).status, 200);
  assert.equal(correos.length, 1);
});

test.after(() => { globalThis.fetch = original; });
