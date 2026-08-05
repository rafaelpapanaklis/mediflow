import { test } from "node:test";
import assert from "node:assert/strict";
import { decideClickCount, type RecentClickLookup } from "../click-guard-core";
import { newVisitorId } from "../visitor-cookie";
import { summarizeUserAgent } from "../stats";

// Los 7 casos de la ola que cambió el dedupe de IP a cookie de navegador.
// El bug que arreglan: en México la IP NO identifica a una persona (CGNAT de
// Telcel/AT&T, WiFi del consultorio), y el link se comparte por WhatsApp, o
// sea que casi todo el tráfico es móvil.

const REF = "ABCD1234";
const IP_TELCEL = "ip-hash-cgnat-telcel"; // misma IP pública para miles
const IP_CLINICA = "ip-hash-wifi-clinica";

const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// El UA entero empieza por WhatsApp/ → generador de vista previa, no persona.
const UA_BOT_WHATSAPP = "WhatsApp/2.23.20.0 A";

const T0 = Date.UTC(2026, 7, 5, 12, 0, 0);
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

interface Row {
  ref: string;
  vid: string | null;
  ipHash: string | null;
  userAgent: string | null;
  at: number;
}

/** Las filas de affiliate_clicks + la consulta del guard sobre ellas. */
function world() {
  const rows: Row[] = [];
  const lookup: RecentClickLookup = async (q) =>
    rows.some(
      (r) =>
        r.ref === q.ref &&
        r.at >= q.since.getTime() &&
        (q.vid === undefined || r.vid === q.vid) &&
        (q.ipHash === undefined || r.ipHash === q.ipHash) &&
        (q.userAgent === undefined || r.userAgent === q.userAgent),
    );
  return { rows, lookup };
}

interface Browser {
  ua: string;
  /** Cookie dc_vid guardada. null = todavía no tiene (o las bloquea). */
  vid: string | null;
  /** false = cookies bloqueadas: nunca conserva la que se le siembra. */
  acceptsCookies: boolean;
}

const browser = (ua: string, acceptsCookies = true): Browser => ({ ua, vid: null, acceptsCookies });

/**
 * Una visita, exactamente como la resuelve /r/<code>: decide con la cookie que
 * el navegador TRAÍA, y si cuenta guarda la fila con el vid EFECTIVO (el
 * recién sembrado en la primera visita).
 */
async function visit(
  w: ReturnType<typeof world>,
  b: Browser,
  opts: { ip: string; minute: number; lookup?: RecentClickLookup },
): Promise<boolean> {
  const incomingVid = b.vid;
  const vid = incomingVid ?? newVisitorId();
  if (!incomingVid && b.acceptsCookies) b.vid = vid;

  const counts = await decideClickCount(
    { userAgent: b.ua, ref: REF, ipHash: opts.ip, vid: incomingVid, now: at(opts.minute) },
    opts.lookup ?? w.lookup,
  );

  if (counts) {
    w.rows.push({
      ref: REF,
      vid,
      ipHash: opts.ip,
      userAgent: summarizeUserAgent(b.ua),
      at: at(opts.minute).getTime(),
    });
  }
  return counts;
}

test("1) dos teléfonos distintos en la misma red móvil (CGNAT) → 2 clics", async () => {
  const w = world();
  // Peor caso a propósito: MISMO modelo de teléfono ⇒ mismo user-agent, misma
  // IP pública de Telcel, ninguno con cookie previa. Antes contaban 1.
  const phoneA = browser(UA_ANDROID);
  const phoneB = browser(UA_ANDROID);

  assert.equal(await visit(w, phoneA, { ip: IP_TELCEL, minute: 0 }), true);
  assert.equal(await visit(w, phoneB, { ip: IP_TELCEL, minute: 3 }), true);
  assert.equal(w.rows.length, 2);
});

test("2) tres navegadores desde el WiFi de la clínica → 3 clics", async () => {
  const w = world();
  const recepcion = browser(UA_DESKTOP);
  const doctora = browser(UA_IPHONE);
  const asistente = browser(UA_ANDROID);

  assert.equal(await visit(w, recepcion, { ip: IP_CLINICA, minute: 0 }), true);
  assert.equal(await visit(w, doctora, { ip: IP_CLINICA, minute: 0 }), true);
  assert.equal(await visit(w, asistente, { ip: IP_CLINICA, minute: 0 }), true);
  assert.equal(w.rows.length, 3);
});

