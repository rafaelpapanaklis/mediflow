/**
 * WS1-T2 · hallazgo 7 — "Ver radiografías" apagado no cerraba los modelos 3D
 * ni las subidas de estudios.
 *
 * Run: npm run test:estudios-permisos
 *   (--experimental-test-module-mocks: se ejecutan los handlers DE VERDAD.)
 *
 * Seis rutas no tenían NINGÚN `denyIfMissingPermission`. Un READONLY —a quien
 * el default del rol le niega todo `xrays.*`— no veía la pestaña Radiografías
 * pero abría Modelos 3D y recibía 200 con las signed URLs de STL, DICOM y sets
 * CBCT, y podía escribir hasta 2 GB contra el cupo del plan.
 *
 * QUÉ PERMISO PIDE CADA UNA, y por qué:
 *   · LEER  → "xrays.view"   — es el mismo cajón de archivos del paciente que
 *     sirve /api/xrays (su `NOT` es el espejo exacto del `OR` de models-3d: una
 *     tabla, dos vistas complementarias). Un cajón, un interruptor.
 *   · ESCRIBIR → "xrays.upload" — el mismo que exige POST /api/xrays, cuyo
 *     default dice literalmente "Subir radiografías y archivos del paciente".
 *     Escribir consume el cupo de almacenamiento del plan, así que pide la
 *     clave de escritura, no la de lectura.
 * No se usó `medicalRecord.*` a propósito: le quitaría a RECEPCIÓN unas
 * pestañas que hoy usa (es quien sube los estudios) sin cerrar nada más.
 *
 * CÓMO SE PRUEBA: `assertPatientVisible` —lo primero que corre DESPUÉS del
 * gate en las seis rutas— se sustituye por un centinela 499. Así, 403 = el
 * permiso cortó; 499 = el permiso dejó pasar. No hace falta simular Storage.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { hasPermission, ROLE_DEFAULT_PERMISSIONS } from "../auth/permissions";

const CENTINELA = 499;
const PACIENTE = "pat_1";

let ctxActual: { role: string; permissionsOverride: string[] } | null = null;

mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () =>
      ctxActual && { userId: "user_1", clinicId: "cli_1", ...ctxActual },
  },
});
mock.module("@/lib/patient-visibility", {
  namedExports: {
    // Centinela: si se llega hasta aquí, el gate de permiso dejó pasar.
    assertPatientVisible: async () =>
      new Response(JSON.stringify({ centinela: true }), { status: CENTINELA }),
  },
});
mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
// La cuota vive detrás de `@/lib/plans`, que importa "server-only" (paquete que
// sólo existe dentro del bundle de Next). Se sustituye para poder cargar los
// handlers en `tsx --test`; ninguno de sus caminos entra en juego aquí, porque
// el gate de permiso corta antes.
mock.module("@/lib/storage-quota", { namedExports: { storageQuotaError: async () => null } });

/** Las seis rutas del hallazgo, con el permiso que debe exigir cada una. */
const RUTAS = [
  { nombre: "GET  models-3d",          mod: "@/app/api/patients/[id]/models-3d/route",        metodo: "GET",  permiso: "xrays.view" },
  { nombre: "POST models-3d",          mod: "@/app/api/patients/[id]/models-3d/route",        metodo: "POST", permiso: "xrays.upload" },
  { nombre: "GET  uploads",            mod: "@/app/api/patients/[id]/uploads/route",          metodo: "GET",  permiso: "xrays.view" },
  { nombre: "POST uploads/sign",       mod: "@/app/api/patients/[id]/uploads/sign/route",     metodo: "POST", permiso: "xrays.upload" },
  { nombre: "POST uploads/confirm",    mod: "@/app/api/patients/[id]/uploads/confirm/route",  metodo: "POST", permiso: "xrays.upload" },
  { nombre: "POST dicom-set/sign",     mod: "@/app/api/patients/[id]/dicom-set/sign/route",   metodo: "POST", permiso: "xrays.upload" },
  { nombre: "POST dicom-set/register", mod: "@/app/api/patients/[id]/dicom-set/register/route", metodo: "POST", permiso: "xrays.upload" },
] as const;

