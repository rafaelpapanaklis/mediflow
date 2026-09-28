/**
 * Ortodoncia en la campana de actividad — ws1-t5.
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/actividad-campana.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eventoDeCasoAbierto, eventoDeCitaCompletada, eventoDePago } from "../actividad-campana";
import { TIPO_CITA_CONTROL_ORTO } from "../agenda-constants";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const ana = { firstName: "Ana", lastName: "Pérez" };
const AGENDA = "/dashboard/agenda?date=2026-09-28&highlight=c1";

test("una cita que no es de ortodoncia sale como siempre", () => {
  for (const accesoOrtodoncia of [true, false]) {
    assert.deepEqual(
      eventoDeCitaCompletada({ type: "Limpieza", patientId: "p1", patient: ana }, { accesoOrtodoncia, hrefDeLaCita: AGENDA }),
      { title: "Cita completada — Ana Pérez", href: AGENDA },
    );
  }
});

test("un control atendido lo dice y lleva al caso del paciente", () => {
  assert.deepEqual(
    eventoDeCitaCompletada(
      { type: TIPO_CITA_CONTROL_ORTO, patientId: "p1", patient: ana },
      { accesoOrtodoncia: true, hrefDeLaCita: AGENDA },
    ),
    { title: "Control de ortodoncia atendido — Ana Pérez", href: "/dashboard/patients/p1?tab=ortodoncia" },
  );
});

test("sin acceso al módulo (o con el paciente enmascarado), el control sigue llevando a la agenda", () => {
  assert.equal(
    eventoDeCitaCompletada(
      { type: TIPO_CITA_CONTROL_ORTO, patientId: "p1", patient: ana },
      { accesoOrtodoncia: false, hrefDeLaCita: AGENDA },
    ).href,
    AGENDA,
  );
  assert.equal(
    eventoDeCitaCompletada(
      { type: TIPO_CITA_CONTROL_ORTO, patientId: null, patient: ana },
      { accesoOrtodoncia: true, hrefDeLaCita: AGENDA },
    ).href,
    AGENDA,
  );
});

test("el pago del plan de un caso dice que es de ortodoncia; los demás, como siempre", () => {
  const factura = { paid: 1000, paymentMethod: "Efectivo", patient: ana };
  assert.deepEqual(eventoDePago(factura, { esDeOrtodoncia: false }), {
    title: "Pago recibido — Ana Pérez",
    subtitle: "$1,000 · Efectivo",
  });
  assert.deepEqual(eventoDePago(factura, { esDeOrtodoncia: true }), {
    title: "Pago de ortodoncia — Ana Pérez",
    subtitle: "$1,000 · Efectivo · plan de pago del caso",
  });
  assert.equal(eventoDePago({ ...factura, paymentMethod: null }, { esDeOrtodoncia: false }).subtitle, "$1,000");
});

test("un caso abierto lleva al caso", () => {
  const at = new Date("2026-09-28T16:00:00.000Z");
  assert.deepEqual(eventoDeCasoAbierto({ id: "plan1", patientId: "p1", createdAt: at, patient: ana }), {
    id: "orto-caso-plan1",
    type: "ortho_case",
    title: "Caso de ortodoncia abierto — Ana Pérez",
    href: "/dashboard/patients/p1?tab=ortodoncia",
    at,
  });
});

test("cableado: la campana lee ortodoncia solo con módulo y permiso, en la clínica de la sesión", () => {
  const ruta = leer("app/api/dashboard/activity/route.ts");
  assert.match(ruta, /hasPermission\(quien, "specialties\.orthodontics"\)/);
  assert.match(ruta, /ctx\.clinicCategory === "DENTAL"/);
  assert.match(ruta, /hasActiveOrthodonticsModule\(ctx\.clinicId\)/);
  const consultas = ruta.match(/prisma\.orthodonticTreatmentPlan\s*\.findMany\(\{[\s\S]*?\}\)/g) ?? [];
  assert.equal(consultas.length, 2);
  for (const c of consultas) {
    assert.match(c, /clinicId: ctx\.clinicId/);
    assert.match(c, /deletedAt: null/);
  }
  // Los casos nuevos respetan la visibilidad por paciente, como el resto del feed.
  assert.match(consultas[0], /relatedVis/);
  // La caché sigue siendo por clínica + persona + rol.
  assert.match(ruta, /claveDeClinica\("activity-recent", ctx\.clinicId, ctx\.userId, ctx\.role\)/);
  // La campana pinta el tipo nuevo.
  const campana = leer("components/dashboard/notifications-popover.tsx");
  assert.match(campana, /ortho_case: \{ Icon: Smile/);
  assert.match(campana, /ortho_case: c\.tonoMarca/);
});
