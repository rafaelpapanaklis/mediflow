// Una «Google Calendar» falsa para las pruebas de la sincronización.
//
// Imita lo que importa de la API real (no el transporte):
//   · events.insert con `id` propio: si ese id ya existe —aunque el evento esté
//     borrado/cancelado— contesta 409, como Google.
//   · events.patch MEZCLA: solo cambia lo que va en el cuerpo; un evento
//     inexistente da 404. (Por eso mover una cita con patch conserva invitados
//     y recordatorios.)
//   · events.update REEMPLAZA el evento entero (lo que hacía el código viejo):
//     existe aquí para poder demostrar que ya nadie lo llama (contador).
//   · events.delete no quita el evento, lo deja `status: cancelled`; borrar dos
//     veces da 410; uno que no existe, 404.
//   · calendars con marca de descripción. Con `alcanceEstrecho` (el permiso
//     `calendar.app.created` que pide la app hoy) imita lo que ese permiso NO
//     cubre: calendarList.* y calendars.patch dan 403 insufficientPermissions, y
//     un calendario que no creó la app (sembrado con `propio: false`) da 404 al
//     consultarlo y 403 al tocar sus eventos.
//
// Además registra cada llamada y deja programar fallos por operación.

import type { ClienteCalendar } from "@/lib/google-calendar";

export function errorGoogle(status: number, razon?: string, mensaje = `Google ${status}`) {
  return Object.assign(new Error(mensaje), {
    code: String(status),
    response: { status, data: { error: { code: status, message: mensaje, errors: razon ? [{ reason: razon }] : [] } } },
  });
}

export function errorInvalidGrant() {
  return Object.assign(new Error("invalid_grant"), {
    code: "400",
    response: { status: 400, data: { error: "invalid_grant", error_description: "Token has been expired or revoked." } },
  });
}

export interface EventoFalso {
  id: string;
  status: "confirmed" | "cancelled";
  [k: string]: any;
}

export class GoogleFalsa implements ClienteCalendar {
  calendarios = new Map<string, { id: string; summary: string; description: string; colorId?: string; timeZone?: string; propio: boolean }>();
  /** true = solo lo que cubre `calendar.app.created`. */
  alcanceEstrecho = false;
  eventos = new Map<string, EventoFalso>();
  llamadas: { op: string; args: any }[] = [];
  updates = 0;
  private fallos: { op: string; quedan: number; error: Error }[] = [];
  private seq = 0;
  /** Se ejecuta antes de cada operación (para simular lentitud o un token renovado). */
  antes: ((op: string) => Promise<void> | void) | null = null;

  /** Falla `veces` veces la operación `op` (p. ej. "events.insert") con `error`. */
  fallar(op: string, error: Error, veces = 1) {
    this.fallos.push({ op, quedan: veces, error });
  }

  private async paso(op: string, args: any) {
    this.llamadas.push({ op, args });
    if (this.antes) await this.antes(op);
    const f = this.fallos.find((x) => x.op === op && x.quedan > 0);
    if (f) {
      f.quedan--;
      throw f.error;
    }
  }

  cuantas(op: string) {
    return this.llamadas.filter((l) => l.op === op).length;
  }

  eventoEn(calendarId: string, eventId: string) {
    return this.eventos.get(`${calendarId}/${eventId}`);
  }

  activos(calendarId?: string) {
    return [...this.eventos.entries()]
      .filter(([k, e]) => e.status !== "cancelled" && (!calendarId || k.startsWith(`${calendarId}/`)))
      .map(([, e]) => e);
  }

  /** Siembra un calendario ya existente en la cuenta (p. ej. el de otra clínica). */
  sembrarCalendario(id: string, summary: string, description: string, propio = true) {
    this.calendarios.set(id, { id, summary, description, propio });
  }

  /** Con el permiso estrecho, un calendario que no creó la app está fuera de alcance. */
  private fueraDeAlcance(calendarId: string) {
    const c = this.calendarios.get(calendarId);
    return this.alcanceEstrecho && !!c && !c.propio;
  }

