/**
 * ws1-t5 — el armazón del panel (sidebar-counts, insights) hace 15-19
 * consultas por pantalla, en TODAS las pantallas, cada 60 s, sin caché
 * (ver ~/gerentes/salidas/MAPA-conexiones.md §6.1). `cachedByKey` es el TTL
 * corto que evita repetir la consulta cuando dos peticiones de la misma
 * clínica caen en la misma instancia dentro de esa ventana.
 *
 * Run: npm run test:route-cache
 *
 * Antes de este archivo, `../route-cache` no existía: falla con
 * "Cannot find module '../route-cache'" contra `origin/main`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedByKey, invalidateCachedKey } from "../route-cache";

test("dentro del TTL, dos llamadas con la misma clave solo cargan una vez", async () => {
  let calls = 0;
  const load = async () => { calls++; return calls; };

  const a = await cachedByKey("clinic-1", 1000, load);
  const b = await cachedByKey("clinic-1", 1000, load);

  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1);
});

test("pasado el TTL, vuelve a cargar", async () => {
  let calls = 0;
  const load = async () => { calls++; return calls; };

  await cachedByKey("clinic-2", 20, load);
  await new Promise((r) => setTimeout(r, 40));
  const b = await cachedByKey("clinic-2", 20, load);

  assert.equal(b, 2);
  assert.equal(calls, 2);
});

test("dos clínicas distintas nunca comparten caché (no cruza tenants)", async () => {
  const load = async (n: number) => n;

  const a = await cachedByKey("clinic-a", 1000, () => load(1));
  const b = await cachedByKey("clinic-b", 1000, () => load(2));

  assert.equal(a, 1);
  assert.equal(b, 2);
});

test("invalidateCachedKey fuerza una recarga inmediata (p. ej. tras marcar insights como leídos)", async () => {
  let calls = 0;
  const load = async () => { calls++; return calls; };

  await cachedByKey("clinic-3", 10_000, load);
  invalidateCachedKey("clinic-3");
  const b = await cachedByKey("clinic-3", 10_000, load);

  assert.equal(b, 2);
  assert.equal(calls, 2);
});

test("una carga que falla no queda cacheada: la siguiente llamada reintenta", async () => {
  let calls = 0;
  const load = async () => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return calls;
  };

  await assert.rejects(() => cachedByKey("clinic-4", 10_000, load));
  const b = await cachedByKey("clinic-4", 10_000, load);

  assert.equal(b, 2);
  assert.equal(calls, 2);
});
