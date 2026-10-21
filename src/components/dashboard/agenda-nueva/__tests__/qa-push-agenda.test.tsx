/**
 * QA DEL PUSH EN LA AGENDA NUEVA (ws1-t6, 20-oct-2026) — lo que Rafael vio con
 * Claude en Chrome en panel.108, Clínica de Prueba QA:
 *  1. «Sin citas» se encimaba con la franja gris «Comida» del doctor;
 *  2. a 390 px el título del Día salía cortado («Martes 20 de o…»);
 *  3. dos citas sobreagendadas lado a lado quedaban en «M» y «J..».
 *
 * Run: npx tsx --tsconfig tsconfig.test.json --test --experimental-test-module-mocks src/components/dashboard/agenda-nueva/__tests__/qa-push-agenda.test.tsx
 *
 * El arnés es el de `agenda-flexible-pintada.test.tsx` (la vista Día de verdad
 * con `renderToStaticMarkup`, CSS Modules como nombre de clase), con tres
 * doctores: Díaz con dos citas encimadas, Soto con comida 13–14 y sin citas,
 * Mora sin nada. (Soto come de 13 a 14 aquí porque el lienzo de la prueba va de
 * 9 a 18 y su centro cae a las 13:30; en panel.108 iba de 9 a 19 y caía a las 14.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const M = Module as any;
M._extensions[".css"] = (m: any) => {
  m.exports = new Proxy({}, { get: (_t, k) => (k === "__esModule" ? false : String(k)) });
};
const cargarOriginal = M._load;
M._load = function (pedido: string, ...resto: unknown[]) {
  if (pedido === "next/navigation") {
    return {
      useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }),
      usePathname: () => "/dashboard/agenda",
      useSearchParams: () => new URLSearchParams(),
      redirect() {},
      notFound() {},
    };
  }
  if (pedido === "next/font/local" || pedido === "next/font/google") {
    const fuente = () => ({ variable: "fuente", className: "fuente", style: {} });
    return new Proxy({ __esModule: true, default: fuente }, { get: (t: any, k) => (k in t ? t[k] : fuente) });
  }
  return cargarOriginal.call(this, pedido, ...resto);
};

const TZ = "America/Mexico_City";
const DIA = "2026-11-10"; // martes

/** Martes a las HH:MM de Ciudad de México (UTC−6), ISO. */
const a = (hhmm: string) => {
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 10, hh! + 6, mm!)).toISOString();
};

function cita(id: string, desde: string, hasta: string, paciente: string, motivo: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    startsAt: a(desde),
    endsAt: a(hasta),
    status: "CONFIRMED",
    patient: { id: `p-${id}`, name: paciente },
    doctor: { id: "d1", shortName: "Dra. Díaz" },
    reason: motivo,
    resourceId: null,
    source: "STAFF",
    requiresValidation: false,
    overrideReason: null,
    ...extra,
  };
}

function payload(flexible: { encendida: boolean; modoColor: "doctor" | "procedimiento" }) {
  return {
    range: { from: a("00:00"), to: a("23:59") },
    timezone: TZ,
    slotMinutes: 30,
    dayStart: 8,
    dayEnd: 20,
    schedules: [{ dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "18:00" }],
    // Las dos encimadas son de la Dra. Díaz; la Dra. Soto (con comida) no tiene ninguna.
    appointments: [
      cita("a-ana", "10:00", "10:30", "Ana García", "Resina"),
      cita("a-eva", "10:00", "10:30", "Eva Paz", "Valoración", { overrideReason: "Sobreagendada por el equipo" }),
    ],
    doctors: [
      { id: "d1", displayName: "Dra. Laura Díaz", shortName: "Dra. Díaz", color: "#2563eb", activeInAgenda: true },
      { id: "d2", displayName: "Dra. Rosa Soto", shortName: "Dra. Soto", color: "#16a34a", activeInAgenda: true },
      { id: "d3", displayName: "Dr. Iván Mora", shortName: "Dr. Mora", color: "#d97706", activeInAgenda: true },
    ],
    resources: [],
    pendingValidation: [],
    waitlistCount: 0,
    bloqueos: [],
    horariosDoctores: {
      // 13:00–14:00: tapa el centro de un lienzo de 9 a 18, que es donde va «Sin citas».
      d2: [{ dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "18:00", lunchStart: "13:00", lunchEnd: "14:00" }],
    },
    agendaFlexible: {
      ...flexible,
      procedimientos: flexible.modoColor === "procedimiento" ? [{ id: "proc-res", nombre: "Resina", color: "azul" }] : [],
    },
  };
}

