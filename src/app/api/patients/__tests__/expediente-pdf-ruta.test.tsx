/**
 * WS1-T4 · LA RUTA DEL EXPEDIENTE COMPLETO: permiso, tenant, casillas y bitácora.
 *
 * Run: npm run test:expediente-ruta
 *   (--experimental-test-module-mocks: se ejecuta el GET
 *   /api/patients/[id]/expediente-pdf DE VERDAD. Son reales el permiso, el
 *   armado de las props y el render del PDF; solo se sustituyen Prisma, la
 *   sesión, la visibilidad del paciente, el bucket y la bitácora.)
 *
 * Lo que se fija aquí es lo que no se puede comprobar mirando el documento:
 *   · sin `medicalRecord.export` → 403, y el default del catálogo es SOLO
 *     SUPER_ADMIN y ADMIN (un doctor NO saca el expediente entero por serlo);
 *   · el `clinicId` sale SIEMPRE de la sesión: cada consulta que se dispara
 *     lleva su filtro de tenant, y un paciente de otra clínica da 404;
 *   · las notas privadas de otro profesional no se leen — y las que quedan
 *     fuera se CUENTAN para que el documento lo declare;
 *   · las dos casillas vienen apagadas: sin parámetros no se toca ni la tabla
 *     de facturas ni la de presupuestos, y no se firma ni se baja una imagen;
 *   · generar el expediente DEJA RASTRO en la bitácora, con el usuario y la
 *     clínica de la sesión;
 *   · `?estimar=1` contesta el peso sin generar el PDF y sin escribir rastro.
 */
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ownPrivateRecordsOnly } from "@/lib/clinical/record-scope";
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_DEFAULT_PERMISSIONS,
  hasPermission,
  sanitizePermissionKeys,
} from "@/lib/auth/permissions";

// ═════════════════════════════════════════════════════════════════════
// El catálogo de permisos — esto NO necesita mocks
// ═════════════════════════════════════════════════════════════════════

describe("el permiso medicalRecord.export", () => {
  const u = (role: string, permissionsOverride: string[] = []) =>
    ({ role, permissionsOverride }) as any;

  test("existe en el catálogo, con una descripción que dice lo que hace", () => {
    assert.ok("medicalRecord.export" in ALL_PERMISSIONS);
    assert.match(ALL_PERMISSIONS["medicalRecord.export"], /expediente/i);
  });

  test("lo tienen por default SOLO SUPER_ADMIN y ADMIN", () => {
    // Es la decisión de Rafael y la razón de que sea una key aparte: ver la
    // ficha no es sacar el expediente entero en un archivo.
    assert.equal(hasPermission(u("SUPER_ADMIN"), "medicalRecord.export"), true);
    assert.equal(hasPermission(u("ADMIN"), "medicalRecord.export"), true);
    assert.equal(hasPermission(u("DOCTOR"), "medicalRecord.export"), false);
    assert.equal(hasPermission(u("RECEPTIONIST"), "medicalRecord.export"), false);
    assert.equal(hasPermission(u("READONLY"), "medicalRecord.export"), false);
  });

  test("se puede CONCEDER desde Equipo → Permisos, como cualquier otra", () => {
    const doctorConPermiso = u("DOCTOR", [
      ...ROLE_DEFAULT_PERMISSIONS.DOCTOR,
      "medicalRecord.export",
    ]);
    assert.equal(hasPermission(doctorConPermiso, "medicalRecord.export"), true);
    // …y se puede QUITAR a un admin: el override REEMPLAZA al default.
    const adminSinPermiso = u(
      "ADMIN",
      (ROLE_DEFAULT_PERMISSIONS.ADMIN as string[]).filter((k) => k !== "medicalRecord.export"),
    );
    assert.equal(hasPermission(adminSinPermiso, "medicalRecord.export"), false);
    assert.equal(hasPermission(adminSinPermiso, "medicalRecord.view"), true);
  });

  test("está en el grupo Expediente del modal (si no, no se puede encender ni apagar)", () => {
    const grupos = PERMISSION_GROUPS.filter((g) => g.keys.includes("medicalRecord.export" as never));
    assert.equal(grupos.length, 1, "tiene que estar en exactamente un grupo");
    assert.equal(grupos[0].title, "Expediente");
  });

  test("READONLY no la hereda: no acaba en '.view' y es un documento clínico", () => {
    assert.ok(!(ROLE_DEFAULT_PERMISSIONS.READONLY as string[]).includes("medicalRecord.export"));
  });

  test("sobrevive al saneado del endpoint de permisos (no es una key inventada)", () => {
    assert.deepEqual(sanitizePermissionKeys(["medicalRecord.export"]), ["medicalRecord.export"]);
  });
});

