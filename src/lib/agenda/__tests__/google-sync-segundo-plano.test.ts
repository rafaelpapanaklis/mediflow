// Las rutas llaman a `sincronizarCitaEnSegundoPlano` tras guardar la cita: no
// puede alargar la respuesta ni tumbarla, pase lo que pase con la base o Google.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let modo: "lenta" | "explota" | "desconectada" = "desconectada";
let consultas = 0;
const clinicaDesconectada = {
  id: "c1", name: "C", address: null, timezone: "America/Mexico_City",
  googleCalendarEnabled: false, googleCalendarToken: null, googleRefreshToken: null, googleClinicCalendarId: null,
};

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: {
        findUnique: async () => {
          consultas++;
          if (modo === "explota") throw new Error("base caída");
          if (modo === "lenta") await new Promise((r) => setTimeout(r, 300));
          return clinicaDesconectada;
        },
      },
      appointment: { count: async () => { throw new Error("base caída"); }, findMany: async () => { throw new Error("base caída"); } },
    },
  },
});

const cargar = () => import("../google-sync");

test("contesta a los ~esperarMs aunque la sincronización tarde más, y ésta termina sola", async () => {
  modo = "lenta"; consultas = 0;
  const { sincronizarCitaEnSegundoPlano } = await cargar();
  const t0 = Date.now();
  await sincronizarCitaEnSegundoPlano("c1", "a1", { esperarMs: 50 });
  const espera = Date.now() - t0;
  assert.ok(espera < 250, `esperó ${espera} ms (la base tarda 300)`);
  assert.equal(consultas, 1, "la sincronización sí arrancó");
  await new Promise((r) => setTimeout(r, 350)); // que termine lo suelto
});

test("si termina antes del plazo no espera de más", async () => {
  modo = "desconectada";
  const { sincronizarCitaEnSegundoPlano } = await cargar();
  const t0 = Date.now();
  await sincronizarCitaEnSegundoPlano("c1", "a1", { esperarMs: 2000 });
  assert.ok(Date.now() - t0 < 500, `esperó ${Date.now() - t0} ms`);
});

test("NUNCA lanza: con la base caída o con ids vacíos la ruta sigue su camino", async () => {
  modo = "explota";
  const { sincronizarCitaEnSegundoPlano, sincronizarCitaConGoogle } = await cargar();
  await sincronizarCitaEnSegundoPlano("c1", "a1");
  const r = await sincronizarCitaConGoogle("c1", "a1");
  assert.equal(r.estado, "fallo");
  await sincronizarCitaEnSegundoPlano("", "a1");
  await sincronizarCitaEnSegundoPlano("c1", "");
  assert.deepEqual(await sincronizarCitaConGoogle("", "a1"), { estado: "omitido", motivo: "no_conectada" });
});

test("en Vercel registra la tarea en waitUntil para que siga viva tras contestar", async () => {
  modo = "desconectada";
  const registradas: Promise<unknown>[] = [];
  const clave = Symbol.for("@vercel/request-context");
  (globalThis as any)[clave] = { get: () => ({ waitUntil: (p: Promise<unknown>) => registradas.push(p) }) };
  try {
    const { sincronizarCitaEnSegundoPlano } = await cargar();
    await sincronizarCitaEnSegundoPlano("c1", "a1");
    assert.equal(registradas.length, 1);
  } finally {
    delete (globalThis as any)[clave];
  }
});

test("«Sincronizar citas futuras»: sin clínica no consulta nada; con un fallo de base dice «error» en vez de fingir 0", async () => {
  const { sincronizarCitasFuturasAGoogle } = await cargar();
  modo = "desconectada";
  assert.deepEqual(await sincronizarCitasFuturasAGoogle(""), { creadas: 0, omitidas: 0, fallidas: 0, restantes: 0, motivo: "no_conectada" });
  assert.deepEqual(await sincronizarCitasFuturasAGoogle("c1"), { creadas: 0, omitidas: 0, fallidas: 0, restantes: 0, motivo: "no_conectada" });
  modo = "explota";
  assert.deepEqual(await sincronizarCitasFuturasAGoogle("c1"), { creadas: 0, omitidas: 0, fallidas: 0, restantes: 0, motivo: "error" });
});
