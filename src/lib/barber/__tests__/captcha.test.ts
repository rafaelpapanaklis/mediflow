/* ═══════════════════════════════════════════════════════════════════════
   CAPTCHA DE LAS PUERTAS PÚBLICAS (Cloudflare Turnstile) — sin base.

     npx tsx --test src/lib/barber/__tests__/captcha.test.ts

   Lo que se demuestra (decisión de Rafael, 15-nov-2026):
     · sin las DOS variables todo sigue como antes y queda en el log;
     · con las dos, el token se verifica en el servidor ANTES de crear nada:
       sin token o token malo → respuesta clara con `code`, nunca un 500;
       Cloudflare caído → se deja pasar (como sin captcha) con grito en el log
       (revisión ronda 15, M1);
       nunca un 500;
     · una llave secreta mal escrita no tumba la reserva (no lo provoca nadie
       de fuera) pero grita en el log;
     · las CUATRO rutas cortan antes de tocar la base. Ninguna de estas
       pruebas tiene DATABASE_URL: si una ruta llegara a la base, reventaría.
   ═══════════════════════════════════════════════════════════════════════ */
import "./_sin-server-only";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  BARBER_CAPTCHA_ACTIONS,
  BARBER_CAPTCHA_ERRORS,
  TURNSTILE_SITEVERIFY_URL,
  barberCaptchaConfig,
  classifySiteverify,
  cleanCaptchaToken,
  isBarberCaptchaErrorCode,
} from "../captcha-core";

const SITE = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";
const SECRET = "TURNSTILE_SECRET_KEY";

// ── núcleo puro ─────────────────────────────────────────────────────────

test("se enciende SOLO con las dos llaves", () => {
  assert.equal(barberCaptchaConfig({}), null);
  assert.equal(barberCaptchaConfig({ [SITE]: "site" }), null);
  assert.equal(barberCaptchaConfig({ [SECRET]: "secret" }), null);
  assert.equal(barberCaptchaConfig({ [SITE]: "  ", [SECRET]: "secret" }), null);
  assert.deepEqual(barberCaptchaConfig({ [SITE]: " site ", [SECRET]: "secret\n" }), {
    siteKey: "site",
    secret: "secret",
  });
});

test("el token: texto de hasta 2048, o nada", () => {
  assert.equal(cleanCaptchaToken(undefined), null);
  assert.equal(cleanCaptchaToken(123), null);
  assert.equal(cleanCaptchaToken("   "), null);
  assert.equal(cleanCaptchaToken("x".repeat(2049)), null);
  assert.equal(cleanCaptchaToken(" abc "), "abc");
});

test("lo que contesta Cloudflare", () => {
  const A = BARBER_CAPTCHA_ACTIONS.booking;
  assert.equal(classifySiteverify({ success: true, action: A }, A), "ok");
  // Versiones sin `action`: no se inventa un fallo.
  assert.equal(classifySiteverify({ success: true }, A), "ok");
  // Un token de OTRA puerta no abre ésta.
  assert.equal(classifySiteverify({ success: true, action: BARBER_CAPTCHA_ACTIONS.walkin }, A), "failed");
  assert.equal(
    classifySiteverify({ success: false, "error-codes": ["timeout-or-duplicate"] }, A),
    "failed",
  );
  assert.equal(
    classifySiteverify({ success: false, "error-codes": ["invalid-input-response"] }, A),
    "failed",
  );
  assert.equal(
    classifySiteverify({ success: false, "error-codes": ["invalid-input-secret"] }, A),
    "misconfigured",
  );
  assert.equal(classifySiteverify({ success: false, "error-codes": ["internal-error"] }, A), "unavailable");
  assert.equal(classifySiteverify(null, A), "unavailable");
  assert.equal(classifySiteverify("<html>", A), "unavailable");
});

test("los textos de error son claros, de tú y con salida (nunca un error crudo)", () => {
  for (const [code, e] of Object.entries(BARBER_CAPTCHA_ERRORS)) {
    assert.ok(isBarberCaptchaErrorCode(code));
    assert.match(e.message, /intenta/i, code);
    assert.equal(e.status, 400, code);
  }
  assert.equal(isBarberCaptchaErrorCode("slotTaken"), false);
});

