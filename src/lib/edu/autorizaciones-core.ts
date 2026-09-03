/**
 * DaleControl INSTITUCIONAL — EL GATE DE AUTORIZACIÓN, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin `node:crypto`
 * y sin `new Date()` escondido: el `now` siempre se pasa). Aquí viven las
 * cuatro decisiones que, si se escriben dos veces, terminan discrepando:
 *
 *   1. QUÉ SE FIRMA   · la lista cerrada de etapas y a qué fila apunta cada
 *                       una (targetType/targetId sin FK)
 *   2. EL HASH        · la RECETA de qué texto se resume, y cuándo una
 *                       autorización deja de valer sola
 *   3. LA PUERTA      · qué avance del caso exige qué etapa, y por qué una
 *                       urgencia pasa igual
 *   4. EL LOTE        · qué se puede firmar sin leer y qué no
 *
 * El sha256 en sí NO está aquí: vive en autorizaciones-hash.ts, que importa
 * `node:crypto` y por eso no puede tocar el bundle del navegador. Lo que se
 * parte en dos no es el capricho de un archivo más — es que la RECETA (qué
 * campos entran, en qué orden, normalizados cómo) se pueda leer y probar sin
 * Node, y que la función de un solo renglón que la digiere sea la única
 * pieza de servidor.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ EXISTE ESTA OLA, EN UN PÁRRAFO
 *
 * Sin hash: el alumno manda A, el docente firma A, el alumno edita a B, y B
 * queda "autorizado por el docente". La firma pasa a ser una etiqueta pegada
 * a un texto editable, que es exactamente lo contrario de una firma. Con
 * hash: al firmar se guarda el resumen de lo que el docente tenía delante, y
 * el día que el contenido cambia la autorización pasa sola a EXPIRED y hay
 * que volver a pedirla.
 *
 * 🔴 Y LO QUE ESTE GATE **NO** HACE: bloquear el expediente. La NOM-004 pide
 * nota por cada acto; si el alumno no puede registrar lo que hizo, el
 * expediente queda incompleto y el paciente con dolor espera. Lo que se
 * bloquea es el AVANCE del tratamiento (que un caso pase a "en tratamiento"
 * o a "terminado"), nunca el registro clínico. Escribir siempre se puede.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import type {
  EduApprovalStage,
  EduApprovalStatus,
  EduCaseStatus,
  EduRole,
} from "@/lib/edu/types";
import {
  EDU_APPROVAL_STAGES,
  EDU_APPROVAL_STAGE_LABELS,
  EDU_APPROVAL_STATUSES,
} from "@/lib/edu/types";
// La sección 6 (EL HISTORIAL) arma un `where` de Prisma, y para eso
// necesita el recorte ÚNICO del vertical. Los tres son módulos puros
// —`visibility.ts` solo importa tipos y `padron-core`—, así que esto no
// arrastra prisma ni "server-only" al navegador.
import { eduCaseScopeWhere, type EduVisibilityScope } from "@/lib/edu/visibility";
import { eduSearchTokens } from "@/lib/edu/padron-core";
import { eduDayRange, eduSafeTimeZone } from "@/lib/edu/agenda-core";

// ═══════════════════════════════════════════════════════════════════════
// 1 · QUÉ SE FIRMA: la lista CERRADA de tipos apuntables
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las tablas a las que puede apuntar una autorización.
 *
 * ⚠️ `EduCaseApproval.targetType`/`targetId` NO tienen llave foránea, y es a
 * propósito: apuntan a filas de tablas DISTINTAS y una FK obligaría a una
 * columna —y en la práctica a una tabla— por tipo. Mismo criterio que
 * `AuditLog.actorAdminId` en el dental.
 *
 * 🔴 Lo que impide que ahí acabe cualquier cosa NO es la base: es esta lista
 * y `parseEduApprovalTarget`. Sin ellas, `targetType` sería un campo de texto
 * libre en una tabla de firmas, que es la definición de un dato en el que no
 * se puede confiar.
 */
export const EDU_APPROVAL_TARGETS = ["EduRecord", "EduAppointment", "EduPrescription"] as const;

export type EduApprovalTarget = (typeof EDU_APPROVAL_TARGETS)[number];

/**
 * A qué fila apunta cada etapa. HOY la etapa determina el tipo, y aun así
 * las dos cosas se guardan:
 *
 *   · el índice único PARCIAL de la base (una sola PENDING por
 *     `(targetType, targetId)`) tiene que poder preguntarse SIN saber de
 *     etapas — si dependiera de la etapa, la misma nota podría tener a la
 *     vez un PLAN y un PROCEDURE esperando firma, que es exactamente el
 *     "¿cuál de los dos me están pidiendo?" que hunde una bandeja;
 *   · una quinta etapa puede apuntar a otra tabla sin migrar nada.
 *
 * 🔴 Tres de las cuatro apuntan a una NOTA CLÍNICA y no es pereza: en una
 * clínica todo lo que un alumno propone se escribe en el expediente. Si
 * el plan viviera en un campo suelto del caso, habría dos sitios donde dice
 * qué se le va a hacer al paciente, y el día que discrepen gana el que no
 * tiene firma.
 */
export const EDU_APPROVAL_STAGE_TARGET: Record<EduApprovalStage, EduApprovalTarget> = {
  PLAN: "EduRecord",
  PROCEDURE: "EduRecord",
  SESSION: "EduAppointment",
  DISCHARGE: "EduRecord",
  // Ola 14. La receta apunta a SU tabla: no es una nota (tiene renglones
  // estructurados con posología) ni cabe en una — y firmarla EXPIDE un
  // documento con la cédula del docente, no solo autoriza un avance.
  PRESCRIPTION: "EduPrescription",
};

/** Qué tipo de fila admite esta etapa. */
export function eduApprovalTargetForStage(stage: EduApprovalStage): EduApprovalTarget {
  return EDU_APPROVAL_STAGE_TARGET[stage];
}

/**
 * Ola 14 · Las etapas que se piden desde "Enviar a autorización" de la
 * ficha del caso. La RECETA no está y no es un olvido: mandarla a firma
 * también la mueve (BORRADOR → PENDIENTE), así que su envío vive en la
 * propia receta (src/lib/edu/recetas.ts) — el desplegable genérico no
 * puede hacer las dos cosas en una transacción. `requestEduApproval` la
 * rebota con el mismo texto por si alguien arma el POST a mano.
 */
export const EDU_APPROVAL_REQUESTABLE_STAGES: EduApprovalStage[] = [
  "PLAN",
  "PROCEDURE",
  "SESSION",
  "DISCHARGE",
];

export function parseEduApprovalStage(raw: unknown): EduApprovalStage | null {
  if (typeof raw !== "string") return null;
  return (EDU_APPROVAL_STAGES as string[]).includes(raw) ? (raw as EduApprovalStage) : null;
}

export function parseEduApprovalStatus(raw: unknown): EduApprovalStatus | null {
  if (typeof raw !== "string") return null;
  return (EDU_APPROVAL_STATUSES as string[]).includes(raw) ? (raw as EduApprovalStatus) : null;
}

