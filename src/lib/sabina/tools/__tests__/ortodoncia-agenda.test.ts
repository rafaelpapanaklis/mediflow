/**
 * Sabina AGENDA ortodoncia y NO la cobra (ws1-t11, decisión de Rafael del
 * 28-sep-2026, «opción B»).
 *
 *   npm run test:sabina-ortodoncia-agenda
 *
 * Lo que se prueba, y por qué cada cosa:
 *
 *  1. 🔴 AGENDAR UN CONTROL. A un paciente con caso activo, «agéndale su
 *     control» sale con el tipo de cita del catálogo de Configuración (su texto
 *     EXACTO, que es lo que el módulo reconoce como control), con su DOCTOR
 *     TRATANTE y con la duración que la clínica le puso. Y sigue siendo
 *     `agendar_cita`: propone y no escribe, respeta la ocupación, los bloqueos,
 *     el rol y la key `agenda.create`, y la propuesta se revalida igual.
 *  2. 🔴 SIN CASO, VALORACIÓN — solo si lo piden. Y quien tiene caso también
 *     viene a limpieza: lo que no es de ortodoncia se agenda como siempre.
 *  3. 🔴 NO COBRA ORTODONCIA. La factura del tratamiento, un control cobrado
 *     aparte o un extra del caso no producen tarjeta ni piden el método: se
 *     contesta con el dato y el enlace. Una factura que no es de ortodoncia,
 *     del mismo paciente, se cobra como siempre. Y si no se puede comprobar,
 *     no se cobra.
 *  4. Una sede SIN el módulo agenda como siempre, y las recetas siguen sin
 *     poder crearse: ninguna acción nueva.
 */

import { pantalla } from "./preparar-orto"; // PRIMERO
import { test } from "node:test";
import assert from "node:assert/strict";

import { scheduleDayOfISO } from "@/lib/agenda/clinic-hours";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { getEffectivePermissions } from "@/lib/auth/permissions";
import { ACCIONES_SABINA, SABINA_TOOLS } from "../../engine-catalog";
import { ejecutarSabina, type TurnoModelo } from "../../engine";
import { prepararCobro } from "../../dinero/cobrar-factura";
import { prepararAviso } from "../../dinero/avisar-saldo";
import { facturaDeOrtodoncia } from "../../dinero/orto-candado";
import type { SabinaCtx } from "../../tipos";
import { revalidarPropuestaAgenda } from "../agenda-acciones";
import { agendarCita } from "../agendar-cita";
import { correrHerramienta } from "../base";
import { sumarDias } from "../fechas";
import { duracionDeTipo, elegirTipoDeCita } from "../orto-agenda";
import type { BaseDoble, Fila } from "./doble-base";
import { CL_SIN_MODULO, baseOrtoConAgenda, sesion, type OpcionesDeAgenda } from "./orto-siembra";
import { CL_NORTE, CL_SUR, HOY_N, TZ_NORTE, U_DOC2_N, U_DOC_N, U_RECEP_N } from "./siembra";

/* ── utilería ───────────────────────────────────────────────────────── */

/** Un martes, miércoles o jueves futuro: la clínica del norte abre de 09:00 a 19:00. */
const DIA = (() => {
  for (let i = 2; i < 16; i++) {
    const f = sumarDias(HOY_N, i);
    if ([1, 2, 3].includes(scheduleDayOfISO(f, TZ_NORTE))) return f;
  }
  throw new Error("no hay día de prueba");
})();

const en = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return tzLocalToUtc(DIA, h, m, TZ_NORTE);
};

const OPS_DE_LECTURA = new Set(["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"]);

function montar(op: OpcionesDeAgenda = {}): { db: BaseDoble; escrituras: string[]; datos: any } {
  const b = baseOrtoConAgenda(op);
  const escrituras: string[] = [];
  const trampa = new Proxy(b.db as any, {
    get(objetivo, clave) {
      const valor = objetivo[clave];
      if (clave === "contador" || typeof clave !== "string" || valor === undefined) return valor;
      if (clave === "$queryRaw") return valor.bind(objetivo);
      if (typeof valor === "function") {
        escrituras.push(clave);
        throw new Error(`escritura prohibida: ${clave}`);
      }
      return new Proxy(valor, {
        get(delegado, operacion) {
          if (typeof operacion === "string" && !OPS_DE_LECTURA.has(operacion)) {
            escrituras.push(`${clave}.${operacion}`);
            throw new Error(`escritura prohibida: ${clave}.${operacion}`);
          }
          return delegado[operacion];
        },
      });
    },
  }) as BaseDoble;
  pantalla.db = trampa;
  pantalla.sql = b.sql;
  pantalla.consultasSql = [];
  return { db: trampa, escrituras, datos: b.datos };
}

