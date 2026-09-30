/**
 * Soporte — editar / retirar / adjuntar a una respuesta ya enviada, de punta a
 * punta: la ruta REAL (`PATCH/DELETE …/messages/[messageId]`) sobre el service
 * REAL, con un Prisma en memoria que sabe hacer el nested write del service y
 * puede simular que `support_message_revisions` todavía NO existe (el SQL sin
 * aplicar).
 *
 * `npm run test:soporte-mensaje-edicion`
 */
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const CL = "cl-prueba";
const TK = "tk-1";

interface Msg {
  id: string;
  ticketId: string;
  authorType: string;
  authorId: string | null;
  authorName: string | null;
  body: string;
  attachments: unknown;
  internalNote: boolean;
  createdAt: Date;
}
interface Rev {
  id: string;
  messageId: string;
  ticketId: string;
  kind: string;
  previousBody: string;
  previousAttachments: unknown;
  editedById: string | null;
  editedByName: string | null;
  createdAt: Date;
}

const db = {
  tablaExiste: true,
  clienteViejo: false, // simula un cliente de Prisma generado antes del cambio
  ticket: null as any,
  mensajes: [] as Msg[],
  revisiones: [] as Rev[],
  sesion: { user: { id: "adm-1", email: "soporte@dalecontrol.com" } } as any,
  correos: [] as string[],
};

const ATT = (n: string) => ({ path: `support/${CL}/${n}.png`, name: `${n}.png`, size: 100, type: "image/png" });

function reset() {
  db.tablaExiste = true;
  db.clienteViejo = false;
  db.sesion = { user: { id: "adm-1", email: "soporte@dalecontrol.com" } };
  db.correos = [];
  db.ticket = {
    id: TK, folio: 6, clinicId: CL, createdById: "u1", createdByName: "Ana", subject: "Prueba", category: "DUDA",
    priority: "NORMAL", status: "ESPERANDO_RESPUESTA", rating: null, firstResponseAt: new Date("2026-09-29T10:00:00Z"),
    lastClinicMessageAt: new Date("2026-09-29T09:00:00Z"), lastSupportMessageAt: new Date("2026-09-29T10:00:00Z"),
    clinicUnread: false, closedAt: null, createdAt: new Date("2026-09-29T09:00:00Z"), updatedAt: new Date("2026-09-29T10:00:00Z"),
  };
  const base = { ticketId: TK, authorId: null, attachments: null, internalNote: false };
  db.mensajes = [
    { ...base, id: "m-clinica", authorType: "clinic", authorName: "Ana", body: "No me deja agendar", createdAt: new Date("2026-09-29T09:00:00Z") },
    { ...base, id: "m-soporte", authorType: "support", authorName: "Soporte DaleControl", body: "Ya lo revisamos.", attachments: [ATT("captura")], createdAt: new Date("2026-09-29T10:00:00Z") },
    { ...base, id: "m-nota", authorType: "support", authorName: "Soporte DaleControl", body: "Nota: era el plan", internalNote: true, createdAt: new Date("2026-09-29T10:05:00Z") },
    { ...base, id: "m-sistema", authorType: "system", authorName: null, body: "Soporte cambió el estado", createdAt: new Date("2026-09-29T10:10:00Z") },
  ];
  db.revisiones = [];
}

function errTablaNoExiste() {
  return Object.assign(new Error('The table `public.support_message_revisions` does not exist in the current database.'), { code: "P2021" });
}