export function parseEduApprovalTarget(raw: unknown): EduApprovalTarget | null {
  if (typeof raw !== "string") return null;
  return (EDU_APPROVAL_TARGETS as readonly string[]).includes(raw)
    ? (raw as EduApprovalTarget)
    : null;
}

// ── Topes de captura ────────────────────────────────────────────────────
// Los mismos que el `@db.VarChar` del schema: si aquí fueran más grandes, la
// base rebotaría la escritura con un error de Postgres en vez de un mensaje
// escrito para una persona.

export const EDU_APPROVAL_NOTE_MAX = 1000;
export const EDU_APPROVAL_EMERGENCY_REASON_MAX = 500;

/**
 * Un motivo de urgencia de tres letras ("xd", "ya") no es un motivo: es la
 * casilla que se llena para saltarse el trámite. El mínimo no impide la
 * urgencia —nada la impide— pero obliga a escribir algo que después se pueda
 * leer.
 */
export const EDU_APPROVAL_EMERGENCY_REASON_MIN = 12;

/** Techo de filas por consulta a la bandeja. */
export const EDU_APPROVAL_MAX_ROWS = 300;

/**
 * Cuántas se pueden firmar de una vez.
 *
 * No es un límite técnico: es que un "Autorizar las 200" no es una decisión,
 * es un botón de rendirse. Con 40 el docente sigue teniendo que mirar la
 * pantalla al menos una vez por grupo.
 */
export const EDU_APPROVAL_BATCH_MAX = 40;

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL HASH: la RECETA
//
// 🔴 SI ESTA RECETA CAMBIA, CAMBIAN TODOS LOS HASHES, y toda autorización
// vigente pasa a EXPIRED de golpe: la escuela se despierta con los casos
// bloqueados. Por eso la versión va DENTRO del texto que se resume — para
// que el cambio sea explícito y greppable, y no un descubrimiento de un
// martes por la mañana. Cambiarla es una decisión de producto, no un
// refactor.
// ═══════════════════════════════════════════════════════════════════════

export const EDU_APPROVAL_HASH_VERSION = "edu-approval/v1";

/**
 * Separadores de la serialización. Se eligen dos caracteres de control que
 * NO puede teclear nadie en un textarea (unit separator y record separator):
 * con una coma o un pipe, un alumno que escribiera "|" en el plan podría
 * fabricar dos contenidos distintos con el mismo hash.
 */
const SEP_CAMPO = "\u001f";
const SEP_LINEA = "\u001e";

/**
 * Lo que se resume de una NOTA CLÍNICA: SOLO el contenido clínico.
 *
 * ⚠️ El `status` de la nota NO entra, y es la decisión más importante de esta
 * lista: si entrara, firmar la nota (BORRADOR → FIRMADA, que es un acto del
 * docente y no cambia una letra del texto) invalidaría la autorización que
 * el propio docente acaba de dar. Lo mismo con `updatedAt`, `submittedAt` y
 * cualquier sello: se mueven sin que el contenido cambie.
 */
export interface EduApprovalRecordSnapshot {
  kind: "EduRecord";
  subjetivo: string | null;
  objetivo: string | null;
  analisis: string | null;
  plan: string | null;
  diagnostico: string | null;
}

/**
 * Lo que se resume de una CITA: cuándo, dónde y de qué tipo.
 *
 * ⚠️ El `status` tampoco entra (una cita pasa a "llegó" y a "en el sillón"
 * mientras ocurre lo que se autorizó) ni las `notes` de recepción. Sí entran
 * la hora, el sillón y el tipo: "te autoricé la sesión del martes a las diez
 * en el sillón 3" deja de ser cierto si se mueve a otro día — y entonces hay
 * que volver a pedirla, que es justo lo que debe pasar.
 */
export interface EduApprovalAppointmentSnapshot {
  kind: "EduAppointment";
  /** Instante ISO con milisegundos (la columna es Timestamptz(3)). */
  startsAtISO: string;
  endsAtISO: string;
  chairId: string;
  type: string;
}

/**
 * Ola 14 · Lo que se resume de una RECETA: el diagnóstico, las
 * indicaciones generales y CADA renglón con su posología completa, en su
 * orden — el orden es contenido: "1º amoxicilina, 2º ibuprofeno" es lo
 * que el docente firmó.
 *
 * ⚠️ El `status` NO entra, por lo mismo de siempre: expedirla (PENDIENTE
 * → EXPEDIDA, que es el acto del docente) no cambia una letra del texto y
 * no puede invalidar la firma que la expidió. Tampoco entran los sellos
 * ni los nombres congelados: se escriben AL firmar, y si entraran, la
 * firma se vencería a sí misma en el mismo UPDATE.
 */
export interface EduApprovalPrescriptionItemSnapshot {
  drug: string | null;
  presentation: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: string | null;
  notes: string | null;
}

export interface EduApprovalPrescriptionSnapshot {
  kind: "EduPrescription";
  diagnosis: string | null;
  indications: string | null;
  items: EduApprovalPrescriptionItemSnapshot[];
}

export type EduApprovalSnapshot =
  | EduApprovalRecordSnapshot
  | EduApprovalAppointmentSnapshot
  | EduApprovalPrescriptionSnapshot;

/**
 * Normaliza un texto antes de resumirlo.
 *
 * Las tres cosas que hace y por qué NINGUNA es cosmética:
 *  · `\r\n` → `\n`. El mismo párrafo tecleado en Windows y pegado desde un
 *    teléfono son bytes distintos y texto idéntico. Sin esto, copiar y
 *    volver a pegar el plan sin cambiar una palabra vencería la firma.
 *  · NFC. En español "é" se puede guardar como un carácter o como dos
 *    (e + acento combinante), y macOS produce una forma e iOS la otra.
 *    Mismo problema, misma cara: una autorización que se vence sola sin que
 *    nadie haya editado nada.
 *  · trim de los extremos. Un espacio al final no es un cambio de plan.
 *
 * Lo que NO hace: colapsar espacios interiores ni bajar a minúsculas. Ahí sí
 * hay contenido — "no extraer" y "NO EXTRAER" se leen distinto en una
 * pantalla, y "16" no es "1 6".
 */
function normalizarTexto(v: string | null | undefined): string {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").normalize("NFC").trim();
}

function campo(nombre: string, valor: string | null | undefined): string {
  return `${nombre}${SEP_CAMPO}${normalizarTexto(valor)}`;
}

/**
 * EL TEXTO CANÓNICO de lo que se manda a autorizar. El sha256 de esto es el
 * `contentHash` (ver autorizaciones-hash.ts).
 *
 * Se devuelve el texto y no el hash a propósito: así una prueba puede leer
 * exactamente qué se está resumiendo, y el día que alguien agregue un campo
 * a la nota se ve en el diff si entra o no entra al hash.
 */