// ═════════════════════════════════════════════════════════════════════
// La clínica de prueba
// ═════════════════════════════════════════════════════════════════════

const CLINICA = "cli_1";
const OTRA_CLINICA = "cli_2";
const PACIENTE = "pat_1";

type Sesion = {
  id: string;
  clinicId: string;
  role: string;
  firstName: string;
  lastName: string;
  cedulaProfesional: string | null;
  permissionsOverride: string[];
};

const SESIONES: Record<string, Sesion> = {
  admin: {
    id: "u_admin",
    clinicId: CLINICA,
    role: "ADMIN",
    firstName: "Marta",
    lastName: "Ruiz",
    cedulaProfesional: "1234567",
    permissionsOverride: [],
  },
  doctor: {
    id: "u_dr",
    clinicId: CLINICA,
    role: "DOCTOR",
    firstName: "Luis",
    lastName: "Paz",
    cedulaProfesional: "7654321",
    permissionsOverride: [],
  },
  recepcion: {
    id: "u_recep",
    clinicId: CLINICA,
    role: "RECEPTIONIST",
    firstName: "Rosa",
    lastName: "Luna",
    cedulaProfesional: null,
    permissionsOverride: [],
  },
  doctorConPermiso: {
    id: "u_dr2",
    clinicId: CLINICA,
    role: "DOCTOR",
    firstName: "Ana",
    lastName: "Soto",
    cedulaProfesional: "9999999",
    permissionsOverride: [...ROLE_DEFAULT_PERMISSIONS.DOCTOR, "medicalRecord.export"],
  },
};

let sesion: keyof typeof SESIONES = "admin";
/** La clínica a la que pertenece el paciente en la base falsa. */
let clinicaDelPaciente = CLINICA;
/** Qué consultas se dispararon y con qué `where`. Es el candado de tenant. */
let consultas: Array<{ modelo: string; metodo: string; where: any }> = [];
/** Lo que se escribió en la bitácora. */
let bitacora: any[] = [];
/** URLs que se mandaron a firmar (si esto se llena con las casillas apagadas, mal). */
let firmadas: string[] = [];

const PACIENTE_FILA = {
  id: PACIENTE,
  patientNumber: "P0042",
  firstName: "Ana",
  lastName: "López",
  dob: new Date("1990-05-03T00:00:00.000Z"),
  gender: "F",
  bloodType: null,
  phone: null,
  email: null,
  address: null,
  curp: null,
  allergies: [] as string[],
  chronicConditions: [] as string[],
  currentMedications: [] as string[],
  familyHistory: null,
  personalNonPathologicalHistory: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  emergencyContactRelation: null,
  createdAt: new Date("2026-01-10T17:00:00.000Z"),
  primaryDoctor: null,
  clinic: {
    name: "Clínica Demo",
    address: null,
    city: null,
    state: null,
    phone: null,
    email: null,
    logoUrl: null,
    taxId: null,
    clues: null,
    timezone: "America/Mexico_City",
  },
};