const recepcion = (db: BaseDoble, over: Partial<SabinaCtx> = {}) =>
  sesion(db, { userId: U_RECEP_N, role: "RECEPTIONIST", ...over });

async function agendar(ctx: SabinaCtx, params: Record<string, unknown>): Promise<any> {
  const r = await correrHerramienta(agendarCita, ctx, params);
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { datos: any }).datos;
}

const minutos = (cuerpo: any) => (new Date(cuerpo.endsAt).getTime() - new Date(cuerpo.startsAt).getTime()) / 60_000;
const campo = (propuesta: any, nombre: string) => propuesta.detalle.find((d: any) => d.campo === nombre)?.valor;

function turno(bloques: TurnoModelo["bloques"], stopReason: string): TurnoModelo {
  return { bloques, stopReason, tokensEntrada: 100, tokensSalida: 20, error: null };
}

/* ═══════════════════════════════════════════════════════════════════════
   1. AGENDAR UN CONTROL
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 «agéndale su control a Ana»: tipo de cita del catálogo, su doctor tratante y la duración configurada", async () => {
  const { db, escrituras } = montar();
  // Recepción no dijo doctor ni duración. La clínica tiene dos doctores: sin
  // ortodoncia, esto acababa en «¿con qué doctor?».
  const d = await agendar(recepcion(db), { paciente: "Ana Perez", fecha: DIA, hora: "11:00", motivo: "su control" });

  assert.equal(d.estado, "propuesta", JSON.stringify(d));
  const { cuerpo, metodo, ruta } = d.propuesta.peticion;
  assert.deepEqual([metodo, ruta], ["POST", "/api/appointments"]);
  // El motivo es el TIPO de la cita (`type: body.reason` en el POST): letra por letra.
  assert.equal(cuerpo.reason, TIPO_CITA_CONTROL_ORTO);
  assert.equal(cuerpo.patientId, "p-ana");
  assert.equal(cuerpo.doctorId, U_DOC_N, "no fue con su doctor tratante");
  assert.equal(minutos(cuerpo), 30, "la duración de fábrica del control");
  assert.equal(new Date(cuerpo.startsAt).getTime(), en("11:00").getTime());

  assert.equal(campo(d.propuesta, "Doctor"), "Hugo Salas (su doctor tratante)");
  assert.equal(campo(d.propuesta, "Motivo"), TIPO_CITA_CONTROL_ORTO);
  assert.equal(campo(d.propuesta, "Ortodoncia"), "Cita de su caso de ortodoncia");
  assert.match(d.propuesta.frase, /Agendar a Ana Perez .* \(30 min\) con Hugo Salas\. Motivo: Control de ortodoncia\./);

  // Propone; no escribe, no manda nada al paciente y no salta ningún candado.
  assert.deepEqual(escrituras, []);
  assert.ok(!("overrideReason" in cuerpo) && !("notifyPatient" in cuerpo) && !("bloqueoConfirmado" in cuerpo));
});

test("🔴 la duración y el nombre son los que la clínica puso en Configuración → Ortodoncia", async () => {
  const configuracion: Fila = {
    clinicId: CL_NORTE,
    defaultTreatingDoctorId: U_DOC2_N,
    appointmentTypes: [
      { id: "valoracion", label: "Primera visita de ortodoncia", durationMin: 50 },
      { id: "control", label: TIPO_CITA_CONTROL_ORTO, durationMin: 40 },
      { id: "tipo-3", label: "Entrega de retenedores" },
    ],
  };
  const { db } = montar({ configuracion });

  const control = await agendar(recepcion(db), { paciente: "Ana Perez", fecha: DIA, hora: "11:00", motivo: "ajuste de brackets" });
  assert.equal(control.propuesta.peticion.cuerpo.reason, TIPO_CITA_CONTROL_ORTO);
  assert.equal(minutos(control.propuesta.peticion.cuerpo), 40);

  // Un tipo que añadió la clínica, sin duración propia: la regla del bot (30 min).
  const propio = await agendar(recepcion(db), { paciente: "Ana Perez", fecha: DIA, hora: "12:00", motivo: "entrega de retenedores" });
  assert.equal(propio.propuesta.peticion.cuerpo.reason, "Entrega de retenedores");
  assert.equal(minutos(propio.propuesta.peticion.cuerpo), 30);

  // Si el usuario dice cuánto dura, manda el usuario.
  const larga = await agendar(recepcion(db), { paciente: "Ana Perez", fecha: DIA, hora: "13:00", motivo: "control", duracionMinutos: 60 });
  assert.equal(minutos(larga.propuesta.peticion.cuerpo), 60);
});

test("🔴 el doctor tratante ocupado o con la agenda bloqueada: no se agenda encima, se ofrecen otras horas", async () => {
  const ocupado = montar({
    citas: [{
      id: "c-hugo-ocupado", clinicId: CL_NORTE, patientId: "p-beto", doctorId: U_DOC_N, type: "Consulta", status: "CONFIRMED",
      resourceId: null, startsAt: en("11:00"), endsAt: en("12:00"),
    }],
  });
  const d1 = await agendar(recepcion(ocupado.db), { paciente: "Ana Perez", fecha: DIA, hora: "11:30", motivo: "control" });
  assert.equal(d1.estado, "no_disponible", JSON.stringify(d1));
  assert.ok(d1.alternativas.length > 0, "no ofreció otras horas");
  assert.ok(!d1.alternativas.includes("11:30"));

  // La Dra. Rojas está libre a esa hora, pero el control es con SU doctor: no se cambia solo.
  assert.doesNotMatch(JSON.stringify(d1), /Nadia Rojas/);

  const bloqueado = montar({
    bloqueos: [{
      id: "b-1", clinicId: CL_NORTE, doctorId: U_DOC_N, kind: "VACACIONES", reason: "Congreso de ortodoncia",
      startsAt: en("09:00"), endsAt: en("19:00"), holidayKey: null, deletedAt: null,
    }],
  });
  const d2 = await agendar(recepcion(bloqueado.db), { paciente: "Ana Perez", fecha: DIA, hora: "11:00", motivo: "control" });
  assert.equal(d2.estado, "no_disponible", JSON.stringify(d2));
  assert.match(d2.frase, /Congreso de ortodoncia/);
});

test("si el usuario nombra a otro doctor, manda el usuario — y la tarjeta avisa de que no es el tratante", async () => {
  const { db } = montar();
  const d = await agendar(recepcion(db), { paciente: "Ana Perez", doctor: "Rojas", fecha: DIA, hora: "11:00", motivo: "control de ortodoncia" });
  assert.equal(d.estado, "propuesta");
  assert.equal(d.propuesta.peticion.cuerpo.doctorId, U_DOC2_N);
  assert.equal(campo(d.propuesta, "Doctor"), "Nadia Rojas");
  assert.ok(d.propuesta.avisos.includes("Nadia Rojas no es el doctor tratante del caso de ortodoncia de Ana Perez."), JSON.stringify(d.propuesta.avisos));
});

test("un doctor que agenda el control de un caso ajeno: va con el tratante, no consigo mismo", async () => {
  const { db } = montar();
  const nadia = sesion(db, { userId: U_DOC2_N, role: "DOCTOR" });
  const d = await agendar(nadia, { paciente: "Ana Perez", fecha: DIA, hora: "11:00", motivo: "control" });
  assert.equal(d.propuesta.peticion.cuerpo.doctorId, U_DOC_N);
});

test("🔴 la propuesta se revalida igual que cualquier cita: misma tarjeta con los ids resueltos", async () => {
  const { db } = montar();
  const ctx = recepcion(db);
  const d = await agendar(ctx, { paciente: "Ana Perez", fecha: DIA, hora: "11:00", motivo: "su ajuste" });
  assert.equal(d.estado, "propuesta");
  assert.deepEqual(d.propuesta.revalidar.parametros, {
    pacienteId: "p-ana", doctorId: U_DOC_N, fecha: DIA, hora: "11:00", duracionMinutos: 30, motivo: TIPO_CITA_CONTROL_ORTO,
  });
  const r = await revalidarPropuestaAgenda(ctx, d.propuesta);
  assert.equal(r.vigente, true, JSON.stringify(r));

  // Y si entretanto le ocupan la hora al doctor tratante, deja de valer.
  const despues = montar({
    citas: [{
      id: "c-entro-otra", clinicId: CL_NORTE, patientId: "p-beto", doctorId: U_DOC_N, type: "Consulta", status: "SCHEDULED",
      resourceId: null, startsAt: en("11:00"), endsAt: en("11:30"),
    }],
  });
  assert.equal((await revalidarPropuestaAgenda(recepcion(despues.db), d.propuesta)).vigente, false);
});

test("🔴 los permisos son los de agendar: sin `agenda.create` o sin rol, tampoco se agenda ortodoncia", async () => {
  const { db } = montar();
  const params = { paciente: "Ana Perez", fecha: DIA, hora: "11:00", motivo: "control" };

  const sinKey = recepcion(db, {
    permissionsOverride: getEffectivePermissions({ role: "RECEPTIONIST" as any, permissionsOverride: [] }).filter((k) => k !== "agenda.create"),
  });
  assert.deepEqual(await correrHerramienta(agendarCita, sinKey, params), { ok: false, motivo: "sin_permiso", permiso: "agenda.create" });
  assert.equal(db.contador.llamadas.length, 0, "se leyó el caso sin permiso de agendar");

  const lector = sesion(db, { role: "READONLY", permissionsOverride: ["agenda.view", "agenda.create", "specialties.orthodontics"] });
  const d = await agendar(lector, params);
  assert.equal(d.estado, "sin_permiso");

  // La paciente restringida: recepción no la ve, así que no hay caso que agendar.
  const restringida = await agendar(recepcion(db), { paciente: "Paula Restringida", fecha: DIA, hora: "11:00", motivo: "control" });
  assert.equal(restringida.estado, "no_se_puede");
  assert.match(restringida.frase, /No encuentro a/);
});

test("con caso activo y sin motivo: se pregunta, ofreciendo las citas de ortodoncia de la clínica", async () => {
  const { db } = montar();
  const d = await agendar(recepcion(db), { paciente: "Ana Perez", doctor: "Salas", fecha: DIA, hora: "11:00" });
  assert.equal(d.estado, "pregunta");
  const q = d.preguntas.find((x: any) => x.falta === "motivo");
  assert.match(q.texto, /Ana Perez tiene un caso de ortodoncia activo/);
  assert.ok(q.opciones.some((o: any) => o.etiqueta === TIPO_CITA_CONTROL_ORTO && o.id === TIPO_CITA_CONTROL_ORTO));

  // En retención, «su control» puede ser dos cosas: se pregunta cuál.
  const carla = await agendar(recepcion(db), { paciente: "Carla Gomez", fecha: DIA, hora: "11:00", motivo: "su control" });
  assert.equal(carla.estado, "pregunta");
  assert.deepEqual(
    carla.preguntas.find((x: any) => x.falta === "motivo").opciones.map((o: any) => o.etiqueta),
    ["Control de retención", TIPO_CITA_CONTROL_ORTO],
  );
  const elegida = await agendar(recepcion(db), { paciente: "Carla Gomez", fecha: DIA, hora: "11:00", motivo: "Control de retención" });
  assert.equal(elegida.propuesta.peticion.cuerpo.reason, "Control de retención");
  assert.equal(minutos(elegida.propuesta.peticion.cuerpo), 20, "la regla del módulo para un control de retención");
});

/* ═══════════════════════════════════════════════════════════════════════
   2. SIN CASO: VALORACIÓN, SI LO PIDEN
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 paciente sin caso que pide ortodoncia: se le agenda la Valoración del catálogo, con su duración", async () => {
  const { db } = montar();
  for (const motivo of ["valoración de ortodoncia", "quiere brackets", "Valoración de ortodoncia"]) {
    const d = await agendar(recepcion(db), { paciente: "Ines Vieja", doctor: "Salas", fecha: DIA, hora: "11:00", motivo });
    assert.equal(d.estado, "propuesta", `${motivo}: ${JSON.stringify(d)}`);
    assert.equal(d.propuesta.peticion.cuerpo.reason, "Valoración de ortodoncia", motivo);
    assert.equal(minutos(d.propuesta.peticion.cuerpo), 45, motivo);
    assert.equal(campo(d.propuesta, "Ortodoncia"), "Sin caso de ortodoncia abierto");
    assert.equal(campo(d.propuesta, "Doctor"), "Hugo Salas");
  }
});

test("sin caso y sin doctor: va con el tratante por defecto de Configuración; si no hay, se pregunta", async () => {
  const conDefecto = montar({ configuracion: { clinicId: CL_NORTE, defaultTreatingDoctorId: U_DOC2_N, appointmentTypes: null } });
  const d = await agendar(recepcion(conDefecto.db), { paciente: "Ines Vieja", fecha: DIA, hora: "11:00", motivo: "valoración de ortodoncia" });
  assert.equal(d.estado, "propuesta", JSON.stringify(d));
  assert.equal(d.propuesta.peticion.cuerpo.doctorId, U_DOC2_N);

  const sinDefecto = montar();
  const q = await agendar(recepcion(sinDefecto.db), { paciente: "Ines Vieja", fecha: DIA, hora: "11:00", motivo: "valoración de ortodoncia" });
  assert.equal(q.estado, "pregunta");
  assert.deepEqual(q.preguntas.map((x: any) => x.falta), ["doctor"]);
});

test("🔴 lo que no es de ortodoncia se agenda como siempre — tenga caso o no", async () => {
  const { db } = montar();
  // Ana tiene caso activo y viene a limpieza: ni tipo de ortodoncia, ni tratante forzado.
  const limpieza = await agendar(recepcion(db), { paciente: "Ana Perez", fecha: DIA, hora: "11:00", motivo: "Limpieza" });
  assert.equal(limpieza.estado, "pregunta");
  assert.deepEqual(limpieza.preguntas.map((x: any) => x.falta), ["doctor"]);

  const conDoctor = await agendar(recepcion(db), { paciente: "Ana Perez", doctor: "Rojas", fecha: DIA, hora: "11:00", motivo: "Limpieza" });
  assert.equal(conDoctor.propuesta.peticion.cuerpo.reason, "Limpieza");
  assert.equal(minutos(conDoctor.propuesta.peticion.cuerpo), 30);
  assert.equal(campo(conDoctor.propuesta, "Ortodoncia"), undefined);
  assert.deepEqual(conDoctor.propuesta.detalle.map((x: any) => x.campo), ["Paciente", "Doctor", "Día", "Hora", "Motivo"]);

  // Sin caso, «control» o «valoración» a secas no son de ortodoncia.
  for (const motivo of ["control", "valoración", "revisión"]) {
    const d = await agendar(recepcion(db), { paciente: "Ines Vieja", doctor: "Salas", fecha: DIA, hora: "12:00", motivo });
    assert.equal(d.propuesta.peticion.cuerpo.reason, motivo, motivo);
  }
});

test("una sede sin el módulo (o que no es dental) agenda como siempre, diga lo que diga el motivo", async () => {
  const { db, datos } = montar();
  datos.users.push({ id: "u-doc-sin", clinicId: CL_SIN_MODULO, role: "DOCTOR", firstName: "Dora", lastName: "Sinmodulo", isActive: true });
  const sinModulo = sesion(db, { clinicId: CL_SIN_MODULO, userId: "u-doc-sin", role: "DOCTOR" });
  const d = await agendar(sinModulo, { paciente: "Nora SINMODULO", fecha: DIA, hora: "11:00", motivo: "control de ortodoncia" });
  assert.equal(d.estado, "propuesta", JSON.stringify(d));
  assert.equal(d.propuesta.peticion.cuerpo.reason, "control de ortodoncia", "sin módulo no se toca el motivo");
  assert.equal(campo(d.propuesta, "Ortodoncia"), undefined);

  const noDental = await agendar(recepcion(db, { clinicCategory: "MEDICINE" }), {
    paciente: "Ana Perez", doctor: "Salas", fecha: DIA, hora: "11:00", motivo: "control",
  });
  assert.equal(noDental.propuesta.peticion.cuerpo.reason, "control");
});

test("🔴 no cruza de clínica: el caso y el catálogo del sur no aparecen al agendar en el norte", async () => {
  const { db, datos } = montar({
    configuracion: { clinicId: CL_SUR, defaultTreatingDoctorId: "u-admin-s", appointmentTypes: [
      { id: "control", label: TIPO_CITA_CONTROL_ORTO, durationMin: 99 },
      { id: "valoracion", label: "VALORACION DEL SUR", durationMin: 99 },
    ] },
  });
  assert.ok(datos.orthodonticsClinicSettings.length === 1);
  const d = await agendar(recepcion(db), { paciente: "Ana Perez", fecha: DIA, hora: "11:00", motivo: "control" });
  assert.equal(minutos(d.propuesta.peticion.cuerpo), 30, "usó la duración del sur");
  const sofia = await agendar(recepcion(db), { paciente: "Sofia SUR", fecha: DIA, hora: "11:00", motivo: "control" });
  assert.equal(sofia.estado, "no_se_puede");
});

test("elegirTipoDeCita y duracionDeTipo: las reglas, sin base", () => {
  const catalogo = [
    { id: "valoracion", label: "Valoración de ortodoncia", durationMin: 45 },
    { id: "control", label: TIPO_CITA_CONTROL_ORTO, durationMin: 30 },
    { id: "urgencia", label: "Urgencia de ortodoncia" },
    { id: "control-retencion", label: "Control de retención" },
  ];
  const caso = { planId: "p", status: "IN_PROGRESS", treatingDoctorId: null };
  const uno = (motivo: string, c: typeof caso | null) => {
    const e = elegirTipoDeCita(motivo, catalogo, c);
    return e.tipo === "uno" ? e.cita.id : e.tipo;
  };
  assert.equal(uno("su control", caso), "control");
  assert.equal(uno("CONTROL DE ORTODONCIA", null), "control");
  assert.equal(uno("urgencia de ortodoncia, se le cayó un bracket", caso), "urgencia");
  assert.equal(uno("control de retención", caso), "control-retencion");
  assert.equal(uno("cambio de ligas", caso), "control");
  assert.equal(uno("alineadores", null), "valoracion");
  assert.equal(uno("limpieza", caso), "ninguno");
  assert.equal(uno("control", null), "ninguno");
  assert.equal(uno("", caso), "ninguno");
  assert.equal(uno("control", { ...caso, status: "RETENTION" }), "varios");

  // 🔴 Una clínica que añadió un tipo «Control» a secas: «su control» puede ser
  // cualquiera de los dos. Se pregunta; jamás se guarda el control de un caso
  // con un texto que el módulo no reconoce.
  const conCorto = [...catalogo, { id: "tipo-9", label: "Control" }];
  for (const motivo of ["su control", "control", "CONTROL"]) {
    const e = elegirTipoDeCita(motivo, conCorto, caso);
    assert.equal(e.tipo, "varios", motivo);
    assert.deepEqual(
      (e as any).opciones.map((t: any) => t.label),
      [TIPO_CITA_CONTROL_ORTO, "Control de retención", "Control"],
      motivo,
    );
  }
  // La opción elegida llega letra por letra, y ya no se pregunta: si no, la
  // propuesta no se podría revalidar nunca.
  assert.equal((elegirTipoDeCita("Control", conCorto, caso) as any).cita?.id, "tipo-9");
  assert.equal((elegirTipoDeCita(TIPO_CITA_CONTROL_ORTO, conCorto, caso) as any).cita?.id, "control");
  assert.equal((elegirTipoDeCita("su control de ortodoncia", conCorto, caso) as any).cita?.id, "control");

  assert.equal(duracionDeTipo({ label: "Lo que sea", durationMin: 40 }), 40);
  assert.equal(duracionDeTipo({ label: "Retiro de aparatología" }), 60);
  assert.equal(duracionDeTipo({ label: "Entrega de retenedores", durationMin: 0 }), 30);
});

/* ═══════════════════════════════════════════════════════════════════════
   3. NO COBRA ORTODONCIA
   ═══════════════════════════════════════════════════════════════════════ */