export function eduApprovalCanonicalText(snapshot: EduApprovalSnapshot): string {
  if (!snapshot || typeof snapshot !== "object") {
    // Un snapshot roto NO puede producir el mismo texto que uno vacío
    // legítimo: si lo hiciera, un fallo de lectura firmaría "nada" y
    // cualquier contenido posterior parecería idéntico.
    return `${EDU_APPROVAL_HASH_VERSION}${SEP_LINEA}__invalido__`;
  }

  if (snapshot.kind === "EduAppointment") {
    return [
      EDU_APPROVAL_HASH_VERSION,
      "EduAppointment",
      campo("startsAt", snapshot.startsAtISO),
      campo("endsAt", snapshot.endsAtISO),
      campo("chairId", snapshot.chairId),
      campo("type", snapshot.type),
    ].join(SEP_LINEA);
  }

  if (snapshot.kind === "EduPrescription") {
    // Ola 14. Rama NUEVA del texto canónico: no toca ni un byte de las dos
    // anteriores, así que ningún hash ya firmado cambia. Cada renglón se
    // serializa completo y EN SU ORDEN — reordenar los medicamentos
    // produce otro documento y por tanto otro hash, a propósito.
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    return [
      EDU_APPROVAL_HASH_VERSION,
      "EduPrescription",
      campo("diagnosis", snapshot.diagnosis),
      campo("indications", snapshot.indications),
      ...items.map((it, i) =>
        [
          campo(`item${i}.drug`, it?.drug),
          campo(`item${i}.presentation`, it?.presentation),
          campo(`item${i}.dose`, it?.dose),
          campo(`item${i}.route`, it?.route),
          campo(`item${i}.frequency`, it?.frequency),
          campo(`item${i}.duration`, it?.duration),
          campo(`item${i}.quantity`, it?.quantity),
          campo(`item${i}.notes`, it?.notes),
        ].join(SEP_LINEA),
      ),
    ].join(SEP_LINEA);
  }

  return [
    EDU_APPROVAL_HASH_VERSION,
    "EduRecord",
    campo("subjetivo", snapshot.subjetivo),
    campo("objetivo", snapshot.objetivo),
    campo("analisis", snapshot.analisis),
    campo("plan", snapshot.plan),
    campo("diagnostico", snapshot.diagnostico),
  ].join(SEP_LINEA);
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · CUÁNDO UNA AUTORIZACIÓN DEJA DE VALER
// ═══════════════════════════════════════════════════════════════════════

/** Lo mínimo de una fila para poder comparar su contenido. */
export interface EduApprovalJudgeable {
  status: EduApprovalStatus;
  contentHash: string;
  isEmergency?: boolean;
}

/**
 * Lo mínimo para decidir si abre la puerta.
 *
 * NO lleva `contentHash` a propósito: el `status` que recibe ya es el
 * EFECTIVO (el que comparó el hash). Si el tipo pidiera el hash, alguien
 * acabaría pasándole el de la columna junto al status de la columna, y una
 * autorización vencida volvería a abrir.
 */
export interface EduGateCandidate {
  status: EduApprovalStatus;
  isEmergency?: boolean;
}

/**
 * ¿El contenido de hoy es el mismo que se guardó?
 *
 * `currentHash === null` significa que la fila apuntada YA NO EXISTE (la nota
 * o la cita se borró). Eso cuenta como cambio: una firma sobre algo que ya no
 * está no autoriza nada, y decir que sí sería peor que decir que no.
 */
export function eduApprovalContentChanged(
  approval: EduApprovalJudgeable,
  currentHash: string | null,
): boolean {
  if (!approval || typeof approval.contentHash !== "string") return true;
  if (currentHash === null || currentHash === undefined) return true;
  return currentHash !== approval.contentHash;
}

/**
 * 🔴 EL ESTADO QUE DE VERDAD TIENE UNA AUTORIZACIÓN.
 *
 * La columna dice APPROVED; esta función dice APPROVED **solo si el
 * contenido sigue siendo el que se firmó**. Ese "solo si" es la ola entera.
 *
 * ⚠️ Una PENDING con el contenido cambiado NO se vence: se MARCA (ver
 * `eduApprovalContentChanged`, que la bandeja pinta como "lo editó después de
 * mandarla") y el docente decide sobre lo que lee ahora. Vencerla sola haría
 * desaparecer de la bandeja la petición de un alumno que corrigió un dedazo,
 * y el alumno no tendría forma de saber por qué. Lo que sí hace el producto
 * es sacarla del LOTE: eso se firma leyendo.
 */
export function eduApprovalEffectiveStatus(
  approval: EduApprovalJudgeable,
  currentHash: string | null,
): EduApprovalStatus {
  if (!approval) return "EXPIRED";
  if (approval.status !== "APPROVED") return approval.status;
  return eduApprovalContentChanged(approval, currentHash) ? "EXPIRED" : "APPROVED";
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA PUERTA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Qué avance del caso exige qué etapa autorizada.
 *
 * SON DOS PUERTAS Y NO SIETE, a propósito:
 *   · pasar a "en tratamiento" exige el PLAN firmado — es el momento en que
 *     se empieza a trabajar sobre una persona;
 *   · pasar a "terminado" exige el ALTA firmada — un caso no se cierra
 *     porque el alumno crea que acabó.
 *
 * Lo que NO se gatea y no es un olvido: pausar (ON_HOLD), transferir
 * (TRANSFERRED) y dar por abandonado (ABANDONED). Ninguno de los tres avanza
 * un tratamiento; los tres son formas de PARAR, y pedir firma para parar es
 * cómo se consigue que nadie registre que paró.
 */
export const EDU_APPROVAL_GATE_BY_CASE_STATUS: Partial<
  Record<EduCaseStatus, EduApprovalStage>
> = {
  IN_TREATMENT: "PLAN",
  COMPLETED: "DISCHARGE",
};

export function eduApprovalStageForCaseStatus(to: EduCaseStatus): EduApprovalStage | null {
  return EDU_APPROVAL_GATE_BY_CASE_STATUS[to] ?? null;
}

/**
 * ¿Esta autorización abre la puerta?
 *
 * Recibe el estado EFECTIVO (el que ya comprobó el hash), nunca el de la
 * columna: si recibiera el de la columna, una APPROVED vencida seguiría
 * abriendo.
 *
 * 🔴 LA RUTA DE URGENCIA. Una petición marcada urgente abre la puerta
 * estando PENDING — el alumno procede sin firma previa y NO se le impide.
 * Queda la fila con su motivo, destacada arriba de la bandeja y en la ficha
 * del caso. La alternativa (bloquear) tiene un solo final conocido: la
 * escuela pide la contraseña de dirección para todo y el gate se apaga.
 *
 * Una urgencia RECHAZADA deja de abrir. El acto ya ocurrió —eso no se
 * deshace— pero el caso no sigue avanzando con ella.
 */
export function eduApprovalOpensGate(a: EduGateCandidate): boolean {
  if (!a) return false;
  if (a.status === "APPROVED") return true;
  if (a.status === "PENDING" && a.isEmergency === true) return true;
  return false;
}

export interface EduGateVerdict {
  ok: boolean;
  /** Por qué pasó, o qué le falta. Escrito para una persona. */
  detail: string;
  /** true cuando pasó SOLO por la ruta de urgencia. */
  viaEmergency: boolean;
}

/**
 * ¿Puede el caso avanzar a este estado?
 *
 * Recibe TODAS las autorizaciones de esa etapa del caso, ya con su estado
 * efectivo. Es puro: la consulta la hace autorizaciones.ts y el juicio se
 * toma aquí, para que una prueba sin base de datos pueda fijarlo.
 */
export function eduCaseGateVerdict(
  stage: EduApprovalStage,
  approvals: EduGateCandidate[],
): EduGateVerdict {
  const lista = Array.isArray(approvals) ? approvals : [];
  const abre = lista.filter(eduApprovalOpensGate);

  if (abre.length === 0) {
    const vencida = lista.some((a) => a.status === "EXPIRED");
    const pendiente = lista.some((a) => a.status === "PENDING");
    const rechazada = lista.some((a) => a.status === "REJECTED");
    const cambios = lista.some((a) => a.status === "CHANGES_REQUESTED");

    if (vencida) {
      return {
        ok: false,
        viaEmergency: false,
        detail: `La autorización de ${EDU_APPROVAL_STAGE_LABELS[stage].toLowerCase()} se venció porque se editó lo que estaba firmado. Hay que mandarla otra vez desde la ficha del caso.`,
      };
    }
    if (pendiente) {
      return {
        ok: false,
        viaEmergency: false,
        // ⚠️ Los mensajes de este bloque NO se dirigen a nadie en concreto, y
        // es a propósito: el mismo texto lo lee el alumno (que puede pedir y
        // no firmar), el docente (que firma y no pide) y la dirección. Un
        // "mándala tú" le diría al docente que haga algo que su rol no puede
        // hacer, y quien lo leyera concluiría que el sistema está roto.
        detail: `Ya está pedida y falta la firma del docente. Si el paciente no puede esperar, el estudiante puede reenviarla marcada como urgencia: queda constancia y no se le impide seguir.`,
      };
    }
    if (rechazada) {
      return {
        ok: false,
        viaEmergency: false,
        detail: `El docente rechazó la autorización de ${EDU_APPROVAL_STAGE_LABELS[stage].toLowerCase()}, y dejó escrito por qué. Eso se habla antes de volver a mandarla.`,
      };
    }
    if (cambios) {
      return {
        ok: false,
        viaEmergency: false,
        detail: `El docente pidió cambios y dejó escrito cuáles. Se corrige lo que marcó y se vuelve a mandar a autorización.`,
      };
    }
    return {
      ok: false,
      viaEmergency: false,
      detail: `Falta la autorización de ${EDU_APPROVAL_STAGE_LABELS[stage].toLowerCase()}. El estudiante la manda desde la ficha del caso y su docente supervisor la firma desde el teléfono.`,
    };
  }

  const soloUrgencia = abre.every((a) => a.status === "PENDING");
  return {
    ok: true,
    viaEmergency: soloUrgencia,
    detail: soloUrgencia
      ? "Avanza por la ruta de urgencia: quedó constancia y el docente todavía tiene que firmarla."
      : "Autorizado.",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LA DECISIÓN
// ═══════════════════════════════════════════════════════════════════════

/** Lo que puede contestar un docente. */
export const EDU_APPROVAL_DECISIONS = [
  "APPROVED",
  "CHANGES_REQUESTED",
  "REJECTED",
] as const;

export type EduApprovalDecision = (typeof EDU_APPROVAL_DECISIONS)[number];

export function parseEduApprovalDecision(raw: unknown): EduApprovalDecision | null {
  if (typeof raw !== "string") return null;
  return (EDU_APPROVAL_DECISIONS as readonly string[]).includes(raw)
    ? (raw as EduApprovalDecision)
    : null;
}

export const EDU_APPROVAL_DECISION_LABELS: Record<EduApprovalDecision, string> = {
  APPROVED: "Autorizar",
  CHANGES_REQUESTED: "Pedir cambios",
  REJECTED: "Rechazar",
};

/**
 * ¿Hace falta escribir un motivo?
 *
 * "Pedir cambios" sin decir cuáles es devolverle al alumno el trabajo con un
 * "no" y ningún camino: vuelve a mandar lo mismo y el docente vuelve a
 * devolverlo. "Rechazar" sin motivo es lo mismo con menos esperanza.
 * Autorizar no lo necesita: la firma ya dice todo lo que hay que decir.
 */
export function eduApprovalDecisionNeedsNote(decision: EduApprovalDecision): boolean {
  return decision !== "APPROVED";
}

/** Mínimo de un motivo, por lo mismo que el de la urgencia. */
export const EDU_APPROVAL_NOTE_MIN = 8;

// ── El lote ─────────────────────────────────────────────────────────────

/**
 * Por qué una petición NO entra en "autorizar todas las de este alumno".
 *
 * 🔴 El lote existe porque un docente con quince alumnos recibe decenas de
 * peticiones al día, y sin lote firma sin leer en dos semanas: el gate se
 * vuelve un sello de goma. Y por lo mismo el lote NO puede tragárselo todo —
 * si se tragara justo lo que hay que leer, habríamos construido el sello de
 * goma nosotros.
 *
 * Se quedan fuera, y se le dicen una por una:
 *  · las URGENCIAS, que son las únicas que YA ocurrieron sin firma;
 *  · las que el alumno EDITÓ después de mandarlas, porque lo que el docente
 *    tiene delante no es lo que pidió;
 *  · las que pidió UNO MISMO — nadie firma su propia petición, SALVO la
 *    dirección (ver eduApprovalRoleSignsOwn: las suyas sí entran al lote);
 *  · las que dejaron de estar pendientes mientras miraba la lista.
 */
export type EduApprovalBatchSkip = "urgencia" | "cambio" | "propia" | "no-pendiente" | "receta";

export const EDU_APPROVAL_BATCH_SKIP_LABELS: Record<EduApprovalBatchSkip, string> = {
  urgencia:
    "Es una urgencia: ya ocurrió sin firma previa. Ésas se leen y se firman una por una.",
  cambio:
    "El estudiante la editó después de mandarla. Lee lo que dice ahora antes de firmarla.",
  // El texto es el del DOCENTE, y por eso habla de otro docente: la
  // dirección ya no ve este motivo nunca (eduApprovalRoleSignsOwn).
  propia:
    "La mandaste tú. Una firma sobre la propia petición no es una firma: que la revise otro docente.",
  "no-pendiente": "Ya no está esperando firma: alguien la decidió mientras mirabas la lista.",
  // Ola 14. Firmar una receta pone TU cédula en un papel que ordena
  // medicamentos. Eso no entra en un botonazo de cuarenta.
  receta:
    "Es una receta: expedirla pone tu cédula en el documento. Se lee completa y se firma una por una.",
};

export interface EduApprovalBatchCandidate {
  status: EduApprovalStatus;
  isEmergency: boolean;
  contentChanged: boolean;
  /** Ola 14. Solo hace falta para dejar las RECETAS fuera del lote. */
  stage?: EduApprovalStage;
}

export function eduApprovalBatchSkipReason(
  r: EduApprovalBatchCandidate,
): EduApprovalBatchSkip | null {
  if (!r || r.status !== "PENDING") return "no-pendiente";
  // Ola 14. ANTES que la urgencia: una receta urgente sigue siendo una
  // receta, y el motivo que se le pinta al docente tiene que ser el que
  // explica por qué ni el lote ni la prisa le quitan la lectura.
  if (r.stage === "PRESCRIPTION") return "receta";
  if (r.isEmergency) return "urgencia";
  if (r.contentChanged) return "cambio";
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 bis · LO PROPIO: quién puede decidir lo que él mismo mandó
//
// 🔴 "Nadie firma su propia petición" vivía escrita TRES veces —la bandeja,
// la decisión individual y el lote— y las tres tenían que decir lo mismo
// para siempre. Aquí vive UNA sola vez, y los tres sitios la llaman.
// ═══════════════════════════════════════════════════════════════════════

/** Lo mínimo de la sesión que hace falta para juzgar lo propio. */
export interface EduApprovalActor {
  role: EduRole;
  eduUserId: string;
}

/**
 * ¿Este ROL puede decidir sobre lo que él mismo mandó?
 *
 * 🔴 SOLO LA DIRECCIÓN, y se decide por el ROL DE LA SESIÓN, NO por un
 * permiso. Encenderle "autorizaciones.decide" a un docente le da la
 * bandeja, no la exención: si la exención colgara de esa casilla, la
 * separación de funciones que sostiene toda la Ola 4 se apagaría con un
 * clic, y quien lo diera no tendría cómo saber que además la apagaba.
 *
 * Por qué la dirección sí. Es la única figura que responde por la escuela
 * entera y la única que no tiene a nadie encima: con la regla puesta también
 * sobre ella, una petición suya sobre un alumno sin supervisor vigente se
 * quedaba SIN NADIE que pudiera firmarla, y la única salida que sabíamos
 * darle era que se nombrara un superior que no existe. Lo que sustituye a la
 * regla no es nada — es la TRAZA: eduApprovalSelfDecided deja escrito, en
 * cada sitio donde esa autorización se lee, que quien firmó fue quien pidió.
 *
 * ⚠️ Para el DOCENTE y para cualquier otro rol, todo sigue igual: bloqueo
 * con el mismo mensaje y fuera del lote.
 */
export function eduApprovalRoleSignsOwn(role: EduRole): boolean {
  return role === "DIRECCION";
}

/**
 * ¿La mandó QUIEN MIRA? Es el HECHO, y va aparte de la consecuencia: la
 * dirección tiene que poder ver que una petición es suya (y que firmarla
 * quedará marcado) sin que eso le cierre nada.
 */
export function eduApprovalIsOwn(
  actor: EduApprovalActor | null | undefined,
  requestedById: string | null | undefined,
): boolean {
  if (!actor || !actor.eduUserId || !requestedById) return false;
  return requestedById === actor.eduUserId;
}

/** ¿A QUIEN MIRA se le cierra esta petición por haberla mandado él? */
export function eduApprovalOwnBlocked(
  actor: EduApprovalActor | null | undefined,
  requestedById: string | null | undefined,
): boolean {
  if (!actor || !eduApprovalIsOwn(actor, requestedById)) return false;
  return !eduApprovalRoleSignsOwn(actor.role);
}

/**
 * El motivo del lote CON lo propio ya juzgado. Es la función que usan la
 * bandeja (para pintar) y el lote (para cerrar): si fueran dos, un día
 * pintaríamos un botón que el servidor rebota.
 */
export function eduApprovalBatchSkipFor(
  actor: EduApprovalActor | null | undefined,
  r: EduApprovalBatchCandidate & { requestedById?: string | null },
): EduApprovalBatchSkip | null {
  // ANTES que todo lo demás, como estaba: a quien no puede firmarla no se
  // le explica que además es una urgencia.
  if (eduApprovalOwnBlocked(actor, r?.requestedById)) return "propia";
  return eduApprovalBatchSkipReason(r);
}

/**
 * El 409 de la decisión individual. Vive aquí, y no como literal dentro del
 * servidor, porque es el texto que la prueba fija: el día que la dirección
 * quedó exenta, lo que NO podía cambiar era lo que sigue leyendo el docente.
 */
export const EDU_APPROVAL_OWN_DENIED =
  "No puedes decidir lo que tú mismo mandaste: una firma sobre la propia petición no es una firma. Que la revise el docente que supervisa a ese estudiante; si no tiene supervisor vigente, asígnaselo desde Docentes y él la firma.";

/**
 * LA TRAZA: ¿quien decidió es quien pidió?
 *
 * 🔴 Es un dato DERIVADO al leer, y por eso no hay columna nueva: los dos
 * ids ya se guardan (`requestedById` al pedir, `decidedById` al decidir), y
 * una columna "fue autofirma" sería un tercer dato que mantener de acuerdo
 * con esos dos — el día que discrepe, gana la que nadie comprueba.
 */
export function eduApprovalSelfDecided(a: {
  requestedById?: string | null;
  decidedById?: string | null;
}): boolean {
  if (!a || !a.requestedById || !a.decidedById) return false;
  return a.requestedById === a.decidedById;
}

/** La marca, cuando la decisión FUE una firma. */
export const EDU_APPROVAL_SELF_SIGNED_MARK =
  "Firmada por Dirección sobre una petición propia";

/**
 * La marca cuando la decisión NO fue una firma (rechazo o cambios pedidos).
 * Decir "firmada" de un rechazo sería, otra vez, una traza que miente.
 */
export const EDU_APPROVAL_SELF_DECIDED_MARK =
  "Decidida por Dirección sobre una petición propia";

/** La marca que le toca a este estado. Las dos dicen "petición propia". */
export function eduApprovalSelfMark(status: EduApprovalStatus): string {
  // EXPIRED se firmó y luego caducó: la firma existió, y quien la puso fue
  // quien pidió. Sigue siendo lo que hay que poder leer.
  return status === "APPROVED" || status === "EXPIRED"
    ? EDU_APPROVAL_SELF_SIGNED_MARK
    : EDU_APPROVAL_SELF_DECIDED_MARK;
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · CUÁNTO LLEVA ESPERANDO
//
// Se calcula en el SERVIDOR y viaja ya formateado: pintarlo en el cliente
// con un `new Date()` daría una hidratación distinta a la del servidor y
// React lo tacharía en consola cada vez que alguien abre la bandeja.
// ═══════════════════════════════════════════════════════════════════════

export function eduApprovalWaitedMinutes(requestedAt: Date, now: Date): number {
  const t = requestedAt instanceof Date ? requestedAt.getTime() : NaN;
  const n = now instanceof Date ? now.getTime() : NaN;
  if (Number.isNaN(t) || Number.isNaN(n)) return 0;
  // Un reloj adelantado no puede producir "hace -3 min".
  return Math.max(0, Math.floor((n - t) / 60000));
}

export function eduApprovalWaitedLabel(minutes: number): string {
  const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  if (m < 1) return "recién llegada";
  if (m < 60) return `hace ${m} min`;
  const horas = Math.floor(m / 60);
  if (horas < 48) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} días`;
}

/**
 * Qué tan mal va la espera.
 *
 * Los cortes son de piso clínico, no de oficina: el alumno está de pie con
 * el paciente sentado. A los 20 minutos ya es una sala de espera; a la hora,
 * el paciente se está yendo.
 */
export const EDU_APPROVAL_WAIT_WARN_MINUTES = 20;
export const EDU_APPROVAL_WAIT_LATE_MINUTES = 60;

export type EduApprovalWaitSeverity = "ok" | "warn" | "late";

export function eduApprovalWaitSeverity(minutes: number): EduApprovalWaitSeverity {
  if (minutes >= EDU_APPROVAL_WAIT_LATE_MINUTES) return "late";
  if (minutes >= EDU_APPROVAL_WAIT_WARN_MINUTES) return "warn";
  return "ok";
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · LAS FORMAS QUE VIAJAN A LA PANTALLA
//
// Se definen aquí (módulo puro) y no en el archivo de servidor por lo de
// siempre: un componente "use client" no puede importar el módulo que trae
// Prisma al navegador. Si el tipo no vive aquí, no hay de dónde.
//
// Las fechas salen como string ISO Y ADEMÁS con su etiqueta ya formateada en
// la zona del INSTITUTO: la pantalla no vuelve a formatear nada.
// ═══════════════════════════════════════════════════════════════════════

/** Lo que se propone, ya resumido para leerlo de pie y con guantes. */
export interface EduApprovalSummary {
  title: string;
  lines: { label: string; text: string }[];
}

export interface EduApprovalRow {
  id: string;
  stage: EduApprovalStage;
  stageLabel: string;
  /** El estado EFECTIVO (el hash ya comprobado). Es el que se pinta. */
  status: EduApprovalStatus;
  /** El que dice la columna. Difiere del anterior cuando venció sola. */
  storedStatus: EduApprovalStatus;
  targetType: EduApprovalTarget;
  targetId: string;

  caseId: string;
  programName: string;
  caseStatusLabel: string;

  patientId: string;
  patientName: string;
  patientFolio: string;

  studentId: string;
  studentName: string;
  studentMatricula: string;

  requestedByName: string;
  requestedAt: string;
  requestedAtLabel: string;
  waitedMinutes: number;
  waitedLabel: string;
  waitSeverity: EduApprovalWaitSeverity;

  decidedByName: string | null;
  decidedAt: string | null;
  decidedAtLabel: string | null;
  decisionNote: string | null;

  isEmergency: boolean;
  emergencyReason: string | null;

  /** El contenido cambió desde que se pidió (o desde que se firmó). */
  contentChanged: boolean;
  /** Por qué no entra en el lote, o null si sí entra. */
  batchSkip: EduApprovalBatchSkip | null;
  /**
   * La mandó QUIEN LA MIRA. Es el hecho, no la consecuencia: para el
   * docente viene con `batchSkip: "propia"` (no la puede firmar) y para la
   * DIRECCIÓN viene sin él (sí puede, y quedará marcada).
   */
  own: boolean;
  /**
   * LA TRAZA: quien la decidió es quien la pidió. Derivado al leer
   * (`decidedById === requestedById`), sin columna nueva. Hoy solo lo puede
   * producir la DIRECCIÓN, que es la única exenta de "nadie firma lo suyo".
   */
  selfDecided: boolean;

  summary: EduApprovalSummary;
}

/**
 * Una opción del desplegable "¿qué mandas a autorizar?".
 *
 * Vive aquí y no en autorizaciones.ts porque la pinta un componente
 * "use client", y ese componente no puede importar el módulo que trae Prisma
 * al navegador.
 */
export interface EduApprovalTargetOption {
  id: string;
  kind: EduApprovalTarget;
  label: string;
  detail: string;
}

/** Un alumno y todo lo que tiene esperando. */
export interface EduApprovalGroup {
  studentId: string;
  studentName: string;
  studentMatricula: string;
  rows: EduApprovalRow[];
  /** Cuántas urgencias trae. Manda el orden de los grupos. */
  emergencies: number;
  /** Las que SÍ se pueden firmar de golpe. */
  batchIds: string[];
  /** La más vieja del grupo, en minutos. */
  oldestWaitedMinutes: number;
}

/**
 * Agrupa la bandeja POR ALUMNO.
 *
 * 🔴 Por alumno y no por paciente ni por fecha: el docente no piensa "¿qué
 * hay de la señora Ramírez?", piensa "¿qué me debe firmar Sofía?". Agrupado
 * por otra cosa, aprobar en lote sería aprobarle a doce alumnos distintos de
 * un botonazo, que es exactamente lo que no queremos poder hacer.
 *
 * El orden: primero los grupos CON urgencias, y dentro de eso el que lleva
 * más esperando. Las urgencias primero es literal — un paciente con dolor no
 * se pone en la cola.
 */
export function eduGroupApprovalsByStudent(rows: EduApprovalRow[]): EduApprovalGroup[] {
  const porAlumno = new Map<string, EduApprovalGroup>();

  for (const r of Array.isArray(rows) ? rows : []) {
    let g = porAlumno.get(r.studentId);
    if (!g) {
      g = {
        studentId: r.studentId,
        studentName: r.studentName,
        studentMatricula: r.studentMatricula,
        rows: [],
        emergencies: 0,
        batchIds: [],
        oldestWaitedMinutes: 0,
      };
      porAlumno.set(r.studentId, g);
    }
    g.rows.push(r);
    if (r.isEmergency) g.emergencies += 1;
    if (r.batchSkip === null) g.batchIds.push(r.id);
    if (r.waitedMinutes > g.oldestWaitedMinutes) g.oldestWaitedMinutes = r.waitedMinutes;
  }

  const grupos = Array.from(porAlumno.values());
  for (const g of grupos) {
    g.rows.sort((a, b) => {
      if (a.isEmergency !== b.isEmergency) return a.isEmergency ? -1 : 1;
      return a.requestedAt.localeCompare(b.requestedAt);
    });
  }

  grupos.sort((a, b) => {
    if ((a.emergencies > 0) !== (b.emergencies > 0)) return a.emergencies > 0 ? -1 : 1;
    if (b.oldestWaitedMinutes !== a.oldestWaitedMinutes) {
      return b.oldestWaitedMinutes - a.oldestWaitedMinutes;
    }
    // Desempate estable: dos grupos con la misma espera no pueden cambiar de
    // orden entre dos recargas, o el docente pierde el sitio donde iba.
    return a.studentMatricula.localeCompare(b.studentMatricula);
  });

  return grupos;
}

/** Lo que se le pinta a quien abrió la bandeja y no le toca nada. */
export const EDU_APPROVAL_NONE_DETAIL =
  "Tu rol no ve autorizaciones. Caja no las ve a propósito: cobra, no autoriza actos clínicos. Las ven la dirección (todas), los docentes (las de sus estudiantes vigentes) y cada estudiante (las suyas).";

// ═══════════════════════════════════════════════════════════════════════
// 6 · EL HISTORIAL — todo lo que YA se decidió
//
// La bandeja contesta "¿qué me falta por firmar?". Esto contesta la otra
// mitad: "¿qué se firmó, qué se rechazó y qué se devolvió con cambios?",
// que es la pregunta de una acreditación, de una queja, y del docente que
// quiere volver a mirar lo que decidió la semana pasada.
//
// 🔴 NO ES UNA TABLA NUEVA NI UN ALCANCE NUEVO. Son las MISMAS filas de
// EduCaseApproval que ya lee la bandeja, con `status` distinto de PENDING,
// y recortadas por el MISMO `eduVisibility(ctx, "cases")`. Todo lo de aquí
// es puro: el parseo de la URL, la query string de vuelta y el comparador
// que ordena. Nada de esto sabe qué filas existen.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los estados que SÍ salen en el historial: todo lo que no está esperando.
 *
 * ⚠️ EXPIRED entra, aunque nadie la "decida": una firma que dejó de valer
 * porque el texto cambió después es justo lo que busca quien audita.
 * Dejarla fuera haría que el historial dijera "Autorizado" de algo que el
 * gate rechaza tres pantallas más allá.
 */
export const EDU_APPROVAL_HISTORY_STATUSES: EduApprovalStatus[] = EDU_APPROVAL_STATUSES.filter(
  (s) => s !== "PENDING",
);

export function parseEduApprovalHistoryStatus(raw: unknown): EduApprovalStatus | null {
  const s = parseEduApprovalStatus(raw);
  return s && s !== "PENDING" ? s : null;
}

export interface EduApprovalHistoryFilters {
  /** Un estado concreto, o null = todas las no pendientes. */
  status: EduApprovalStatus | null;
  stage: EduApprovalStage | null;
  /** El ESTUDIANTE dueño del caso (EduStudent.id). */
  studentId: string | null;
  /** Quién DECIDIÓ (EduUser.id del docente o de la dirección). */
  decidedByUserId: string | null;
  /** La especialidad = EduCase.programId. */
  programId: string | null;
  /** Rango de la DECISIÓN, en días de calendario del instituto (AAAA-MM-DD). */
  desdeISO: string | null;
  hastaISO: string | null;
  /** Paciente: nombre o folio. Va contra el searchIndex del paciente. */
  q: string | null;
  /** "Las que decidí yo". Se resuelve con el id de la SESIÓN, no de la URL. */
  soloMias: boolean;
}

export const EDU_APPROVAL_HISTORY_EMPTY_FILTERS: EduApprovalHistoryFilters = {
  status: null,
  stage: null,
  studentId: null,
  decidedByUserId: null,
  programId: null,
  desdeISO: null,
  hastaISO: null,
  q: null,
  soloMias: false,
};

function histFirst(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  if (typeof value === "string") return value;
  return null;
}

/** Un id de la URL: cuid o nada. Lo que no encaja se descarta en silencio. */
function histId(value: string | string[] | undefined): string | null {
  const raw = histFirst(value);
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.length > 40) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

const HIST_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Un día de CALENDARIO de la URL, y que EXISTA.
 *
 * ⚠️ La forma no basta: "2026-13-45" pasa el patrón y es un día que no
 * existe. Más abajo, `eduDayRange` lo convertiría en null y el filtro
 * desaparecería en silencio — la consulta saldría bien pero la pantalla
 * seguiría enseñando el filtro puesto y el botón «Limpiar» encendido,
 * diciendo que filtra por algo que no filtra. Se descarta AQUÍ.
 */
function histDay(value: string | string[] | undefined): string | null {
  const raw = histFirst(value);
  if (!raw) return null;
  const m = HIST_DAY_RE.exec(raw.trim());
  if (!m) return null;
  const [, y, mes, dia] = m;
  const d = new Date(Date.UTC(Number(y), Number(mes) - 1, Number(dia)));
  // El round-trip descarta el 31 de febrero, el mes 13 y el día 45: el
  // Date los desborda al mes siguiente y ya no vuelve al mismo texto.
  return d.toISOString().slice(0, 10) === m[0] ? m[0] : null;
}

function histQ(value: string | string[] | undefined): string | null {
  const raw = histFirst(value);
  if (typeof raw !== "string") return null;
  const v = raw.trim().slice(0, 60);
  return v.length > 0 ? v : null;
}

/**
 * Lee los filtros de la query string. Lo que no reconoce, lo tira.
 *
 * 🔴 Aquí NO se lee ningún institutionId, ningún rol y ningún alcance: el
 * tenant sale de la sesión y el recorte de visibility.ts. Un `?estudiante=`
 * de otro docente entra tal cual —es un id, se parsea— y muere DENTRO de la
 * consulta, que lo mete en el MISMO objeto `student` donde ya vive el
 * recorte: el AND de los dos no devuelve una fila. Contestar 403 aquí sería
 * confirmarle a quien lo teclea que ese id existe.
 */
export function parseEduApprovalHistoryFilters(
  searchParams: Record<string, string | string[] | undefined> | undefined | null,
): EduApprovalHistoryFilters {
  const sp = searchParams ?? {};
  const desde = histDay(sp.desde);
  const hasta = histDay(sp.hasta);
  // Un rango al revés se ignora ENTERO. Quedarse con un lado inventaría un
  // filtro que nadie pidió, y en una pantalla de auditoría eso es peor que
  // no filtrar: se lee como "no hay nada" cuando sí lo hay.
  const alReves = Boolean(desde && hasta && desde > hasta);
  return {
    status: parseEduApprovalHistoryStatus(histFirst(sp.estado)),
    stage: parseEduApprovalStage(histFirst(sp.etapa)),
    studentId: histId(sp.estudiante),
    decidedByUserId: histId(sp.docente),
    programId: histId(sp.especialidad),
    desdeISO: alReves ? null : desde,
    hastaISO: alReves ? null : hasta,
    q: histQ(sp.q),
    soloMias: histFirst(sp.mias) === "1",
  };
}

/**
 * La query string equivalente. Solo lo que difiere del default: un enlace
 * que se puede leer es un enlace que se puede pegar en un correo, y eso es
 * media pantalla — "mándame lo que rechazaste de endodoncia en marzo".
 */
export function eduApprovalHistoryQuery(f: EduApprovalHistoryFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set("estado", f.status);
  if (f.stage) p.set("etapa", f.stage);
  if (f.studentId) p.set("estudiante", f.studentId);
  if (f.decidedByUserId) p.set("docente", f.decidedByUserId);
  if (f.programId) p.set("especialidad", f.programId);
  if (f.desdeISO) p.set("desde", f.desdeISO);
  if (f.hastaISO) p.set("hasta", f.hastaISO);
  if (f.q) p.set("q", f.q);
  if (f.soloMias) p.set("mias", "1");
  return p.toString();
}

export function eduHasApprovalHistoryFilters(f: EduApprovalHistoryFilters): boolean {
  return Boolean(
    f.status ||
      f.stage ||
      f.studentId ||
      f.decidedByUserId ||
      f.programId ||
      f.desdeISO ||
      f.hastaISO ||
      f.q ||
      f.soloMias,
  );
}

/**
 * EL SELLO por el que se ordena el historial: cuándo quedó como quedó.
 *
 * Casi siempre es `decidedAt`. Es null en las que NADIE decidió: cuando el
 * alumno REENVÍA, la anterior se cierra como CHANGES_REQUESTED y queda
 * adrede sin `decidedById` (no se le atribuye a un docente una decisión que
 * no tomó). Ésas se ordenan por su `requestedAt`, el único instante que la
 * fila tiene propio.
 */
export function eduApprovalHistoryStamp(row: {
  decidedAt: string | null;
  requestedAt: string;
}): string {
  return row.decidedAt ?? row.requestedAt;
}

/**
 * El comparador del historial: lo más reciente arriba.
 *
 * 🔴 POR QUÉ ORDENA JAVASCRIPT Y NO POSTGRES. La fecha que se PINTA es
 * `decidedAt ?? requestedAt`, y Prisma no sabe ordenar por una expresión.
 * Peor: en Postgres un `ORDER BY x DESC` pone los NULL **primero**, así que
 * `orderBy: { decidedAt: "desc" }` encabezaría el historial con justo las
 * filas que nadie decidió. La consulta trae DOS tandas con `where`
 * disjuntos (`decidedAt` no nulo / nulo), cada una con su propio orden y su
 * propio `take`, y aquí se mezclan: la unión contiene con certeza el top-N
 * real, porque una fila que entra en el top verdadero no puede ser
 * desplazada por otra de su misma tanda.
 *
 * Desempate por `id` para que dos filas del mismo instante no cambien de
 * sitio entre dos recargas.
 */
export function eduCompareApprovalHistory(
  a: { id: string; decidedAt: string | null; requestedAt: string },
  b: { id: string; decidedAt: string | null; requestedAt: string },
): number {
  const sa = eduApprovalHistoryStamp(a);
  const sb = eduApprovalHistoryStamp(b);
  if (sa !== sb) return sa < sb ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

/**
 * El tono del tag por estado.
 *
 * Vive AQUÍ y no en la pantalla porque lo pintan dos: la ficha del caso
 * (`caso-autorizaciones.tsx`) y el historial. Dos mapas iguales terminan
 * discrepando el día que alguien cambia uno, y entonces la misma fila sale
 * ámbar en una pantalla y roja en la otra.
 */
export const EDU_APPROVAL_STATUS_TAG: Record<EduApprovalStatus, string> = {
  PENDING: "edu-tag--info",
  APPROVED: "edu-tag--ok",
  CHANGES_REQUESTED: "edu-tag--warn",
  REJECTED: "edu-tag--danger",
  EXPIRED: "edu-tag--danger",
};

/**
 * 🔴 EL `where` DEL HISTORIAL — el punto donde se cierra TODO.
 *
 * Vive aquí, en el módulo puro, y no dentro de la consulta, por la misma
 * razón que `eduStudentWhere` vive en padron-core: así se puede MIRAR sin
 * base de datos. Una prueba arma el `where` de un docente con el
 * `?estudiante=` de un alumno ajeno y comprueba, sobre el objeto, que el
 * id ajeno quedó DENTRO del mismo `student` donde vive el recorte — es
 * decir, que la consulta no puede devolver esa fila. Eso no se puede
 * comprobar mirando una pantalla.
 *
 * Las tres cerraduras, en este orden:
 *
 *  1. `institutionId` de la SESIÓN, siempre. Un undefined aquí BORRA el
 *     filtro de tenant en Prisma y devuelve las filas de todos los
 *     institutos; por eso `eduCaseScopeWhere` revienta si le falta.
 *  2. `case: eduCaseScopeWhere(...)` — EL ALCANCE, el mismo de la bandeja y
 *     del expediente. No hay un segundo recorte escrito a mano en ningún
 *     sitio de este archivo.
 *  3. Los FILTROS, que solo pueden ACOTAR. El más delicado es
 *     `studentId`: entra como `studentExtra` de `eduCaseScopeWhere`, o sea
 *     que se FUSIONA con el filtro del alcance en el mismo objeto
 *     `student`. Para la dirección (`scope.kind === "all"`) es el único
 *     filtro y funciona; para un docente se suma a `supervisors.some(…)` y
 *     para un alumno a `userId`, y en los dos casos un id ajeno da un AND
 *     imposible: cero filas, sin 403 y sin pista de que ese id exista.
 *
 * ⚠️ `decidedByUserId` NO abre nada: filtra por quién decidió DENTRO de lo
 * que ya se ve. Un docente que teclee el id de un colega verá, como mucho,
 * lo que ese colega decidió sobre SUS PROPIOS alumnos vigentes — filas que
 * ya podía leer enteras.
 */
export interface EduApprovalHistoryWhereInput {
  institutionId: string;
  scope: EduVisibilityScope;
  filters: EduApprovalHistoryFilters;
  /** El id de la SESIÓN, para "las que decidí yo". Nunca sale de la URL. */
  viewerUserId: string;
  timeZone: string;
  now: Date;
}

export function eduApprovalHistoryWhere({
  institutionId,
  scope,
  filters,
  viewerUserId,
  timeZone,
  now,
}: EduApprovalHistoryWhereInput): Prisma.EduCaseApprovalWhereInput {
  const where: Prisma.EduCaseApprovalWhereInput = {
    institutionId,
    // El historial es lo que YA no espera. Un `status` concreto tiene que
    // ser uno de los decididos: `parseEduApprovalHistoryStatus` ya descarta
    // PENDING, así que `?estado=PENDING` cae a null y vuelve al `not`.
    status: filters.status ? filters.status : { not: "PENDING" },
    case: {
      ...eduCaseScopeWhere({
        institutionId,
        scope,
        now,
        studentExtra: filters.studentId ? { id: filters.studentId } : undefined,
      }),
      ...(filters.programId ? { programId: filters.programId } : {}),
    },
  };

  if (filters.stage) where.stage = filters.stage;

  // "Las que decidí yo" GANA sobre el desplegable de docente: es el filtro
  // de la sesión y el otro es texto de la URL. Si los dos vinieran puestos
  // y se aplicaran los dos, un `?docente=<otro>&mias=1` no devolvería nada
  // y parecería un error del sistema.
  if (filters.soloMias) where.decidedById = viewerUserId;
  else if (filters.decidedByUserId) where.decidedById = filters.decidedByUserId;

  const tz = eduSafeTimeZone(timeZone);
  const and: Prisma.EduCaseApprovalWhereInput[] = [];

  // El rango va sobre la DECISIÓN y en días de CALENDARIO del instituto:
  // una firma de las 20:00 en Tijuana pintada en UTC cae al día siguiente,
  // y quien filtra "el 3 de marzo" no la encontraría el 3 de marzo.
  // Extremo derecho EXCLUSIVO (< medianoche del día siguiente).
  if (filters.desdeISO) {
    const r = eduDayRange(filters.desdeISO, tz);
    if (r) and.push({ decidedAt: { gte: r.from } });
  }
  if (filters.hastaISO) {
    const r = eduDayRange(filters.hastaISO, tz);
    if (r) and.push({ decidedAt: { lt: r.to } });
  }

  // El paciente, por nombre o folio. Contra `searchIndex`, que es la
  // columna SIN ACENTOS de la Ola 1B: buscar "Rodriguez" tiene que
  // encontrar a "Rodríguez". Cada palabra por separado y todas (AND), como
  // en el resto del vertical.
  for (const token of eduSearchTokens(filters.q)) {
    and.push({ case: { patient: { searchIndex: { contains: token } } } });
  }

  if (and.length > 0) where.AND = and;
  return where;
}