const NOTA_PUBLICA = {
  id: "rec_pub",
  visitDate: new Date("2026-03-04T16:00:00.000Z"),
  subjective: "Dolor en cuadrante superior derecho.",
  objective: "Caries oclusal en 16.",
  assessment: "Caries de la dentina.",
  plan: "Resina en 16.",
  vitals: { bloodPressure: "120/80" },
  specialtyData: {
    status: "SIGNED",
    signedAt: "2026-03-04T16:40:00.000Z",
    procedures: ["Resina compuesta"],
    addenda: [
      {
        text: "Donde dice pieza 26 debe decir pieza 27.",
        authorName: "Dr/a. Marta Ruiz",
        createdAt: "2026-03-05T18:00:00.000Z",
      },
    ],
    exploracionFisica: { habitus: "Íntegro, cooperador" },
    pronostico: "reservado",
  },
  doctor: { firstName: "Marta", lastName: "Ruiz", cedulaProfesional: "1234567" },
  diagnoses_v2: [{ cie10: { code: "K02.1", description: "Caries de la dentina" } }],
};

const ARCHIVO = {
  name: "panoramica-2026.png",
  url: "patients/pat_1/panoramica-2026.png",
  category: "XRAY_PANORAMIC",
  mimeType: "image/png",
  size: 1_200_000,
  toothNumber: null,
  notes: null,
  takenAt: new Date("2026-02-11T18:00:00.000Z"),
  createdAt: new Date("2026-02-11T18:00:00.000Z"),
  uploadedBy: "u_recep",
};

const FACTURA = {
  invoiceNumber: "F-0001",
  createdAt: new Date("2026-03-04T18:00:00.000Z"),
  items: [{ name: "Resina compuesta" }],
  total: 1200,
  paid: 1200,
  status: "PAID",
  notes: null,
};

const PRESUPUESTO = {
  folio: "Q-0007",
  createdAt: new Date("2026-02-20T18:00:00.000Z"),
  title: "Rehabilitación superior",
  total: 18400,
  status: "ACCEPTED",
};

/**
 * El cuestionario del paciente. `null` = no contestó ninguno.
 *
 * Por default se deja a MEDIAS a propósito: `diabetes` contestada que sí,
 * `hypertension` contestada que no, y las otras catorce preguntas SIN tocar.
 * Es el estado real de casi todos: el formulario arranca en `{}` y solo
 * escribe lo que alguien marca.
 */
let cuestionario: any = null;

/** Anota la consulta y devuelve lo canned. Un modelo desconocido LANZA. */
function anotar(modelo: string, metodo: string, args: any, salida: unknown) {
  consultas.push({ modelo, metodo, where: args?.where ?? null });
  return Promise.resolve(salida);
}

const prismaFalso: any = {
  patient: {
    findFirst: (a: any) => {
      // Se porta como Prisma: el `where` manda. Si el paciente es de otra
      // clínica, el findFirst acotado por clinicId no lo encuentra.
      const coincide = a?.where?.id === PACIENTE && a?.where?.clinicId === clinicaDelPaciente;
      return anotar("patient", "findFirst", a, coincide ? PACIENTE_FILA : null);
    },
  },
  healthQuestionnaire: {
    findFirst: (a: any) => anotar("healthQuestionnaire", "findFirst", a, cuestionario),
  },
  medicalRecord: {
    findMany: (a: any) => anotar("medicalRecord", "findMany", a, [NOTA_PUBLICA]),
    // Dos en total: la pública que se lee y una privada de otro doctor que no.
    count: (a: any) => anotar("medicalRecord", "count", a, 2),
  },
  odontogramEntry: {
    findMany: (a: any) =>
      anotar("odontogramEntry", "findMany", a, [
        {
          toothNumber: 16,
          surface: "O",
          conditionId: "caries",
          notes: null,
          updatedAt: new Date("2026-03-04T16:00:00.000Z"),
        },
      ]),
  },
  treatmentPlan: { findMany: (a: any) => anotar("treatmentPlan", "findMany", a, []) },
  prescription: { findMany: (a: any) => anotar("prescription", "findMany", a, []) },
  consentForm: { findMany: (a: any) => anotar("consentForm", "findMany", a, []) },
  patientFile: { findMany: (a: any) => anotar("patientFile", "findMany", a, [ARCHIVO]) },
  appointment: { findMany: (a: any) => anotar("appointment", "findMany", a, []) },
  invoice: { findMany: (a: any) => anotar("invoice", "findMany", a, [FACTURA]) },
  quote: { findMany: (a: any) => anotar("quote", "findMany", a, [PRESUPUESTO]) },
  user: {
    findMany: (a: any) =>
      anotar("user", "findMany", a, [{ id: "u_recep", firstName: "Rosa", lastName: "Luna" }]),
    findFirst: (a: any) => anotar("user", "findFirst", a, null),
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });

