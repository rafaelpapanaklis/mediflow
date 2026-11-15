/* ═══════════════════════════════════════════════════════════════════════
   RESERVA SIN TRABAS — el freno por IP es de EMERGENCIA, no una traba.

     npx tsx --test src/lib/barber/__tests__/reserva-sin-trabas.test.ts

   Decisión de Rafael (15-nov-2026): «que dejen reservar a cualquiera sin
   ningún problema». Ya no hay tope diario por barbería (eso se prueba con
   base en reserva-frenos-integration.test.ts) y el freno por IP pasó de 8
   en 10 min para TODO el vertical a 30 en 10 min por barbería.

   Sin base: se usa el campo trampa, que contesta antes de tocar nada pero
   DESPUÉS del freno (así cuenta para el freno sin crear citas).
   ═══════════════════════════════════════════════════════════════════════ */
import "./_sin-server-only";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

async function intento(slug: string, ip: string): Promise<number> {
  const { POST } = await import("@/app/api/barber/public/booking/[slug]/route");
  const res = await POST(
    new NextRequest(`http://x/api/barber/public/booking/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ website: "trampa" }),
    }),
    { params: Promise.resolve({ slug }) },
  );
  return res.status;
}

test("la misma IP puede intentar 30 veces en 10 minutos en una barbería; la 31.ª se frena", async () => {
  const ip = "189.10.20.30";
  for (let i = 1; i <= 30; i++) {
    assert.equal(await intento("barberia-uno", ip), 200, `el intento ${i} no debía frenarse`);
  }
  assert.equal(await intento("barberia-uno", ip), 429);
});

test("el freno es por barbería: la misma IP sigue pudiendo reservar en otra", async () => {
  // La IP de la prueba anterior ya está frenada en «barberia-uno».
  assert.equal(await intento("barberia-uno", "189.10.20.30"), 429);
  assert.equal(await intento("barberia-dos", "189.10.20.30"), 200);
});

test("antes eran 8 para todo el vertical: el 9.º intento ya NO se frena", async () => {
  const ip = "189.99.99.99";
  for (let i = 1; i <= 9; i++) assert.equal(await intento(`barberia-${i}`, ip), 200);
  for (let i = 1; i <= 9; i++) assert.equal(await intento("barberia-tres", ip), 200);
});
