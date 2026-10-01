/**
 * El script de Lua de la señal contra un Redis REAL.
 *
 * Se salta solo si no hay uno: `PRESENCIA_REDIS_TCP=127.0.0.1:6390 npm run test:presencia-lua`
 * (Redis 7/8 de cualquier origen; en este servidor, el binario del .deb de Debian
 * extraído en el scratchpad — nada de esto entra a package.json ni al repo).
 * ⚠ Hace FLUSHDB en la base 15 de ese Redis: usa uno de pruebas.
 *
 * Lo que fija: las mismas llaves y formato, TTL real, ventana de 5 min, desde/duración,
 * límite por sesión, UNA llamada por señal, la caída a EVAL completo si el script no
 * está cargado, la caída al camino de varios comandos si EVAL falla, y que el script y
 * `aplicarLatido` (JS) hacen exactamente lo mismo.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RedisTcp } from "./redis-tcp";
import { SCRIPT_LATIDO, SHA_SCRIPT_LATIDO } from "../presencia-lua";
import {
  _fijarRedisParaPruebas,
  contarClinicasEnLinea,
  leerClinicasEnLinea,
  procesarLatido,
  type IdentidadLatido,
} from "../presencia-store";
import { LATIDO_MS, MAX_LATIDOS_POR_MINUTO, VENTANA_EN_LINEA_MS, armarClinicasEnLinea, leerRegistro } from "../presencia-core";

const DONDE = process.env.PRESENCIA_REDIS_TCP;
const opciones = { skip: DONDE ? false : "sin PRESENCIA_REDIS_TCP: no hay un Redis real contra el que probar" };
const MIN = 60_000;
// Un instante fijo, alineado a minuto (así el contador del límite es predecible).
const T0 = Math.floor(1_790_000_000_000 / MIN) * MIN;

let r: RedisTcp;
before(async () => {
  if (!DONDE) return;
  r = await RedisTcp.conectar(DONDE);
  await r.cmd("SELECT", 15);
});
after(() => { if (DONDE) r.cerrar(); });
beforeEach(async () => {
  if (!DONDE) return;
  await r.cmd("FLUSHDB");
  await r.cmd("SCRIPT", "FLUSH");
  r.evalRoto = null;
  r.viajes = 0; r.comandos = 0;
  _fijarRedisParaPruebas(undefined);
});

const ANA: IdentidadLatido = { clinicId: "clin-A", userId: "u-ana", nombre: "Ana Pérez", cuenta: true };
const LUIS: IdentidadLatido = { clinicId: "clin-A", userId: "u-luis", nombre: "Luis Gómez", cuenta: true };
const BETO: IdentidadLatido = { clinicId: "clin-B", userId: "u-beto", nombre: "Beto Ruiz", cuenta: true };

let resoluciones = 0;
const latir = (id: IdentidadLatido | null, o: { sesion?: string; ruta?: string; ahora?: number } = {}) =>
  procesarLatido(
    { redis: r, resolverIdentidad: async () => { resoluciones++; return id; } },
    { sesion: o.sesion ?? "ses-1", clinicaCookie: "clin-A", ruta: o.ruta ?? "/dashboard/agenda", ahora: o.ahora ?? T0 },
  );

test("el script carga y su hash es el que usa el cliente", opciones, async () => {
  assert.equal(await r.cmd("SCRIPT", "LOAD", SCRIPT_LATIDO), SHA_SCRIPT_LATIDO);
});

test("primera señal: guarda el registro y el índice con las llaves y el formato de siempre", opciones, async () => {
  assert.deepEqual(await latir(ANA, { ruta: "/dashboard/orthodontics/cobranza" }), { estado: 200, guardado: true });
  assert.equal(await r.cmd("GET", "pres:s:ses-1:clin-A"), `clin-A|u-ana|1|${T0}|${T0}|${T0 / MIN}|1|Ortodoncia · Cobranza|Ana Pérez`);
  assert.deepEqual(await r.cmd("ZRANGE", "pres:z", 0, -1, "WITHSCORES"), [`clin-A|u-ana|ses-1:clin-A`, String(T0)]);
  const ttl = Number(await r.cmd("TTL", "pres:s:ses-1:clin-A"));
  assert.ok(ttl >= 599 && ttl <= 600, `TTL del registro 10 min (salió ${ttl})`);
});

test("UNA llamada a Redis por señal en régimen normal; dos solo la primera (descubrir + guardar la identidad)", opciones, async () => {
  resoluciones = 0;
  await r.cmd("SCRIPT", "LOAD", SCRIPT_LATIDO); // en producción el script ya está cargado casi siempre
  await latir(ANA);
  assert.equal(r.viajes, 2, "primera de la sesión: EVALSHA sin identidad → resolver con la base → EVALSHA con la identidad");
  r.viajes = 0;
  for (let i = 1; i <= 20; i++) await latir(ANA, { ahora: T0 + i * LATIDO_MS });
  assert.equal(r.viajes, 20, "20 señales, 20 viajes");
  assert.equal(resoluciones, 1, "y la base se consultó una sola vez");
  const stats = String(await r.cmd("INFO", "commandstats"));
  assert.match(stats, /cmdstat_evalsha:calls=\d+/, "se usa EVALSHA, no se manda el script entero cada vez");
});

test("script no cargado (Redis reiniciado o SCRIPT FLUSH): cae a EVAL completo, que lo carga, y sigue", opciones, async () => {
  await latir(ANA);
  assert.equal(r.viajes, 3, "EVALSHA que dice NOSCRIPT, EVAL completo, y EVALSHA con la identidad: solo la primera vez tras un reinicio");
  await r.cmd("SCRIPT", "FLUSH");
  r.viajes = 0;
  assert.deepEqual(await latir(ANA, { ahora: T0 + LATIDO_MS }), { estado: 200, guardado: true });
  assert.equal(r.viajes, 2, "EVALSHA (NOSCRIPT) + EVAL completo");
  assert.deepEqual(await r.cmd("SCRIPT", "EXISTS", SHA_SCRIPT_LATIDO), [1], "quedó cargado");
  r.viajes = 0;
  await latir(ANA, { ahora: T0 + 2 * LATIDO_MS });
  assert.equal(r.viajes, 1);
});

test("ventana de 5 min: en línea hasta 5:00 desde la última señal, fuera después", opciones, async () => {
  await latir(ANA);
  assert.equal(await contarClinicasEnLinea(r, T0 + VENTANA_EN_LINEA_MS), 1, "a los 5:00 todavía");
  assert.equal(await contarClinicasEnLinea(r, T0 + VENTANA_EN_LINEA_MS + 1), 0, "a los 5:00,001 ya no");
});

test("dos usuarios, dos clínicas: conteo 2, lista con nombres y pantallas, la clínica 'desde' el primero", opciones, async () => {
  await latir(ANA, { sesion: "s-ana", ruta: "/dashboard/agenda", ahora: T0 });
  await latir(LUIS, { sesion: "s-luis", ruta: "/dashboard/caja", ahora: T0 + 30_000 });
  await procesarLatido({ redis: r, resolverIdentidad: async () => BETO }, { sesion: "s-beto", clinicaCookie: "clin-B", ruta: "/dashboard/billing", ahora: T0 + 40_000 });
  const ahora = T0 + 60_000;
  assert.equal(await contarClinicasEnLinea(r, ahora), 2);
  const clinicas = armarClinicasEnLinea((await leerClinicasEnLinea(r, ahora))!, new Map([["clin-A", "A"], ["clin-B", "B"]]), ahora);
  assert.deepEqual(clinicas.map((c) => [c.nombre, c.usuarios.length, c.desde]), [["A", 2, T0], ["B", 1, T0 + 40_000]]);
  assert.deepEqual(clinicas[0].usuarios.map((u) => [u.nombre, u.pantalla]), [["Ana Pérez", "Agenda"], ["Luis Gómez", "Caja"]]);
});

test("«desde» sobrevive a las señales y se reinicia pasados 5 min sin señal", opciones, async () => {
  for (let i = 0; i < 5; i++) await latir(ANA, { ahora: T0 + i * LATIDO_MS });
  let [f] = (await leerClinicasEnLinea(r, T0 + 4 * LATIDO_MS))!;
  assert.equal(f.usuarios[0].desde, T0);
  assert.equal(f.usuarios[0].ultimaSenal, T0 + 4 * LATIDO_MS);
  const vuelta = T0 + 4 * LATIDO_MS + 6 * MIN;
  await latir(ANA, { ahora: vuelta });
  [f] = (await leerClinicasEnLinea(r, vuelta))!;
  assert.equal(f.usuarios[0].desde, vuelta, "la sesión se cortó más de 5 min: empieza otra");
});

test("la misma persona con dos sesiones (dos navegadores) es UN usuario", opciones, async () => {
  await latir(ANA, { sesion: "s-1", ruta: "/dashboard/agenda", ahora: T0 });
  await latir(ANA, { sesion: "s-2", ruta: "/dashboard/caja", ahora: T0 + 10_000 });
  const [f] = (await leerClinicasEnLinea(r, T0 + 20_000))!;
  assert.equal(f.usuarios.length, 1);
  assert.equal(f.usuarios[0].pantalla, "Caja", "la pantalla de la última señal");
  assert.equal(f.usuarios[0].desde, T0);
});

test(`límite: ${MAX_LATIDOS_POR_MINUTO} señales por minuto y sesión; la siguiente es 429 y no escribe; al minuto siguiente vuelve`, opciones, async () => {
  for (let i = 0; i < MAX_LATIDOS_POR_MINUTO; i++) assert.equal((await latir(ANA, { ahora: T0 + i * 1000 })).estado, 200);
  const antes = await r.cmd("GET", "pres:s:ses-1:clin-A");
  const rechazada = await latir(ANA, { ahora: T0 + 30_000 });
  assert.equal(rechazada.estado, 429);
  assert.ok("reintentarEnS" in rechazada && rechazada.reintentarEnS === 30);
  for (let i = 0; i < 50; i++) assert.equal((await latir(ANA, { ahora: T0 + 31_000 })).estado, 429);
  assert.equal(await r.cmd("GET", "pres:s:ses-1:clin-A"), antes, "las rechazadas no tocan nada");
  assert.equal((await latir(ANA, { ahora: T0 + MIN })).estado, 200);
  assert.equal((await latir(ANA, { sesion: "otra", ahora: T0 + 31_000 })).estado, 200, "otra sesión no se ve afectada");
});

test("«no cuenta» (Ver como clínica): se recuerda la decisión sin volver a preguntar, y nunca entra al índice", opciones, async () => {
  resoluciones = 0;
  const suplantando = { ...ANA, cuenta: false };
  assert.deepEqual(await latir(suplantando, { sesion: "ses-imp" }), { estado: 200, guardado: false, motivo: "no-cuenta" });
  for (let i = 1; i <= 5; i++) await latir(suplantando, { sesion: "ses-imp", ahora: T0 + i * LATIDO_MS });
  assert.equal(resoluciones, 1);
  assert.equal(await r.cmd("EXISTS", "pres:z"), 0);
  assert.equal(await contarClinicasEnLinea(r, T0 + 5 * LATIDO_MS), 0);
});

test("sin acceso (la base dice null): 401 y no se guarda nada", opciones, async () => {
  assert.deepEqual(await latir(null), { estado: 401 });
  assert.equal(await r.cmd("DBSIZE"), 0);
});

test("TTL real: el registro caduca solo y la señal siguiente vuelve a pedir la identidad", opciones, async () => {
  // El mismo script con ttl = 1 s (el cliente usa 600).
  const llamar = (ahora: number, ...identidad: string[]) =>
    r.evalsha(SHA_SCRIPT_LATIDO, ["pres:s:ttl:clin-A", "pres:z"], [ahora, 1, 10, "Agenda", VENTANA_EN_LINEA_MS, "ttl:clin-A", ...identidad]);
  await r.cmd("SCRIPT", "LOAD", SCRIPT_LATIDO);
  assert.deepEqual(await llamar(T0), [1, 0], "sin registro ni identidad: pide la identidad");
  assert.deepEqual(await llamar(T0, "clin-A", "u-ana", "1", "Ana"), [0, 0]);
  assert.deepEqual(await llamar(T0 + 1000), [0, 0], "con registro ya no la pide");
  await new Promise((ok) => setTimeout(ok, 1300));
  assert.deepEqual(await llamar(T0 + 2000), [1, 0], "caducó: la pide otra vez");
});

test("nombres con «|», saltos de línea, acentos y emojis: el formato no se rompe", opciones, async () => {
  const raro: IdentidadLatido = { ...ANA, nombre: "Ana|Pérez\nñandú 😀 \t Ü" };
  await latir(raro);
  const reg = leerRegistro(await r.cmd("GET", "pres:s:ses-1:clin-A"))!;
  assert.equal(reg.userId, "u-ana");
  assert.equal(reg.nombre, "Ana Pérez ñandú 😀 Ü");
  assert.equal(reg.n, 1);
});

test("un registro dañado se trata como ausente (pide la identidad), no rompe", opciones, async () => {
  await r.cmd("SET", "pres:s:ses-1:clin-A", "basura sin formato");
  resoluciones = 0;
  assert.deepEqual(await latir(ANA), { estado: 200, guardado: true });
  assert.equal(resoluciones, 1);
  assert.ok(leerRegistro(await r.cmd("GET", "pres:s:ses-1:clin-A")));
});

test("si EVAL falla en ejecución, la señal sigue por el camino de varios comandos CONTRA REDIS REAL y deja lo mismo", opciones, async () => {
  r.evalRoto = new Error("ERR unknown command 'EVALSHA'");
  assert.deepEqual(await latir(ANA, { ruta: "/dashboard/caja" }), { estado: 200, guardado: true });
  assert.equal(await r.cmd("GET", "pres:s:ses-1:clin-A"), `clin-A|u-ana|1|${T0}|${T0}|${T0 / MIN}|1|Caja|Ana Pérez`);
  assert.deepEqual(await r.cmd("ZRANGE", "pres:z", 0, -1), ["clin-A|u-ana|ses-1:clin-A"]);
  assert.equal(await contarClinicasEnLinea(r, T0), 1);
});

// ── Lua y JS hacen lo mismo ──

type Paso = { id: IdentidadLatido; sesion: string; ruta: string; dt: number };
function secuencia(): Paso[] {
  // Determinista: mezcla de sesiones, pantallas, saltos de 1 s a 8 min, y ráfagas que pasan el límite.
  const rutas = ["/dashboard", "/dashboard/agenda", "/dashboard/caja", "/dashboard/patients/xyz", "/dashboard/orthodontics/alertas", "/otra"];
  const ids = [ANA, LUIS, BETO, { ...ANA, userId: "u-imp", cuenta: false }];
  const pasos: Paso[] = [];
  let sem = 7;
  const azar = (n: number) => { sem = (sem * 1103515245 + 12345) & 0x7fffffff; return sem % n; };
  for (let i = 0; i < 120; i++) {
    const k = azar(4);
    pasos.push({ id: ids[k], sesion: `s${k}${azar(2)}`, ruta: rutas[azar(rutas.length)], dt: [1000, 1000, 5000, 20_000, 60_000, 7 * 60_000][azar(6)] });
  }
  return pasos;
}

async function correr(conLua: boolean) {
  await r.cmd("FLUSHDB");
  await r.cmd("SCRIPT", "FLUSH");
  _fijarRedisParaPruebas(undefined);
  r.evalRoto = conLua ? null : new Error("sin lua");
  const resultados: unknown[] = [];
  let t = T0;
  for (const p of secuencia()) {
    t += p.dt;
    resultados.push(await procesarLatido(
      { redis: r, resolverIdentidad: async () => p.id },
      { sesion: p.sesion, clinicaCookie: p.id.clinicId, ruta: p.ruta, ahora: t },
    ));
  }
  const llaves = ((await r.cmd("KEYS", "pres:s:*")) as string[]).sort();
  const registros = await Promise.all(llaves.map(async (k) => [k, await r.cmd("GET", k)]));
  const indice = await r.cmd("ZRANGE", "pres:z", 0, -1, "WITHSCORES");
  return { resultados, registros, indice };
}

test("equivalencia: la misma secuencia de 120 señales con Lua y con el camino de JS deja EXACTAMENTE lo mismo", opciones, async () => {
  const lua = await correr(true);
  const js = await correr(false);
  assert.deepEqual(lua.resultados, js.resultados);
  assert.deepEqual(lua.registros, js.registros);
  assert.deepEqual(lua.indice, js.indice);
  const tipos = new Set(lua.resultados.map((x) => JSON.stringify(x)));
  assert.ok(tipos.size >= 3, "la secuencia pasa por guardado, no-cuenta y límite: " + Array.from(tipos).join(" "));
});
