/* ============================================================
   LA LISTA BLANCA DEL EQUIPO NO PUEDE DEJAR PASAR UN SECRETO.

     npm run test:team-fields

   GET y PATCH /api/team/[id] devolvían la fila COMPLETA del usuario, con
   el secret TOTP en claro dentro (EQ-05). Se cerró con una lista blanca
   (../member-fields.ts). Esto la sujeta.

   Las tres afirmaciones, por orden de lo que protegen:

   1. Ninguno de los seis secretos de `User` está en la lista.
   2. Nada que PAREZCA un secreto puede entrar en el futuro. Es la que de
      verdad vale: la lista de nombres del punto 1 envejece, el patrón no.
   3. Cada nombre de la lista existe de verdad en el modelo `User`. Un
      typo aquí no lo caza el compilador —el `select` es un objeto de
      literales— y revienta en producción con un error de Prisma.

   Y una cuarta, en el otro sentido: los campos que el panel de Equipo
   pinta tienen que seguir estando. Una lista blanca que se recorta de más
   no filtra nada y rompe la pantalla.
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MIEMBRO_CAMPOS, MIEMBRO_SELECT, camposPublicosDeMiembro } from "../member-fields";

/** Los seis de `User` que jamás pueden salir del servidor. */
const SECRETOS = [
  "totpSecret",
  "recoveryCodes",
  "cajaPinHash",
  "googleCalendarToken",
  "googleRefreshToken",
  "stripeAccountId",
] as const;

/**
 * Campos con nombre de credencial que NO lo son. Van uno por uno y con el
 * motivo: la excepción se concede a mano, que es lo contrario de que el
 * patrón no exista.
 */
const NO_SON_SECRETOS: Record<string, string> = {
  // Es una BANDERA, no una contraseña: dice que la actual la generó el
  // sistema y el usuario todavía no ha puesto la suya.
  mustChangePassword: "bandera booleana; la contraseña vive en Supabase Auth, no en esta columna",
};

