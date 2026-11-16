/* ═══════════════════════════════════════════════════════════════════════
   EQUIPO (16-nov): último acceso en cada cuenta y el alta que llega desde
   «Darle acceso al panel» en Barberos.

     npx tsx --tsconfig tsconfig.test.json --test \
       src/components/barber/team/__tests__/equipo-pantalla.test.tsx

   Se pinta el TeamClient real (react-dom/server). El modal se monta en
   portal: aquí se mira el estado inicial con el que nace (el alta abierta
   con rol Barbero y la ficha elegida) leyendo el HTML del propio modal.
   ═══════════════════════════════════════════════════════════════════════ */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { BarberMemberRow, BarberTeamContext } from "@/lib/barber/team";

const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (request.endsWith(".module.css")) {
    const clases = new Proxy({}, { get: (_t, k) => String(k) });
    return { __esModule: true, default: clases };
  }
  if (request.endsWith(".css")) return {};
  if (request === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {} }) };
  // createPortal fuera del navegador: se pinta en su lugar.
  if (request === "react-dom") {
    const real = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
    return { ...real, createPortal: (node: unknown) => node };
  }
  return originalLoad.call(this, request, ...rest);
};
after(() => {
  M._load = originalLoad;
});

function persona(extra: Partial<BarberMemberRow>): BarberMemberRow {
  return {
    id: "u1", barbershopId: "s1", email: "luis@barber.mx", firstName: "Luis", lastName: "R",
    role: "BARBER", barberId: null, barberName: null, isActive: true, lastLogin: null,
    createdAt: "2026-11-01T00:00:00.000Z", isSelf: false,
    permissions: { role: "BARBER", hasOverride: false, added: [], removed: [], states: [] } as unknown as BarberMemberRow["permissions"],
    branchAccessIds: [], noSchedule: false,
    ...extra,
  };
}

const team = {
  selfUserId: "dueno", selfRole: "OWNER", canAssignOwner: true, advancedRoles: true, multiBranch: false,
  planName: "Profesional", canManageBranches: true, grants: [],
} as unknown as BarberTeamContext;

async function pinta(locale: "es" | "en", members: BarberMemberRow[], alta: string | null = null) {
  const { TeamClient } = await import("../team-client");
  const { AdminI18n } = await import("../admin-ui");
  return renderToStaticMarkup(
    createElement(AdminI18n, {
      dict: getBarberDict(locale),
      children: createElement(TeamClient, {
        initialMembers: members,
        team,
        barbers: [
          { id: "ficha-toño", name: "Toño", barbershopId: "s1" },
          { id: "ficha-ajena", name: "Ajeno", barbershopId: "s2" },
        ],
        branches: [{ id: "s1", label: "Centro", isMainBranch: true, isActive: true }],
        activeBranchId: "s1",
        isConsolidated: false,
        initialInviteBarberId: alta,
      }),
    }),
  );
}

test("cada cuenta dice su último acceso, o «Nunca ha entrado»", async () => {
  const html = await pinta("es", [persona({ lastLogin: "2026-11-14T18:00:00.000Z" }), persona({ id: "u2", email: "x@y.mx" })]);
  assert.match(html, /Último acceso: 14 nov 2026/);
  assert.match(html, /Nunca ha entrado/);
});

test("en inglés: «Last sign in» / «Never signed in»", async () => {
  const html = await pinta("en", [persona({ lastLogin: "2026-11-14T18:00:00.000Z" }), persona({ id: "u2" })]);
  assert.match(html, /Last sign in: Nov 14, 2026/);
  assert.match(html, /Never signed in/);
});

test("la pantalla dice qué es Barberos y liga a ella", async () => {
  const html = await pinta("es", [persona({})]);
  assert.match(html, /Las fichas de quienes cortan/);
  assert.match(html, /href="\/barber\/barberos"/);
});

test("?alta=<ficha> abre el alta con rol Barbero y esa ficha elegida", async () => {
  const html = await pinta("es", [persona({})], "ficha-toño");
  assert.match(html, /Dar de alta en el panel/);
  assert.match(html, /<option value="BARBER" selected="">/);
  assert.match(html, /<option value="ficha-toño" selected="">Toño<\/option>/);
});

test("?alta= con una ficha que no está en la lista de la sesión no abre nada", async () => {
  const html = await pinta("es", [persona({})], "no-existe");
  assert.doesNotMatch(html, /Dar de alta en el panel/);
});