async function pintar(flexible: { encendida: boolean; modoColor: "doctor" | "procedimiento" }): Promise<string> {
  const { I18nProvider } = await import("@/i18n/i18n-provider");
  const { AgendaProvider } = await import("@/components/dashboard/agenda/agenda-provider");
  const { NewAppointmentProvider } = await import("@/components/dashboard/new-appointment/new-appointment-provider");
  const { AgendaNuevaProvider } = await import("../contexto-agenda-nueva");
  const { ArrastreCitas } = await import("../arrastre-citas");
  const { VistaDia } = await import("../vista-dia");
  const { BarraHerramientas } = await import("../barra-herramientas");
  const es = (await import("@/i18n/dictionaries/es.json")).default;
  const arbol = (hijos: ReactNode) =>
    h(I18nProvider as any, { locale: "es", dict: es },
      h(AgendaProvider as any, { initialPayload: payload(flexible), initialDayISO: DIA, clinicCategory: "DENTAL" },
        h(NewAppointmentProvider as any, null,
          h(AgendaNuevaProvider as any, null, hijos))));
  return renderToStaticMarkup(arbol([h(BarraHerramientas, { key: "b" }), h(ArrastreCitas as any, { key: "a" }, h(VistaDia))]));
}


/** El `<div>` de «Sin citas» de la columna de un doctor. */
function rotuloVacioDe(html: string, doctorId: string): string | undefined {
  const desde = html.indexOf(`data-columna="${doctorId}"`);
  assert.ok(desde >= 0, `hay columna ${doctorId}`);
  const siguiente = html.indexOf("data-columna=", desde + 1);
  const trozo = html.slice(desde, siguiente < 0 ? undefined : siguiente);
  return trozo.match(/<div class="columnaVacia[^"]*"[^>]*>Sin citas<\/div>/)?.[0];
}

