/**
 * Equipo — el selector de rol del modal «Editar»: el dueño ya no ve una trampa.
 *
 * `npm run test:team-dueno-edita`
 *
 * Se PINTA el selector con React (como `hero-card-rediseno.test.tsx`), con los
 * colores de siempre y con los del rediseño (`--m2-*`), y se comprueba lo que la
 * persona ve:
 *   · dueño      → una sola tarjeta, «Super Admin», sin botón «Doctor» al que tocar;
 *   · uno mismo  → su rol marcado, los tres botones deshabilitados;
 *   · otro miembro / alta → los tres botones, activos.
 * Y que `team-client.tsx` lo usa en las dos pantallas (no quedó la lista vieja).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Stethoscope, Shield, ClipboardList, ShieldCheck } from "lucide-react";

import { SelectorDeRol, type OpcionDeRol } from "@/app/dashboard/team/selector-de-rol";
import { TEXTOS_EQUIPO } from "@/app/dashboard/team/textos-equipo";

const opciones: OpcionDeRol[] = [
  { value: "DOCTOR", label: "Doctor/a", desc: "Sus pacientes y citas", icon: Stethoscope },
  { value: "ADMIN", label: "Administrador/a", desc: "Acceso completo", icon: Shield },
  { value: "RECEPTIONIST", label: "Recepción", desc: "Agenda y citas", icon: ClipboardList },
];
const tarjetaDueno: OpcionDeRol = { value: "SUPER_ADMIN", label: "Super Admin", desc: "Dueño de la cuenta", icon: ShieldCheck };

const COLORES = {
  hoy: { acento: "var(--brand)", acentoSuave: "var(--brand-soft)", bordeSuave: "var(--border-soft)" },
  rediseno: { acento: "var(--m2-activo)", acentoSuave: "var(--m2-iniciales-fondo)", bordeSuave: "var(--m2-tarjeta-borde)" },
};

function pintar(valor: string, bloqueo: "dueno" | "propio" | null, colores = COLORES.hoy): string {
  return renderToStaticMarkup(
    <SelectorDeRol
      etiqueta="Rol" opciones={opciones} valor={valor} onCambiar={() => {}} bloqueo={bloqueo}
      ayuda={bloqueo === "dueno" ? "AYUDA-DUENO" : "AYUDA-PROPIO"} tarjetaDueno={tarjetaDueno} {...colores}
    />,
  );
}

const botones = (html: string) => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);

for (const [nombre, colores] of Object.entries(COLORES)) {
  test(`dueño (${nombre}): una sola tarjeta «Super Admin», deshabilitada y marcada; ni Doctor, ni Administrador, ni Recepción`, () => {
    const html = pintar("SUPER_ADMIN", "dueno", colores);
    const bs = botones(html);
    assert.equal(bs.length, 1);
    assert.match(bs[0], /data-rol="SUPER_ADMIN"/);
    assert.match(bs[0], /disabled/);
    assert.match(bs[0], /aria-pressed="true"/);
    assert.match(html, /Super Admin/);
    assert.match(html, /Dueño de la cuenta/);
    assert.match(html, /AYUDA-DUENO/);
    for (const r of ["Doctor/a", "Administrador/a", "Recepción"]) assert.equal(html.includes(r), false, r);
    assert.match(html, new RegExp(colores.acento.replace(/[()]/g, "\\$&")), "usa los colores de su pantalla");
  });

  test(`uno mismo (${nombre}): su rol marcado y los tres botones deshabilitados`, () => {
    const html = pintar("ADMIN", "propio", colores);
    const bs = botones(html);
    assert.equal(bs.length, 3);
    for (const b of bs) assert.match(b, /disabled/);
    assert.match(bs.find((b) => b.includes('data-rol="ADMIN"'))!, /aria-pressed="true"/);
    assert.match(bs.find((b) => b.includes('data-rol="DOCTOR"'))!, /aria-pressed="false"/);
    assert.match(html, /AYUDA-PROPIO/);
  });

  test(`otro miembro o alta (${nombre}): los tres botones activos y sin texto de ayuda`, () => {
    const html = pintar("DOCTOR", null, colores);
    const bs = botones(html);
    assert.equal(bs.length, 3);
    for (const b of bs) assert.equal(b.includes("disabled"), false);
    assert.equal(html.includes("AYUDA"), false);
    assert.match(html, /data-selector-de-rol="libre"/);
  });
}

test("team-client usa el selector nuevo en alta y edición y ya no pinta la lista de roles a mano", () => {
  const src = readFileSync(join(__dirname, "..", "..", "..", "..", "app", "dashboard", "team", "team-client.tsx"), "utf8");
  assert.match(src, /<SelectorDeRol/);
  assert.match(src, /motivoRolFijo\(\{ esEdicion: isEdit, rol: form\.role, esYo \}\)/, "el selector sale del mismo motivo que el parche");
  assert.equal(src.includes("ROLES.map(r => (\n            <button"), false, "quedó el selector viejo");
  // El guardado nunca manda el rol cuando no se puede cambiar.
  assert.match(src, /parcheDeCambios\(formInicial, datosActuales, \{ rolFijo \}\)/);
  // Las dos pantallas (con y sin rediseño) comparten el mismo formulario.
  assert.equal((src.match(/<MemberForm/g) ?? []).length, 2, "alta y edición");
  assert.equal((src.match(/esYo=\{/g) ?? []).length, 2);
});

test("los textos nuevos existen en español e inglés, con las mismas claves", () => {
  const claves = ["rolDuenoDesc", "rolDuenoAyuda", "rolPropioAyuda", "atiendeTitulo", "atiendeDesc"] as const;
  for (const c of claves) {
    assert.equal(typeof TEXTOS_EQUIPO.es[c], "string", `es.${c}`);
    assert.equal(typeof TEXTOS_EQUIPO.en[c], "string", `en.${c}`);
    assert.notEqual(TEXTOS_EQUIPO.es[c], TEXTOS_EQUIPO.en[c], `${c} sin traducir`);
  }
  assert.match(TEXTOS_EQUIPO.es.rolDuenoAyuda, /cédulas/);
});

test("la casilla «Atiende pacientes» solo sale al editar y a quien tiene agenda propia", () => {
  const src = readFileSync(join(__dirname, "..", "..", "..", "..", "app", "dashboard", "team", "team-client.tsx"), "utf8");
  assert.match(src, /isEdit && puedeMarcarAtiende\(form\.role\) && \(/);
  assert.match(src, /ofreceHorario\(m\)/, "el botón Horario sale también para el dueño que atiende");
  assert.equal(src.includes('puedeHorario && m.role === "DOCTOR"'), false);
});
