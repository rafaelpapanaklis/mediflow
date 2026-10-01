/**
 * «Clínicas en línea» — reglas de la señal y del conteo.
 *
 * Run: node --import tsx --test src/lib/presencia/__tests__/presencia.test.ts
 *      (o `npm run test:presencia`)
 *
 * Lo que aprobó Rafael (1-oct-2026) y aquí queda fijado:
 *   · señal cada 60 s solo con la pestaña visible; 15 min sin actividad = ya no manda;
 *   · en línea = al menos un usuario con señal en los últimos 5 min;
 *   · «Ver como clínica» y los usuarios de plataforma NO cuentan;
 *   · sin Redis la tarjeta dice «sin dato» y nada falla;
 *   · la señal NO abre conexiones de Prisma: la identidad se resuelve una vez.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INACTIVIDAD_MS,
  LATIDO_MS,
  LATIDO_MINIMO_MS,
  MAX_LATIDOS_POR_MINUTO,
  VENTANA_EN_LINEA_MS,
  armarClinicasEnLinea,
  debeLatir,
  etiquetaDePantalla,
  formatoDuracion,
  pausaPorErrores,
  puedeLatirYa,
} from "../presencia-core";
import {
  contarClinicasEnLinea,
  contarConEspera,
  leerClinicasEnLinea,
  procesarLatido,
  _fijarRedisParaPruebas,
  _luaEnPausa,
  type IdentidadLatido,
} from "../presencia-store";
import { RedisConEvalRoto, RedisFalso } from "./redis-falso";

const MIN = 60_000;

// ─────────────────────────── Cliente: cuándo se manda ───────────────────────

test("las cifras aprobadas: 60 s, 15 min de inactividad, 5 min de ventana", () => {
  assert.equal(LATIDO_MS, 60_000);
  assert.equal(INACTIVIDAD_MS, 15 * MIN);
  assert.equal(VENTANA_EN_LINEA_MS, 5 * MIN);
});

test("pestaña en segundo plano: no se manda, aunque el usuario esté activo", () => {
  assert.equal(debeLatir({ visible: false, ahora: 1000, ultimaActividad: 1000 }), false);
});

test("pestaña visible con actividad reciente: se manda", () => {
  assert.equal(debeLatir({ visible: true, ahora: 10 * MIN, ultimaActividad: 9 * MIN }), true);
});

test("15 min sin mouse/teclado/toque: deja de mandar aunque la pestaña siga visible", () => {
  const t0 = 5_000_000;
  assert.equal(debeLatir({ visible: true, ahora: t0 + 15 * MIN - 1, ultimaActividad: t0 }), true, "a los 14:59 todavía");
  assert.equal(debeLatir({ visible: true, ahora: t0 + 15 * MIN, ultimaActividad: t0 }), false, "a los 15:00 ya no");
  assert.equal(debeLatir({ visible: true, ahora: t0 + 40 * MIN, ultimaActividad: t0 }), false);
});

test("las señales que no son del reloj respetan los 15 s mínimos", () => {
  assert.equal(puedeLatirYa(100_000 + LATIDO_MINIMO_MS - 1, 100_000), false);
  assert.equal(puedeLatirYa(100_000 + LATIDO_MINIMO_MS, 100_000), true);
});

test("«error» seguido: 1 y 2 no cambian el ritmo; desde la 3.ª se espacia hasta 10 min", () => {
  assert.equal(pausaPorErrores(0), 0);
  assert.equal(pausaPorErrores(1), 0);
  assert.equal(pausaPorErrores(2), 0);
  assert.equal(pausaPorErrores(3), 2 * MIN);
  assert.equal(pausaPorErrores(4), 4 * MIN);
  assert.equal(pausaPorErrores(5), 8 * MIN);
  assert.equal(pausaPorErrores(6), 10 * MIN, "tope");
  assert.equal(pausaPorErrores(500), 10 * MIN, "no se desborda");
  assert.equal(pausaPorErrores(Number.NaN), 0);
});

test("el latido lleva el espaciado por «error» y vuelve al ritmo normal con una respuesta buena", () => {
  const src = readFileSync(join(process.cwd(), "src/components/dashboard/presencia-latido.tsx"), "utf8");
  assert.match(src, /j\.motivo === "error"/, "cuenta los «error» del servidor");
  assert.match(src, /pausaPorErrores\(erroresSeguidos\)/);
  assert.match(src, /erroresSeguidos = 0;\s*\n\s*noAntesDe = 0;/, "una respuesta buena lo reinicia");
  assert.match(src, /if \(Date\.now\(\) < noAntesDe\) return;/);
});

// ─────────────────────────── Pantalla legible ───────────────────────────────

test("la ruta se traduce a la pantalla del menú", () => {
  assert.equal(etiquetaDePantalla("/dashboard"), "Hoy");
  assert.equal(etiquetaDePantalla("/dashboard/agenda"), "Agenda");
  assert.equal(etiquetaDePantalla("/dashboard/agenda?date=2026-10-01"), "Agenda");
  assert.equal(etiquetaDePantalla("/dashboard/caja/"), "Caja");
  assert.equal(etiquetaDePantalla("/dashboard/billing"), "Facturación");
  assert.equal(etiquetaDePantalla("/dashboard/patients"), "Pacientes");
  assert.equal(etiquetaDePantalla("/dashboard/orthodontics/cobranza"), "Ortodoncia · Cobranza");
  assert.equal(etiquetaDePantalla("/dashboard/whatsapp/bot/saldo"), "Saldo IA");
});

test("la ruta cruda NUNCA sale: el id del paciente no llega a ninguna etiqueta", () => {
  const e = etiquetaDePantalla("/dashboard/patients/cm9x8y7z6w5v4u3t2s1r/odontogram?nota=texto-privado");
  assert.equal(e, "Ficha de paciente");
  assert.ok(!e.includes("cm9x") && !e.includes("privado"));
});

test("lo que no se reconoce (o no es del panel) es «Otra pantalla»", () => {
  for (const r of ["/admin/clinics", "/dashboard/no-existe", "https://x.test/dashboard/agenda", "", null, undefined, 42, {}]) {
    assert.equal(etiquetaDePantalla(r), "Otra pantalla", String(r));
  }
});

test("la duración se escribe legible", () => {
  assert.equal(formatoDuracion(20_000), "menos de 1 min");
  assert.equal(formatoDuracion(42 * MIN), "42 min");
  assert.equal(formatoDuracion(65 * MIN), "1 h 05 min");
  assert.equal(formatoDuracion(NaN), "menos de 1 min");
});

// ─────────────────────────── Servidor: la señal ─────────────────────────────

function fabrica(redis: RedisFalso | null) {
  let resoluciones = 0;
  const identidades: Record<string, IdentidadLatido | null> = {};
  const entrada = (o: { sesion?: string; ruta?: unknown } = {}) => ({
    sesion: o.sesion ?? "ses-1",
    clinicaCookie: "clin-A" as string | null,
    ruta: o.ruta ?? "/dashboard/agenda",
    ahora: redis?.reloj ?? 0,
  });
  const latir = (id: IdentidadLatido | null, o: Parameters<typeof entrada>[0] = {}) =>
    procesarLatido(
      { redis, resolverIdentidad: async () => { resoluciones++; return id; } },
      entrada(o),
    );
  return { latir, resoluciones: () => resoluciones, identidades };
}

const ANA: IdentidadLatido = { clinicId: "clin-A", userId: "u-ana", nombre: "Ana Pérez", cuenta: true };
const LUIS: IdentidadLatido = { clinicId: "clin-A", userId: "u-luis", nombre: "Luis Gómez", cuenta: true };
const BETO: IdentidadLatido = { clinicId: "clin-B", userId: "u-beto", nombre: "Beto Ruiz", cuenta: true };

test("una señal pone a la clínica en línea y a los 5 min sin señal deja de estarlo", async () => {
  const r = new RedisFalso();
  const { latir } = fabrica(r);
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 0);

  assert.deepEqual(await latir(ANA), { estado: 200, guardado: true });
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 1);

  r.avanzar(5 * MIN - 1);
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 1, "a los 4:59 sigue en línea");
  r.avanzar(1);
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 1, "justo a los 5:00 todavía entra en la ventana");
  r.avanzar(1);
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 0, "pasados los 5 min ya no");
});

test("dos usuarios de la misma clínica son UNA clínica en línea con dos usuarios; otra clínica suma", async () => {
  const r = new RedisFalso();
  const a = fabrica(r), b = fabrica(r), c = fabrica(r);
  await a.latir(ANA, { sesion: "s-ana", ruta: "/dashboard/agenda" });
  await b.latir(LUIS, { sesion: "s-luis", ruta: "/dashboard/caja" });
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 1);
  await c.latir(BETO, { sesion: "s-beto", ruta: "/dashboard/billing" });
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 2);

  const filas = (await leerClinicasEnLinea(r, r.reloj))!;
  const clinicas = armarClinicasEnLinea(filas, new Map([["clin-A", "Clínica A"], ["clin-B", "Clínica B"]]), r.reloj);
  assert.equal(clinicas.length, 2);
  assert.equal(clinicas[0].nombre, "Clínica A", "la que más usuarios tiene va primero");
  assert.deepEqual(clinicas[0].usuarios.map((u) => [u.nombre, u.pantalla]), [["Ana Pérez", "Agenda"], ["Luis Gómez", "Caja"]]);
  assert.deepEqual(clinicas[1].usuarios.map((u) => [u.nombre, u.pantalla]), [["Beto Ruiz", "Facturación"]]);
});

test("«en línea desde» es la primera señal de la sesión continua y sobrevive a las siguientes", async () => {
  const r = new RedisFalso();
  const { latir } = fabrica(r);
  const inicio = r.reloj;
  await latir(ANA);
  for (let i = 0; i < 4; i++) { r.avanzar(LATIDO_MS); await latir(ANA); }
  const [f] = (await leerClinicasEnLinea(r, r.reloj))!;
  assert.equal(f.usuarios[0].desde, inicio);
  assert.equal(armarClinicasEnLinea([f], new Map(), r.reloj)[0].desde, inicio, "la clínica: la primera señal de sus usuarios en línea");
  assert.equal(f.usuarios[0].ultimaSenal, r.reloj);
});

test("si la sesión se corta más de 5 min, la siguiente señal empieza una sesión nueva", async () => {
  const r = new RedisFalso();
  const { latir } = fabrica(r);
  await latir(ANA);
  r.avanzar(6 * MIN);
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 0);
  const vuelta = r.reloj;
  await latir(ANA);
  const [f] = (await leerClinicasEnLinea(r, r.reloj))!;
  assert.equal(f.usuarios[0].desde, vuelta, "desde se reinicia: ya no es la sesión de hace 6 min");
});

test("la pantalla de cada usuario se actualiza con su última señal", async () => {
  const r = new RedisFalso();
  const { latir } = fabrica(r);
  await latir(ANA, { ruta: "/dashboard/agenda" });
  r.avanzar(LATIDO_MS);
  await latir(ANA, { ruta: "/dashboard/caja" });
  const [f] = (await leerClinicasEnLinea(r, r.reloj))!;
  assert.equal(f.usuarios[0].pantalla, "Caja");
});

test("lo que se guarda en Redis es el NOMBRE de la pantalla, nunca la ruta con el id del paciente", async () => {
  const r = new RedisFalso();
  const { latir } = fabrica(r);
  await latir(ANA, { ruta: "/dashboard/patients/cm9x8y7z6w5v4u3t2s1r?q=dolor-de-muela" });
  const todo = r.volcado();
  assert.ok(todo.includes("Ficha de paciente"));
  assert.ok(!todo.includes("cm9x8y7z6w5v4u3t2s1r") && !todo.includes("dolor-de-muela"), "ni el id ni la consulta salen del navegador a Redis");
});

// ── Quién NO cuenta ──

test("«Ver como clínica» (cuenta:false) no suma ni escribe nada de presencia", async () => {
  const r = new RedisFalso();
  const { latir } = fabrica(r);
  const suplantando: IdentidadLatido = { ...ANA, cuenta: false };
  const res = await latir(suplantando, { sesion: "ses-impersonada" });
  assert.deepEqual(res, { estado: 200, guardado: false, motivo: "no-cuenta" });
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 0);
  assert.deepEqual((await leerClinicasEnLinea(r, r.reloj))!, []);
  assert.ok(!r.llaves().includes("pres:z"), "no entra al índice de quién está en línea");
  assert.ok(r.llaves().some((k) => k.startsWith("pres:s:")), "solo se recuerda la decisión, para no volver a preguntar a la base");
});

test("la sesión real del dueño y la de «Ver como clínica» (mismo usuario) no se mezclan", async () => {
  const r = new RedisFalso();
  const real = fabrica(r), suplantada = fabrica(r);
  // Mismo supabaseId; solo cambia el session_id de Supabase.
  await suplantada.latir({ ...ANA, cuenta: false }, { sesion: "ses-admin-viendo" });
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 0);
  await real.latir(ANA, { sesion: "ses-real" });
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 1, "la sesión real sí cuenta");
  // Y la suplantada, otra vez, sigue sin contar: su identidad en caché es la suya.
  const otra = await suplantada.latir({ ...ANA, cuenta: true }, { sesion: "ses-admin-viendo" });
  assert.deepEqual(otra, { estado: 200, guardado: false, motivo: "no-cuenta" });
  assert.equal(suplantada.resoluciones(), 1, "no se vuelve a resolver: la decisión quedó en caché");
});

test("sin sesión con acceso (2FA pendiente, plan vencido…) contesta 401 y no guarda nada", async () => {
  const r = new RedisFalso();
  const { latir } = fabrica(r);
  assert.deepEqual(await latir(null), { estado: 401 });
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 0);
  assert.ok(!r.llaves().some((k) => k.startsWith("pres:s:")), "tampoco se cachea el «no»");
});

// ── Sin base de datos en cada señal ──

test("la identidad se resuelve con la base UNA vez: las 25 señales siguientes (8 min) solo tocan Redis", async () => {
  const r = new RedisFalso();
  const { latir, resoluciones } = fabrica(r);
  await latir(ANA);
  for (let i = 0; i < 25; i++) { r.avanzar(20_000); await latir(ANA); }
  assert.equal(resoluciones(), 1, "26 señales, 1 resolución (la de la primera)");
});

test("en una hora de uso a una señal por minuto la base se consulta 1 vez, no 60 (la identidad vive mientras la sesión da señales)", async () => {
  const r = new RedisFalso();
  const { latir, resoluciones } = fabrica(r);
  for (let i = 0; i < 60; i++) { await latir(ANA); r.avanzar(LATIDO_MS); }
  assert.equal(resoluciones(), 1);
});

test("en régimen normal una señal es UN viaje a Redis (dos la primera de la sesión: descubrir que falta la identidad y guardarla)", async () => {
  const r = new RedisFalso();
  const { latir } = fabrica(r);
  await latir(ANA);
  assert.equal(r.viajes, 3, "primera señal en el camino de reserva: GET, GET + SET/ZADD con la identidad");
  const antes = r.viajes;
  r.avanzar(LATIDO_MS);
  await latir(ANA);
  assert.equal(r.viajes - antes, 2, "camino de reserva: GET y luego SET+ZADD (con Lua sería 1 solo)");
});

test("la identidad en caché caduca a los 10 min SIN señales: ahí sí se vuelve a preguntar, una vez", async () => {
  const r = new RedisFalso();
  const { latir, resoluciones } = fabrica(r);
  await latir(ANA);
  r.avanzar(10 * MIN + 1);
  await latir(ANA);
  await latir(ANA);
  assert.equal(resoluciones(), 2);
});

test("el servidor de la señal no importa Prisma (ni el almacén ni la ruta salvo por getAuthContext)", () => {
  const raiz = process.cwd();
  const almacen = readFileSync(join(raiz, "src/lib/presencia/presencia-store.ts"), "utf8");
  const nucleo = readFileSync(join(raiz, "src/lib/presencia/presencia-core.ts"), "utf8");
  const ruta = readFileSync(join(raiz, "src/app/api/dashboard/presencia/route.ts"), "utf8");
  for (const [n, src] of [["store", almacen], ["core", nucleo], ["ruta", ruta]] as const) {
    assert.ok(!/from\s+["']@\/lib\/prisma/.test(src) && !/@prisma\/client/.test(src), `${n} no importa Prisma`);
  }
  // La única vía a la base de la ruta es getAuthContext, y va DENTRO de resolverIdentidad.
  const dentro = ruta.slice(ruta.indexOf("resolverIdentidad"));
  assert.ok(dentro.includes("getAuthContext()"));
  assert.equal(ruta.split("getAuthContext()").length - 1, 1, "una sola llamada, la de resolverIdentidad");
  assert.ok(ruta.indexOf("getAuthContext()") > ruta.indexOf("resolverIdentidad"));
});

// ── Límite ──

test(`una sesión no pasa de ${MAX_LATIDOS_POR_MINUTO} señales por minuto: la siguiente es 429`, async () => {
  const r = new RedisFalso();
  const { latir } = fabrica(r);
  // Arranca en el segundo 0 de un minuto: así las 11 caen en el mismo minuto.
  r.reloj = Math.floor(r.reloj / MIN) * MIN;
  for (let i = 0; i < MAX_LATIDOS_POR_MINUTO; i++) {
    assert.equal((await latir(ANA)).estado, 200, `señal ${i + 1}`);
  }
  const rechazada = await latir(ANA);
  assert.equal(rechazada.estado, 429);
  assert.ok("reintentarEnS" in rechazada && rechazada.reintentarEnS >= 1 && rechazada.reintentarEnS <= 60);
  // Cien intentos más: todos rechazados, y no escriben nada nuevo.
  const antes = r.volcado();
  for (let i = 0; i < 100; i++) assert.equal((await latir(ANA)).estado, 429);
  assert.equal(r.volcado(), antes, "las rechazadas no escriben nada");
  // Al minuto siguiente vuelve a pasar.
  r.avanzar(MIN);
  assert.equal((await latir(ANA)).estado, 200);
});

test("el límite es por sesión: otro usuario no se queda sin señal porque Ana se pasó", async () => {
  const r = new RedisFalso();
  r.reloj = Math.floor(r.reloj / MIN) * MIN;
  const a = fabrica(r), b = fabrica(r);
  for (let i = 0; i < MAX_LATIDOS_POR_MINUTO + 3; i++) await a.latir(ANA, { sesion: "s-ana" });
  assert.equal((await b.latir(LUIS, { sesion: "s-luis" })).estado, 200);
});

// ── Sin Redis / Redis caído ──

test("sin Redis: la señal no hace nada, no pregunta quién es y no falla; el conteo es «sin dato» (null)", async () => {
  const { latir, resoluciones } = fabrica(null);
  assert.deepEqual(await latir(ANA), { estado: 200, guardado: false, motivo: "sin-redis" });
  assert.equal(resoluciones(), 0, "ni siquiera toca la base");
  assert.equal(await contarClinicasEnLinea(null, Date.now()), null);
  assert.equal(await leerClinicasEnLinea(null, Date.now()), null);
  assert.equal(await contarConEspera(null, Date.now()), null);
});

test("Redis que falla en runtime: la señal contesta 200 sin guardar (nada se cae) y el conteo es «sin dato»", async () => {
  const r = new RedisFalso();
  r.fallar = new Error("ECONNRESET");
  const { latir } = fabrica(r);
  assert.deepEqual(await latir(ANA), { estado: 200, guardado: false, motivo: "error" });
  assert.equal(await contarClinicasEnLinea(r, r.reloj), null);
  assert.equal(await leerClinicasEnLinea(r, r.reloj), null);
  r.fallar = null;
  assert.deepEqual(await latir(ANA), { estado: 200, guardado: true }, "al volver Redis, vuelve a funcionar");
});

test("el conteo de la portada no espera a un Redis lento: pasado el tope, «sin dato»", async () => {
  const lento = {
    pipeline: () => {
      const p: any = new Proxy({}, { get: (_t, k) => (k === "exec" ? () => new Promise(() => {}) : () => p) });
      return p;
    },
  };
  const t0 = Date.now();
  assert.equal(await contarConEspera(lento as any, Date.now(), 50), null);
  assert.ok(Date.now() - t0 < 1000);
});

// ── La lista ──

test("armarClinicasEnLinea descarta lo que ya pasó de la ventana y ordena por usuarios y nombre", () => {
  const ahora = 10_000_000;
  const u = (nombre: string, hace: number, desdeHace = hace) => ({ nombre, pantalla: "Agenda", desde: ahora - desdeHace, ultimaSenal: ahora - hace });
  const res = armarClinicasEnLinea(
    [
      { clinicId: "z", desde: null, usuarios: [u("Zoe", 1 * MIN, 30 * MIN)] },
      { clinicId: "a", desde: ahora - 50 * MIN, usuarios: [u("Ana", 2 * MIN, 20 * MIN), u("Abel", 4 * MIN, 25 * MIN)] },
      { clinicId: "vieja", desde: null, usuarios: [u("Vieja", 6 * MIN)] },
      { clinicId: "vacia", desde: null, usuarios: [] },
    ],
    new Map([["z", "Zeta"], ["a", "Alfa"], ["vieja", "Vieja"]]),
    ahora,
  );
  assert.deepEqual(res.map((c) => c.nombre), ["Alfa", "Zeta"]);
  assert.equal(res[0].desde, ahora - 50 * MIN, "la sesión de la clínica puede ser más vieja que la de sus usuarios");
  assert.equal(res[1].desde, ahora - 30 * MIN, "sin dato de clínica, la primera de sus usuarios");
  assert.deepEqual(res[0].usuarios.map((x) => x.nombre), ["Abel", "Ana"]);
});

test("una clínica sin nombre en la base se enseña igual, no desaparece", () => {
  const ahora = 10_000_000;
  const res = armarClinicasEnLinea([{ clinicId: "x", desde: null, usuarios: [{ nombre: "A", pantalla: "Hoy", desde: ahora, ultimaSenal: ahora }] }], new Map(), ahora);
  assert.equal(res[0].nombre, "Clínica sin nombre");
});

test("cada clínica solo ve sus propios usuarios (nada se mezcla entre clínicas)", async () => {
  const r = new RedisFalso();
  const a = fabrica(r), b = fabrica(r);
  await a.latir(ANA, { sesion: "s-ana" });
  await b.latir(BETO, { sesion: "s-beto" });
  const filas = (await leerClinicasEnLinea(r, r.reloj))!;
  const porId = Object.fromEntries(filas.map((f) => [f.clinicId, f.usuarios.map((u) => u.nombre)]));
  assert.deepEqual(porId, { "clin-A": ["Ana Pérez"], "clin-B": ["Beto Ruiz"] });
});

// ── EVAL que falla: se cae al camino de varios comandos y no se rompe nada ──

test("si EVAL falla en ejecución, la señal sigue funcionando por el camino de varios comandos", async () => {
  _fijarRedisParaPruebas(undefined);
  const r = new RedisConEvalRoto(new Error("ERR unknown command 'evalsha'"));
  const { latir } = fabrica(r);
  assert.deepEqual(await latir(ANA), { estado: 200, guardado: true });
  assert.equal(await contarClinicasEnLinea(r, r.reloj), 1);
  assert.equal(r.intentosEval, 1);
  assert.ok(_luaEnPausa(r.reloj), "Lua queda en pausa");
});

test("con Lua en pausa no se vuelve a intentar durante 5 min (cada intento fallido costaría de más) y luego sí", async () => {
  _fijarRedisParaPruebas(undefined);
  const r = new RedisConEvalRoto(new Error("script falló"));
  const { latir } = fabrica(r);
  await latir(ANA);
  for (let i = 0; i < 4; i++) { r.avanzar(LATIDO_MS); await latir(ANA); }
  assert.equal(r.intentosEval, 1, "4 señales más en 4 min: ni un intento de EVAL");
  r.avanzar(2 * MIN);
  await latir(ANA);
  assert.equal(r.intentosEval, 2, "pasados los 5 min se vuelve a probar");
  _fijarRedisParaPruebas(undefined);
});

test("el camino de reserva aplica la misma regla: límite, «no cuenta» y desde", async () => {
  _fijarRedisParaPruebas(undefined);
  const r = new RedisConEvalRoto(new Error("x"));
  r.reloj = Math.floor(r.reloj / MIN) * MIN;
  const { latir } = fabrica(r);
  for (let i = 0; i < MAX_LATIDOS_POR_MINUTO; i++) assert.equal((await latir(ANA)).estado, 200);
  assert.equal((await latir(ANA)).estado, 429);
  assert.deepEqual(await fabrica(r).latir({ ...LUIS, cuenta: false }, { sesion: "otra" }), { estado: 200, guardado: false, motivo: "no-cuenta" });
  _fijarRedisParaPruebas(undefined);
});