const prismaDoble = {
  get supportMessageRevision() {
    if (db.clienteViejo) return undefined;
    return {
      findMany: async ({ where }: any) => {
        if (!db.tablaExiste) throw errTablaNoExiste();
        return db.revisiones.filter((r) => r.ticketId === where.ticketId).map((r) => ({ messageId: r.messageId, kind: r.kind, createdAt: r.createdAt }));
      },
    };
  },
  supportTicket: {
    findUnique: async ({ where, include }: any) => {
      if (where.id !== db.ticket.id) return null;
      return include?.messages ? { ...db.ticket, messages: db.mensajes.slice() } : { ...db.ticket };
    },
    findFirst: async ({ where, include }: any) => {
      if (where.id !== db.ticket.id || where.clinicId !== db.ticket.clinicId) return null;
      const t: any = { ...db.ticket };
      if (include?.messages) {
        t.messages = db.mensajes.filter((m) => (include.messages.where?.internalNote === false ? !m.internalNote : true));
      }
      return t;
    },
    update: async ({ where, data }: any) => {
      assert.equal(where.id, db.ticket.id);
      const upd = data.messages?.update;
      if (upd) {
        if (db.clienteViejo) throw new Error("Unknown argument `revisions`. Available options are marked with ?.");
        if (upd.data.revisions && !db.tablaExiste) throw errTablaNoExiste(); // atómico: nada se aplica
        const m = db.mensajes.find((x) => x.id === upd.where.id && x.ticketId === where.id);
        if (!m) throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
        const previo = m.body; void previo;
        if ("body" in upd.data) m.body = upd.data.body;
        if ("attachments" in upd.data) m.attachments = upd.data.attachments;
        if (upd.data.revisions?.create) {
          db.revisiones.push({ id: `r${db.revisiones.length + 1}`, messageId: m.id, createdAt: new Date(), ...upd.data.revisions.create });
        }
      }
      if ("clinicUnread" in data) db.ticket.clinicUnread = data.clinicUnread;
      return { ...db.ticket };
    },
  },
  supportMessage: {
    findFirst: async ({ where }: any) => db.mensajes.find((m) => m.id === where.id && m.ticketId === where.ticketId) ?? null,
  },
  clinic: { findUnique: async () => ({ name: "Clínica de Prueba", email: "clinica@example.com" }) },
  user: { findUnique: async () => ({ email: "ana@example.com" }) },
};

let PATCH: (req: any, ctx: any) => Promise<Response>;
let DELETE: (req: any, ctx: any) => Promise<Response>;
let servicio: typeof import("../service");
let NextRequestCtor: any;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  mock.module("@/lib/storage", {
    namedExports: { signMaybeUrls: async (paths: string[]) => paths.map((p) => `https://firmada.test/${p}`), BUCKETS: { PATIENT_FILES: "patient-files" } },
  });
  const noti = async (ctx: any) => { db.correos.push(`${ctx.folio}`); };
  mock.module("@/lib/support/notifications", {
    namedExports: { notifyNewTicket: noti, notifyClinicReply: noti, notifySupportReply: noti, notifyStatusChange: noti },
  });
  mock.module("@/lib/admin-auth", { namedExports: { getAdminSession: async () => db.sesion, isAdminAuthed: async () => db.sesion !== null } });
  servicio = await import("../service");
  const { NextRequest } = await import("next/server");
  NextRequestCtor = NextRequest;
  const ruta = await import("@/app/api/admin/support/tickets/[id]/messages/[messageId]/route");
  PATCH = ruta.PATCH as any;
  DELETE = ruta.DELETE as any;
});
beforeEach(reset);

const url = (id = "m-soporte") => `http://localhost/api/admin/support/tickets/${TK}/messages/${id}`;
const patch = (body: unknown, id = "m-soporte", tk = TK) =>
  PATCH(new NextRequestCtor(url(id), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: { id: tk, messageId: id } });
const borrar = (id = "m-soporte", tk = TK) =>
  DELETE(new NextRequestCtor(url(id), { method: "DELETE" }), { params: { id: tk, messageId: id } });
const mensajeDe = (rol: "clinica" | "admin") => (rol === "admin" ? servicio.getTicketForAdmin(TK) : servicio.getTicketForClinic(TK, CL));

test("sin sesión de admin: 401 y no cambia nada", async () => {
  db.sesion = null;
  assert.equal((await patch({ body: "x" })).status, 401);
  assert.equal((await borrar()).status, 401);
  assert.equal(db.mensajes.find((m) => m.id === "m-soporte")!.body, "Ya lo revisamos.");
});

