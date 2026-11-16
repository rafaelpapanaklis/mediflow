/* ═══════════════════════════════════════════════════════════════════════
   SUELDO en la tarjeta de Barberos (ws6-t6).

     npx tsx --tsconfig tsconfig.test.json --test \
       src/components/barber/team/__tests__/sueldo-en-barberos.test.tsx

   «Sueldo · $3,000 semanal» cuando cobra por Sueldo con monto; «Sueldo» a
   secas sin monto; y nada de sueldo en la tarjeta de quien cobra a comisión
   aunque lo tenga guardado. Se pinta el componente real (react-dom/server).
   ═══════════════════════════════════════════════════════════════════════ */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { BarberProfileRow } from "@/lib/barber/team";

const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  // CSS module: cualquier clase es su propio nombre.
  if (request.endsWith(".module.css")) {
    const clases = new Proxy({}, { get: (_t, k) => String(k) });
    return { __esModule: true, default: clases };
  }
  if (request.endsWith(".css")) return {};
  if (request === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {} }) };
  return originalLoad.call(this, request, ...rest);
};
after(() => {
  M._load = originalLoad;
});

function barbero(extra: Partial<BarberProfileRow>): BarberProfileRow {
  return {
    id: "b1", barbershopId: "s1", name: "Toño", nickname: null, photoUrl: null, bio: null,
    commissionType: "SALARY", commissionPct: null, chairRent: null, isActive: true, sortOrder: 0,
    createdAt: "2026-11-01T00:00:00.000Z", linkedUserIds: [], noSchedule: false,
    salaryAmount: null, salaryPeriod: null,
    ...extra,
  };
}

async function pinta(locale: "es" | "en", rows: BarberProfileRow[]): Promise<string> {
  const { BarbersClient } = await import("../barbers-client");
  const { AdminI18n } = await import("../admin-ui");
  return renderToStaticMarkup(
    createElement(AdminI18n, {
      dict: getBarberDict(locale),
      children: createElement(BarbersClient, {
        initialBarbers: rows,
        seat: { used: rows.length, max: 10, unlimited: true, canCreate: true, planName: "Profesional" },
        branches: [{ id: "s1", label: "Centro", isMainBranch: true, isActive: true }],
        activeBranchId: "s1",
        isConsolidated: false,
        salaryReady: true,
      }),
    }),
  );
}

test("«Sueldo · $3,000 semanal» en la tarjeta", async () => {
  const html = await pinta("es", [barbero({ salaryAmount: 3000, salaryPeriod: "WEEKLY" })]);
  assert.match(html, /Sueldo · \$3,000 semanal/);
});

test("sin monto, «Sueldo» a secas (como hoy)", async () => {
  const html = await pinta("es", [barbero({})]);
  assert.match(html, />Sueldo</);
  assert.doesNotMatch(html, /semanal|quincenal|mensual/);
});

test("a comisión con sueldo guardado: la tarjeta dice su comisión, no el sueldo", async () => {
  const html = await pinta("es", [barbero({ commissionType: "COMMISSION", commissionPct: 40, salaryAmount: 4500, salaryPeriod: "BIWEEKLY" })]);
  assert.match(html, /40%/);
  assert.doesNotMatch(html, /quincenal/);
});

test("en inglés: «Salary · $9,000 monthly»", async () => {
  const html = await pinta("en", [barbero({ salaryAmount: 9000, salaryPeriod: "MONTHLY" })]);
  assert.match(html, /\$9,000 monthly/);
});
