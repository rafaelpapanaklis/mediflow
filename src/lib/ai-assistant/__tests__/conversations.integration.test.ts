/**
 * Aislamiento del historial del Asistente IA contra una base REAL.
 *
 * Lo que se prueba aquí no se puede probar con mocks: que ninguna operación
 * (leer, listar, renombrar, borrar, anexar) alcance la conversación de otra
 * clínica ni la de otro compañero de la misma clínica, y que la migración desde
 * localStorage sea idempotente.
 *
 * SIN `DATABASE_URL` el archivo entero se salta (no revienta el gate de nadie).
 * Para correrlo, desde la raíz del repo, con un Postgres de usar y tirar:
 *
 *   docker run -d --name aiconv-pg -e POSTGRES_PASSWORD=x -e POSTGRES_DB=x \
 *     -p 54331:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://postgres:x@localhost:54331/x DIRECT_URL=$DATABASE_URL \
 *     npx prisma db push --skip-generate
 *   DATABASE_URL=... DIRECT_URL=... npx tsx --test \
 *     src/lib/ai-assistant/__tests__/conversations.integration.test.ts
 *   docker rm -f aiconv-pg
 */
import "../../clinical-shared/__tests__/_sin-server-only"; // PRIMERO: @/lib/prisma arrastra "server-only"
import { test } from "node:test";
import assert from "node:assert/strict";

const LIVE = !!process.env.DATABASE_URL;
const only = { skip: LIVE ? false : "sin DATABASE_URL" };

// Los imports pesados van dentro de los tests para que el archivo se pueda
// cargar (y saltar) sin base de datos.
async function mod() {
  return import("../conversations");
}
async function db() {
  return (await import("@/lib/prisma")).prisma;
}

const A = { clinicId: "clinicA", userId: "userA1" };
const A2 = { clinicId: "clinicA", userId: "userA2" }; // compañero de la MISMA clínica
const B = { clinicId: "clinicB", userId: "userB1" }; // otra clínica

async function limpiar() {
  const prisma = await db();
  await prisma.aiConversationMessage.deleteMany({ where: { clinicId: { in: ["clinicA", "clinicB"] } } });
  await prisma.aiConversation.deleteMany({ where: { clinicId: { in: ["clinicA", "clinicB"] } } });
}

test("una conversación de la clínica A no existe para la clínica B ni para otro usuario de A", only, async () => {
  const { createConversation, getConversation, listConversations } = await mod();
  await limpiar();

  const { conversation } = await createConversation(A, {
    messages: [{ role: "user", content: "Paciente con pulpitis irreversible en 46" }],
  });

  // El dueño la ve entera.
  const propia = await getConversation(A, conversation.id);
  assert.ok(propia);
  assert.equal(propia.messages.length, 1);
  assert.equal(propia.messages[0].content, "Paciente con pulpitis irreversible en 46");

  // Pedirla POR ID desde la otra clínica: null → la ruta responde 404, el mismo
  // 404 que un id inventado. Ni el título ni la existencia se filtran.
  assert.equal(await getConversation(B, conversation.id), null);
  // Y desde otro usuario de la MISMA clínica: también null.
  assert.equal(await getConversation(A2, conversation.id), null);

  // Y no aparece en ningún listado ajeno.
  assert.equal((await listConversations(B)).length, 0);
  assert.equal((await listConversations(A2)).length, 0);
  assert.equal((await listConversations(A)).length, 1);

  await limpiar();
});