test("editar: cambia el texto, guarda el original y deja «(editado)» con fecha para la clínica y para soporte", async () => {
  const res = await patch({ body: "Ya lo revisamos y quedó corregido." });
  assert.equal(res.status, 200);
  const { message } = await res.json();
  assert.equal(message.body, "Ya lo revisamos y quedó corregido.");
  assert.ok(message.editedAt);
  assert.equal(message.retractedAt, null);

  assert.equal(db.revisiones.length, 1);
  assert.equal(db.revisiones[0].kind, "edit");
  assert.equal(db.revisiones[0].previousBody, "Ya lo revisamos.");
  assert.equal(db.revisiones[0].editedById, "adm-1");
  assert.equal(db.revisiones[0].editedByName, "soporte@dalecontrol.com");

  for (const rol of ["clinica", "admin"] as const) {
    const hilo = await mensajeDe(rol);
    const m = hilo!.messages.find((x) => x.id === "m-soporte")!;
    assert.equal(m.body, "Ya lo revisamos y quedó corregido.", rol);
    assert.ok(m.editedAt, `${rol} ve la fecha de edición`);
    // los demás mensajes no se tocan
    assert.equal(hilo!.messages.find((x) => x.id === "m-clinica")!.editedAt, null);
  }
});

test("editar levanta clinicUnread (la clínica ve la novedad) y NO manda correo", async () => {
  db.ticket.clinicUnread = false;
  await patch({ body: "Texto nuevo" });
  assert.equal(db.ticket.clinicUnread, true);
  assert.deepEqual(db.correos, []);
});

test("editar NO cambia el estado del ticket ni sus fechas de respuesta", async () => {
  const antes = { status: db.ticket.status, ultima: db.ticket.lastSupportMessageAt };
  await patch({ body: "Texto nuevo" });
  assert.equal(db.ticket.status, antes.status);
  assert.equal(db.ticket.lastSupportMessageAt, antes.ultima);
});

test("retirar: en su lugar queda «Respuesta retirada por soporte», sin archivos, y el original se conserva", async () => {
  const res = await borrar();
  assert.equal(res.status, 200);
  const { message } = await res.json();
  assert.equal(message.body, "Respuesta retirada por soporte");
  assert.deepEqual(message.attachments, []);
  assert.ok(message.retractedAt);

  assert.equal(db.revisiones.length, 1);
  assert.equal(db.revisiones[0].kind, "retract");
  assert.equal(db.revisiones[0].previousBody, "Ya lo revisamos.");
  assert.deepEqual((db.revisiones[0].previousAttachments as any[]).map((a) => a.name), ["captura.png"]);
  // la fila sigue existiendo: NO se borró
  assert.ok(db.mensajes.find((m) => m.id === "m-soporte"));
  // la clínica ve la novedad en su lista (antes de abrir el hilo, que la marca leída)
  assert.equal(db.ticket.clinicUnread, true);

  for (const rol of ["clinica", "admin"] as const) {
    const m = (await mensajeDe(rol))!.messages.find((x) => x.id === "m-soporte")!;
    assert.equal(m.body, "Respuesta retirada por soporte", rol);
    assert.deepEqual(m.attachments, [], rol);
    assert.ok(m.retractedAt, rol);
  }
  assert.deepEqual(db.correos, []);
});

test("un mensaje retirado nunca deja ver su texto ni sus archivos aunque la fila conserve datos viejos", async () => {
  // fila «sucia»: retirada en el historial pero con cuerpo y archivos aún en la fila
  db.revisiones.push({ id: "r0", messageId: "m-soporte", ticketId: TK, kind: "retract", previousBody: "x", previousAttachments: null, editedById: null, editedByName: null, createdAt: new Date() });
  const m = (await mensajeDe("clinica"))!.messages.find((x) => x.id === "m-soporte")!;
  assert.equal(m.body, "Respuesta retirada por soporte");
  assert.deepEqual(m.attachments, []);
});

test("retirar dos veces o editar una retirada: 409", async () => {
  assert.equal((await borrar()).status, 200);
  assert.equal((await borrar()).status, 409);
  assert.equal((await patch({ body: "otra" })).status, 409);
  assert.equal(db.revisiones.length, 1);
});

test("los mensajes de la clínica y los del sistema no se tocan (403) y no cambian", async () => {
  for (const id of ["m-clinica", "m-sistema"]) {
    assert.equal((await patch({ body: "hackeado" }, id)).status, 403, id);
    assert.equal((await borrar(id)).status, 403, id);
  }
  assert.equal(db.mensajes.find((m) => m.id === "m-clinica")!.body, "No me deja agendar");
  assert.equal(db.revisiones.length, 0);
});

