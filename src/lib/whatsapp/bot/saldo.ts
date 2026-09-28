// ═══════════════════════════════════════════════════════════════════════════
// «¿Cuánto debo?» — shell del flujo de saldo (ws1-t3).
//
// El flujo y TODAS las reglas de seguridad viven en `saldo-core.ts`, puro y
// testeable. Aquí solo se cablean las dependencias reales y se inyectan,
// exactamente como hace `booking.ts` con `booking-core.ts`.
//
// ── El rastro ─────────────────────────────────────────────────────────────
// Contestar un saldo por WhatsApp es un acceso a datos del paciente, y tiene
// que dejar constancia de QUIÉN preguntó y QUÉ se contestó.
//
// Va como NOTA INTERNA en el propio hilo del Inbox (`isInternal: true`): queda
// pegada a la conversación y al paciente, la clínica la ve donde ya mira, y no
// se le manda al paciente.
//
// ⚠️ NO va a `AuditLog` vía `logRead`, y no por olvido: `AuditLog.userId` es
// una FK NOT NULL a `User` y el bot no es un usuario de la clínica. Escribir
// ahí exigiría o inventarse un usuario —dejando en la bitácora que «lo leyó»
// alguien que estaba dormido— o cambiar el schema, que queda fuera de esta
// tarea. `registrarConsultaDeSaldo` es el único punto por el que pasa el
// rastro: el día que exista un actor «bot» en la bitácora formal, se enchufa
// aquí y ni el núcleo ni las pruebas se enteran. Queda anotado en el reporte.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { SYSTEM_EXTERNAL_ID_PREFIX, buildSystemExternalId } from "@/lib/whatsapp/system-message";
import { findPatientsByWhatsAppPhone } from "@/lib/whatsapp/inbox-log";
import { dinero } from "@/lib/quotes/condiciones-pago";
import { resumenDeSaldoDePaciente } from "@/lib/whatsapp/cobranza/datos";
import { fechaLarga, hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { getCobranzaSettings } from "@/lib/reminders/config";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import {
  MAX_FALLOS,
  RESULTADOS_FALLIDOS,
  VENTANA_FALLOS_MS,
  runSaldoTurn,
  sufijoDelRastro,
  type PacienteSaldo,
  type RastroConsulta,
  type SaldoDeps,
} from "./saldo-core";
import type { BotConfigDTO, BotTurnInput, BotTurnResult } from "./types";

export { isSaldoInProgress } from "./saldo-core";

/** Cómo se lee cada resultado en la nota interna, en cristiano. */
const COMO_SE_CUENTA: Record<RastroConsulta["resultado"], string> = {
  saldoEntregado: "el bot le dijo su próxima mensualidad y lo pendiente",
  sinPlan: "no tiene mensualidades pendientes; se le dijo así",
  pacienteNoEncontrado: "preguntó por su saldo desde un número sin paciente; se derivó",
  pacienteDeBaja: "el paciente está dado de baja; NO se dijo nada y se derivó",
  fechaPedida:
    "ese número es de más de un paciente; se le pidió la fecha de nacimiento para saber de cuál",
  fechaIlegible: "lo que respondió no es una fecha; se le pidió otra vez",
  fechaSinCoincidencia:
    "la fecha no es de ninguno de los pacientes de ese número; NO se dijo nada y el bot se pausó en este hilo",
  fechaAmbigua:
    "la fecha es de más de un paciente de ese número; NO se dijo nada y el bot se pausó en este hilo",
  intentosAgotados:
    "dos fallos con la fecha en 24 h (o no se pudieron contar); NO se dijo nada y el bot se pausó en este hilo",
};

/**
 * Deja constancia de la consulta. NUNCA lanza: que no se pueda escribir la
 * nota no puede tumbar la respuesta al paciente ni el webhook de Meta.
 */
export async function registrarConsultaDeSaldo(datos: RastroConsulta): Promise<void> {
  try {
    if (!datos.clinicId || !datos.threadId) return;
    // Últimos 4 dígitos y no el teléfono entero: la nota ya cuelga del hilo de
    // ese número, repetirlo completo solo esparce el dato personal.
    const cola = datos.telefono.replace(/\D/g, "").slice(-4);
    const cuerpo =
      `🔒 Consulta de saldo por WhatsApp — ${COMO_SE_CUENTA[datos.resultado]}` +
      (cola ? ` (número ···${cola})` : "");

    const ahora = new Date();
    await prisma.inboxMessage.create({
      data: {
        threadId: datos.threadId,
        direction: "OUT",
        body: cuerpo,
        // Nota del sistema: no se envía al canal, solo la ve la clínica.
        isInternal: true,
        sentAt: ahora,
        // ⚠️ El `sys:` NO es decorativo. El tope diario del bot cuenta los OUT
        // con `sentById` null y sin ese prefijo (ver el `count` del webhook):
        // sin él, cada consulta de saldo gastaría DOS unidades del cupo de
        // Claude de toda la clínica, y un puñado de ellas dejaría al bot sin
        // contestar FAQ ni agendar a nadie. El resultado va dentro del id para
        // poder CONTAR los fallos sin parsear el texto de la nota.
        externalId: `${buildSystemExternalId("system")}${sufijoDelRastro(datos.resultado)}`,
      },
    });
    // Que la nota suba el hilo en el Inbox: un rastro que nadie ve no es un
    // rastro. (No es un mensaje del paciente, pero sí algo que la clínica
    // tiene que poder encontrar.)
    await prisma.inboxThread
      .update({ where: { id: datos.threadId }, data: { lastMessageAt: ahora } })
      .catch(() => {});
  } catch (e) {
    console.error("[whatsapp/saldo] no se pudo registrar la consulta:", e);
  }
}

/**
 * Cuántas desambiguaciones han fallado ya en este hilo en las últimas 24 h.
 *
 * Se cuenta sobre las notas que deja `registrarConsultaDeSaldo`, no sobre el
 * `botState`: ese caduca a los 10 minutos, y cada «¿cuánto debo?» nuevo
 * empieza sin él. El resultado viaja en el `externalId` justamente para poder
 * contarlo con un `count` y no leyendo el texto.
 */
export async function fallosRecientesDeSaldo(
  clinicId: string,
  threadId: string,
): Promise<number> {
  try {
    if (!clinicId || !threadId) return MAX_FALLOS; // ante la duda, no se contesta
    return await prisma.inboxMessage.count({
      where: {
        threadId,
        // El hilo tiene que ser de esta clínica: el threadId no basta por sí solo.
        thread: { clinicId },
        isInternal: true,
        sentAt: { gte: new Date(Date.now() - VENTANA_FALLOS_MS) },
        externalId: { startsWith: `${SYSTEM_EXTERNAL_ID_PREFIX}system:` },
        OR: RESULTADOS_FALLIDOS.map((r) => ({ externalId: { endsWith: sufijoDelRastro(r) } })),
      },
    });
  } catch (e) {
    console.error("[whatsapp/saldo] no se pudieron contar los fallos:", e);
    // Si no se puede contar, se corta: mejor derivar de más que convertir el
    // bot en un oráculo por un fallo de la base.
    return MAX_FALLOS;
  }
}

/**
 * "YYYY-MM-DD" de la próxima cita "Control de ortodoncia" del paciente, o
 * `null` si no tiene ninguna (o no es paciente de ortodoncia). Mismo patrón
 * de tolerancia P2021/P2022 que el resto de `lib/orthodontics/`: si el caso
 * de ortodoncia todavía no existe en esta base, no tumba la respuesta de
 * saldo, solo se queda sin ese dato.
 */
async function proximoControlDe(clinicId: string, patientId: string): Promise<string | null> {
  if (!clinicId || !patientId) return null;
  try {
    const cita = await prisma.appointment.findFirst({
      where: {
        clinicId,
        patientId,
        type: TIPO_CITA_CONTROL_ORTO,
        startsAt: { gte: new Date() },
        status: { not: "CANCELLED" },
      },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true },
    });
    return cita ? cita.startsAt.toISOString().slice(0, 10) : null;
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022") return null;
    throw e;
  }
}