mock.module("@/lib/auth", {
  namedExports: {
    getCurrentUser: async () => SESIONES[sesion],
  },
});

mock.module("@/lib/patient-visibility", {
  namedExports: {
    // La visibilidad tiene su propia prueba (test:patient-visibility). Aquí se
    // deja pasar a propósito: lo que se mide es el permiso y el tenant.
    assertPatientVisible: async () => null,
  },
});

mock.module("@/lib/branches", {
  namedExports: {
    // La implementación REAL (es pura y vive en clinical/record-scope); lo que
    // se evita es `server-only`, que tsx --test no puede cargar.
    ownPrivateRecordsOnly,
  },
});

mock.module("@/lib/storage", {
  namedExports: {
    BUCKETS: { PATIENT_FILES: "patient-files" },
    signMaybeUrls: async (urls: string[]) => {
      firmadas.push(...urls);
      // Sin red: se devuelve una URL que el descargador no va a poder traer, y
      // el documento lo declara. Lo que importa aquí es SI se pidió firmar.
      return urls.map(() => "https://bucket.invalido.local/x.png");
    },
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logRead: async (o: any) => {
      bitacora.push(o);
    },
    extractAuditMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "prueba" }),
  },
});

async function llamar(query = ""): Promise<Response> {
  const { NextRequest } = await import("next/server");
  const mod: any = await import("@/app/api/patients/[id]/expediente-pdf/route");
  const req = new NextRequest(
    `https://panel.local/api/patients/${PACIENTE}/expediente-pdf${query}`,
    { headers: { "user-agent": "prueba" } },
  );
  return mod.GET(req, { params: { id: PACIENTE } });
}

const CUESTIONARIO_A_MEDIAS = {
  filledAt: new Date("2025-11-18T18:00:00.000Z"),
  filledById: "u_borrada", // una capturista que ya no existe
  riskFlags: ["DIABETES"],
  notes: null,
  answers: { diabetes: true, diabetesDetail: "tipo 2 controlada", hypertension: false },
};

beforeEach(() => {
  sesion = "admin";
  cuestionario = null;
  clinicaDelPaciente = CLINICA;
  consultas = [];
  bitacora = [];
  firmadas = [];
});

const tocados = () => Array.from(new Set(consultas.map((c) => c.modelo)));

// ═════════════════════════════════════════════════════════════════════
// 1 · La puerta
// ═════════════════════════════════════════════════════════════════════