async function llamar(ruta: (typeof RUTAS)[number], rol: string, override: string[] = []) {
  ctxActual = { role: rol, permissionsOverride: override };
  const { NextRequest } = await import("next/server");
  const mod: any = await import(ruta.mod);
  const req = new NextRequest(`https://dalecontrol.test/api/patients/${PACIENTE}/x`, {
    method: ruta.metodo === "GET" ? "GET" : "POST",
    ...(ruta.metodo === "GET" ? {} : { body: JSON.stringify({ name: "estudio.zip", size: 10 }) }),
    headers: { "content-type": "application/json" },
  } as any);
  const res = await mod[ruta.metodo](req, { params: { id: PACIENTE } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ── El hallazgo, rol por rol y ruta por ruta ────────────────────────────────

for (const ruta of RUTAS) {
  test(`H7 · ${ruta.nombre} le cierra la puerta a READONLY (${ruta.permiso})`, async () => {
    // Hoy esto devuelve 200 con signed URLs (GET) o empieza a subir (POST).
    const { status, body } = await llamar(ruta, "READONLY");
    assert.equal(status, 403, `${ruta.nombre} dejó pasar a READONLY`);
    assert.match(String(body.error), new RegExp(ruta.permiso.replace(".", "\\.")));
  });

  test(`H7 · ${ruta.nombre} sigue abierta para recepción y doctor`, async () => {
    // El arreglo no puede cerrarle la pestaña a quien la usa a diario.
    for (const rol of ["RECEPTIONIST", "DOCTOR", "ADMIN", "SUPER_ADMIN"]) {
      const { status } = await llamar(ruta, rol);
      assert.equal(status, CENTINELA, `${ruta.nombre} bloqueó a ${rol}`);
    }
  });

  test(`H7 · ${ruta.nombre} respeta el override del dueño`, async () => {
    // Encendido a mano para un READONLY → pasa. Apagado a mano para un
    // DOCTOR (override = lista cerrada que REEMPLAZA al default) → no pasa.
    assert.equal((await llamar(ruta, "READONLY", [ruta.permiso])).status, CENTINELA);
    assert.equal((await llamar(ruta, "DOCTOR", ["patients.view"])).status, 403);
  });

  test(`H7 · ${ruta.nombre} sigue pidiendo sesión antes que permiso`, async () => {
    ctxActual = null;
    const { NextRequest } = await import("next/server");
    const mod: any = await import(ruta.mod);
    const req = new NextRequest("https://dalecontrol.test/x", {
      method: ruta.metodo === "GET" ? "GET" : "POST",
      ...(ruta.metodo === "GET" ? {} : { body: "{}" }),
      headers: { "content-type": "application/json" },
    } as any);
    const res = await mod[ruta.metodo](req, { params: { id: PACIENTE } });
    assert.equal(res.status, 401);
  });
}

// ── La decisión de negocio, escrita ─────────────────────────────────────────

test("H7 · la matriz que justifica la elección de clave", async () => {
  const u = (role: any, override: string[] = []) => ({ role, permissionsOverride: override });
  // READONLY: ninguna xrays.* — es exactamente el rol del hallazgo.
  assert.equal(hasPermission(u("READONLY"), "xrays.view"), false);
  assert.equal(hasPermission(u("READONLY"), "xrays.upload"), false);
  // RECEPTIONIST: las dos. Por eso NO se usó medicalRecord.*, que no tiene.
  assert.equal(hasPermission(u("RECEPTIONIST"), "xrays.view"), true);
  assert.equal(hasPermission(u("RECEPTIONIST"), "xrays.upload"), true);
  assert.equal(hasPermission(u("RECEPTIONIST"), "medicalRecord.view"), false);
  // DOCTOR y los dos admin: las dos.
  for (const rol of ["DOCTOR", "ADMIN", "SUPER_ADMIN"]) {
    assert.equal(hasPermission(u(rol as any), "xrays.view"), true);
    assert.equal(hasPermission(u(rol as any), "xrays.upload"), true);
  }
  // Si mañana se agrega un rol, hay que decidir su acceso a propósito.
  assert.deepEqual(Object.keys(ROLE_DEFAULT_PERMISSIONS).sort(), [
    "ADMIN", "DOCTOR", "READONLY", "RECEPTIONIST", "SUPER_ADMIN",
  ]);
});