/**
 * Las dependencias reales. Las pruebas pasan dobles en su lugar.
 *
 * ws1-t1 ronda 2 — `permiteDinero`/`permiteControl` son los DOS interruptores
 * separados (antes era uno solo, `canAnswerBalance`, que también tapaba el
 * control). Cierran sobre `resumenDeSaldo` para que enmascarar el dato sea
 * cosa del shell (I/O), no del núcleo puro (`saldo-core.ts` no sabe de
 * interruptores de ortodoncia, solo de lo que `ResumenSaldo` le trae).
 */
export function realSaldoDeps(
  timezone: string,
  permiteDinero: boolean,
  permiteControl: boolean,
): SaldoDeps {
  return {
    async buscarPacientesPorTelefono(clinicId, phone): Promise<PacienteSaldo[]> {
      if (!clinicId || !phone) return [];
      // La misma búsqueda que usa el Inbox para enlazar hilos: compara los
      // últimos 10 dígitos NORMALIZADOS en los dos lados. Devuelve a TODOS los
      // que tengan el número, que es justo lo que el núcleo necesita para
      // negarse a adivinar cuando hay dos.
      const encontrados = await findPatientsByWhatsAppPhone(clinicId, phone);
      if (encontrados.length === 0) return [];

      const filas = await prisma.patient.findMany({
        where: {
          clinicId,
          id: { in: encontrados.map((p) => p.id) },
          deletedAt: null,
          // SIN filtrar por `status`: el dado de baja cuenta para saber si el
          // número es compartido (si no, su mamá parecería la única paciente
          // del número y él recibiría la deuda de ella). Que no se le conteste
          // a él lo decide el núcleo con `activo`.
        },
        select: { id: true, status: true, dob: true },
      });
      return filas.map((p) => ({
        id: p.id,
        activo: p.status === "ACTIVE",
        // La columna es `date`: se lee en UTC para que el 1 de octubre no se
        // vuelva el 30 de septiembre en México (mismo criterio que
        // condiciones-pago-db.ts).
        dob: p.dob ? p.dob.toISOString().slice(0, 10) : null,
      }));
    },

    async resumenDeSaldo(clinicId, patientId) {
      // ws1-t1 ronda 2 — interruptores SEPARADOS: solo se LEE (y por tanto
      // solo se puede contestar) lo que su propio interruptor permite. Un
      // clínica con el de dinero apagado y el de control encendido nunca ve
      // `resumenDeSaldoDePaciente` correr para esa consulta, y viceversa —
      // no es un `if` al pintar el texto, es que el dato ni se trae.
      const [resumen, proximoControl] = await Promise.all([
        permiteDinero
          ? resumenDeSaldoDePaciente(clinicId, patientId, hoyEnZona(new Date(), timezone))
          : Promise.resolve(null),
        permiteControl ? proximoControlDe(clinicId, patientId) : Promise.resolve(null),
      ]);
      if (!resumen && !proximoControl) return null;
      return {
        ...(resumen ?? {
          vencimiento: null,
          importeCuota: 0,
          numeroCuota: 0,
          esEnganche: false,
          totalCuotas: 0,
          pendiente: 0,
          tieneVencidas: false,
        }),
        proximoControl,
      };
    },

    registrarConsulta: registrarConsultaDeSaldo,
    fallosRecientes: fallosRecientesDeSaldo,
    formatearImporte: dinero,
    formatearFecha: fechaLarga,
  };
}