test("3) el mismo navegador recargando 5 veces en un minuto → 1 clic", async () => {
  const w = world();
  const b = browser(UA_IPHONE);

  assert.equal(await visit(w, b, { ip: IP_TELCEL, minute: 0 }), true);
  for (const minute of [0.2, 0.4, 0.6, 0.9]) {
    assert.equal(await visit(w, b, { ip: IP_TELCEL, minute }), false);
  }
  assert.equal(w.rows.length, 1);
});

test("4) el mismo navegador 40 minutos después → 2 clics", async () => {
  const w = world();
  const b = browser(UA_IPHONE);

  assert.equal(await visit(w, b, { ip: IP_TELCEL, minute: 0 }), true);
  assert.equal(await visit(w, b, { ip: IP_TELCEL, minute: 29 }), false); // dentro de la ventana
  assert.equal(await visit(w, b, { ip: IP_TELCEL, minute: 40 }), true); // expiró: cuenta
  assert.equal(w.rows.length, 2);
});

test("5) cookies bloqueadas, 3 recargas en un minuto → 1 clic (respaldo corto)", async () => {
  const w = world();
  const b = browser(UA_ANDROID, false); // nunca conserva dc_vid

  assert.equal(await visit(w, b, { ip: IP_TELCEL, minute: 0 }), true);
  assert.equal(await visit(w, b, { ip: IP_TELCEL, minute: 0.3 }), false);
  assert.equal(await visit(w, b, { ip: IP_TELCEL, minute: 0.8 }), false);
  assert.equal(w.rows.length, 1);
});

test("6) bot de vista previa → no cuenta (la redirección no la decide esto)", async () => {
  const w = world();
  const bot = browser(UA_BOT_WHATSAPP);

  assert.equal(await visit(w, bot, { ip: IP_TELCEL, minute: 0 }), false);
  assert.equal(w.rows.length, 0);
});

test("7) sin sql/affiliate-click-vid.sql aplicado → degrada, no pierde clics", async () => {
  const w = world();
  // La columna `vid` no existe: toda consulta que la mencione truena (null).
  const brokenLookup: RecentClickLookup = async (q) =>
    q.vid !== undefined ? null : w.lookup(q);

  const b = browser(UA_IPHONE);
  assert.equal(await visit(w, b, { ip: IP_TELCEL, minute: 0, lookup: brokenLookup }), true);
  // Ya tiene cookie, pero la consulta por vid falla → cae al respaldo corto.
  assert.equal(await visit(w, b, { ip: IP_TELCEL, minute: 1, lookup: brokenLookup }), false);
  // Y un visitante nuevo de la misma red sigue contando.
  const otro = browser(UA_DESKTOP);
  assert.equal(await visit(w, otro, { ip: IP_TELCEL, minute: 1, lookup: brokenLookup }), true);
  assert.equal(w.rows.length, 2);
});

test("residual conocido: dos teléfonos idénticos, misma IP, con < 2 min → 1 clic", async () => {
  const w = world();
  // El respaldo corto no puede distinguir "otra persona con el mismo teléfono
  // en la misma red" de "el mismo navegador recargando". Es el precio de que
  // el caso 5 (cookies bloqueadas) siga deduplicando; con 2 minutos la ventana
  // es lo bastante estrecha para que casi nunca ocurra.
  const phoneA = browser(UA_ANDROID);
  const phoneB = browser(UA_ANDROID);

  assert.equal(await visit(w, phoneA, { ip: IP_TELCEL, minute: 0 }), true);
  assert.equal(await visit(w, phoneB, { ip: IP_TELCEL, minute: 1 }), false);
  // Con otro teléfono (otro user-agent) NO se pierde ni dentro de la ventana.
  const iphone = browser(UA_IPHONE);
  assert.equal(await visit(w, iphone, { ip: IP_TELCEL, minute: 1 }), true);
});
