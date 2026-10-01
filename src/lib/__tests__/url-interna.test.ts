/**
 * B10 (auditoría 30-sep-2026) — redirección abierta en el callback OAuth y
 * `mapsUrl` con `javascript:`.
 *
 * Run: npm run test:seguridad-rapidos
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { normalizarUrlWeb, rutaInternaSegura } from "../url-interna";

// ═══ Piezas puras ═══════════════════════════════════════════════════════════
test("rutaInternaSegura: acepta rutas internas con query y hash", () => {
  for (const ok of ["/dashboard", "/dashboard/agenda?x=1#y", "/reset-password", "/a/b/c"]) {
    assert.equal(rutaInternaSegura(ok), ok);
  }
});

test("rutaInternaSegura: todo lo que salga del sitio cae al respaldo", () => {
  for (const malo of [
    "@evil.example", ".evil.example", "evil.example", "https://evil.example", "http://evil.example/x",
    "//evil.example", "/\\evil.example", "/\\/evil.example", "javascript:alert(1)", "/ok\nSet-Cookie: x=1",
    "/ok\r\n", "", "   ", "dashboard", "\\\\evil.example", "/\u0000", null, undefined,
  ]) {
    assert.equal(rutaInternaSegura(malo as any), "/dashboard", String(malo));
  }
  assert.equal(rutaInternaSegura("@evil.example", "/otra"), "/otra");
});

test("normalizarUrlWeb: http/https y sin esquema (se le pone https://)", () => {
  assert.equal(normalizarUrlWeb("https://maps.app.goo.gl/abc"), "https://maps.app.goo.gl/abc");
  assert.equal(normalizarUrlWeb("http://x.mx/mapa?q=1"), "http://x.mx/mapa?q=1");
  assert.equal(normalizarUrlWeb("  maps.app.goo.gl/abc  "), "https://maps.app.goo.gl/abc");
  assert.equal(normalizarUrlWeb("goo.gl:443/x"), "https://goo.gl:443/x");
});

test("normalizarUrlWeb: javascript:, data:, vbscript:, file:, vacío y con espacios se rechazan", () => {
  for (const malo of [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<script>1</script>",
    "vbscript:msgbox(1)", "file:///etc/passwd", "", "   ", "https://a b.com", "https://x.mx/a\nb", null, 5, {},
  ]) {
    assert.equal(normalizarUrlWeb(malo as any), null, String(malo));
  }
});

// ═══ Callback OAuth ══════════════════════════════════════════════════════════
let usuariosDeClinica: Array<{ clinicId: string }>;
let sesionOk: boolean;

beforeEach(() => {
  usuariosDeClinica = [{ clinicId: "c1" }];
  sesionOk = true;
});

(mock as any).module("@/lib/supabase/server", {
  namedExports: {
    createClient: () => ({
      auth: {
        exchangeCodeForSession: async () =>
          sesionOk ? { data: { user: { id: "sb1", email: "a@b.mx" } }, error: null } : { data: {}, error: new Error("x") },
      },
    }),
  },
});
(mock as any).module("@/lib/prisma", {
  namedExports: { prisma: { user: { findMany: async () => usuariosDeClinica } } },
});
(mock as any).module("@/lib/url-publica", { namedExports: { origenPublicoDe: () => "https://app.test" } });
(mock as any).module("@/lib/active-clinic", {
  namedExports: {
    writeActiveClinicCookie: () => undefined,
    readActiveClinicCookie: () => null,
    pickActiveClinicId: () => ({ clinicId: "c1" }),
  },
});
(mock as any).module("@/lib/auth/two-factor-cookie", { namedExports: { applyTwoFactorLoginCookies: async () => undefined } });

const llamar = async (next: string | null) => {
  const { GET } = await import("@/app/api/auth/callback/route");
  const q = new URLSearchParams({ code: "c" });
  if (next !== null) q.set("next", next);
  return GET({ url: `https://app.test/api/auth/callback?${q.toString()}` } as any);
};

test("callback OAuth: next interno se respeta", async () => {
  const res = await llamar("/dashboard/agenda?x=1");
  assert.equal(res.headers.get("location"), "https://app.test/dashboard/agenda?x=1");
});

test("callback OAuth: un next que saltaría a otro sitio cae a /dashboard", async () => {
  for (const malo of ["@evil.example", ".evil.example", "//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)"]) {
    const res = await llamar(malo);
    const destino = res.headers.get("location")!;
    assert.equal(destino, "https://app.test/dashboard", malo);
    assert.equal(new URL(destino).host, "app.test", malo);
  }
});

test("callback OAuth: sin next va a /dashboard", async () => {
  assert.equal((await llamar(null)).headers.get("location"), "https://app.test/dashboard");
});