test("1 · «Sin citas» no cae encima de la comida: va al hueco libre más grande", async () => {
  const { minutoDelRotuloVacio } = await import("../rotulo-vacio");
  const html = await pintar({ encendida: true, modoColor: "doctor" });
  const soto = rotuloVacioDe(html, "d2");
  assert.ok(soto, "la columna con comida sigue diciendo «Sin citas»");
  assert.match(soto!, /columnaVaciaEnHueco/, "colocado aparte, no centrado");
  // Su `top` cae fuera de la franja de comida de ESA columna, con aire.
  const desde = html.indexOf('data-columna="d2"');
  const franja = html.slice(desde).match(/<div class="franjaComida"[^>]*style="top:([\d.]+)px;height:([\d.]+)px/);
  assert.ok(franja, "la columna de Soto tiene su comida");
  const [arriba, alto] = [Number(franja![1]), Number(franja![2])];
  const top = Number(soto!.match(/top:([\d.]+)px/)?.[1]);
  assert.ok(top < arriba - 20 || top > arriba + alto + 20, `«Sin citas» en ${top}px, comida en ${arriba}–${arriba + alto}px`);
  assert.equal(minutoDelRotuloVacio({ desdeMin: 540, hastaMin: 1080 }, [{ desdeMin: 840, hastaMin: 900 }], 860), 690);
  const mora = rotuloVacioDe(html, "d3");
  assert.ok(mora, "la columna sin comida también lo dice");
  assert.doesNotMatch(mora!, /columnaVaciaEnHueco|style=/, "y ahí sigue centrado, como siempre");
});

test("1 · minutoDelRotuloVacio: centro si nada lo pisa, hueco mayor si sí, nada si no cabe", async () => {
  const { minutoDelRotuloVacio } = await import("../rotulo-vacio");
  const abierto = { desdeMin: 540, hastaMin: 1080 };
  assert.equal(minutoDelRotuloVacio(abierto, [], 840), "centro");
  assert.equal(minutoDelRotuloVacio(abierto, [{ desdeMin: 600, hastaMin: 660 }], 840), "centro", "una comida lejos no lo mueve");
  assert.equal(minutoDelRotuloVacio(abierto, [{ desdeMin: 845, hastaMin: 900 }], 840), 692.5, "una que empieza justo debajo sí (9:00–14:05 libre)");
  // Dos franjas: 9–10 libre (60), 11–13 libre (120), 15–18 libre (180) → 16:30.
  assert.equal(
    minutoDelRotuloVacio(abierto, [{ desdeMin: 780, hastaMin: 900 }, { desdeMin: 600, hastaMin: 660 }], 840),
    990,
  );
  assert.equal(minutoDelRotuloVacio(abierto, [{ desdeMin: 0, hastaMin: 1440 }], 840), null, "bloqueo de día entero: no se pinta");
  assert.equal(minutoDelRotuloVacio(abierto, [{ desdeMin: 540, hastaMin: 1075 }], 840), null, "5 min libres no alcanzan");
});

test("2 · el título del Día tiene versión corta («Mar 10 nov») y conserva la larga para el lector", async () => {
  const html = await pintar({ encendida: true, modoColor: "doctor" });
  const h1 = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)?.[0];
  assert.ok(h1, "hay título");
  assert.match(h1!, /title="Martes 10 de noviembre de 2026"/);
  assert.match(h1!, /<span class="tituloLargo">Martes 10 de noviembre de 2026<\/span>/);
  assert.match(h1!, /<span class="tituloCorto" aria-hidden="true">Mar 10 nov( 2026)?<\/span>/);
});

test("2 · el CSS solo cambia al título corto por debajo de 480 px, y oculta el largo sin quitárselo al lector", () => {
  const css = readFileSync(join(__dirname, "..", "agenda-nueva.module.css"), "utf8");
  assert.match(css, /\.tituloCorto \{\s*display: none;/);
  const bloque = css.slice(css.indexOf(".tituloCorto {"), css.indexOf(".chipHoy {"));
  assert.match(bloque, /@media \(max-width: 479\.98px\)[\s\S]*\.tituloLargo \{[\s\S]*clip: rect\(0, 0, 0, 0\)/);
  assert.doesNotMatch(bloque, /\.tituloLargo \{[^}]*display: none/, "display:none se lo quitaría al lector");
});

test("3 · las encimadas del Día llevan `tarjetaEncimada`; una cita sola, no", async () => {
  const html = await pintar({ encendida: true, modoColor: "doctor" });
  for (const id of ["a-ana", "a-eva"]) {
    const boton = html.match(new RegExp(`<button[^>]*data-cita="${id}"[^>]*>`))?.[0];
    assert.match(boton!, /class="[^"]*tarjetaEncimada/, `${id} encimada`);
  }
  const css = readFileSync(join(__dirname, "..", "agenda-nueva.module.css"), "utf8");
  const q = css.slice(css.indexOf("@container (max-width: 120px)"));
  assert.match(q, /\.tarjetaEncimada \.tarjetaNombre \{[^}]*-webkit-line-clamp: 3/, "el nombre en hasta tres renglones");
  assert.match(q, /\.tarjetaEncimada \.tarjetaChip \{\s*display: none/, "sin el punto de estado");
});
