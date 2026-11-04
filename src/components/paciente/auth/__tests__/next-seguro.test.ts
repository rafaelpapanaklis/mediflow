/**
 * Seguridad admin-auth (auditoría «cloudflare», nº17) — el `?next=` del portal del paciente ya no saca al
 * paciente del sitio.
 *
 * Run: npm run test:seg-admin-auth
 *
 * `useSearchParams` decodifica: `?next=%2F%09%2Fevil.example` llega como "/<TAB>/evil.example". El viejo
 * `safeNext` solo miraba que empezara por "/" y no por "//" o "/\", así que pasaba; el navegador quita el
 * tabulador al resolver `location.assign` y queda "//evil.example": fuera del sitio justo después de
 * entrar. Ahora las cuatro copias (login, verificar, registro, recuperar) y `safeNextPath` de la reserva
 * usan `rutaInternaSegura`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// Los formularios son componentes de cliente: lo que no es la regla se dobla (sin DOM, sin Next).
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  if (req === "next/navigation") return { useRouter: () => ({}), useSearchParams: () => new URLSearchParams() };
  if (req === "next/link") return { __esModule: true, default: () => null };
  return cargaOriginal.call(this, req, ...r);
};

const BASE = "https://www.dalecontrol.com";
const MALOS = [
  "/\t/evil.example", // %2F%09%2Fevil.example
  "/\n/evil.example",
  "/\r/evil.example",
  "/\t\\evil.example",
  "//evil.example",
  "/\\evil.example",
  "https://evil.example",
  "javascript:alert(1)",
  "",
];
const BUENOS = ["/paciente", "/paciente/citas?id=c1", "/reservar/clinica-x?fecha=2026-10-29&hora=10%3A00", "/paciente#pagos"];

async function reglas(): Promise<Array<[string, (raw: string) => string | null]>> {
  return [
    ["login-form", (await import("../login-form")).safeNext],
    ["verificar-form", (await import("../verificar-form")).safeNext],
    ["registro-form", (await import("../registro-form")).safeNext],
    ["recuperar-form", (await import("../recuperar-form")).safeNext],
    ["booking-auth", (await import("@/lib/patient-portal/booking-auth")).safeNextPath],
  ];
}

test("así ataca: el navegador (WHATWG URL) quita el tabulador y «/<TAB>/evil» es otro host", () => {
  assert.equal(new URL("/\t/evil.example", BASE).host, "evil.example");
  assert.equal(new URL(decodeURIComponent("%2F%09%2Fevil.example"), BASE).host, "evil.example");
});

test("🔴 los cinco filtros de ?next= rechazan tabulador, salto, //, /\\ y esquemas ajenos", async () => {
  for (const [nombre, f] of await reglas()) {
    assert.equal(typeof f, "function", `${nombre} no exporta su filtro`);
    for (const malo of MALOS) assert.equal(f(malo), null, `${nombre} dejó pasar ${JSON.stringify(malo)}`);
  }
});

test("las rutas internas de siempre siguen pasando, y nada de lo que pasa sale del sitio", async () => {
  for (const [nombre, f] of await reglas()) {
    for (const bueno of BUENOS) {
      assert.equal(f(bueno), bueno, `${nombre} rechazó ${bueno}`);
      assert.equal(new URL(f(bueno)!, BASE).origin, BASE);
    }
  }
});
