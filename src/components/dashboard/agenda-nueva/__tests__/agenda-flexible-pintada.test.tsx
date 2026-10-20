/**
 * LA AGENDA FLEXIBLE PINTADA (WS1-T5 · grupo Salamanca) — la vista Día de
 * verdad, con sus proveedores de verdad, en el servidor (`renderToStaticMarkup`).
 *
 * Run: npm run test:salamanca-agenda
 *
 * En vivo todavía no se puede (las columnas no existen hasta que Rafael pegue
 * el SQL), así que se pinta el componente con un payload a mano y se mira lo
 * que la persona vería:
 *  · dos citas encimadas del mismo doctor salen LAS DOS, lado a lado (dos
 *    carriles de 50 %), y la sobreagendada lleva su marca;
 *  · la hora de comida sale en gris con «Comida» en la columna de su doctor;
 *  · con «Colorear por: Procedimiento» la barra de la tarjeta lleva el color
 *    del procedimiento (token `--ag-proc-…`), y sin procedimiento el del doctor;
 *  · la leyenda cambia según el modo;
 *  · y SIN la bandera, nada de eso aparece.
 *
 * Los `.module.css` no los entiende Node: se sustituyen por un objeto cuyo
 * nombre de clase es la propia llave. `next/navigation` y `next/font` también se doblan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
    appointments: [
      cita("a-ana", "10:00", "10:30", "Ana García", "Resina"),
      cita("a-eva", "10:00", "10:30", "Eva Paz", "Valoración", { overrideReason: "Sobreagendada por el equipo" }),
    ],
    doctors: [{ id: "d1", displayName: "Dra. Laura Díaz", shortName: "Dra. Díaz", color: "#2563eb", activeInAgenda: true }],
    resources: [],
    pendingValidation: [],
    waitlistCount: 0,
    bloqueos: [],
    horariosDoctores: {
      d1: [{ dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "18:00", lunchStart: "14:00", lunchEnd: "15:00" }],
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
  const { LeyendaColores } = await import("../leyenda-colores");
  const es = (await import("@/i18n/dictionaries/es.json")).default;
  const arbol = (hijos: ReactNode) =>
    h(I18nProvider as any, { locale: "es", dict: es },
      h(AgendaProvider as any, { initialPayload: payload(flexible), initialDayISO: DIA, clinicCategory: "DENTAL" },
        h(NewAppointmentProvider as any, null,
          h(AgendaNuevaProvider as any, null, hijos))));
  return renderToStaticMarkup(arbol([h(LeyendaColores, { key: "l" }), h(ArrastreCitas as any, { key: "a" }, h(VistaDia))]));
}

/** Las tarjetas (`data-cita`) con su `style`. */
function tarjetas(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<button[^>]*data-cita="([^"]+)"[^>]*>/g)) out.set(m[1]!, m[0]);
  return out;
}

test("pintada · las dos citas encimadas se ven, lado a lado, y la sobreagendada lleva su marca", async () => {
  const html = await pintar({ encendida: true, modoColor: "doctor" });
  const t = tarjetas(html);
  assert.ok(t.has("a-ana") && t.has("a-eva"), "salen las dos");
  assert.match(t.get("a-ana")!, /width:\s*calc\(50%/, "Ana ocupa medio carril");
  assert.match(t.get("a-eva")!, /width:\s*calc\(50%/, "Eva ocupa el otro medio");
  assert.notEqual(t.get("a-ana")!.match(/left:[^;]+/)?.[0], t.get("a-eva")!.match(/left:[^;]+/)?.[0], "no una encima de la otra");
  assert.match(html, /aria-label="Sobreagendada"/, "la marca de sobreagendada");
  assert.equal(html.match(/aria-label="Sobreagendada"/g)?.length, 1, "solo en la sobreagendada");
});

test("pintada · la comida del doctor sale en gris con «Comida» (14:00–15:00)", async () => {
  const html = await pintar({ encendida: true, modoColor: "doctor" });
  const franja = html.match(/<div class="franjaComida"[^>]*>/)?.[0];
  assert.ok(franja, "hay franja de comida");
  assert.match(franja!, /title="Comida · Dra\. Laura Díaz · 14:00–15:00"/);
  assert.match(html, /franjaComidaTexto">Comida</);
});

test("pintada · «Doctor»: la barra con el color del doctor, y leyenda de doctores", async () => {
  const html = await pintar({ encendida: true, modoColor: "doctor" });
  assert.match(tarjetas(html).get("a-ana")!, /box-shadow:inset 3px 0 0 #2563eb/);
  assert.match(html, /Colores por doctor:/);
});

test("pintada · «Procedimiento»: Resina en su color (token), sin procedimiento el del doctor; la leyenda lo dice", async () => {
  const html = await pintar({ encendida: true, modoColor: "procedimiento" });
  const t = tarjetas(html);
  assert.match(t.get("a-ana")!, /box-shadow:inset 5px 0 0 var\(--ag-proc-azul, oklch/, "Resina en azul, barra ancha");
  assert.match(t.get("a-eva")!, /box-shadow:inset 3px 0 0 #2563eb/, "Valoración no está en el catálogo: color del doctor");
  assert.match(html, /Colores por procedimiento:/);
  assert.match(html, />Resina</);
  assert.match(html, /Sin procedimiento: color del doctor/);
});

test("pintada · SIN la bandera: ni comida, ni leyenda, ni color por procedimiento (la agenda de siempre)", async () => {
  const html = await pintar({ encendida: false, modoColor: "doctor" });
  assert.doesNotMatch(html, /franjaComida/);
  assert.doesNotMatch(html, /leyendaColores/);
  assert.doesNotMatch(html, /--ag-proc-/);
  const t = tarjetas(html);
  assert.ok(t.has("a-ana") && t.has("a-eva"), "las encimadas se siguen viendo las dos, como ya pasaba");
});
