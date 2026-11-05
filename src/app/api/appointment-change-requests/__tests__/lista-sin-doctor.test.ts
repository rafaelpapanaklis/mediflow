/**
 * La lista de solicitudes del portal dice «Sin doctor» en una cita sin doctor
 * (ws1-t11, unión · R1). Antes salía «· —» en el panel de solicitudes.
 *
 * Run: npm run test:cita-sin-doctor-mensajes
 *
 * HANDLER REAL (GET /api/appointment-change-requests) con dobles; sin base ni
 * red. Ids de siembra, cuid y de Dentalink.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CL = "seed-clinica-salamanca";

function fila(id: string, doctor: { firstName: string | null; lastName: string | null } | null) {
  return {
    id, type: "RESCHEDULE", status: "PENDING", reason: null,
    proposedStartsAt: new Date("2031-03-11T18:00:00Z"), proposedEndsAt: new Date("2031-03-11T18:30:00Z"),
    autoApproved: false, createdAt: new Date("2031-03-01T12:00:00Z"), resolvedAt: null, resolutionNote: null,
    resolvedBy: null,
    patient: { id: "p1", firstName: "Ana", lastName: "García", phone: "+5215550000000" },
    appointment: {
      id: `cita-${id}`, startsAt: new Date("2031-03-11T16:00:00Z"), endsAt: new Date("2031-03-11T16:30:00Z"),
      type: "Limpieza", status: "SCHEDULED", doctorId: doctor ? "clx9doc0a000108l4aaaa0001" : null, doctor,
    },
  };
}

const filas = [
  fila("dentalink-cr-48213", null),
  fila("clx9cr00a000108l4aaaa0002", { firstName: "Raquel", lastName: "Méndez" }),
  fila("seed-cr-3", { firstName: null, lastName: null }),
];

const session = {
  user: { id: "u-recep", role: "RECEPTIONIST", clinicId: CL, displayName: "Recepción", permissionsOverride: [] as string[] },
  clinic: { id: CL, name: "Centro Dental Salamanca QA", timezone: "America/Mexico_City" },
};

let whereVisto: any = null;
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      appointmentChangeRequest: {
        findMany: async ({ where }: any) => {
          whereVisto = where;
          return filas.map((f) => ({ ...f }));
        },
      },
    },
  },
});
mock.module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => session, requireRole: () => null },
});
mock.module("@/lib/patient-visibility", { namedExports: { relatedPatientVisibilityAnd: () => [] } });

test("🔴 una solicitud de una cita «Sin doctor» dice «Sin doctor», no «—»", async () => {
  const { GET } = await import("@/app/api/appointment-change-requests/route");
  const req: any = { nextUrl: new URL("http://localhost/api/appointment-change-requests?status=PENDING") };
  const res = await GET(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(whereVisto.clinicId, CL, "la lista se filtra por la clínica de la sesión");
  const porId = new Map(body.requests.map((r: any) => [r.id, r.appointment]));
  const sin: any = porId.get("dentalink-cr-48213");
  assert.equal(sin.doctorName, "Sin doctor");
  assert.equal(sin.doctorId, null);
  // Con doctor, lo de siempre; con doctor sin nombre, la raya de siempre.
  assert.equal((porId.get("clx9cr00a000108l4aaaa0002") as any).doctorName, "Raquel Méndez");
  assert.equal((porId.get("seed-cr-3") as any).doctorName, "—");
});
