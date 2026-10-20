import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/safe-log";
import { repoHojas } from "@/lib/indicaciones/db";
import { columnaAgendaColorExiste } from "@/lib/agenda/color-procedimiento.server";
import { BANDERAS_AGENDA_FLEXIBLE } from "@/lib/agenda/agenda-flexible";
import { repoVersiones } from "@/lib/plantillas-fabrica/db";
import { plantillasParaSedeNueva } from "@/lib/plantillas-fabrica/copia-sede";
import type { FamiliaVersion } from "@/lib/plantillas-fabrica/versiones";
import { columnaBotBookableExiste } from "@/lib/whatsapp/bot/servicios-agendables-db";
import {
  AJUSTES_QUE_SE_COPIAN,
  ajustesParaSedeNueva,
  banderasParaSedeNueva,
  copiarCatalogo,
  horarioParaSedeNueva,
  religarProcedimientos,
  resultadoVacio,
  type FilaHorario,
  type ResultadoCopia,
  type SeccionCopia,
} from "./copia-sede-core";

/**
 * Copia de configuración de la sede principal a una sede recién creada
 * (ws1-t10, auditoría BEVADENT · M4). Qué se copia y por qué: la cabecera de
 * `copia-sede-core.ts`.
 *
 * Dos tiempos, porque la sede se crea con un nested write en POST /api/clinics:
 *  1. `leerOrigenParaAlta` ANTES de crear: los ajustes escalares y el horario
 *     viajan dentro del propio `clinic.create` (una sola transacción).
 *  2. `copiarConfiguracion` DESPUÉS: catálogo, paquetes, plantillas, hojas y
 *     bot, sección por sección y en best-effort. Si una sección falla, la sede
 *     YA existe y no se tira: se marca `null` en el resultado, el diálogo lo
 *     dice y queda en la bitácora. Nunca se lanza.
 *
 * 🔴 Aislamiento: `origenId` y `destinoId` llegan de la sesión (la principal
 * del dueño y la sede que acaba de crear), nunca del cuerpo de la petición.
 * Todas las lecturas filtran por `origenId` y todas las escrituras llevan
 * `destinoId`; si cualquiera de los dos falta, no se hace nada.
 */

export interface OrigenParaAlta {
  clinicId: string;
  nombre: string;
  ajustes: Record<string, unknown>;
  horario: FilaHorario[];
}

/** La sede principal del dueño: la más antigua donde es SUPER_ADMIN (el mismo criterio que «Aparece en la agenda»). */
export async function sedePrincipalDe(supabaseId: string): Promise<{ clinicId: string; nombre: string } | null> {
  if (!supabaseId) return null;
  const fila = await prisma.user.findFirst({
    where: { supabaseId, role: "SUPER_ADMIN", isActive: true, clinic: { archivedAt: null } },
    orderBy: { clinic: { createdAt: "asc" } },
    select: { clinic: { select: { id: true, name: true } } },
  });
  return fila ? { clinicId: fila.clinic.id, nombre: fila.clinic.name } : null;
}

/** Lo que entra en el `clinic.create` de la sede nueva: ajustes escalares y horario de la principal. */
export async function leerOrigenParaAlta(origen: { clinicId: string; nombre: string }): Promise<OrigenParaAlta> {
  const select = Object.fromEntries(AJUSTES_QUE_SE_COPIAN.map((k) => [k, true])) as Record<string, true>;
  const [clinica, horario] = await Promise.all([
    prisma.clinic.findFirst({ where: { id: origen.clinicId }, select }),
    prisma.clinicSchedule.findMany({
      where: { clinicId: origen.clinicId },
      select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
      orderBy: { dayOfWeek: "asc" },
    }),
  ]);
  const ajustes = ajustesParaSedeNueva((clinica ?? {}) as Record<string, unknown>);
  // Un Json en null no se puede mandar tal cual a `create`: se omite y queda el default.
  for (const k of Object.keys(ajustes)) {
    if ((ajustes as Record<string, unknown>)[k] === null) delete (ajustes as Record<string, unknown>)[k];
  }
  return { clinicId: origen.clinicId, nombre: origen.nombre, ajustes, horario: horarioParaSedeNueva(horario) };
}