// ── verificación en el servidor (Cloudflare simulado) ───────────────────

interface Call {
  url: string;
  body: URLSearchParams;
}
let calls: Call[] = [];
let reply: (() => Promise<Response>) | null = null;
const realFetch = globalThis.fetch;
const realWarn = console.warn;
const realError = console.error;
let warns: string[] = [];
let errors: string[] = [];

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url !== TURNSTILE_SITEVERIFY_URL) {
    return Promise.reject(new Error(`fetch inesperado en la prueba: ${url}`));
  }
  calls.push({ url, body: new URLSearchParams(String(init?.body ?? "")) });
  if (!reply) return Promise.reject(new Error("sin respuesta preparada"));
  return reply();
}

function cloudflare(json: unknown, status = 200) {
  reply = async () => new Response(JSON.stringify(json), { status });
}

function setKeys(on: boolean) {
  if (on) {
    process.env[SITE] = "1x00000000000000000000AA";
    process.env[SECRET] = "1x0000000000000000000000000000000AA";
  } else {
    delete process.env[SITE];
    delete process.env[SECRET];
  }
}

before(() => {
  globalThis.fetch = fakeFetch as typeof fetch;
  console.warn = (...a: unknown[]) => void warns.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => void errors.push(a.map(String).join(" "));
});
after(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  console.error = realError;
  setKeys(false);
});
beforeEach(() => {
  calls = [];
  reply = null;
  warns = [];
  errors = [];
});

test("sin variables: pasa como antes, sin llamar a Cloudflare, y lo dice el log UNA vez", async () => {
  setKeys(false);
  const { verifyBarberCaptcha, barberCaptchaSiteKey } = await import("../captcha");
  assert.equal(barberCaptchaSiteKey(), null);
  const a = await verifyBarberCaptcha({ token: undefined, action: BARBER_CAPTCHA_ACTIONS.register });
  const b = await verifyBarberCaptcha({ token: undefined, action: BARBER_CAPTCHA_ACTIONS.register });
  assert.deepEqual(a, { ok: true, verified: false });
  assert.deepEqual(b, { ok: true, verified: false });
  assert.equal(calls.length, 0);
  const avisos = warns.filter((w) => w.includes("[barber/captcha]") && w.includes("barber-register"));
  assert.equal(avisos.length, 1, warns.join("\n"));
  assert.match(avisos[0], /NEXT_PUBLIC_TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY/);
});

test("con UNA sola variable sigue apagado (y el log dice cuál falta)", async () => {
  setKeys(false);
  process.env[SECRET] = "solo-la-secreta";
  const { verifyBarberCaptcha, barberCaptchaSiteKey } = await import("../captcha");
  assert.equal(barberCaptchaSiteKey(), null);
  const r = await verifyBarberCaptcha({ token: null, action: BARBER_CAPTCHA_ACTIONS.portalCode });
  assert.deepEqual(r, { ok: true, verified: false });
  assert.equal(calls.length, 0);
  assert.ok(warns.some((w) => /barber-portal-code.*falta NEXT_PUBLIC_TURNSTILE_SITE_KEY\./.test(w)), warns.join("\n"));
  setKeys(false);
});

test("con variables: sin token no se pregunta a nadie y se pide esperar", async () => {
  setKeys(true);
  const { verifyBarberCaptcha, barberCaptchaSiteKey } = await import("../captcha");
  assert.equal(barberCaptchaSiteKey(), "1x00000000000000000000AA");
  const r = await verifyBarberCaptcha({ token: "", action: BARBER_CAPTCHA_ACTIONS.booking });
  assert.deepEqual(r, { ok: false, code: "captchaRequired" });
  assert.equal(calls.length, 0);
});