/** Los campos escalares del modelo `User`, leídos del esquema de verdad. */
function camposDelModeloUser(): string[] {
  const esquema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  // Los nombres de modelo sirven para distinguir una columna de una relación:
  // `appointments Appointment[]` no es un campo que se pueda seleccionar.
  const modelos = new Set(Array.from(esquema.matchAll(/^model ([A-Za-z0-9_]+) \{$/gm), m => m[1]));
  const bloque = esquema.match(/^model User \{$([\s\S]*?)^\}$/m);
  assert.ok(bloque, "no se encontró el modelo User en prisma/schema.prisma");
  const campos: string[] = [];
  for (const linea of bloque[1].split("\n")) {
    // `nombre Tipo ...`. Se descartan comentarios y atributos de bloque
    // (@@unique, @@index) porque no casan, y las relaciones por el tipo.
    const m = linea.match(/^\s{2}([a-zA-Z][a-zA-Z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)(\[\])?(\?)?/);
    if (!m || modelos.has(m[2])) continue;
    campos.push(m[1]);
  }
  return campos;
}

test("ningún secreto conocido está en la lista blanca", () => {
  const colados = SECRETOS.filter(s => (MIEMBRO_CAMPOS as string[]).includes(s));
  assert.deepEqual(
    colados, [],
    "Un secreto entró en la lista de campos que viajan al navegador. Con el " +
    "secret TOTP en claro, el segundo factor de esa persona deja de valer.",
  );
});

test("nada que parezca un secreto puede entrar en la lista", () => {
  // La red que sigue funcionando dentro de un año: la lista de nombres de
  // arriba envejece con el esquema, este patrón no. Si un campo legítimo
  // cae aquí, se renombra o se documenta la excepción a mano — pero se
  // decide, que es justo lo que faltó cuando esto se serializaba entero.
  const HUELE_A_SECRETO = /secret|token|hash|password|passwd|apikey|privatekey|credential|recoverycodes|pin(?![a-z])/i;
  const sospechosos = (MIEMBRO_CAMPOS as string[])
    .filter(c => HUELE_A_SECRETO.test(c))
    .filter(c => !(c in NO_SON_SECRETOS));
  assert.deepEqual(
    sospechosos, [],
    "Hay campos con pinta de credencial en la lista blanca del equipo. Si alguno " +
    "no lo es de verdad, añádelo a NO_SON_SECRETOS con el motivo escrito.",
  );
});

test("todo campo de la lista existe en el modelo User", () => {
  // El `select` es un objeto de literales: TypeScript no comprueba que las
  // claves sean columnas reales, así que un typo pasa el build y revienta
  // en la primera llamada con "Unknown field" de Prisma.
  const delModelo = new Set(camposDelModeloUser());
  const inventados = (MIEMBRO_CAMPOS as string[]).filter(c => !delModelo.has(c));
  assert.deepEqual(inventados, [], "Campos de la lista blanca que no existen en el modelo User.");
});

test("los campos que pinta la pantalla de Equipo siguen estando", () => {
  // Una lista blanca recortada de más no filtra nada y deja la tabla de
  // Equipo sin nombres. Estos son los que lee team-client.tsx.
  const QUE_USA_LA_PANTALLA = [
    "id", "firstName", "lastName", "email", "role", "specialty", "color",
    "services", "avatarUrl", "phone", "isActive", "createdAt",
    "cedulaProfesional", "especialidad", "cedulaEspecialidad",
    "permissionsOverride",
  ];
  const faltan = QUE_USA_LA_PANTALLA.filter(c => !(MIEMBRO_CAMPOS as string[]).includes(c));
  assert.deepEqual(faltan, [], "La pantalla de Equipo lee campos que la lista blanca ya no deja pasar.");
});

test("proyectar una fila entera deja fuera los secretos", () => {
  // El caso del PATCH: la fila completa hace falta en el servidor para la
  // bitácora, y aun así no puede salir entera de vuelta.
  const filaEntera = {
    id: "u1", clinicId: "c1", email: "doc@clinica.mx",
    firstName: "Ana", lastName: "Ruiz", role: "DOCTOR",
    specialty: null, avatarUrl: null, phone: null, isActive: true,
    mustChangePassword: false, color: "#3b82f6", agendaActive: true,
    lastLogin: null, createdAt: new Date(0), updatedAt: new Date(0),
    services: [], permissionsOverride: [], sidebarCollapsed: [],
    canAccessCaja: true, totpEnabled: true,
    // Lo que no puede salir:
    supabaseId: "sb-123",
    totpSecret: "JBSWY3DPEHPK3PXP",
    recoveryCodes: ["$2b$10$hash1", "$2b$10$hash2"],
    cajaPinHash: "$2b$10$pin",
    googleCalendarToken: "ya29.token",
    googleRefreshToken: "1//refresh",
    stripeAccountId: "acct_123",
  };

  const publico = camposPublicosDeMiembro(filaEntera) as Record<string, unknown>;

  for (const s of [...SECRETOS, "supabaseId"]) {
    assert.equal(publico[s], undefined, `"${s}" sobrevivió a la proyección.`);
  }
  // Y lo que sí tiene que llegar, llega.
  assert.equal(publico.email, "doc@clinica.mx");
  assert.equal(publico.canAccessCaja, true);
  assert.equal(publico.totpEnabled, true);
});

test("proyectar no inventa campos que la fila no traía", () => {
  // El GET ya lee con `select`, así que su fila viene recortada. Proyectarla
  // otra vez no puede rellenar con undefined lo que nunca estuvo: el cliente
  // distingue "no vino" de "vino vacío".
  const parcial = { id: "u1", email: "a@b.mx" };
  const publico = camposPublicosDeMiembro(parcial) as Record<string, unknown>;
  assert.deepEqual(Object.keys(publico).sort(), ["email", "id"]);
});

test("la lista blanca y el select son la misma cosa", () => {
  assert.deepEqual((MIEMBRO_CAMPOS as string[]).slice().sort(), Object.keys(MIEMBRO_SELECT).sort());
  assert.ok(Object.values(MIEMBRO_SELECT).every(v => v === true), "el select solo admite `true`");
});