test("renombrar, borrar y anexar desde otra clínica no tocan la fila", only, async () => {
  const { appendMessages, createConversation, deleteConversation, getConversation, updateConversation } = await mod();
  await limpiar();

  const { conversation } = await createConversation(A, {
    title: "Plan de tratamiento",
    messages: [{ role: "user", content: "Hola" }],
  });

  assert.equal(await updateConversation(B, conversation.id, { title: "SECUESTRADA" }), null);
  assert.equal(await updateConversation(A2, conversation.id, { title: "SECUESTRADA" }), null);
  assert.equal(await appendMessages(B, conversation.id, [{ role: "user", content: "inyectado" }]), null);
  assert.equal(await appendMessages(A2, conversation.id, [{ role: "user", content: "inyectado" }]), null);
  assert.equal(await deleteConversation(B, conversation.id), null);
  assert.equal(await deleteConversation(A2, conversation.id), null);

  // Intacta: mismo título y un solo turno.
  const despues = await getConversation(A, conversation.id);
  assert.ok(despues);
  assert.equal(despues.conversation.title, "Plan de tratamiento");
  assert.equal(despues.messages.length, 1);

  // Y el dueño sí puede.
  assert.ok(await updateConversation(A, conversation.id, { title: "Plan revisado" }));
  assert.ok(await appendMessages(A, conversation.id, [{ role: "assistant", content: "Respuesta" }]));
  const final = await getConversation(A, conversation.id);
  assert.equal(final.conversation.title, "Plan revisado");
  assert.equal(final.messages.length, 2);
  assert.equal(final.messages[1].role, "assistant");

  await limpiar();
});

test("borrar se lleva los turnos y no deja huérfanos", only, async () => {
  const { createConversation, deleteConversation } = await mod();
  const prisma = await db();
  await limpiar();

  const { conversation } = await createConversation(A, {
    messages: [{ role: "user", content: "uno" }],
  });
  await (await mod()).appendMessages(A, conversation.id, [{ role: "assistant", content: "dos" }]);

  assert.ok(await deleteConversation(A, conversation.id));
  const restos = await prisma.aiConversationMessage.count({ where: { conversationId: conversation.id } });
  assert.equal(restos, 0);

  await limpiar();
});

test("anexar sube la conversación en la barra lateral (updatedAt se mueve)", only, async () => {
  const { appendMessages, createConversation, listConversations } = await mod();
  await limpiar();

  const primera = await createConversation(A, { messages: [{ role: "user", content: "vieja" }] });
  await new Promise((r) => setTimeout(r, 15));
  const segunda = await createConversation(A, { messages: [{ role: "user", content: "nueva" }] });

  let orden = await listConversations(A);
  assert.deepEqual(orden.map((c) => c.id), [segunda.conversation.id, primera.conversation.id]);

  await new Promise((r) => setTimeout(r, 15));
  await appendMessages(A, primera.conversation.id, [{ role: "user", content: "revivida" }]);

  orden = await listConversations(A);
  assert.deepEqual(orden.map((c) => c.id), [primera.conversation.id, segunda.conversation.id]);
  assert.equal(orden[0].messageCount, 2);

  await limpiar();
});

test("la migración desde localStorage es idempotente y no cruza cuentas", only, async () => {
  const { importLegacyConversations, listConversations } = await mod();
  await limpiar();

  const legacy = [
    {
      id: "local-abc",
      title: "Dosis de amoxicilina",
      group: "clinico",
      updatedAt: Date.now() - 60_000,
      messages: [
        { role: "user", content: "¿Dosis pediátrica?", timestamp: Date.now() - 61_000 },
        { role: "assistant", content: "50 mg/kg/día", timestamp: Date.now() - 60_500 },
      ],
    },
    // Vacía: es la basura que dejaba el comportamiento viejo (creaba una
    // conversación al entrar, escribiera el usuario o no). NO debe subir.
    { id: "local-vacia", title: "Nueva", messages: [] },
    // Sin id: sin llave de idempotencia no se sube (duplicaría en cada recarga).
    { title: "Sin id", messages: [{ role: "user", content: "hola" }] },
  ];

  const primera = await importLegacyConversations(A, legacy);
  assert.equal(primera.imported, 1);

  // Segunda pasada (dos pestañas, o un reintento tras un fallo a medias): 0.
  const segunda = await importLegacyConversations(A, legacy);
  assert.equal(segunda.imported, 0);
  assert.equal((await listConversations(A)).length, 1);

  // El mismo legacyId en OTRA cuenta sí entra: el índice único es
  // (clinicId, userId, legacyId), no legacyId a secas.
  assert.equal((await importLegacyConversations(B, legacy)).imported, 1);
  assert.equal((await listConversations(A)).length, 1);
  assert.equal((await listConversations(B)).length, 1);

  await limpiar();
});