describe("quién puede sacar el expediente", () => {
  test("un DOCTOR sin el permiso recibe 403 y NO se consulta nada", async () => {
    sesion = "doctor";
    const res = await llamar();
    assert.equal(res.status, 403);
    assert.deepEqual(consultas, [], "se consultó la base antes de comprobar el permiso");
    assert.deepEqual(bitacora, [], "se escribió bitácora de una lectura que no ocurrió");
  });

  test("recepción tampoco: 403", async () => {
    sesion = "recepcion";
    assert.equal((await llamar()).status, 403);
  });

  test("un DOCTOR con el permiso concedido desde Equipo SÍ lo saca", async () => {
    sesion = "doctorConPermiso";
    const res = await llamar();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
  });

  test("un ADMIN lo saca, y sale un PDF de verdad", async () => {
    const res = await llamar();
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-", "esto no es un PDF");
    assert.ok(buf.byteLength > 2000, "el PDF salió sospechosamente vacío");
    assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="expediente-/);
    // Un expediente completo no se cachea en ningún sitio.
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  });

  test("un paciente de OTRA clínica da 404, no 403 (no se confirma que exista)", async () => {
    clinicaDelPaciente = OTRA_CLINICA;
    const res = await llamar();
    assert.equal(res.status, 404);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2 · El aislamiento por clínica
// ═════════════════════════════════════════════════════════════════════

describe("el clinicId sale de la sesión, nunca del cliente", () => {
  test("todas las consultas acotables llevan el clinicId de la sesión", async () => {
    await llamar("?administrativo=1");
    // `odontogramEntry` no tiene columna clinicId: su candado es el paciente,
    // que ya se resolvió contra la clínica de la sesión. El resto SÍ la lleva.
    const sinTenant = consultas.filter(
      (c) =>
        c.modelo !== "odontogramEntry" &&
        c.where != null &&
        c.where.clinicId !== CLINICA,
    );
    assert.deepEqual(
      sinTenant.map((c) => `${c.modelo}.${c.metodo}`),
      [],
      "hay consultas sin filtro de clínica (o con uno distinto al de la sesión)",
    );
    assert.ok(consultas.length >= 10, `se esperaban muchas consultas, hubo ${consultas.length}`);
  });

  test("ninguna consulta se dispara con clinicId undefined (eso no filtra nada)", async () => {
    await llamar("?administrativo=1");
    for (const c of consultas) {
      if (c.where && "clinicId" in c.where) {
        assert.notEqual(c.where.clinicId, undefined, `${c.modelo}.${c.metodo} con clinicId undefined`);
      }
    }
  });

  test("el odontograma se acota por el paciente ya resuelto", async () => {
    await llamar();
    const odo = consultas.find((c) => c.modelo === "odontogramEntry");
    assert.equal(odo?.where?.patientId, PACIENTE);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 3 · Las notas privadas
// ═════════════════════════════════════════════════════════════════════

describe("las notas privadas de otro profesional", () => {
  test("la consulta lleva el filtro de nota privada, con el id de QUIEN mira", async () => {
    await llamar();
    const notas = consultas.find((c) => c.modelo === "medicalRecord" && c.metodo === "findMany");
    assert.ok(notas, "no se consultaron las notas");
    // El fragmento va dentro de un AND (dos `OR` en el mismo objeto se pisan).
    assert.deepEqual(notas!.where.AND, [ownPrivateRecordsOnly(SESIONES.admin.id)]);
    assert.equal(notas!.where.clinicId, CLINICA);
  });

  test("las que quedan fuera se CUENTAN, y el documento lo dice", async () => {
    // El `count` no lleva el filtro de privadas: cuenta TODAS las del paciente.
    await llamar();
    const cuenta = consultas.find((c) => c.modelo === "medicalRecord" && c.metodo === "count");
    assert.ok(cuenta, "no se contaron las notas del paciente");
    assert.equal(cuenta!.where.AND, undefined, "el conteo no puede excluir las privadas");
    assert.equal(cuenta!.where.clinicId, CLINICA);

    // Y llega al papel: 2 en total, 1 leída → 1 omitida.
    const res = await llamar();
    const pdf = Buffer.from(await res.arrayBuffer());
    const { textoVisiblePorPagina } = await import("@/lib/pdf/__tests__/_texto-del-pdf");
    const todo = textoVisiblePorPagina(pdf).join(" ");
    assert.match(todo, /1 nota marcada como privada/);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4 · Las dos casillas, apagadas por default
// ═════════════════════════════════════════════════════════════════════

describe("las casillas vienen apagadas", () => {
  test("sin parámetros NO se consulta ni una factura ni un presupuesto", async () => {
    await llamar();
    assert.ok(!tocados().includes("invoice"), "se consultaron facturas con la casilla apagada");
    assert.ok(!tocados().includes("quote"), "se consultaron presupuestos con la casilla apagada");
  });

  test("sin parámetros NO se firma ni se baja una sola imagen", async () => {
    await llamar();
    assert.deepEqual(firmadas, [], "se pidió firmar una URL con la casilla de imágenes apagada");
  });

  test("las placas salen LISTADAS, no incrustadas, y el PDF lo dice", async () => {
    const res = await llamar();
    const pdf = Buffer.from(await res.arrayBuffer());
    const { textoVisiblePorPagina } = await import("@/lib/pdf/__tests__/_texto-del-pdf");
    const todo = textoVisiblePorPagina(pdf).join(" ");
    assert.match(todo, /panoramica-2026.png/);
    assert.match(todo, /Radiograf.a panor.mica/);
    assert.match(todo, /Rosa Luna/, "no se dice quién subió la placa");
    assert.match(todo, /NO incluye las im.genes/);
  });

  test("con la casilla de imágenes encendida SÍ se piden las URLs firmadas", async () => {
    await llamar("?imagenes=1");
    assert.equal(firmadas.length, 1, "no se pidió firmar la única imagen del paciente");
  });

  test("un valor que no es «1» NO enciende la casilla que pesa", async () => {
    await llamar("?imagenes=true");
    assert.deepEqual(firmadas, [], "«imagenes=true» encendió la casilla; solo vale «1»");
    await llamar("?administrativo=si");
    assert.ok(!tocados().includes("invoice"), "«administrativo=si» encendió el anexo");
  });

  test("con administrativo=1 sí se consultan facturas y presupuestos", async () => {
    await llamar("?administrativo=1");
    assert.ok(tocados().includes("invoice"));
    assert.ok(tocados().includes("quote"));
  });

  test("el anexo administrativo solo sale cuando se pidió", async () => {
    const { textoVisiblePorPagina } = await import("@/lib/pdf/__tests__/_texto-del-pdf");
    const sin = textoVisiblePorPagina(Buffer.from(await (await llamar()).arrayBuffer())).join(" ");
    assert.doesNotMatch(sin, /F-0001/);
    assert.doesNotMatch(sin, /Anexo administrativo/);

    const con = textoVisiblePorPagina(
      Buffer.from(await (await llamar("?administrativo=1")).arrayBuffer()),
    ).join(" ");
    assert.match(con, /Anexo administrativo/);
    assert.match(con, /F-0001/);
    assert.match(con, /Q-0007/);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4b · Honestidad de los antecedentes
// ═════════════════════════════════════════════════════════════════════

describe("el cuestionario contestado a medias", () => {
  async function papel(): Promise<string> {
    const pdf = Buffer.from(await (await llamar()).arrayBuffer());
    const { textoVisiblePorPagina } = await import("@/lib/pdf/__tests__/_texto-del-pdf");
    return textoVisiblePorPagina(pdf).join(" ");
  }

  test("una pregunta SIN contestar NO se imprime como «No»", async () => {
    cuestionario = CUESTIONARIO_A_MEDIAS;
    const todo = await papel();
    // Lo contestado se respeta…
    assert.match(todo, /tipo 2 controlada/);
    // …y lo que nadie preguntó se declara ausente. Si esto se rompe, el
    // expediente afirma «VIH / SIDA: No» de una pregunta que no se hizo.
    const noes = todo.split("No capturado").length - 1;
    assert.ok(noes >= 10, `solo ${noes} campos declarados ausentes; se esperaban 10 o más`);
  });

  test("un «no» contestado sí sale como «No»", async () => {
    cuestionario = CUESTIONARIO_A_MEDIAS;
    const todo = await papel();
    // `hypertension: false` está contestada: tiene que decir No, no «No capturado».
    assert.match(todo, /HIPERTENSI.N ARTERIALNo(?!\s*capturado)/i);
  });

  test("si no se sabe quién lo llenó, NO se dice que lo llenó el paciente", async () => {
    // `filledById` apunta a una capturista que ya no está en la clínica: el
    // dato no es «lo autorreportó el paciente», es que no consta.
    cuestionario = CUESTIONARIO_A_MEDIAS;
    const todo = await papel();
    assert.doesNotMatch(todo, /El paciente \(portal\)/);
    assert.match(todo, /LLENADO PORNo capturado/i);
  });

  test("si de verdad lo llenó el paciente desde el portal, se dice", async () => {
    cuestionario = { ...CUESTIONARIO_A_MEDIAS, filledById: null };
    const todo = await papel();
    assert.match(todo, /El paciente \(portal\)/);
  });
});

describe("el anexo administrativo", () => {
  test("los importes llevan sus centavos, no se redondean a pesos", async () => {
    const pdf = Buffer.from(await (await llamar("?administrativo=1")).arrayBuffer());
    const { textoVisiblePorPagina } = await import("@/lib/pdf/__tests__/_texto-del-pdf");
    const todo = textoVisiblePorPagina(pdf).join(" ");
    // La factura de prueba es de 1200: en un papel que alguien puede cotejar,
    // «$1,200.00» y no «$1,200».
    assert.match(todo, /\$1,200\.00/);
    assert.doesNotMatch(todo, /\$1,200(?!\.)/);
  });

  test("el estado del presupuesto se dice en español", async () => {
    const pdf = Buffer.from(await (await llamar("?administrativo=1")).arrayBuffer());
    const { textoVisiblePorPagina } = await import("@/lib/pdf/__tests__/_texto-del-pdf");
    const todo = textoVisiblePorPagina(pdf).join(" ");
    assert.match(todo, /Aceptado/);
    assert.doesNotMatch(todo, /ACCEPTED/);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 5 · La bitácora
// ═════════════════════════════════════════════════════════════════════

describe("la bitácora", () => {
  test("generar el expediente deja UNA fila, con quién y de qué paciente", async () => {
    await llamar();
    assert.equal(bitacora.length, 1, "el expediente completo tiene que dejar rastro");
    const fila = bitacora[0];
    assert.equal(fila.kind, "expediente_pdf");
    assert.equal(fila.patientId, PACIENTE);
    assert.equal(fila.userId, SESIONES.admin.id, "el usuario sale de la sesión");
    assert.equal(fila.clinicId, CLINICA, "la clínica sale de la sesión");
    assert.equal(fila.ipAddress, "127.0.0.1");
  });

  test("cada descarga deja su propia fila: un export no se deduplica", async () => {
    await llamar();
    await llamar();
    assert.equal(bitacora.length, 2);
  });

  test("un 403 no escribe nada", async () => {
    sesion = "doctor";
    await llamar();
    assert.deepEqual(bitacora, []);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 6 · La sonda del diálogo
// ═════════════════════════════════════════════════════════════════════

describe("?estimar=1", () => {
  test("contesta cuántas imágenes hay y cuánto pesan, sin generar el PDF", async () => {
    const res = await llamar("?estimar=1");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const data: any = await res.json();
    assert.equal(data.estudios, 1);
    assert.equal(data.imagenes, 1);
    assert.equal(data.bytes, 1_200_000);
    assert.equal(data.pesoLegible, "1,1 MB");
    assert.equal(data.recortado, false);
  });

  test("no escribe bitácora: no sale ningún dato clínico", async () => {
    await llamar("?estimar=1");
    assert.deepEqual(bitacora, []);
  });

  test("no lee notas, recetas ni consentimientos: solo los archivos", async () => {
    await llamar("?estimar=1");
    assert.deepEqual(tocados().sort(), ["patient", "patientFile"]);
  });

  test("exige el mismo permiso que la descarga", async () => {
    sesion = "recepcion";
    assert.equal((await llamar("?estimar=1")).status, 403);
  });
});
