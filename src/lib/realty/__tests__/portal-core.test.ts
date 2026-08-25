// ═══════════════════════════════════════════════════════════════════════
// NÚCLEO DEL PORTAL DEL CLIENTE — la red que impide romperlo sin enterarse.
//
// Estas pruebas son ESTÁTICAS y PURAS: no necesitan Postgres, ni navegador,
// ni sesión. Corren en menos de un segundo.
//
//   npx tsx --test src/lib/realty/__tests__/portal-core.test.ts
//
// 🔴 POR QUÉ EXISTEN. Tres de estas comprobaciones nacieron de bugs reales
// encontrados en la revisión de la propia ola:
//
//   1. `packPortalSession` escribía SEIS campos en la cookie y
//      `readPortalSession` leía CINCO. La caducidad se leía del campo
//      equivocado, así que toda cookie recién emitida salía caducada y
//      NADIE podía entrar — pero el síntoma era "entro y me saca al login",
//      indistinguible de "el código no sirvió". No lo atrapa ni el
//      compilador ni el build: solo un ida y vuelta.
//
//   2. `sinComisionPactada` se calculaba dentro del bucle de COBROS, así
//      que un mes sin pagos imprimía "no hay comisión pactada en tus
//      inmuebles" en el PDF que el propietario guarda para reclamar,
//      siendo falso.
//
//   3. La suma de las líneas por inmueble tiene que dar EXACTAMENTE el
//      total. Con floats y un 7.5%, no es gratis.
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PORTAL_SESSION_MAX_DAYS,
  buildOwnerStatement,
  civilDate,
  civilDaysBetween,
  dueState,
  formatCivilDate,
  formatPeriodMonth,
  isPeriodMonth,
  monthRange,
  normalizeIssueText,
  packPortalSession,
  parsePortalIdentityKey,
  periodMonthOf,
  portalIdentityKey,
  portalOriginMismatch,
  readPortalSession,
  shiftPeriodMonth,
  sniffImageMime,
  sumMoney,
} from "@/lib/realty/portal-core";

const TZ = "America/Mexico_City";

// ── 1. LA COOKIE FIRMADA ───────────────────────────────────────────────

test("la sesión sobrevive el ida y vuelta (si no, nadie puede entrar)", () => {
  const p = packPortalSession("5512345678", { role: "INQUILINO", accountId: "cku123abc" });
  assert.ok(p, "no se pudo firmar");
  const s = readPortalSession(p!.value);
  assert.ok(s, "la cookie recién emitida no se pudo leer — el login entero está roto");
  assert.equal(s!.phone, "5512345678");
  assert.equal(s!.role, "INQUILINO");
  assert.equal(s!.accountId, "cku123abc");
  assert.ok(s!.expiresAt.getTime() > Date.now() + 29 * 86_400_000);
});

test("la sesión a medias (código verificado, cara sin elegir) va y vuelve", () => {
  const p = packPortalSession("5512345678", null)!;
  const s = readPortalSession(p.value);
  assert.ok(s);
  assert.equal(s!.role, null);
  assert.equal(s!.accountId, null);
});

test("una cookie manipulada NO abre nada", () => {
  const p = packPortalSession("5512345678", { role: "INQUILINO", accountId: "cuentaA" })!;
  // Firma cambiada.
  assert.equal(readPortalSession(p.value.slice(0, -4) + "dead"), null);
  // Cuenta cambiada (el ataque obvio: entrar a la cartera de otro).
  assert.equal(readPortalSession(p.value.replace("cuentaA", "cuentaB")), null);
  // Rol cambiado (inquilino que se asciende a propietario).
  assert.equal(readPortalSession(p.value.replace("INQUILINO", "PROPIETARIO")), null);
  // Campos de más.
  assert.equal(readPortalSession("x." + p.value), null);
  assert.equal(readPortalSession(""), null);
  assert.equal(readPortalSession(undefined), null);
});

test("no se firma nada con un teléfono o una cuenta con forma rara", () => {
  assert.equal(packPortalSession("55123", null), null);
  assert.equal(packPortalSession("525512345678", null), null);
  assert.equal(packPortalSession("", null), null);
  // Un accountId con punto rompería el formato del payload.
  assert.equal(packPortalSession("5512345678", { role: "INQUILINO", accountId: "a.b" }), null);
});

