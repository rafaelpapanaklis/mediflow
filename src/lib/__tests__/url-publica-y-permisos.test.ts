/**
 * ws1-t3 (revisión final, H11 y H14).
 *
 * Run: npx tsx --test src/lib/__tests__/url-publica-y-permisos.test.ts
 *
 *  · H11 — los redirects a /login salen con el origen PÚBLICO, no con el
 *    interno (`https://localhost:3301/login` tras «Crea tu contraseña»).
 *  · H14 — un 403 de permiso dice en español qué falta; y la factura no pinta
 *    los botones de cobro a quien no tiene permiso.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { origenPublicoDe, urlPublica, urlPublicaDe } from "../url-publica";
import { mensajeSinPermiso } from "../auth/permissions";
import { denyIfMissingAnyPermission, denyIfMissingPermission } from "../auth/require-permission";

const RAIZ = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const cab = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

test("origenPublicoDe: manda x-forwarded-host/proto, no el origen interno", () => {
  const req = { headers: cab({ "x-forwarded-host": "dev.108-181-149-131.sslip.io", "x-forwarded-proto": "https", host: "localhost:3301" }) };
  assert.equal(origenPublicoDe(req, "http://localhost:3301/dashboard"), "https://dev.108-181-149-131.sslip.io");
});

test("origenPublicoDe: cadena de proxies → el primero; sin x-forwarded usa host; sin nada, el interno (Vercel/dev a pelo)", () => {
  assert.equal(
    origenPublicoDe({ headers: cab({ "x-forwarded-host": "a.example, b.interno", "x-forwarded-proto": "https, http" }) }, "http://localhost:3301/x"),
    "https://a.example",
  );
  assert.equal(origenPublicoDe({ headers: cab({ host: "panel.example" }) }, "https://localhost:3301/x"), "https://panel.example");
  assert.equal(origenPublicoDe({ headers: cab({}) }, "http://localhost:3000/x"), "http://localhost:3000");
});

test("urlPublicaDe arma /login con el host público", () => {
  const req = { url: "http://localhost:3301/api/auth/logout", headers: cab({ "x-forwarded-host": "dev.example.io", "x-forwarded-proto": "https" }) };
  assert.equal(urlPublicaDe(req, "/login").toString(), "https://dev.example.io/login");
});

test("urlPublica (middleware): quita el puerto interno y pone el protocolo público", () => {
  const nextUrl = new URL("http://localhost:3301/dashboard/team?x=1") as URL & { clone(): URL };
  nextUrl.clone = () => new URL(nextUrl.toString());
  const url = urlPublica({ nextUrl, headers: cab({ "x-forwarded-host": "dev.example.io", "x-forwarded-proto": "https" }) });
  url.pathname = "/login";
  assert.equal(url.origin + url.pathname, "https://dev.example.io/login");
  assert.equal(url.port, "");
});

test("ningún redirect de auth/middleware se arma con request.url / nextUrl a pelo", () => {
  for (const rel of [
    "src/lib/supabase/middleware.ts",
    "src/app/auth/confirm/route.ts",
    "src/app/api/auth/callback/route.ts",
    "src/app/api/auth/logout/route.ts",
    "src/app/r/[code]/route.ts",
    "src/app/api/barber/affiliates/r/[code]/route.ts",
    "src/app/api/admin/impersonate/route.ts",
  ]) {
    const src = leer(rel);
    assert.match(src, /url-publica/, `${rel} no usa el origen público`);
    assert.doesNotMatch(src, /NextResponse\.redirect\(new URL\([^)]*(request|req)\.url/, `${rel} redirige con la URL interna`);
    assert.doesNotMatch(src, /nextUrl\.origin/, `${rel} usa nextUrl.origin`);
  }
  const mw = leer("src/middleware.ts");
  assert.match(mw, /import \{ urlPublica \} from "@\/lib\/url-publica"/);
  assert.doesNotMatch(mw, /function urlPublica/, "una sola implementación");
});

test("mensajeSinPermiso: español, dice qué falta y a quién pedirlo, sin la llave técnica", () => {
  assert.equal(mensajeSinPermiso(["billing.charge"]), "No tienes permiso para cobrar. Pídeselo al administrador.");
  assert.match(mensajeSinPermiso(["billing.deposit.register", "billing.charge"]), /registrar anticipos recibidos ni para cobrar/);
  assert.doesNotMatch(mensajeSinPermiso(["agenda.edit"]), /agenda\.edit/);
  assert.match(mensajeSinPermiso(["agenda.edit"]), /Editar\/mover citas/);
});

test("el 403 lleva el mensaje en `error` y la llave en `permiso`", async () => {
  const sin = { role: "DOCTOR", permissionsOverride: [] as string[] };
  const r = denyIfMissingPermission(sin, "billing.charge")!;
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: "No tienes permiso para cobrar. Pídeselo al administrador.", permiso: "billing.charge" });
  const r2 = denyIfMissingAnyPermission({ role: "READONLY", permissionsOverride: [] }, ["billing.deposit.register", "billing.charge"])!;
  const b2 = await r2.json();
  assert.equal(b2.permiso, "billing.deposit.register o billing.charge");
  assert.doesNotMatch(b2.error, /billing\./);
});

test("Sabina sigue leyendo la llave del 403 (campo `permiso` o el texto viejo)", () => {
  assert.match(leer("src/lib/sabina/engine-acciones.ts"), /cuerpo\.permiso/);
  assert.match(leer("src/lib/sabina/tools/agenda-respuestas.ts"), /b\.permiso/);
});

test("H14: el detalle de la factura esconde cobrar, marcar pagada, WhatsApp y CFDI a quien no tiene permiso", () => {
  const m = leer("src/components/dashboard/billing/invoice-detail-modal.tsx");
  assert.match(m, /const \[puedeCobrar, setPuedeCobrar\] = useState\(false\)/, "arranca en el lado seguro");
  assert.match(m, /const cobrable = rediseno && puedeCobrar/, "la sección de métodos de pago");
  assert.match(m, /const botonRegistrarPago = !puedeCobrar \|\|/);
  assert.match(m, /puedeCobrar && [^\n]*!esPlanAPlazos\(condicionesPago\)/, "Marcar pagada");
  assert.match(m, /puedeEnviarRecibo && \(\s*<ButtonNew[\s\S]{0,200}handleSendWhatsApp/, "Enviar por WhatsApp");
  assert.match(m, /\) : puedeTimbrar && \(/, "Facturar (CFDI)");
  const ruta = leer("src/app/api/invoices/[id]/permisos-cobro/route.ts");
  assert.match(ruta, /puedeCobrar: denyIfMissingPermission\(ctx, "billing\.charge"\) === null/);
  assert.match(ruta, /puedeTimbrar: requireAdmin\(ctx\) === null/);
  assert.match(ruta, /clinicId: ctx\.clinicId/, "multi-tenant");
  assert.match(m, /permisos-cobro/);
});

test("H14 (2.ª parte): editar precio/descuento/eliminar borrador, cancelar y reembolsar salen con el permiso que exige su ruta", () => {
  const m = leer("src/components/dashboard/billing/invoice-detail-modal.tsx");
  assert.match(m, /const canEditPrice = \(isPending \|\| isDraft\) && invoice\.paid === 0 && puedeEditar;/);
  assert.match(m, /puedeEditar && \(\s*<ButtonNew[\s\S]{0,120}openSub\("edit-price"\)/);
  assert.match(m, /puedeEditar && \(\s*<ButtonNew[\s\S]{0,120}handleDeleteDraft/);
  assert.match(m, /puedeReembolsar && \(invoice\.paid === 0 \|\| soloAnticipo\)/, "Cancelar factura");
  assert.match(m, /puedeReembolsar && \(\s*<ButtonNew[\s\S]{0,120}openSub\("refund"\)/, "Reembolsar");
  // Las llaves salen de las mismas que exigen las rutas (no inventadas).
  assert.match(leer("src/app/api/invoices/[id]/edit-price/route.ts"), /denyIfMissingPermission\(ctx, "billing\.edit"\)/);
  assert.match(leer("src/app/api/invoices/[id]/cancel/route.ts"), /denyIfMissingPermission\(ctx, "billing\.refund"\)/);
  assert.match(leer("src/app/api/invoices/[id]/refund/route.ts"), /denyIfMissingPermission\(ctx, "billing\.refund"\)/);
  const ruta = leer("src/app/api/invoices/[id]/permisos-cobro/route.ts");
  assert.match(ruta, /puedeEditar: denyIfMissingPermission\(ctx, "billing\.edit"\) === null/);
  assert.match(ruta, /puedeReembolsar: denyIfMissingPermission\(ctx, "billing\.refund"\) === null/);
});

test("H14 (ficha del paciente): «Cobrar», «Timbrar» y «Enviar por WhatsApp» salen según permiso, en la ficha nueva y la vieja", () => {
  const page = leer("src/app/dashboard/patients/[id]/page.tsx");
  assert.match(page, /cobrar: hasPermission\([^)]*\}, "billing\.charge"\)/);
  assert.match(page, /enviar: hasPermission\([^)]*\}, "whatsapp\.send"\)/);
  assert.match(page, /timbrar: user\.role === "ADMIN" \|\| user\.role === "SUPER_ADMIN"/);
  assert.match(page, /permisosCobro=\{permisosCobro\}/);
  const cli = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.equal((cli.match(/puedeCobrar=\{permisosCobro\?\.cobrar !== false\}/g) ?? []).length, 2, "cabecera y rail");
  assert.equal((cli.match(/permisosCobro=\{permisosCobro\}/g) ?? []).length, 2, "facturación nueva y vieja");
  assert.match(leer("src/components/dashboard/patient-detail/hero-card.tsx"), /\{puedeCobrar && \(\s*<button/);
  assert.match(leer("src/components/dashboard/patient-detail/side-cards.tsx"), /finance\.balance > 0 && puedeCobrar/);
  const bt = leer("src/components/dashboard/patient-detail/billing-tab.tsx");
  assert.match(bt, /permisosCobro\?\.timbrar === false \? undefined/);
  assert.match(bt, /permisosCobro\?\.cobrar !== false/);
  const fac = leer("src/components/dashboard/expediente-rediseno/facturacion.tsx");
  assert.match(fac, /puedeCobrar=\{permisosCobro\?\.cobrar === false/);
  assert.match(fac, /puedeTimbrar=\{permisosCobro\?\.timbrar === false/);
  assert.match(fac, /puedeEnviar=\{permisosCobro\?\.enviar !== false\}/);
  assert.match(leer("src/components/dashboard/factura-ficha-rediseno/fichas-factura.tsx"), /const ofreceWhatsApp = puedeEnviar && sePuedeEnviarPorWhatsApp/);
});

test("sanidad: no quedó ningún archivo con dos imports de url-publica", () => {
  const recorre = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? recorre(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  for (const f of recorre(join(RAIZ, "src/app")).concat(recorre(join(RAIZ, "src/lib/supabase")))) {
    const s = readFileSync(f, "utf8");
    if ((s.match(/from "@\/lib\/url-publica"/g) ?? []).length > 1) assert.fail(`${f} importa dos veces`);
  }
});