  events = {
    insert: async (p: { calendarId: string; sendUpdates?: string; requestBody: Record<string, any> }) => {
      await this.paso("events.insert", p);
      if (this.fueraDeAlcance(p.calendarId)) throw errorGoogle(403, "insufficientPermissions", "Insufficient Permission");
      if (!this.calendarios.has(p.calendarId) && p.calendarId !== "primary") throw errorGoogle(404, "notFound", "Not Found");
      const id = p.requestBody.id ?? `g${++this.seq}`;
      const k = `${p.calendarId}/${id}`;
      if (this.eventos.has(k)) throw errorGoogle(409, "duplicate", "The requested identifier already exists.");
      this.eventos.set(k, { ...structuredClone(p.requestBody), id, status: "confirmed" });
      return { data: { id } };
    },
    patch: async (p: { calendarId: string; eventId: string; sendUpdates?: string; requestBody: Record<string, any> }) => {
      await this.paso("events.patch", p);
      if (this.fueraDeAlcance(p.calendarId)) throw errorGoogle(403, "insufficientPermissions", "Insufficient Permission");
      const k = `${p.calendarId}/${p.eventId}`;
      const e = this.eventos.get(k);
      if (!e) throw errorGoogle(404, "notFound", "Not Found");
      Object.assign(e, structuredClone(p.requestBody)); // mezcla: lo que no va, se queda
      return { data: { id: p.eventId } };
    },
    /** El reemplazo total del código viejo: si alguien lo llama, `updates` lo delata. */
    update: async (p: { calendarId: string; eventId: string; requestBody: Record<string, any> }) => {
      this.updates++;
      await this.paso("events.update", p);
      const k = `${p.calendarId}/${p.eventId}`;
      if (!this.eventos.has(k)) throw errorGoogle(404, "notFound", "Not Found");
      this.eventos.set(k, { ...structuredClone(p.requestBody), id: p.eventId, status: "confirmed" });
      return { data: { id: p.eventId } };
    },
    delete: async (p: { calendarId: string; eventId: string; sendUpdates?: string }) => {
      await this.paso("events.delete", p);
      if (this.fueraDeAlcance(p.calendarId)) throw errorGoogle(403, "insufficientPermissions", "Insufficient Permission");
      const k = `${p.calendarId}/${p.eventId}`;
      const e = this.eventos.get(k);
      if (!e) throw errorGoogle(404, "notFound", "Not Found");
      if (e.status === "cancelled") throw errorGoogle(410, "deleted", "Resource has been deleted");
      e.status = "cancelled";
      return {};
    },
  };

  /** Lo que el permiso estrecho no cubre: si alguien lo llama con `alcanceEstrecho`, da 403 como Google. */
  calendarList = {
    list: async (p?: any) => {
      await this.paso("calendarList.list", p);
      if (this.alcanceEstrecho) throw errorGoogle(403, "insufficientPermissions", "Request had insufficient authentication scopes.");
      return { data: { items: [...this.calendarios.values()].map((c) => ({ id: c.id, summary: c.summary, description: c.description })) } };
    },
    patch: async (p: any) => {
      await this.paso("calendarList.patch", p);
      if (this.alcanceEstrecho) throw errorGoogle(403, "insufficientPermissions", "Request had insufficient authentication scopes.");
      return {};
    },
  };

  calendars = {
    insert: async (p: { requestBody: Record<string, any> }) => {
      await this.paso("calendars.insert", p);
      const id = `cal${++this.seq}@group.calendar.google.com`;
      this.calendarios.set(id, { id, summary: p.requestBody.summary, description: p.requestBody.description, timeZone: p.requestBody.timeZone, propio: true });
      return { data: { id } };
    },
    get: async (p: { calendarId: string }) => {
      await this.paso("calendars.get", p);
      if (!this.calendarios.has(p.calendarId) || this.fueraDeAlcance(p.calendarId)) throw errorGoogle(404, "notFound", "Not Found");
      return { data: { id: p.calendarId } };
    },
    delete: async (p: { calendarId: string }) => {
      await this.paso("calendars.delete", p);
      this.calendarios.delete(p.calendarId);
      return {};
    },
    /** Fuera del contrato `ClienteCalendar` (la app ya no lo usa): existe para que, si alguien lo llama, lo delate. */
    patch: async (p: { calendarId: string; requestBody: Record<string, any> }) => {
      await this.paso("calendars.patch", p);
      if (this.alcanceEstrecho) throw errorGoogle(403, "insufficientPermissions", "Request had insufficient authentication scopes.");
      const c = this.calendarios.get(p.calendarId);
      if (!c) throw errorGoogle(404, "notFound", "Not Found");
      Object.assign(c, p.requestBody);
      return {};
    },
  };
}