/** Una factura normal de Ana, con folio, para comprobar que lo demás se sigue cobrando. */
function conFolios(datos: any): void {
  for (const [id, folio] of [["inv-orto-ana", "MF-0900"], ["inv-orto-priv", "MF-0901"], ["inv-3", "MF-0003"], ["inv-2", "MF-0002"]]) {
    const f = datos.invoices.find((i: any) => i.id === id);
    f.invoiceNumber = folio;
    f.updatedAt = f.createdAt;
    f.taxRate = 0;
    f.taxIncluded = true;
    f.cfdiUuid = null;
  }
  for (const f of datos.invoices) {
    f.updatedAt ??= f.createdAt;
    f.invoiceNumber ??= `MF-X-${f.id}`;
  }
}

test("🔴 la mensualidad no se cobra: ni tarjeta ni «¿con qué método?» — el dato y el enlace", async () => {
  const { db, datos, escrituras } = montar();
  conFolios(datos);
  const ctx = recepcion(db);

  for (const params of [
    { factura: "MF-0900" },
    { factura: "MF-0900", monto: 2000, metodo: "cash" as const },
  ]) {
    const r = await prepararCobro(ctx, params);
    assert.equal(r.tipo, "no_se_puede", JSON.stringify(r));
    const frase = (r as { frase: string }).frase;
    assert.match(frase, /^No cobro ortodoncia\./);
    assert.match(frase, /MF-0900 de Ana Perez es la factura de su tratamiento de ortodoncia: le quedan \$16,000\.00 por pagar/);
    // El dato, del motor del módulo: debe una mensualidad.
    assert.match(frase, /tiene 1 pago vencido por \$2,000\.00 \(\d+ días de atraso\)/);
    assert.match(frase, /su próximo pago es de \$2,000\.00 el \d+ \w+ \d{4}/);
    assert.ok(frase.includes("(/dashboard/patients/p-ana?tab=ortodoncia)"), frase);
    assert.ok(frase.includes("(/dashboard/orthodontics/cobranza)"), frase);
    assert.doesNotMatch(frase, /método|tarjeta de débito/i);
  }
  assert.deepEqual(escrituras, []);
});