test("con variables: token bueno → persona; se manda secreta, token e IP", async () => {
  setKeys(true);
  cloudflare({ success: true, action: BARBER_CAPTCHA_ACTIONS.booking });
  const { verifyBarberCaptcha } = await import("../captcha");
  const r = await verifyBarberCaptcha({
    token: "tok-123",
    action: BARBER_CAPTCHA_ACTIONS.booking,
    ip: "201.1.2.3",
  });
  assert.deepEqual(r, { ok: true, verified: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.get("secret"), "1x0000000000000000000000000000000AA");
  assert.equal(calls[0].body.get("response"), "tok-123");
  assert.equal(calls[0].body.get("remoteip"), "201.1.2.3");
});

test("con variables: token vencido o repetido → captchaFailed", async () => {
  setKeys(true);
  cloudflare({ success: false, "error-codes": ["timeout-or-duplicate"] });
  const { verifyBarberCaptcha } = await import("../captcha");
  const r = await verifyBarberCaptcha({ token: "viejo", action: BARBER_CAPTCHA_ACTIONS.walkin });
  assert.deepEqual(r, { ok: false, code: "captchaFailed" });
});

test("Cloudflare no responde (red caída): se DEJA PASAR sin captcha y se grita en el log (M1)", async () => {
  setKeys(true);
  reply = () => Promise.reject(new TypeError("fetch failed"));
  const { verifyBarberCaptcha } = await import("../captcha");
  const r = await verifyBarberCaptcha({ token: "t", action: BARBER_CAPTCHA_ACTIONS.booking });
  assert.deepEqual(r, { ok: true, verified: false });
  assert.ok(errors.some((e) => /siteverify NO RESPONDE/.test(e)), errors.join("\n"));
});

test("Cloudflare contesta basura (HTML de un 502) o internal-error: se deja pasar sin captcha (M1)", async () => {
  setKeys(true);
  reply = async () => new Response("<html>bad gateway</html>", { status: 502 });
  const { verifyBarberCaptcha } = await import("../captcha");
  assert.deepEqual(
    await verifyBarberCaptcha({ token: "t", action: BARBER_CAPTCHA_ACTIONS.booking }),
    { ok: true, verified: false },
  );
  cloudflare({ success: false, "error-codes": ["internal-error"] });
  assert.deepEqual(
    await verifyBarberCaptcha({ token: "t", action: BARBER_CAPTCHA_ACTIONS.booking }),
    { ok: true, verified: false },
  );
});

test("Cloudflare que TARDA más de 8 s cuenta como caído: se deja pasar, no se cuelga", async () => {
  setKeys(true);
  const { verifyBarberCaptcha } = await import("../captcha");
  // Un fetch que solo termina cuando lo abortan (como uno real colgado).
  const colgado = ((_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  const t0 = Date.now();
  const r = await verifyBarberCaptcha({ token: "t", action: BARBER_CAPTCHA_ACTIONS.booking, fetchImpl: colgado });
  assert.deepEqual(r, { ok: true, verified: false });
  assert.ok(Date.now() - t0 < 9_500, "corta a los 8 s");
});

test("llave SECRETA mal escrita: se deja pasar como sin captcha y se grita en el log", async () => {
  setKeys(true);
  cloudflare({ success: false, "error-codes": ["invalid-input-secret"] });
  const { verifyBarberCaptcha } = await import("../captcha");
  const r = await verifyBarberCaptcha({ token: "t", action: BARBER_CAPTCHA_ACTIONS.booking });
  assert.deepEqual(r, { ok: true, verified: false });
  assert.ok(errors.some((e) => e.includes("TURNSTILE_SECRET_KEY")), errors.join("\n"));
});

// ── las cuatro rutas cortan ANTES de tocar la base ──────────────────────

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "201.9.9.9" },
    body: JSON.stringify(body),
  });
}

async function json(res: Response): Promise<{ status: number; body: any }> {
  return { status: res.status, body: await res.json() };
}

