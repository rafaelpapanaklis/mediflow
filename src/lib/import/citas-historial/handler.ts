// HISTORIAL DE CITAS PASADAS migrado (ws1-t12, importador Dentalink, sep-2026):
// 05b_Citas_Estados_Historico trae citas del sistema anterior que YA
// terminaron (atendida, no asistió, cancelada). El archivo de citas "vivas"
// (05_Citas, appointmentsHandler en entities.ts) las omite a propósito — una
// cita pasada no se agenda, ver `estadoDeCita`/el chequeo de `startsAt` ahí —
// así que sin este handler esa historia se perdía por completo.
//
// Es HISTORIA, no agenda. Mismo criterio que pagos-historial:
//   · (ws1-t10, 29-sep-2026) UNA excepción a propósito: el CONTROL ATENDIDO de un caso de ortodoncia migrado de 06
//     entra además como cita COMPLETADA («Control de ortodoncia»), porque Controles/Alertas/Visitas leen la agenda para
//     saber cuándo vino por última vez. Nunca SCHEDULED/CONFIRMED (nada que recordar) y solo si no choca con otra cita.
//     Todo lo demás sigue sin tocar `Appointment`.
//   · Fuera de esa excepción NUNCA crea una fila en `Appointment`: por eso el barrido de
//     recordatorios (reminders/enqueue.ts, filtra por status
//     PENDING/SCHEDULED/CONFIRMED) y el de seguimiento post-cita
//     (post-appointment-followup/route.ts, filtra por status+ventana de
//     tiempo reciente) NUNCA la leen — ninguno de los dos consulta
//     `migrated_visits`. No hay recordatorio ni cobro posible porque no hay
//     código nuevo que dispare ninguno de los dos a partir de esta tabla.
//   · Se ve, de solo lectura, en la ficha del paciente ("Citas anteriores
//     (migradas)" — ver leer.ts + la tarjeta de la ficha).
//   · (ws1-t10) Entran TODAS las citas pasadas, también las que no dicen cómo terminaron: «Cambio de fecha» es
//     «reagendada»; «Confirmado…», «No confirmado», «Notificado…», «Recordado por IA»… son «sin registro de
//     asistencia». El estado original se conserva en la nota. Ver dentalink/citas.ts.
//
// Construido en un archivo NUEVO. Multi-tenant: clinicId SIEMPRE de la sesión.

import { prisma } from "@/lib/prisma";
import type { PreviewRow } from "../types";
import { BATCH, ImportError, normName, parseDate, textoDeCelda, type EntityHandler, type MappedRow, type ImportContext } from "../engine";
import { cellText, oneLine, nombreOrigen, newId } from "../migrado";
import { parseHora, horaLocalAUtc, textoLocal } from "../valores";
import { loadPatientIndex, resolvePaymentPatient } from "../pagos-historial/paciente";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { elegirRecurso, esSobreagendamiento, notasDeCita, tipoParaCaso, visitaDeEstado, type EnlaceDeCita, type RecursoDeClinica } from "../dentalink/citas";
import { cargarOcupadas, cargarRecursos, leerDuracionDeCita, solapa, soltarConsultoriosQueChocan, tramoLocal } from "../dentalink/citas-agenda";
import { cargarControlesOrto, claveControlCaso, diaLocal, guardarControlesOrto, limpiarId } from "../dentalink/control-ortodoncia";
import { cargarEnlaces, enlaceDe, enlacesVacios, type Enlaces } from "../dentalink/enlace-tratamientos";

const DEFAULT_HOUR = { h: 9, m: 0 };

/** ¿El error es "la tabla migrated_visits no existe todavía"? (SQL pendiente, sql/citas-historial-migradas.sql) */
function faltaLaTabla(e: unknown): boolean {
  const code = (e as any)?.code;
  return code === "P2021" || code === "P2022";
}

const pickInsertable = (rows: PreviewRow[], skipDuplicates: boolean) =>
  rows.filter((r) => r.status === "ok" || (!skipDuplicates && r.status === "duplicate"));

function llaveDeVisita(o: { patientId: string; startsAt: Date; status: string }): string {
  return `v:${o.patientId}|${o.startsAt.toISOString()}|${o.status}`;
}