test("🔴 un control cobrado aparte o un extra del caso tampoco se cobran", async () => {
  const { db, datos } = montar();
  conFolios(datos);
  // Un extra: un retenedor facturado aparte y ligado al caso de Ana.
  datos.invoices.push({
    id: "inv-extra-ana", clinicId: CL_NORTE, patientId: "p-ana", status: "PENDING", invoiceNumber: "MF-0950",
    total: 1800, paid: 0, balance: 1800, discount: 0, taxRate: 0, taxIncluded: true, cfdiUuid: null, dueDate: null,
    createdAt: new Date(), updatedAt: new Date(), items: [], orthodonticTreatmentPlanId: "plan-ana",
  });
  const ctx = recepcion(db);

  const extra = await prepararCobro(ctx, { factura: "MF-0950", metodo: "cash" });
  assert.equal(extra.tipo, "no_se_puede", JSON.stringify(extra));
  assert.match((extra as any).frase, /es un cargo de su caso de ortodoncia \(un control o un extra\): le quedan \$1,800\.00 por pagar/);
  assert.ok((extra as any).frase.includes("(/dashboard/patients/p-ana?tab=ortodoncia)"));

  // El control de Dora (pago por control).
  const control = await prepararCobro(ctx, { factura: "MF-0802", metodo: "cash" });
  assert.equal(control.tipo, "no_se_puede", JSON.stringify(control));
  assert.match((control as any).frase, /No cobro ortodoncia/);

  assert.deepEqual(await facturaDeOrtodoncia(ctx, { id: "inv-extra-ana" }), { planId: "plan-ana", clase: "del_caso" });
  assert.deepEqual(await facturaDeOrtodoncia(ctx, { id: "inv-orto-ana" }), { planId: "plan-ana", clase: "tratamiento" });
  assert.equal(await facturaDeOrtodoncia(ctx, { id: "inv-3" }), null);
  // Con la sesión de otra clínica, esa factura no existe.
  assert.equal(await facturaDeOrtodoncia(sesion(db, { clinicId: CL_SUR }), { id: "inv-orto-ana" }), null);
});

