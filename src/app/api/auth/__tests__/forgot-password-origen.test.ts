/**
 * Seguridad admin-auth (auditoría «cloudflare», nº6) — el enlace de «recuperar contraseña» ya no sale del
 * header Origin.
 *
 * Run: npm run test:seg-admin-auth
 *
 * Antes: `POST /api/auth/forgot-password` con `Origin: https://evil.example` (curl) hacía que Supabase
 * mandara a la víctima un correo de verdad con `redirect_to=https://evil.example/auth/confirm…`. Ahora el
 * origen sale de una lista fija del servidor; el Origin solo elige dentro de ella. Handler real con dobles
 * por Module._load (sin red, sin Supabase).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

process.env.NEXT_PUBLIC_APP_URL = "https://www.dalecontrol.com";
delete process.env.NEXT_PUBLIC_SITE_URL;
delete process.env.AUTH_ORIGENES_EXTRA;

const pedidos: Array<{ email: string; redirectTo?: string }> = [];
beforeEach(() => { pedidos.length = 0; delete process.env.AUTH_ORIGENES_EXTRA; });

const dobles: Record<string, unknown> = {
  "@/lib/supabase/server": {
    createClient: async () => ({
      auth: {
        resetPasswordForEmail: async (email: string, o: { redirectTo?: string }) => {
          pedidos.push({ email, redirectTo: o.redirectTo });
          return { error: null };
        },
      },
    }),
  },
  "@/lib/failban": { persistentRateLimit: async () => null },
  "@/lib/safe-log": { logError: () => {} },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

async function pedir(origin?: string) {
  const { POST } = await import("../forgot-password/route");
  const { NextRequest } = await import("next/server");
  const h: Record<string, string> = { "content-type": "application/json" };
  if (origin) h.origin = origin;
  const res = await POST(new NextRequest("http://127.0.0.1:3300/api/auth/forgot-password", {
    method: "POST", headers: h, body: JSON.stringify({ email: "victima@example.test" }),
  }));
  assert.equal(res.status, 200);
  return pedidos.at(-1)!.redirectTo!;
}

test("🔴 Origin del atacante → el enlace del correo va al dominio de DaleControl, no al suyo", async () => {
  for (const malo of ["https://evil.example", "https://www.dalecontrol.com.evil.example", "https://evil.vercel.app", "http://www.dalecontrol.com", "null"]) {
    const r = await pedir(malo);
    assert.equal(r, "https://www.dalecontrol.com/auth/confirm?next=/reset-password", `Origin ${malo}`);
  }
});

test("sin Origin, al canónico (antes: el origen interno del servidor, 127.0.0.1:3300)", async () => {
  assert.equal(await pedir(), "https://www.dalecontrol.com/auth/confirm?next=/reset-password");
});

test("desde un dominio nuestro, vuelve a ESE dominio (la cookie PKCE es de host)", async () => {
  assert.equal(await pedir("https://dalecontrol.com"), "https://dalecontrol.com/auth/confirm?next=/reset-password");
  assert.equal(await pedir("https://mediflow-pi.vercel.app"), "https://mediflow-pi.vercel.app/auth/confirm?next=/reset-password");
});

test("un panel autoalojado entra solo si está en AUTH_ORIGENES_EXTRA, y exacto", async () => {
  const panel = "https://panel.108-181-149-131.sslip.io";
  assert.equal(await pedir(panel), "https://www.dalecontrol.com/auth/confirm?next=/reset-password");
  process.env.AUTH_ORIGENES_EXTRA = `${panel}, https://otro.example`;
  assert.equal(await pedir(panel), `${panel}/auth/confirm?next=/reset-password`);
  assert.equal(await pedir("https://x.108-181-149-131.sslip.io"), "https://www.dalecontrol.com/auth/confirm?next=/reset-password");
});

test("origenesPermitidos: el canónico es NEXT_PUBLIC_APP_URL; sin él, www.dalecontrol.com", async () => {
  const { origenesPermitidos, origenParaEnlaceDeAuth } = await import("@/lib/auth/origen-de-enlaces");
  assert.equal(origenesPermitidos({ NEXT_PUBLIC_APP_URL: "https://app.example/ruta" })[0], "https://app.example");
  assert.equal(origenParaEnlaceDeAuth("https://evil.example", {}), "https://www.dalecontrol.com");
  assert.equal(origenParaEnlaceDeAuth("javascript:alert(1)", {}), "https://www.dalecontrol.com");
});