test("pregunta y respuesta NO se cruzan aunque compartan milisegundo", only, async () => {
  const { appendMessages, createConversation, getConversation, importLegacyConversations, listConversations } =
    await mod();
  await limpiar();

  // La página vieja creaba el turno del doctor y el hueco de la respuesta en el
  // MISMO bloque síncrono: dos `Date.now()` que caen en el mismo milisegundo, y
  // la columna es timestamp(3). Sin desempate, al releerlas el orden no está
  // garantizado y la respuesta podía pintarse encima de su pregunta.
  const mismoMs = Date.now() - 120_000;
  await importLegacyConversations(A, [
    {
      id: "local-empate",
      title: "Empate de milisegundo",
      messages: [
        { role: "user", content: "P1", timestamp: mismoMs },
        { role: "assistant", content: "R1", timestamp: mismoMs },
        { role: "user", content: "P2", timestamp: mismoMs },
        { role: "assistant", content: "R2", timestamp: mismoMs },
      ],
    },
  ]);
  const migrada = (await listConversations(A))[0];
  const leida = await getConversation(A, migrada.id);
  assert.deepEqual(leida.messages.map((m) => m.content), ["P1", "R1", "P2", "R2"]);

  // Y lo mismo cuando los turnos se anexan de golpe en una sola llamada.
  const { conversation } = await createConversation(A, {
    messages: [
      { role: "user", content: "A" },
      { role: "assistant", content: "B" },
    ],
  });
  await appendMessages(A, conversation.id, [
    { role: "user", content: "C" },
    { role: "assistant", content: "D" },
  ]);
  const hilo = await getConversation(A, conversation.id);
  assert.deepEqual(hilo.messages.map((m) => m.content), ["A", "B", "C", "D"]);

  await limpiar();
});

test("la búsqueda mira título y contenido, y sigue clavada al dueño", only, async () => {
  const { createConversation, listConversations } = await mod();
  const { sanitizeSearchTerm } = await import("../conversation-core");
  await limpiar();

  await createConversation(A, { title: "Endodoncia 46", messages: [{ role: "user", content: "gutapercha" }] });
  await createConversation(A, { title: "Ortodoncia", messages: [{ role: "user", content: "brackets" }] });
  await createConversation(B, { title: "Endodoncia ajena", messages: [{ role: "user", content: "gutapercha" }] });

  assert.equal((await listConversations(A, { search: "endodoncia" })).length, 1); // insensible a mayúsculas
  assert.equal((await listConversations(A, { search: "gutapercha" })).length, 1); // busca DENTRO de los turnos
  assert.equal((await listConversations(A, { search: "nada de esto" })).length, 0);
  // El comodín de LIKE llega ya limpio: no vuelca nada extra, y de todos modos
  // el where sigue clavado a clinicId + userId.
  assert.equal(sanitizeSearchTerm("%"), null);
  assert.equal((await listConversations(A, { search: sanitizeSearchTerm("%") })).length, 2);
  assert.equal((await listConversations(B, { search: "gutapercha" })).length, 1);

  await limpiar();
});

test("un scope sin clínica o sin usuario CORTA antes de consultar", only, async () => {
  const { AiScopeError, listConversations } = await mod();

  // El fallo que esto evita: `clinicId: undefined` en un where de Prisma no
  // filtra — Prisma descarta la clave y devuelve las filas de TODAS las clínicas.
  await assert.rejects(() => listConversations({ clinicId: undefined, userId: "userA1" } as never), AiScopeError);
  await assert.rejects(() => listConversations({ clinicId: "clinicA", userId: undefined } as never), AiScopeError);
  await assert.rejects(() => listConversations({ clinicId: "", userId: "userA1" }), AiScopeError);
  await assert.rejects(() => listConversations({ clinicId: "  ", userId: "userA1" }), AiScopeError);
  await assert.rejects(() => listConversations(null as never), AiScopeError);
});