test("🔴 tampoco manda el aviso de saldo de ortodoncia por WhatsApp: es cobrar por otra puerta", async () => {
  const { db, datos, escrituras } = montar();
  conFolios(datos);
  const ana = datos.patients.find((p: any) => p.id === "p-ana");
  ana.phone = "+52 55 1234 5678";
  const ctx = sesion(db); // administradora: tiene whatsapp.send

  const r = await prepararAviso(ctx, { factura: "MF-0900" });
  assert.equal(r.tipo, "no_se_puede", JSON.stringify(r));
  const frase = (r as { frase: string }).frase;
  assert.match(frase, /^No mando avisos de saldo de ortodoncia\./);
  assert.match(frase, /le quedan \$16,000\.00 por pagar/);
  assert.ok(frase.includes("(/dashboard/orthodontics/cobranza)"), frase);
  assert.match(frase, /No preparé ningún mensaje\.$/);
  assert.deepEqual(escrituras, []);
});

test("🔴 lo que NO es de ortodoncia se sigue cobrando, aunque el paciente tenga un caso", async () => {
  const { db, datos } = montar();
  conFolios(datos);
  const ctx = recepcion(db);

  // La MF-0003 es una limpieza de Carla, que está en retención.
  const sinMetodo = await prepararCobro(ctx, { factura: "MF-0003" });
  assert.equal(sinMetodo.tipo, "aclarar", JSON.stringify(sinMetodo));
  assert.match((sinMetodo as any).pregunta, /¿Con qué método pagó\?/);

  const tarjeta = await prepararCobro(ctx, { factura: "MF-0003", monto: 500, metodo: "cash" });
  assert.equal(tarjeta.tipo, "propuesta", JSON.stringify(tarjeta));
  assert.equal((tarjeta as any).datos.facturaId, "inv-3");
});