test("la sesión caduca, y el techo absoluto no se puede renovar", () => {
  const hace40 = new Date(Date.now() - 40 * 86_400_000);
  assert.equal(readPortalSession(packPortalSession("5512345678", null, hace40, hace40)!.value), null);

  // Renovar (cambio de cara) NO reinicia el techo.
  const vieja = new Date(Date.now() - (PORTAL_SESSION_MAX_DAYS + 1) * 86_400_000);
  assert.equal(packPortalSession("5512345678", null, new Date(), vieja), null);

  const casi = new Date(Date.now() - (PORTAL_SESSION_MAX_DAYS - 5) * 86_400_000);
  const recortada = packPortalSession("5512345678", null, new Date(), casi)!;
  assert.ok(
    recortada.expiresAt.getTime() < Date.now() + 6 * 86_400_000,
    "la renovación se pasó del techo absoluto",
  );
});

// ── 2. IDENTIDAD Y CSRF ────────────────────────────────────────────────

test("la llave de identidad va y vuelve, y rechaza roles inventados", () => {
  assert.deepEqual(parsePortalIdentityKey(portalIdentityKey("PROPIETARIO", "cuenta1")), {
    role: "PROPIETARIO",
    accountId: "cuenta1",
  });
  assert.equal(parsePortalIdentityKey("ADMIN:cuenta1"), null);
  assert.equal(parsePortalIdentityKey("cuenta1"), null);
  assert.equal(parsePortalIdentityKey(42), null);
});

test("el guard de origen falla CERRADO", () => {
  assert.equal(portalOriginMismatch({ origin: "https://a.com", referer: null, host: "a.com" }), false);
  assert.equal(portalOriginMismatch({ origin: "https://malo.com", referer: null, host: "a.com" }), true);
  // Sin Origin ni Referer: se rechaza, no se deja pasar.
  assert.equal(portalOriginMismatch({ origin: null, referer: null, host: "a.com" }), true);
  assert.equal(portalOriginMismatch({ origin: "https://a.com", referer: null, host: null }), true);
});

// ── 3. DINERO ──────────────────────────────────────────────────────────

test("las sumas de dinero no arrastran el error binario", () => {
  assert.equal(sumMoney([0.1, 0.2]), 0.3);
  assert.equal(sumMoney([1234.56, 7890.12, null, undefined, NaN]), 9124.68);
  assert.equal(sumMoney([]), 0);
});

test("el corte del propietario cuadra al centavo con una comisión de 7.5%", () => {
  const st = buildOwnerStatement({
    periodMonth: "2026-08",
    properties: [
      { propertyId: "p1", commissionPct: 7.5 },
      { propertyId: "p2", commissionPct: 7.5 },
      { propertyId: "p3", commissionPct: 7.5 },
    ],
    rents: [
      { propertyId: "p1", amount: 15000, commissionPct: 7.5 },
      { propertyId: "p2", amount: 8333.33, commissionPct: 7.5 },
    ],
    expenses: [
      { propertyId: "p1", amount: 1250.55 },
      { propertyId: "p2", amount: 890.1 },
    ],
  });
  assert.equal(st.cobrado, 23333.33);
  assert.equal(st.gastos, 2140.65);
  assert.equal(st.depositado, sumMoney([st.cobrado, -st.retenido, -st.gastos]));
  // Si la suma de las líneas no da el total, al propietario le sobra o le
  // falta un peso que nadie sabe explicar.
  assert.equal(sumMoney(st.porInmueble.map((p) => p.cobrado)), st.cobrado);
  assert.equal(sumMoney(st.porInmueble.map((p) => p.retenido)), st.retenido);
  assert.equal(sumMoney(st.porInmueble.map((p) => p.depositado)), st.depositado);
  // El inmueble sin movimiento también sale, en ceros.
  assert.equal(st.porInmueble.length, 3);
});