// «Mi cuenta» resuelve la barbería ANTES del captcha (para poder decir «ese
// teléfono está mal escrito»): su prueba va con base local, en
// captcha-integration.test.ts.
test("reserva, fila y registro: sin token → 400 captchaRequired; token malo → 400 captchaFailed", async () => {
  setKeys(true);
  // Sin DATABASE_URL: si alguna ruta llegara a la base, la prueba lo vería.
  const { POST: booking } = await import("@/app/api/barber/public/booking/[slug]/route");
  const { POST: walkin } = await import("@/app/api/barber/walkins/public/route");
  const { POST: register } = await import("@/app/api/barber/auth/register/route");
  const slug = { params: Promise.resolve({ slug: "barberia-prueba" }) };

  const casos: Array<[string, (b: unknown) => Promise<Response>, Record<string, unknown>]> = [
    [
      "reserva",
      (b) => booking(post("http://x/api/barber/public/booking/barberia-prueba", b), slug),
      { serviceIds: ["s1"], date: "2030-01-01", time: "10:00", name: "Ana", phone: "5512345678" },
    ],
    [
      "fila",
      (b) => walkin(post("http://x/api/barber/walkins/public", b)),
      { slug: "barberia-prueba", name: "Ana", phone: "5512345678" },
    ],
    [
      "registro",
      (b) => register(post("http://x/api/barber/auth/register", b)),
      { shopName: "X", firstName: "A", lastName: "B", email: "a@b.mx", password: "12345678" },
    ],
  ];

  for (const [name, call, body] of casos) {
    const sin = await json(await call(body));
    assert.equal(sin.status, 400, `${name}: ${JSON.stringify(sin.body)}`);
    assert.equal(sin.body.code, "captchaRequired", name);
    assert.equal(sin.body.error, BARBER_CAPTCHA_ERRORS.captchaRequired.message, name);

    cloudflare({ success: false, "error-codes": ["invalid-input-response"] });
    const malo = await json(await call({ ...body, captchaToken: "tok" }));
    assert.equal(malo.status, 400, name);
    assert.equal(malo.body.code, "captchaFailed", name);
  }
});

test("la reserva: el campo trampa sigue contestando «éxito» sin gastar captcha", async () => {
  setKeys(true);
  const { POST: booking } = await import("@/app/api/barber/public/booking/[slug]/route");
  const res = await booking(
    post("http://x/api/barber/public/booking/barberia-prueba", { website: "spam.example" }),
    { params: Promise.resolve({ slug: "barberia-prueba" }) },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

// ── M2 (ronda 15): si el widget no carga, el cliente tiene otra puerta ──

test("tras el 2.º intento fallido, la reserva, «mi cuenta» y la fila enseñan su salida (es/en)", async () => {
  const { readFileSync } = await import("node:fs");
  const widget = readFileSync("src/components/barber/captcha/barber-captcha.tsx", "utf8");
  assert.match(widget, /export const BARBER_CAPTCHA_GIVE_UP_AFTER = 2;/);
  assert.match(widget, /failures >= BARBER_CAPTCHA_GIVE_UP_AFTER && fallback/);

  const reserva = readFileSync("src/components/barber/booking/booking-flow.tsx", "utf8");
  assert.match(reserva, /fallback=\{\s*<NoScheduleNotice[\s\S]{0,200}captcha\.ayudaTitulo[\s\S]{0,200}waHref=\{waHref\}\s*telHref=\{telHref\}/);
  const cuenta = readFileSync("src/components/barber/portal/portal-login.tsx", "utf8");
  assert.match(cuenta, /fallback=\{[\s\S]{0,200}shop\.phone[\s\S]{0,200}tel:/);
  const fila = readFileSync("src/components/barber/walkin/walkin-public.tsx", "utf8");
  assert.match(fila, /fallback=\{[\s\S]{0,120}captcha\.ayudaFila/);

  for (const l of ["es", "en"]) {
    const j = JSON.parse(readFileSync(`src/i18n/dictionaries/barber/reserva.${l}.json`, "utf8"));
    for (const k of ["ayudaTitulo", "ayudaCuerpo", "ayudaPortal", "ayudaPortalSinTelefono", "ayudaFila"]) {
      assert.ok(typeof j.captcha[k] === "string" && j.captcha[k].length > 5, `${l}: captcha.${k}`);
    }
  }
  assert.equal(
    JSON.parse(readFileSync("src/i18n/dictionaries/barber/reserva.es.json", "utf8")).captcha.ayudaTitulo,
    "Si no puedes reservar aquí, escríbenos",
  );
});