test("🔴 si no se puede comprobar si es de ortodoncia, no se cobra", async () => {
  const { db, datos } = montar();
  conFolios(datos);
  const rota = new Proxy(db as any, {
    get(objetivo, clave) {
      if (clave === "orthodonticTreatmentPlan") return { findFirst: async () => { throw new Error("timeout del pooler"); } };
      return objetivo[clave];
    },
  });
  const r = await prepararCobro(recepcion(rota), { factura: "MF-0003", monto: 500, metodo: "cash" });
  assert.equal(r.tipo, "no_se_puede");
  assert.match((r as any).frase, /No pude comprobar si la factura MF-0003 es de un caso de ortodoncia/);

  // Que la columna todavía no exista en esta base SÍ se tolera: ninguna factura cuelga de un caso.
  const sinColumna = new Proxy(db as any, {
    get(objetivo, clave) {
      if (clave === "$queryRaw") {
        return async (q: any) => {
          if (/orthodonticTreatmentPlanId/.test((q?.strings ?? []).join(""))) {
            throw Object.assign(new Error("Raw query failed. Code: `42703`. Message: `column \"orthodonticTreatmentPlanId\" does not exist`"), { code: "P2010", meta: { code: "42703" } });
          }
          return objetivo.$queryRaw(q);
        };
      }
      return objetivo[clave];
    },
  });
  assert.equal((await prepararCobro(recepcion(sinColumna), { factura: "MF-0003", monto: 500, metodo: "cash" })).tipo, "propuesta");

  // Pero «does not exist» de OTRA cosa no es una columna ausente: no se cobra.
  const otroError = new Proxy(db as any, {
    get(objetivo, clave) {
      if (clave === "$queryRaw") {
        return async () => {
          throw Object.assign(new Error("Raw query failed. Code: `42883`. Message: `operator does not exist: uuid = text`"), { code: "P2010", meta: { code: "42883" } });
        };
      }
      return objetivo[clave];
    },
  });
  const r2 = await prepararCobro(recepcion(otroError), { factura: "MF-0003", monto: 500, metodo: "cash" });
  assert.equal(r2.tipo, "no_se_puede");
  assert.match((r2 as any).frase, /No pude comprobar/);
});