test("sin comisión pactada no se retiene NADA y el corte lo dice", () => {
  const st = buildOwnerStatement({
    periodMonth: "2026-08",
    properties: [{ propertyId: "p1", commissionPct: 0 }],
    rents: [{ propertyId: "p1", amount: 10000, commissionPct: 0 }],
    expenses: [],
  });
  assert.equal(st.retenido, 0);
  assert.equal(st.depositado, 10000);
  assert.equal(st.sinComisionPactada, true);
});

test("un mes sin cobros NO puede decir que no hay comisión pactada", () => {
  const st = buildOwnerStatement({
    periodMonth: "2026-08",
    properties: [{ propertyId: "p1", commissionPct: 7.5 }],
    rents: [],
    expenses: [{ propertyId: "p1", amount: 4500 }],
  });
  assert.equal(
    st.sinComisionPactada,
    false,
    'imprimiría "no hay comisión pactada" en el PDF del propietario, y es falso',
  );
  assert.equal(st.cobrado, 0);
  assert.equal(st.depositado, -4500);
});

// ── 4. FECHAS CIVILES ──────────────────────────────────────────────────

test("el mes se valida y se mueve bien en los dos sentidos", () => {
  assert.equal(isPeriodMonth("2026-08"), true);
  assert.equal(isPeriodMonth("2026-13"), false);
  assert.equal(isPeriodMonth("2026-8"), false);
  assert.equal(shiftPeriodMonth("2026-01", -1), "2025-12");
  assert.equal(shiftPeriodMonth("2026-12", 1), "2027-01");
});

test("el mes se mide en la zona de la inmobiliaria y cruza diciembre→enero", () => {
  const r = monthRange("2025-12", TZ)!;
  assert.ok(r);
  assert.equal(civilDate(r.start, TZ), "2025-12-01");
  assert.equal(civilDate(new Date(r.end.getTime() - 1000), TZ), "2025-12-31");
  assert.equal(periodMonthOf(r.start, TZ), "2025-12");
  assert.equal(monthRange("nada", TZ), null);
});

test("el adeudo se cuenta en días de CALENDARIO, no en múltiplos de 24 horas", () => {
  const hoy = new Date("2026-09-17T18:00:00Z");
  const tarde = dueState(new Date("2026-09-05T18:00:00Z"), hoy, TZ);
  assert.equal(tarde.tone, "retraso");
  assert.equal(tarde.daysLate, 12);

  assert.equal(dueState(new Date("2026-09-17T18:00:00Z"), hoy, TZ).tone, "venceHoy");

  const futuro = dueState(new Date("2026-09-25T18:00:00Z"), hoy, TZ);
  assert.equal(futuro.tone, "porVencer");
  assert.equal(futuro.daysLeft, 8);

  assert.equal(civilDaysBetween("2026-09-05", "2026-09-17"), 12);
  assert.equal(civilDaysBetween("2026-09-17", "2026-09-05"), -12);
});

test("las fechas se pintan en español y una basura no rompe el render", () => {
  assert.ok(formatCivilDate("2026-09-05").includes("septiembre"));
  assert.ok(formatCivilDate("2026-09-05", { withYear: true }).includes("2026"));
  assert.equal(formatCivilDate("basura"), "basura");
  assert.ok(formatPeriodMonth("2026-09").includes("septiembre"));
});

// ── 5. FOTOS DE LA FALLA ───────────────────────────────────────────────

test("el tipo de la foto se lee por firma de bytes, no por el Content-Type", () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(sniffImageMime(jpg), "image/jpeg");
  assert.equal(sniffImageMime(png), "image/png");
  assert.equal(sniffImageMime(webp), "image/webp");
  assert.equal(sniffImageMime(exe), null, "un ejecutable disfrazado de foto NO puede pasar");
  assert.equal(sniffImageMime(new Uint8Array([1, 2])), null);
});

test("un reporte sin nada que se entienda no se acepta", () => {
  assert.equal(normalizeIssueText("corto"), null);
  assert.equal(normalizeIssueText("   "), null);
  assert.equal(normalizeIssueText(null), null);
  assert.equal(
    normalizeIssueText("  se sale el agua del fregadero  "),
    "se sale el agua del fregadero",
  );
});