export interface ArgsCopia {
  origen: { clinicId: string; nombre: string };
  destinoId: string;
  /** La fila User del dueño en la sede nueva (dueña de las plantillas copiadas). */
  destinoOwnerUserId: string;
}

export async function copiarConfiguracion(args: ArgsCopia): Promise<ResultadoCopia> {
  const r = resultadoVacio(args.origen);
  const { clinicId: origenId } = args.origen;
  const destinoId = args.destinoId;
  if (!origenId || !destinoId || origenId === destinoId) return r;

  // Horario y ajustes ya fueron con el alta (leerOrigenParaAlta); aquí solo se cuentan.
  await seccion(r, "horario", async () => prisma.clinicSchedule.count({ where: { clinicId: destinoId } }));
  r.copiado.ajustes = AJUSTES_QUE_SE_COPIAN.length;

  // Las versiones de la clínica de las plantillas de fábrica (ws1-t6) viajan a la sede nueva:
  // si no, la sede nacería con los textos de fábrica y perdería lo que la clínica ya adaptó.
  const copiarVersiones = async (familias: readonly FamiliaVersion[]): Promise<number> => {
    if (!(await repoVersiones.disponible())) return 0;
    let n = 0;
    for (const familia of familias) {
      for (const v of await repoVersiones.activas(origenId, familia)) {
        await repoVersiones.guardar({
          clinicId: destinoId,
          familia,
          clave: v.clave,
          cuerpo: v.cuerpo,
          userId: args.destinoOwnerUserId,
        });
        n++;
      }
    }
    return n;
  };

  // 1 · Catálogo de procedimientos (+ «Se agenda por WhatsApp»).
  let idViejoANuevo = new Map<string, string>();
  await seccion(r, "catalogo", async () => {
    const filas = await prisma.procedureCatalog.findMany({
      where: { clinicId: origenId },
      select: {
        id: true, name: true, code: true, cieCode: true, category: true, basePrice: true,
        cost: true, duration: true, description: true, isActive: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const copia = copiarCatalogo(filas, destinoId, randomUUID);
    idViejoANuevo = copia.idViejoANuevo;
    if (copia.filas.length > 0) await prisma.procedureCatalog.createMany({ data: copia.filas });
    await copiarMarcasDelBot(origenId, destinoId, idViejoANuevo);
    await copiarColoresDeAgenda(origenId, destinoId, idViejoANuevo);
    return copia.filas.length;
  });

  // 2 · Paquetes de servicios.
  await seccion(r, "paquetes", async () => {
    const filas = await prisma.servicePackage.findMany({
      where: { clinicId: origenId },
      select: { name: true, description: true, totalSessions: true, price: true, validDays: true, bodyZone: true, isActive: true },
    });
    if (filas.length > 0) await prisma.servicePackage.createMany({ data: filas.map((f) => ({ ...f, clinicId: destinoId })) });
    return filas.length;
  });

  // 3 · Política de bloqueos de agenda (una fila por clínica, si la principal la guardó).
  await seccion(r, "ajustes", async () => {
    const pol = await prisma.agendaBlockPolicy.findUnique({
      where: { clinicId: origenId },
      select: { recepcionPuedeAgendar: true },
    });
    if (pol) {
      await prisma.agendaBlockPolicy.upsert({
        where: { clinicId: destinoId },
        create: { clinicId: destinoId, recepcionPuedeAgendar: pol.recepcionPuedeAgendar, updatedById: args.destinoOwnerUserId },
        update: { recepcionPuedeAgendar: pol.recepcionPuedeAgendar, updatedById: args.destinoOwnerUserId },
      });
    }
    return AJUSTES_QUE_SE_COPIAN.length + (pol ? 1 : 0);
  });

  // 4 · Plantillas de documentos: notas de evolución y consentimientos.
  for (const [seccionNombre, kind] of [
    ["plantillasNotas", "NOTA_EVOLUCION"],
    ["plantillasConsentimientos", "CONSENTIMIENTO"],
  ] as const) {
    await seccion(r, seccionNombre, async () => {
      const filas = await prisma.documentTemplate.findMany({
        where: { clinicId: origenId, kind, deletedAt: null },
        select: { name: true, body: true, isActive: true, createdById: true },
      });
      if (filas.length > 0) {
        await prisma.documentTemplate.createMany({
          // Las de fábrica (sin autor) siguen sin autor en la sede nueva: ofrecen «Volver a la de fábrica».
          data: plantillasParaSedeNueva(filas, kind, destinoId, args.destinoOwnerUserId),
          skipDuplicates: true,
        });
      }
      return filas.length;
    });
  }

  // 5 · Plantillas SOAP por módulo clínico.
  await seccion(r, "plantillasEvolucion", async () => {
    const filas = await prisma.clinicalEvolutionTemplate.findMany({
      where: { clinicId: origenId, deletedAt: null },
      select: { module: true, name: true, soapTemplate: true, proceduresPrefilled: true, isDefault: true },
    });
    if (filas.length > 0) {
      await prisma.clinicalEvolutionTemplate.createMany({
        data: filas.map((f) => ({
          clinicId: destinoId,
          module: f.module,
          name: f.name,
          soapTemplate: f.soapTemplate as object,
          proceduresPrefilled: religarProcedimientos(f.proceduresPrefilled, idViejoANuevo),
          isDefault: f.isDefault,
          createdBy: args.destinoOwnerUserId,
        })),
        skipDuplicates: true,
      });
    }
    // Las versiones de la clínica de las notas de ortodoncia de fábrica (ws1-t6) viajan con ellas.
    return filas.length + (await copiarVersiones(["ORTO_NOTA"]));
  });

  // 6 · Hojas de indicaciones y constancias (tabla por SQL crudo; sin tabla, 0).
  await seccion(r, "indicaciones", async () => {
    if (!(await repoHojas.tablaExiste())) return 0;
    const hojas = await repoHojas.listar(origenId);
    const activas = hojas.filter((h) => h.activa);
    if (activas.length > 0) {
      await repoHojas.sembrar(
        activas.map((h) => ({
          clinicId: destinoId,
          tipo: h.tipo,
          nombre: h.nombre,
          cuerpo: h.cuerpo,
          procedureIds: religarProcedimientos(h.procedureIds, idViejoANuevo),
          factoryKey: h.factoryKey,
          basadaEn: h.basadaEn,
          createdById: args.destinoOwnerUserId,
        })),
      );
    }
    // Y sus versiones de la clínica (ws1-t6): la hoja de fábrica llega con el texto de fábrica y la versión encima.
    return activas.length + (await copiarVersiones(["HOJA_INDICACIONES", "HOJA_CONSTANCIA"]));
  });

  // 7 · Textos del bot de WhatsApp, con el bot apagado (la conexión es por sede).
  await seccion(r, "botWhatsApp", async () => {
    const cfg = await prisma.whatsAppBotConfig.findUnique({
      where: { clinicId: origenId },
      select: {
        botName: true, persona: true, greeting: true, businessHours: true, afterHoursMsg: true,
        canAnswerFaq: true, canBookAppointments: true, fallbackToHuman: true,
        faqs: { where: { enabled: true }, select: { question: true, answer: true, order: true }, orderBy: { order: "asc" } },
      },
    });
    if (!cfg) return 0;
    const { faqs, businessHours, ...textos } = cfg;
    await prisma.whatsAppBotConfig.upsert({
      where: { clinicId: destinoId },
      create: {
        clinicId: destinoId,
        enabled: false,
        ...textos,
        ...(businessHours !== null ? { businessHours: businessHours as object } : {}),
        faqs: { create: faqs.map((f) => ({ clinicId: destinoId, question: f.question, answer: f.answer, order: f.order })) },
      },
      update: {},
    });
    return 1 + faqs.length;
  });

  return r;
}

/** «Se agenda por WhatsApp»: columna fuera de schema.prisma; sin ella, no se copia y no se falla. */
async function copiarMarcasDelBot(origenId: string, destinoId: string, idViejoANuevo: ReadonlyMap<string, string>): Promise<void> {
  if (idViejoANuevo.size === 0 || !(await columnaBotBookableExiste())) return;
  try {
    const marcados = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "procedure_catalog" WHERE "clinicId" = ${origenId} AND "botBookable" = true`;
    const nuevos = marcados.map((m) => idViejoANuevo.get(m.id)).filter((id): id is string => !!id);
    if (nuevos.length === 0) return;
    await prisma.$executeRaw`
      UPDATE "procedure_catalog" SET "botBookable" = true
       WHERE "clinicId" = ${destinoId} AND "id" = ANY(${nuevos}::text[])`;
  } catch (e) {
    logError("[copia-sede] marcas «Se agenda por WhatsApp»", e);
  }
}

/** Color de agenda de cada procedimiento: columna fuera de schema.prisma; sin ella, no se copia y no se falla. */
async function copiarColoresDeAgenda(origenId: string, destinoId: string, idViejoANuevo: ReadonlyMap<string, string>): Promise<void> {
  if (idViejoANuevo.size === 0 || !(await columnaAgendaColorExiste())) return;
  try {
    const coloreados = await prisma.$queryRaw<{ id: string; agendaColor: string }[]>`
      SELECT "id", "agendaColor" FROM "procedure_catalog" WHERE "clinicId" = ${origenId} AND "agendaColor" IS NOT NULL`;
    // Un UPDATE por clave de color (son ~10), con los ids nuevos de ese grupo.
    const porColor = new Map<string, string[]>();
    for (const c of coloreados) {
      const nuevo = idViejoANuevo.get(c.id);
      if (!nuevo) continue;
      porColor.set(c.agendaColor, [...(porColor.get(c.agendaColor) ?? []), nuevo]);
    }
    for (const [color, nuevos] of porColor) {
      await prisma.$executeRaw`
        UPDATE "procedure_catalog" SET "agendaColor" = ${color}
         WHERE "clinicId" = ${destinoId} AND "id" = ANY(${nuevos}::text[])`;
    }
  } catch (e) {
    logError("[copia-sede] color de agenda de los procedimientos", e);
  }
}

/**
 * Banderas de la agenda flexible: la sede nueva hereda las de la principal.
 * Va APARTE de `copiarConfiguracion` porque se hereda aunque el dueño no marque
 * «copiar la configuración». No lanza: la sede se crea igual si esto falla.
 */
export async function heredarBanderasDeAgenda(origenId: string, destinoId: string): Promise<void> {
  if (!origenId || !destinoId || origenId === destinoId) return;
  try {
    const sonda = await prisma.$queryRaw<{ existe: boolean }[]>`SELECT to_regclass('public.clinic_feature_flags') IS NOT NULL AS existe`;
    if (sonda[0]?.existe !== true) return;
    const filas = await prisma.clinicFeatureFlag.findMany({
      where: { clinicId: origenId, flag: { in: [...BANDERAS_AGENDA_FLEXIBLE] } },
      select: { flag: true, enabled: true },
    });
    const heredar = banderasParaSedeNueva(filas);
    if (heredar.length === 0) return;
    await prisma.clinicFeatureFlag.createMany({
      data: heredar.map((r) => ({ clinicId: destinoId, ...r })),
      skipDuplicates: true,
    });
  } catch (e) {
    logError("[copia-sede] banderas de la agenda flexible", e);
  }
}

/** Corre una sección; si falla, la marca en `null` y sigue con la siguiente. */
async function seccion(r: ResultadoCopia, nombre: SeccionCopia, fn: () => Promise<number>): Promise<void> {
  try {
    r.copiado[nombre] = await fn();
  } catch (e) {
    r.copiado[nombre] = null;
    logError(`[copia-sede] sección ${nombre}`, e);
  }
}