test("🔴 por el motor entero: «cóbrale su mensualidad a Ana» no deja ninguna tarjeta, y sí el enlace", async () => {
  const { db, datos, escrituras } = montar();
  conFolios(datos);
  const turnos = [
    turno([{ type: "tool_use", id: "tu_1", name: "cobrar_factura", input: { factura: "MF-0900", monto: 2000, metodo: "cash" } }], "tool_use"),
    turno([{ type: "text", text: "No cobro ortodoncia. Se cobra en [la ficha de ortodoncia de Ana Perez](/dashboard/patients/p-ana?tab=ortodoncia)." }], "end_turn"),
  ];
  let i = 0;
  let resultadoDeLaHerramienta = "";
  const salida = await ejecutarSabina({
    ctx: recepcion(db),
    pregunta: "cóbrale su mensualidad de ortodoncia a Ana Perez, pagó en efectivo",
    tools: SABINA_TOOLS,
    llamar: async (args) => {
      const ultimo = JSON.stringify(args.messages[args.messages.length - 1]);
      if (ultimo.includes("tool_result")) resultadoDeLaHerramienta = ultimo;
      return turnos[Math.min(i++, turnos.length - 1)];
    },
  });
  assert.equal((salida.propuestas ?? []).length, 0, "quedó una tarjeta de cobro de ortodoncia");
  assert.match(resultadoDeLaHerramienta, /No cobro ortodoncia/);
  assert.match(resultadoDeLaHerramienta, /dashboard\/patients\/p-ana\?tab=ortodoncia/);
  assert.ok(salida.respuesta.includes("(/dashboard/patients/p-ana?tab=ortodoncia)"), salida.respuesta);
  assert.deepEqual(escrituras, []);
});

/* ═══════════════════════════════════════════════════════════════════════
   4. LO QUE NO CAMBIÓ
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 ninguna acción nueva: Sabina sigue sin recetar, sin firmar y sin cobrar ortodoncia por otra puerta", () => {
  assert.deepEqual(
    ACCIONES_SABINA.map((a) => a.nombre).sort(),
    ["agendar_cita", "avisar_saldo_whatsapp", "cancelar_cita", "cobrar_factura", "crear_factura", "reagendar_cita", "registrar_paciente"],
  );
  for (const a of ACCIONES_SABINA) {
    assert.doesNotMatch(a.nombre, /receta|prescri|firma|orto|mensualidad|plan_de_pago/i, a.nombre);
  }
});