test("un mensaje de OTRO ticket no se alcanza por la URL de este: 404", async () => {
  db.mensajes.push({ id: "m-ajeno", ticketId: "otro-ticket", authorType: "support", authorId: null, authorName: "S", body: "ajeno", attachments: null, internalNote: false, createdAt: new Date() });
  assert.equal((await patch({ body: "x" }, "m-ajeno")).status, 404);
  assert.equal((await borrar("m-ajeno")).status, 404);
  assert.equal(db.mensajes.find((m) => m.id === "m-ajeno")!.body, "ajeno");
  assert.equal((await patch({ body: "x" }, "m-soporte", "no-existe")).status, 404);
});

test("adjuntar un archivo a una respuesta ya enviada: queda agregado, «(editado)» y el texto igual", async () => {
  const res = await patch({ attachments: [ATT("nueva")] });
  assert.equal(res.status, 200);
  const { message } = await res.json();
  assert.equal(message.body, "Ya lo revisamos.");
  assert.deepEqual(message.attachments.map((a: any) => a.name), ["captura.png", "nueva.png"]);
  assert.ok(message.attachments.every((a: any) => a.signedUrl));
  assert.ok(message.editedAt);
  assert.equal(db.revisiones[0].kind, "attach");
  // lo que había antes queda guardado
  assert.deepEqual((db.revisiones[0].previousAttachments as any[]).map((a) => a.name), ["captura.png"]);
});

test("un adjunto de OTRA clínica se rechaza (anti cross-tenant) y no cambia nada", async () => {
  const res = await patch({ attachments: [{ ...ATT("x"), path: "support/otra-clinica/x.png" }] });
  assert.equal(res.status, 400);
  assert.equal(db.revisiones.length, 0);
  assert.equal((db.mensajes.find((m) => m.id === "m-soporte")!.attachments as any[]).length, 1);
});

test("guardar sin cambios reales: 400 y no queda ninguna revisión", async () => {
  assert.equal((await patch({ body: "Ya lo revisamos." })).status, 400);
  assert.equal((await patch({})).status, 400);
  assert.equal(db.revisiones.length, 0);
});

test("una nota interna también se puede corregir/retirar, pero NO levanta el aviso de la clínica", async () => {
  db.ticket.clinicUnread = false;
  const r = await borrar("m-nota");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).message.body, "Nota interna retirada por soporte");
  assert.equal(db.ticket.clinicUnread, false);
  // y la clínica nunca la ve, retirada o no
  assert.equal((await mensajeDe("clinica"))!.messages.some((m) => m.id === "m-nota"), false);
});

test("SIN el SQL aplicado: el hilo se lee igual y editar/retirar responden 503 con el motivo, sin cambiar nada", async () => {
  db.tablaExiste = false;
  for (const rol of ["clinica", "admin"] as const) {
    const hilo = await mensajeDe(rol);
    const m = hilo!.messages.find((x) => x.id === "m-soporte")!;
    assert.equal(m.body, "Ya lo revisamos.", rol);
    assert.equal(m.editedAt, null, rol);
  }
  const r1 = await patch({ body: "cambio" });
  assert.equal(r1.status, 503);
  assert.match((await r1.json()).error, /soporte-mensajes-edicion\.sql/);
  const r2 = await borrar();
  assert.equal(r2.status, 503);
  assert.equal(db.mensajes.find((m) => m.id === "m-soporte")!.body, "Ya lo revisamos.");
  assert.equal(db.ticket.clinicUnread, false);
});

test("con un cliente de Prisma viejo (sin el modelo) el hilo se lee y editar responde 503", async () => {
  db.clienteViejo = true;
  const hilo = await mensajeDe("admin");
  assert.equal(hilo!.messages.length, 4);
  assert.equal((await patch({ body: "cambio" })).status, 503);
  assert.equal((await borrar()).status, 503);
});

test("enviar un mensaje nuevo sigue igual (toMessageDTOs sin estados)", async () => {
  const dto = await (servicio as any).getTicketForAdmin(TK);
  assert.equal(dto.messages.length, 4);
  assert.ok(dto.messages.every((m: any) => m.editedAt === null && m.retractedAt === null));
});