/**
 * Entrypoint que consume el motor (engine.ts). `deps` inyectable para pruebas.
 *
 * ws1-t1 ronda 2 — DOS interruptores separados: `canAnswerBalance` (dinero,
 * `Clinic.reminderSettings.cobranza.bot`, apagado de fábrica) y
 * `canAnswerOrthoControl` (próximo control, `OrthodonticsClinicSettings.
 * proximoControlBotEnabled`, encendido de fábrica). El núcleo comprueba que
 * al menos uno esté encendido; cuál de los dos deja VER cada dato lo decide
 * `realSaldoDeps` al construir el shell.
 */
export function handleSaldoTurn(
  input: BotTurnInput,
  config: BotConfigDTO,
  deps?: SaldoDeps,
): Promise<BotTurnResult | null> {
  return runSaldoTurn(
    input,
    config,
    deps ??
      realSaldoDeps(
        config.timezone ?? "America/Mexico_City",
        config.canAnswerBalance ?? false,
        config.canAnswerOrthoControl ?? false,
      ),
  );
}

/** ¿Esta clínica deja que el bot hable de dinero? (lee el Json de la clínica) */
export function botPuedeDecirSaldo(clinic: { reminderSettings?: unknown }): boolean {
  return getCobranzaSettings(clinic).bot;
}