/** Una fila ya leída (paciente, hora, estado) que espera saber a qué tratamiento importado pertenece. */
interface Parcial {
  pr: PreviewRow;
  mapped: Record<string, any>;
  patientId: string;
  patientName: string;
  startsAt: Date;
  endsAt: Date;
  duracionAviso?: string;
  visita: ReturnType<typeof visitaDeEstado>;
  motivo: string;
  ref: string;
  /** El doctor del archivo (emparejado o elegido), o null si no se pudo resolver. */
  doctorArchivoId: string | null;
  doctorArchivoTexto: string;
  doctorSinResolver?: { key: string; value: string; varios: boolean };
}

export const appointmentHistoryHandler: EntityHandler = {
  entity: "appointmentHistory",
  auditEntityType: "appointment",
  sheetNames: ["citasestadoshistorico", "historialdecitas", "estadosdecitas", "citashistorico"],
  headerVariants: {
    name: ["nombre", "nombredelpaciente", "paciente", "nombrecompleto", "nombres", "cliente"],
    lastName: ["apellido", "apellidos", "lastname"],
    phone: ["telefono", "celular", "whatsapp", "phone", "movil"],
    email: ["email", "correo", "correoelectronico"],
    patientExternalId: ["idpaciente", "#paciente", "iddelpaciente", "idficha", "idfichapaciente", "codigopaciente", "nficha", "nroficha", "numeroficha", "numerodeficha"],
    doctor: ["doctor", "doctora", "medico", "odontologo", "odontologa", "dentista", "profesional", "atiende"],
    date: ["fecha", "fechacita", "fechadelacita", "dia", "date"],
    time: ["hora", "horacita", "time", "horario"],
    endTime: ["horafin", "horadefin", "horatermino", "horadetermino", "horafinal", "horafincita", "endtime"],
    status: ["estado", "estadocita", "estadofinal", "estadodelacita", "status"],
    type: ["tipo", "motivo", "tratamiento", "servicio", "tipocita", "concepto"],
    notes: ["notas", "observaciones", "comentarios", "nota", "comentario"],
    // Dentalink (ws1-t10): a qué tratamiento pertenece, en qué sillón, quién y cuándo la agendó, y el texto libre.
    treatmentRef: ["#tratamiento", "idtratamiento", "numerotratamiento", "notratamiento", "ntratamiento", "foliotratamiento"],
    chair: ["sillon", "sillonrecurso", "recurso", "consultorio", "sala", "box"],
    bookedBy: ["agendadopor", "agendadapor", "creadopor", "creadapor", "registradopor"],
    createdOn: ["fechadecreaciondecita", "fechacreacioncita", "fechadecreacion", "fechacreacion", "creadoel"],
    // «Observaciones» a secas sigue siendo `notes` (lo normal en cualquier Excel); este campo solo lo asigna un perfil que
    // trae DOS columnas de texto libre (Dentalink: «Comentario Cita» y «Observaciones»).
    observations: ["observacionescita", "observacionesdelacita"],
    apptRef: ["#cita", "idcita", "numerocita", "ncita", "foliocita"],
  },

  validateMapping(campos) {
    if (!campos.has("date")) return "Falta la columna de fecha de la cita";
    if (!campos.has("status")) return "Falta la columna del estado de la cita (atendida / no asistió / cancelada…)";
    if (!campos.has("name") && !campos.has("phone") && !campos.has("email") && !campos.has("patientExternalId")) {
      return "Falta una columna para identificar al paciente (ID, nombre, teléfono o correo)";
    }
    return null;
  },

  async process(rows: MappedRow[], clinicId: string, ctx: ImportContext): Promise<PreviewRow[]> {
    const idx = await loadPatientIndex(clinicId, ctx);
    const clinic = await prisma.clinic.findFirst({ where: { id: clinicId }, select: { timezone: true } });
    const tz = clinic?.timezone ?? null;
    const origen = nombreOrigen(ctx.originName);

    const users = await prisma.user.findMany({ where: { clinicId, isActive: true }, select: { id: true, firstName: true, lastName: true } });
    // Nombre normalizado → TODOS los usuarios que lo llevan: con dos iguales (el dueño y su ficha de doctor) ya
    // no gana el último en silencio; es ambiguo y lo decide la persona (valueMapping.doctor).
    const byDoctor = new Map<string, string[]>();
    const nombreDe = new Map<string, string>();
    for (const u of users) {
      const k = normName(`${u.firstName} ${u.lastName}`);
      byDoctor.set(k, [...(byDoctor.get(k) ?? []), u.id]);
      nombreDe.set(u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim());
    }
    const eleccionDoctor = ctx.valueMapping.doctor ?? {};

    // Red contra lo que ya está en migrated_visits (tolera que la tabla aún no exista).
    const existentes = new Set<string>();
    try {
      const ya = await prisma.migratedVisit.findMany({ where: { clinicId }, select: { patientId: true, startsAt: true, status: true } });
      for (const v of ya) existentes.add(llaveDeVisita({ patientId: v.patientId, startsAt: v.startsAt, status: v.status }));
    } catch (e) {
      if (!faltaLaTabla(e)) throw e;
    }

    const out: PreviewRow[] = [];
    const parciales: Parcial[] = [];

    // ── Primera pasada: paciente, hora, estado y doctor del archivo de cada fila ──
    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };
      const visita = visitaDeEstado(mapped.status);

      const fecha = mapped.date ? parseDate(mapped.date) : null;
      if (!mapped.date || !cellText(mapped.date)) pr.errors.push("Falta la fecha de la cita");
      else if (!fecha) pr.errors.push(`Fecha "${cellText(mapped.date)}" inválida`);

      let hora = DEFAULT_HOUR;
      if (mapped.time && cellText(mapped.time)) {
        const leida = parseHora(mapped.time);
        if (leida === null) pr.errors.push(`Hora "${cellText(mapped.time)}" inválida`);
        else if (leida) hora = leida;
      }

      const res = resolvePaymentPatient(mapped, idx);
      if (res.error) pr.errors.push(res.error);
      if (res.warning) pr.warnings.push(res.warning);

      let doctorArchivoId: string | null = null;
      let doctorSinResolver: Parcial["doctorSinResolver"];
      const doctorArchivoTexto = mapped.doctor ? cellText(mapped.doctor) : "";
      if (doctorArchivoTexto) {
        const clave = normName(doctorArchivoTexto);
        const elegido = eleccionDoctor[clave];
        const iguales = byDoctor.get(clave) ?? [];
        if (elegido && nombreDe.has(elegido)) doctorArchivoId = elegido;
        else if (iguales.length === 1) doctorArchivoId = iguales[0];
        else doctorSinResolver = { key: clave, value: doctorArchivoTexto, varios: iguales.length > 1 };
      }

      if (pr.errors.length > 0) { pr.status = "error"; out.push(pr); continue; }

      const startsAt = horaLocalAUtc(fecha!.getFullYear(), fecha!.getMonth() + 1, fecha!.getDate(), hora.h, hora.m, tz);
      if (!startsAt) { pr.status = "error"; pr.errors.push("La hora no existe en la zona horaria de la clínica (cambio de horario)"); out.push(pr); continue; }

      const futura = startsAt.getTime() > ctx.now.getTime();
      if (futura) {
        // Una cita de FECHA FUTURA: atendida / no asistió no puede ser (dato incoherente); cancelada o reagendada sí (es
        // la historia de un horario que se liberó); y una vigente («Confirmado», «No confirmado»…) no es historia: la
        // agenda de citas la trae.
        if (visita.grupo === "atendida" || visita.grupo === "no_asistio") {
          pr.status = "error";
          pr.errors.push(`Fecha futura (${textoLocal(startsAt, tz)}) para un estado ya cerrado: dato incoherente`);
          out.push(pr);
          continue;
        }
        if (visita.grupo === "confirmada" || visita.grupo === "vigente") {
          pr.status = "skipped";
          pr.warnings.push(`Cita futura (${textoLocal(startsAt, tz)}) todavía vigente: no es historia, la importa el archivo de citas`);
          pr.data = { patientName: res.fullName || idx.nameById.get(res.id!) || undefined, startsLocal: textoLocal(startsAt, tz) };
          out.push(pr);
          continue;
        }
      }

      const duracion = leerDuracionDeCita(mapped, startsAt, tz);
      parciales.push({
        pr,
        mapped,
        patientId: res.id!,
        patientName: res.fullName || idx.nameById.get(res.id!) || "",
        startsAt,
        endsAt: new Date(startsAt.getTime() + duracion.min * 60_000),
        duracionAviso: duracion.warning,
        visita,
        motivo: mapped.type && cellText(mapped.type) ? oneLine(mapped.type, 200) : "",
        ref: limpiarId(mapped.treatmentRef),
        doctorArchivoId,
        doctorArchivoTexto,
        doctorSinResolver,
      });
    }

    // ── A qué tratamiento importado pertenece cada una (caso de ortodoncia / tratamiento normal) ──
    const hayRefs = parciales.some((p) => p.ref);
    let enlaces: Enlaces = enlacesVacios();
    let controles = new Map<string, string>();
    let controlesDisponibles = true;
    if (hayRefs) {
      enlaces = await cargarEnlaces(clinicId, ctx.originId, Array.from(new Set(parciales.map((p) => p.patientId))));
      if (enlaces.casos.size > 0) {
        const c = await cargarControlesOrto(clinicId, ctx.originId);
        controles = c.mapa;
        controlesDisponibles = c.disponible;
      }
    }
    // Las marcas de control que apuntan a una CITA ya creada (por una importación anterior de este archivo).
    const citasYaCreadas = new Set<string>();
    {
      const locales = Array.from(new Set(controles.values()));
      for (let i = 0; i < locales.length; i += 500) {
        const f = await prisma.appointment.findMany({ where: { clinicId, id: { in: locales.slice(i, i + 500) } }, select: { id: true } });
        for (const a of f) citasYaCreadas.add(a.id);
      }
    }
    const recursos: RecursoDeClinica[] = parciales.some((p) => p.mapped.chair) ? await cargarRecursos(clinicId) : [];

    // ── Segunda pasada: tipo, doctor, nota y —para el control atendido de un caso— la cita completada ──
    const clavesEnArchivo = new Set<string>();
    for (const p of parciales) {
      const { pr, mapped, visita } = p;
      const { enlace, deOtroPaciente } = enlaceDe(enlaces, p.ref, p.patientId);
      const caso = enlace && enlace.tipo === "caso" ? enlace : null;
      const tipoInfo = caso ? tipoParaCaso(p.motivo) : { tipo: p.motivo || null, esControl: false, cambio: false };
      const casoDoctor = caso?.doctorId && nombreDe.has(caso.doctorId) ? caso.doctorId : null;

      // Doctor: el control de un caso es de su doctor tratante; lo demás, el del archivo (y, si no se pudo, el del caso).
      let doctorId: string | null = tipoInfo.esControl && casoDoctor ? casoDoctor : p.doctorArchivoId ?? casoDoctor;
      if (!doctorId && p.doctorSinResolver) {
        const d = p.doctorSinResolver;
        pr.unresolved = [{ field: "doctor", key: d.key, value: d.value }];
        pr.warnings.push(d.varios
          ? `Varios usuarios coinciden con el doctor "${d.value}": elige a cuál se asigna (mientras tanto se guarda sin doctor)`
          : `Doctor "${d.value}" no encontrado en la clínica: elige a qué usuario se asigna (mientras tanto se guarda sin doctor)`);
      }
      if (p.duracionAviso) pr.warnings.push(p.duracionAviso);
      if (deOtroPaciente) pr.warnings.push(`El tratamiento #${p.ref} pertenece a otro paciente en lo ya importado: la cita no se liga a él`);

      const enlaceNota: EnlaceDeCita | null = p.ref
        ? { tipo: caso ? "caso" : enlace ? "tratamiento" : "suelta", ref: p.ref }
        : null;
      const sobre = esSobreagendamiento(mapped.chair);
      const notes = notasDeCita({
        resultado: visita.resultado,
        comentario: mapped.notes,
        observaciones: mapped.observations,
        motivoOriginal: tipoInfo.cambio ? p.motivo : null,
        estadoOrigen: mapped.status,
        agendadoPor: mapped.bookedBy,
        creadaEl: textoDeCelda(mapped.createdOn),
        citaRef: mapped.apptRef,
        sobreagendada: sobre,
        enlace: enlaceNota,
      });
      const type = tipoInfo.tipo ? oneLine(tipoInfo.tipo, 200) : null;
      pr.data = {
        patientId: p.patientId,
        doctorId,
        startsAt: p.startsAt,
        status: visita.status,
        type,
        notes,
        origin: origen,
        patientName: p.patientName || undefined,
        startsLocal: textoLocal(p.startsAt, tz),
        resultado: visita.resultado,
        estadoOrigen: cellText(mapped.status) || undefined,
        tratamiento: p.ref ? `${enlaceNota!.tipo}:${p.ref}` : undefined,
      };
      if (doctorId) pr.data.doctorName = nombreDe.get(doctorId);

      // ¿Es el control atendido de un caso? Entonces cuenta como control hecho (cita COMPLETADA) — salvo que 06 o una
      // importación anterior ya lo hayan registrado ese día, o que otro control del mismo caso ese día ya vaya en el archivo.
      if (caso && visita.grupo === "atendida" && tipoInfo.esControl && doctorId) {
        const clave = claveControlCaso(p.ref, diaLocal(p.startsAt, tz));
        const previo = clave ? controles.get(clave) : undefined;
        if (clave && previo && citasYaCreadas.has(previo)) {
          pr.status = "skipped";
          pr.warnings.push("Este control ya se importó antes como cita del caso");
          out.push(pr);
          continue;
        }
        if (clave && clavesEnArchivo.has(clave)) {
          pr.warnings.push("Otro control del mismo caso ese día ya va en el archivo: esta queda como cita migrada (historial)");
        } else if (clave) {
          clavesEnArchivo.add(clave);
          pr.data.comoControl = true;
          pr.data.claveControl = clave;
          pr.data.endsAt = p.endsAt;
          if (previo) pr.data.hojaId = previo; // 06 ya registró la hoja de este control: la cita se enlaza a ella
          const rec = elegirRecurso(mapped.chair, recursos);
          pr.data.resourceId = rec.id;
        }
      }
      out.push(pr);
    }

    // ── El control se guarda como cita SOLO si no choca con otra cita del doctor (la agenda no admite dos a la vez) ──
    const candidatos = out.filter((r) => r.data.comoControl);
    if (candidatos.length > 0) {
      let desde = candidatos[0].data.startsAt as Date;
      let hasta = candidatos[0].data.endsAt as Date;
      for (const r of candidatos) {
        if ((r.data.startsAt as Date) < desde) desde = r.data.startsAt;
        if ((r.data.endsAt as Date) > hasta) hasta = r.data.endsAt;
      }
      const doctores = Array.from(new Set(candidatos.map((r) => r.data.doctorId as string)));
      const consultorios = Array.from(new Set(candidatos.map((r) => r.data.resourceId as string | null).filter((x): x is string => !!x)));
      const ocupadas = await cargarOcupadas(clinicId, doctores, consultorios, desde, hasta);
      // Citas ya existentes del mismo paciente a la misma hora (p. ej. la importó el archivo de citas): no se repite.
      const pacientes = Array.from(new Set(candidatos.map((r) => r.data.patientId as string)));
      const yaHay = new Set<string>();
      for (let i = 0; i < pacientes.length; i += 500) {
        const f = await prisma.appointment.findMany({
          where: { clinicId, patientId: { in: pacientes.slice(i, i + 500) }, startsAt: { gte: desde, lte: hasta } },
          select: { patientId: true, startsAt: true },
        });
        for (const a of f) yaHay.add(`${a.patientId}|${a.startsAt.toISOString()}`);
      }
      const aceptadas: PreviewRow[] = [];
      for (const r of candidatos) {
        const cita = { startsAt: r.data.startsAt as Date, endsAt: r.data.endsAt as Date };
        if (yaHay.has(`${r.data.patientId}|${cita.startsAt.toISOString()}`)) {
          r.status = "skipped";
          r.warnings.push("Ya existe una cita de este paciente a esa hora");
          delete r.data.comoControl;
          continue;
        }
        const choque =
          ocupadas.find((o) => o.doctorId === r.data.doctorId && solapa(cita, o)) ??
          aceptadas.find((o) => o.data.doctorId === r.data.doctorId && solapa(cita, { startsAt: o.data.startsAt, endsAt: o.data.endsAt }));
        if (choque) {
          // No se mueve ningún horario y no se pierde la visita: queda en el historial, sin contar como control del caso.
          const con = choque instanceof Object && "data" in choque ? { startsAt: choque.data.startsAt as Date, endsAt: choque.data.endsAt as Date } : choque;
          r.warnings.push(`Choca con otra cita del doctor (${tramoLocal(con, tz)}): queda como cita migrada (historial), no como control del caso`);
          delete r.data.comoControl;
          delete r.data.claveControl;
          delete r.data.hojaId;
          delete r.data.resourceId;
          delete r.data.endsAt;
          continue;
        }
        aceptadas.push(r);
      }
      soltarConsultoriosQueChocan(aceptadas, ocupadas, tz);
      for (const r of aceptadas) {
        if (r.data.consultorioSoltado) {
          const chair = cellText(parciales.find((p) => p.pr === r)?.mapped.chair);
          r.data.notes = [r.data.notes, chair ? `Sillón en Dentalink: ${chair} (no se asignó consultorio: estaba ocupado)` : null].filter(Boolean).join("\n");
        }
      }
    }

    // ── Idempotencia de lo que queda como visita migrada ──
    const vistosEnArchivo = new Set<string>();
    for (const r of out) {
      if (r.status !== "ok" || r.data.comoControl) continue;
      const key = llaveDeVisita({ patientId: r.data.patientId, startsAt: r.data.startsAt, status: r.data.status });
      if (existentes.has(key)) {
        r.status = "skipped";
        r.warnings.push("Esta cita ya se importó antes");
      } else if (vistosEnArchivo.has(key)) {
        r.status = "duplicate";
        r.warnings.push("Fila repetida en el archivo (mismo paciente, fecha y estado)");
      } else {
        vistosEnArchivo.add(key);
      }
    }
    if (!controlesDisponibles && out.some((r) => r.data.comoControl)) {
      out.find((r) => r.data.comoControl)!.warnings.push("Falta import_external_ids (sql/import-ids-externos.sql): no se puede evitar repetir un control que 06 ya registró");
    }
    return out.sort((a, b) => a.row - b.row);
  },

  // Los usuarios activos de la clínica, para elegir a quién se asigna un doctor del archivo sin equivalente.
  async valueOptions(clinicId: string) {
    const usuarios = await prisma.user.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    const ROL: Record<string, string> = { SUPER_ADMIN: "dueño", ADMIN: "administrador", DOCTOR: "doctor", RECEPTIONIST: "recepción" };
    return {
      doctor: usuarios.map((u: any) => ({ id: u.id, label: `${`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()}${u.role && ROL[u.role] ? ` · ${ROL[u.role]}` : ""}` })),
    };
  },

  async commit(rows: PreviewRow[], clinicId: string, skipDuplicates: boolean, ctx: ImportContext) {
    const toInsert = pickInsertable(rows, skipDuplicates);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };
    let created = 0;

    // 1) Los controles atendidos de un caso de ortodoncia: cita COMPLETADA (nunca SCHEDULED: nada que recordar).
    const controles = toInsert.filter((r) => r.data.comoControl);
    if (controles.length > 0) {
      for (const r of controles) r.data.newId = newId();
      const build = (rs: PreviewRow[]) => rs.map((r) => ({
        id: r.data.newId as string,
        clinicId,
        patientId: r.data.patientId as string,
        doctorId: r.data.doctorId as string,
        type: TIPO_CITA_CONTROL_ORTO,
        startsAt: r.data.startsAt as Date,
        endsAt: r.data.endsAt as Date,
        status: "COMPLETED" as any,
        completedAt: r.data.endsAt as Date,
        notes: (r.data.notes as string | null) ?? null,
        resourceId: (r.data.resourceId as string | null) ?? null,
      }));
      const crear = (data: any[]) => prisma.appointment.createMany({ data, skipDuplicates: true });
      for (let i = 0; i < controles.length; i += BATCH) {
        const slice = controles.slice(i, i + BATCH);
        try {
          await crear(build(slice));
        } catch {
          for (const r of slice) {
            try { await crear(build([r])); } catch { /* la fila se resuelve abajo: si no quedó creada, entra como visita migrada */ }
          }
        }
      }
      const hechas = new Set<string>();
      const ids = controles.map((r) => r.data.newId as string);
      for (let i = 0; i < ids.length; i += 500) {
        const f = await prisma.appointment.findMany({ where: { clinicId, id: { in: ids.slice(i, i + 500) } }, select: { id: true } });
        for (const a of f) hechas.add(a.id);
      }
      const buenas = controles.filter((r) => hechas.has(r.data.newId as string));
      created += buenas.length;
      // Lo que no pudo entrar como cita (la base se lo negó) no se pierde: pasa a visita migrada.
      for (const r of controles) if (!hechas.has(r.data.newId as string)) { r.data.comoControl = false; r.warnings.push("No pudo guardarse como cita del caso: quedó como cita migrada (historial)"); }

      // Recuerda «este control de este caso ese día» y, si 06 ya había registrado su hoja, la enlaza a la cita.
      const pares = buenas
        .filter((r) => r.data.claveControl && !r.data.hojaId)
        .map((r) => ({ externalId: r.data.claveControl as string, localId: r.data.newId as string }));
      if (pares.length > 0 && !(await guardarControlesOrto(clinicId, ctx.originId, pares))) {
        console.warn("[import/appointmentHistory] import_external_ids no existe: no se recuerda qué controles ya se registraron (falta sql/import-ids-externos.sql)");
      }
      for (const r of buenas) {
        if (!r.data.hojaId) continue;
        try {
          await prisma.orthoTreatmentCard.updateMany({
            where: { id: r.data.hojaId as string, clinicId, appointmentId: null },
            data: { appointmentId: r.data.newId as string },
          });
        } catch (e) {
          if (!faltaLaTabla(e) && (e as any)?.code !== "P2002") throw e; // ya enlazada a otra cita o la columna aún no existe
        }
      }
    }

    // 2) Todo lo demás: historia de solo lectura (migrated_visits).
    const visitas = toInsert.filter((r) => !r.data.comoControl);
    if (visitas.length > 0) {
      try {
        await prisma.migratedVisit.count({ where: { clinicId } });
      } catch (e) {
        if (faltaLaTabla(e)) {
          throw new ImportError(
            409,
            "Falta aplicar el SQL del historial de citas (sql/citas-historial-migradas.sql) antes de importar",
            undefined,
            "MIGRATED_VISITS_TABLE_MISSING",
          );
        }
        throw e;
      }
      for (const r of visitas) r.data.newId = newId();
      const build = (rs: PreviewRow[]) => rs.map((r) => ({
        id: r.data.newId as string,
        clinicId,
        patientId: r.data.patientId as string,
        doctorId: (r.data.doctorId as string | null) ?? null,
        startsAt: r.data.startsAt as Date,
        status: r.data.status as any,
        type: (r.data.type as string | null) ?? null,
        notes: (r.data.notes as string | null) ?? null,
        origin: r.data.origin as string,
        createdById: ctx.userId,
      }));

      for (let i = 0; i < visitas.length; i += BATCH) {
        const slice = visitas.slice(i, i + BATCH);
        try {
          created += (await prisma.migratedVisit.createMany({ data: build(slice) })).count;
        } catch {
          for (const r of slice) {
            try {
              created += (await prisma.migratedVisit.createMany({ data: build([r]) })).count;
            } catch (e2: any) {
              r.status = "error";
              r.errors.push(e2?.code === "P2003" ? "No se pudo guardar: el paciente ya no existe" : "No se pudo guardar la fila (error de base de datos)");
            }
          }
        }
      }
    }

    const erroredNow = toInsert.filter((r) => r.status === "error").length;
    return { created, skipped: Math.max(0, toInsert.length - created - erroredNow) };
  },
};
