import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { ownPrivateRecordsOnly } from "@/lib/branches";
import { logRead, extractAuditMeta } from "@/lib/audit";
import { signMaybeUrls, BUCKETS } from "@/lib/storage";
import { consentTimeZone } from "@/lib/consent/dates";
import { buildSignatureBlocks } from "@/lib/consent/signers";
import {
  CLINIC_LETTERHEAD_SELECT,
  clinicLetterheadProps,
  imageAspect,
} from "@/lib/pdf/clinic-letterhead";
import { COND_BY_ID, SURFACE_NAMES } from "@/components/dashboard/odontogram-v2/data";
import {
  PADECIMIENTOS,
  ALERGIAS,
  HABITOS,
  RISK_FLAG_LABELS,
} from "@/lib/health-questionnaire";
import {
  ExpedienteDocument,
  leerAparatosSistemas,
  leerExploracionFisica,
  leerHeredoFamiliares,
  leerPronostico,
  pesoLegible,
  siNo,
  type ExpedienteAdenda,
  type ExpedienteCita,
  type ExpedienteConsentimiento,
  type ExpedienteDocumentProps,
  type ExpedienteEstudio,
  type ExpedienteHallazgoDental,
  type ExpedienteNota,
  type ExpedientePlan,
  type ExpedienteReceta,
} from "@/lib/pdf/expediente-document";

export const dynamic = "force-dynamic";
// El expediente entero de un paciente cargado puede tardar: se leen ocho
// colecciones y, si se piden, se bajan decenas de imágenes. El default de 10 s
// de Vercel corta a la mitad justo el caso que importa.
export const maxDuration = 120;

interface Params {
  params: { id: string };
}

// ── Topes de las imágenes ────────────────────────────────────────────────
//
// Existen para que un expediente con 60 placas no tumbe la función ni devuelva
// un archivo que nadie puede abrir. Cuando un tope corta, el PDF lo DICE junto
// al estudio y el estudio sigue listado: nunca desaparece una placa en silencio.

/** Cuántas imágenes se incrustan como mucho. */
const MAX_IMAGENES = 40;
/** Presupuesto total de bytes de imagen dentro del PDF. */
const MAX_BYTES_IMAGENES = 25 * 1024 * 1024;
/** Tope por archivo: una placa de 20 MB no se lleva el presupuesto entero. */
const MAX_BYTES_POR_IMAGEN = 8 * 1024 * 1024;
/** Cuántas se bajan a la vez. Más que esto satura al bucket y no va más rápido. */
const TANDA_IMAGENES = 4;
const TIMEOUT_IMAGEN_MS = 8000;

/** Las firmas son PNG pequeños; su propio tope, más apretado. */
const MAX_FIRMAS = 48;
const MAX_BYTES_POR_FIRMA = 1024 * 1024;
const TIMEOUT_FIRMA_MS = 4000;

/** TTL de las URLs firmadas: solo tienen que vivir lo que dura el render. */
const TTL_DESCARGA = 180;

/**
 * Plazo GLOBAL de todas las descargas (imágenes + firmas), no el de cada una.
 *
 * Sin él, el peor caso no cabe en `maxDuration`: 40 imágenes en tandas de 4 a
 * 8 s son 80 s, más 48 firmas en tandas de 4 a 4 s son 48 s, y las dos fases
 * van en serie → 128 s ANTES de empezar a renderizar, con los 120 s de la
 * función ya agotados. Un bucket degradado (que no falla rápido: tarda) es
 * exactamente el caso que lo dispara. Con este reloj, al agotarse se deja de
 * bajar y lo que falte sale con su motivo escrito en el papel, que es
 * infinitamente mejor que un 504 sin documento.
 */
const PRESUPUESTO_TIEMPO_MS = 70_000;

/**
 * GET /api/patients/[id]/expediente-pdf
 *
 * EL EXPEDIENTE CLÍNICO COMPLETO DEL PACIENTE, EN UN SOLO PDF.
 *
 * Hasta hoy cada pieza se descargaba por su lado y quien pedía su expediente se
 * llevaba quince archivos sueltos. La NOM-004-SSA3-2012 (§5.5) dice que la
 * información es del PACIENTE y que puede pedir copia; y si un día hay una
 * reclamación, lo que se entrega es el expediente, no una carpeta.
 *
 * ── LAS CUATRO PUERTAS, EN ESTE ORDEN ──────────────────────────────────────
 *   1. Sesión (`getCurrentUser`, que redirige si no hay).
 *   2. Permiso `medicalRecord.export` → 403. Es una key propia y no un extra de
 *      `medicalRecord.view`: ver la ficha deja el dato dentro del sistema,
 *      armar el expediente entero lo SACA. Por default solo SUPER_ADMIN y
 *      ADMIN; se concede a quien haga falta desde Equipo → Permisos.
 *   3. Tenant: `clinicId` SIEMPRE de la sesión, nunca del cliente, y si faltara
 *      se corta ANTES de consultar (un `clinicId: undefined` no filtra nada:
 *      Prisma descarta la clave y devuelve las filas de todas las clínicas).
 *   4. Visibilidad del paciente (`assertPatientVisible`) → 404, no 403: no se
 *      confirma que el paciente exista.
 *
 * ── Y QUEDA EN LA BITÁCORA ─────────────────────────────────────────────────
 * `logRead` con `kind: "expediente_pdf"`. Es la lectura más grande que existe
 * en el panel, así que se registra cada vez (sin dedupe, igual que los demás
 * export) y se lanza solapada con el render para no añadir un viaje en serie.
 *
 * ── LAS DOS CASILLAS, LAS DOS APAGADAS POR DEFAULT ─────────────────────────
 *   · `imagenes=1` incrusta radiografías y fotos. Apagada (el default) van
 *     LISTADAS con su tipo, su fecha y quién las subió — y el PDF lo dice.
 *   · `administrativo=1` añade el anexo de facturas y presupuestos. Apagada,
 *     no aparece ni una: la NOM-004 no lo pide, el expediente es clínico, y
 *     mezclar dinero con historia clínica se lee mal en una reclamación.
 * Se leen SOLO como "=1": cualquier otra cosa es apagado. Un parámetro suelto
 * no puede encender la que pesa.
 *
 * ── `?estimar=1` ───────────────────────────────────────────────────────────
 * Devuelve JSON con cuántas imágenes hay y cuánto pesan, sin generar el PDF.
 * Es lo que el diálogo usa para decirle al usuario cuánto va a pesar ANTES de
 * encender la casilla. No escribe bitácora a propósito: no sale ningún dato
 * clínico, solo el número y los bytes.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();

  const denied = denyIfMissingPermission(user, "medicalRecord.export");
  if (denied) return denied;

  // Regla (c) del repo, explícita: sin clínica en la sesión NO se consulta.
  if (!user.clinicId) {
    return NextResponse.json({ error: "Sesión sin clínica" }, { status: 403 });
  }

  const visDenied = await assertPatientVisible(params.id, {
    userId: user.id,
    role: user.role,
    clinicId: user.clinicId,
  });
  if (visDenied) return visDenied;

  const paciente = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: user.clinicId },
    select: {
      id: true,
      patientNumber: true,
      firstName: true,
      lastName: true,
      dob: true,
      gender: true,
      bloodType: true,
      phone: true,
      email: true,
      address: true,
      curp: true,
      allergies: true,
      chronicConditions: true,
      currentMedications: true,
      familyHistory: true,
      personalNonPathologicalHistory: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      emergencyContactRelation: true,
      createdAt: true,
      primaryDoctor: { select: { firstName: true, lastName: true } },
      clinic: { select: { ...CLINIC_LETTERHEAD_SELECT, taxId: true, clues: true, timezone: true } },
    },
  });
  if (!paciente) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }

  const url = new URL(req.url);
  const incluirImagenes = url.searchParams.get("imagenes") === "1";
  const incluirAdministrativo = url.searchParams.get("administrativo") === "1";

  // ── La sonda del diálogo: cuánto va a pesar ────────────────────────────
  if (url.searchParams.get("estimar") === "1") {
    const archivos = await prisma.patientFile.findMany({
      where: {
        patientId: paciente.id,
        clinicId: user.clinicId,
        deletedAt: null,
        category: { not: "CONSENT_FORM" },
      },
      select: { mimeType: true, size: true },
    });
    const incrustables = archivos.filter((f) => esImagenIncrustable(f.mimeType));
    const bytes = incrustables.reduce((suma, f) => suma + (f.size ?? 0), 0);
    return NextResponse.json({
      estudios: archivos.length,
      imagenes: incrustables.length,
      bytes,
      pesoLegible: pesoLegible(bytes),
      // Lo que el usuario tiene que saber antes de encender la casilla: si hay
      // más imágenes que el tope, no van a entrar todas.
      topeImagenes: MAX_IMAGENES,
      recortado: incrustables.length > MAX_IMAGENES || bytes > MAX_BYTES_IMAGENES,
    });
  }

  const tz = consentTimeZone(paciente.clinic?.timezone ?? null);

  // ── Lectura del expediente ─────────────────────────────────────────────
  //
  // Dos tandas de menos de 7 consultas cada una: el pooler de Supabase se
  // satura por encima de eso y empiezan los timeouts (regla del repo).
  const [cuestionario, notas, hallazgos, planes, recetas, consentimientos] = await Promise.all([
    prisma.healthQuestionnaire.findFirst({
      where: { patientId: paciente.id, clinicId: user.clinicId },
      orderBy: { filledAt: "desc" },
      select: { filledAt: true, answers: true, riskFlags: true, notes: true, filledById: true },
    }),
    prisma.medicalRecord.findMany({
      // Nota privada = de su autor, sin excepción para admin (misma regla que
      // /api/records y que el PDF de nota suelta). Las que quedan fuera no se
      // esconden: se CUENTAN, y el documento dice cuántas hay.
      where: { patientId: paciente.id, clinicId: user.clinicId, AND: [ownPrivateRecordsOnly(user.id)] },
      orderBy: { visitDate: "asc" }, // de la más vieja a la más nueva
      select: {
        id: true,
        visitDate: true,
        subjective: true,
        objective: true,
        assessment: true,
        plan: true,
        vitals: true,
        specialtyData: true,
        doctor: { select: { firstName: true, lastName: true, cedulaProfesional: true } },
        diagnoses_v2: {
          select: { cie10: { select: { code: true, description: true } } },
          orderBy: { isPrimary: "desc" },
        },
      },
    }),
    prisma.odontogramEntry.findMany({
      // OdontogramEntry no lleva clinicId; el candado de tenant es el paciente,
      // que ya se resolvió contra `user.clinicId` en el findFirst de arriba.
      where: { patientId: paciente.id },
      orderBy: [{ toothNumber: "asc" }, { conditionId: "asc" }],
      select: { toothNumber: true, surface: true, conditionId: true, notes: true, updatedAt: true },
    }),
    prisma.treatmentPlan.findMany({
      where: { patientId: paciente.id, clinicId: user.clinicId },
      orderBy: { startDate: "asc" },
      select: {
        name: true,
        description: true,
        status: true,
        startDate: true,
        endDate: true,
        totalSessions: true,
        doctor: { select: { firstName: true, lastName: true } },
        sessions: {
          orderBy: { sessionNumber: "asc" },
          select: { sessionNumber: true, completedAt: true, notes: true },
        },
      },
    }),
    prisma.prescription.findMany({
      // Las ANULADAS también: la anulación no borra lo que se prescribió, y un
      // expediente que solo enseña las vigentes cuenta media historia.
      where: { patientId: paciente.id, clinicId: user.clinicId },
      orderBy: { issuedAt: "asc" },
      select: {
        qrCode: true,
        issuedAt: true,
        expiresAt: true,
        diagnosis: true,
        indications: true,
        status: true,
        voidedAt: true,
        voidReason: true,
        doctor: { select: { firstName: true, lastName: true, cedulaProfesional: true } },
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            cumsKey: true,
            dosage: true,
            duration: true,
            quantity: true,
            notes: true,
            cums: { select: { descripcion: true, presentacion: true } },
          },
        },
      },
    }),
    prisma.consentForm.findMany({
      where: { patientId: paciente.id, clinicId: user.clinicId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        procedure: true,
        content: true,
        createdAt: true,
        doctorId: true,
        signedAt: true,
        signatureUrl: true,
        signerName: true,
        signerRelation: true,
        contentHash: true,
        revokedAt: true,
        revokedReason: true,
        doctorSignedAt: true,
        doctorSignatureUrl: true,
        witness1Name: true,
        witness1SignedAt: true,
        witness1SignatureUrl: true,
        witness2Name: true,
        witness2SignedAt: true,
        witness2SignatureUrl: true,
      },
    }),
  ]);

  const [archivos, citas, notasTotales, facturas, presupuestos] = await Promise.all([
    prisma.patientFile.findMany({
      where: {
        patientId: paciente.id,
        clinicId: user.clinicId,
        deletedAt: null,
        // El consentimiento firmado ya va íntegro en la sección 7; listarlo otra
        // vez como "estudio" duplicaría el documento sin añadir nada.
        category: { not: "CONSENT_FORM" },
      },
      orderBy: { createdAt: "asc" },
      select: {
        name: true,
        url: true,
        category: true,
        mimeType: true,
        size: true,
        toothNumber: true,
        notes: true,
        takenAt: true,
        createdAt: true,
        uploadedBy: true,
      },
    }),
    prisma.appointment.findMany({
      where: { patientId: paciente.id, clinicId: user.clinicId },
      orderBy: { startsAt: "asc" },
      select: {
        startsAt: true,
        type: true,
        status: true,
        room: true,
        notes: true,
        doctor: { select: { firstName: true, lastName: true } },
        resource: { select: { name: true } },
      },
    }),
    // Cuántas notas hay EN TOTAL para este paciente, privadas incluidas. La
    // diferencia con las que se leyeron arriba es lo que el documento declara
    // como "no incluido por ser privado de otro profesional".
    prisma.medicalRecord.count({ where: { patientId: paciente.id, clinicId: user.clinicId } }),
    incluirAdministrativo
      ? prisma.invoice.findMany({
          where: { patientId: paciente.id, clinicId: user.clinicId },
          orderBy: { createdAt: "asc" },
          select: {
            invoiceNumber: true,
            createdAt: true,
            items: true,
            total: true,
            paid: true,
            status: true,
            notes: true,
          },
        })
      : Promise.resolve([]),
    incluirAdministrativo
      ? prisma.quote.findMany({
          where: { patientId: paciente.id, clinicId: user.clinicId },
          orderBy: { createdAt: "asc" },
          select: { folio: true, createdAt: true, title: true, total: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  // Quién llenó el cuestionario. Consulta suelta y solo si hace falta.
  //
  // Se distinguen TRES casos y no dos, porque confundirlos es afirmar algo que
  // no consta: `filledById` nulo es el caso legítimo («lo llenó el paciente
  // desde el portal, sin sesión»); un id que ya no resuelve —la capturista se
  // dio de baja y su fila se borró— NO es eso, y decir que lo autorreportó el
  // paciente sería inventar el origen del interrogatorio. Ese caso sale como
  // «No capturado», igual que hace `subidoPor` con los archivos.
  const cuestionarioAutoreportado = !!cuestionario && !cuestionario.filledById;
  const capturista = cuestionario?.filledById
    ? await prisma.user
        .findFirst({
          where: { id: cuestionario.filledById, clinicId: user.clinicId },
          select: { firstName: true, lastName: true },
        })
        .catch(() => null)
    : null;
  const llenadoPor = cuestionarioAutoreportado
    ? "El paciente (portal)"
    : capturista
      ? `${capturista.firstName} ${capturista.lastName}`.trim()
      : null;

  // Quién subió cada archivo y quién es el profesional de cada carta, en UNA
  // consulta para todos (no N+1). Acotada por clínica como todo lo demás.
  const personasIds = Array.from(
    new Set(
      [
        ...archivos.map((f) => f.uploadedBy),
        ...consentimientos.map((c) => c.doctorId),
      ].filter((x): x is string => !!x),
    ),
  );
  const personas = personasIds.length
    ? await prisma.user.findMany({
        where: { id: { in: personasIds }, clinicId: user.clinicId },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const nombrePorId = new Map(personas.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

  // ── La bitácora, lanzada YA y recogida tras el render ───────────────────
  const lecturaP = logRead({
    clinicId: user.clinicId,
    userId: user.id,
    kind: "expediente_pdf",
    patientId: paciente.id,
    ...extractAuditMeta(req),
  });

  // ── Imágenes y firmas ──────────────────────────────────────────────────
  const membreteP = clinicLetterheadProps(paciente.clinic);
  // Un solo reloj para las dos fases: lo que gasten las imágenes se lo quitan
  // a las firmas, y al agotarse nadie baja nada más.
  const limite = Date.now() + PRESUPUESTO_TIEMPO_MS;
  const estudios = await armarEstudios(archivos, nombrePorId, incluirImagenes, limite);
  const { firmas: firmasPorConsentimiento, omitidas: firmasOmitidas } =
    await armarFirmas(consentimientos, limite);
  const membrete = await membreteP;

  // ── Props del documento ────────────────────────────────────────────────
  const answers = (cuestionario?.answers ?? null) as Record<string, unknown> | null;

  const notasDoc: ExpedienteNota[] = notas.map((n) => ({
    id: n.id,
    fecha: n.visitDate.toISOString(),
    doctor: n.doctor ? `Dr/a. ${n.doctor.firstName} ${n.doctor.lastName}`.trim() : null,
    doctorCedula: n.doctor?.cedulaProfesional ?? null,
    estado: estadoDeLaNota(n.specialtyData),
    firmadaEl: firmadaEl(n.specialtyData),
    subjetivo: n.subjective,
    objetivo: n.objective,
    analisis: n.assessment,
    plan: n.plan,
    diagnosticos:
      n.diagnoses_v2.length > 0
        ? n.diagnoses_v2.map((d) => ({ code: d.cie10.code, description: d.cie10.description }))
        : diagnosticosLegacy(n.specialtyData),
    procedimientos: procedimientos(n.specialtyData),
    signosVitales: signosVitales(n.vitals),
    exploracionFisica: leerExploracionFisica(n.specialtyData),
    pronostico: leerPronostico(n.specialtyData),
    adendas: adendas(n.specialtyData),
  }));

  const odontograma: ExpedienteHallazgoDental[] = hallazgos
    // `__note__` no es un hallazgo: es la nota por diente. Se imprime como
    // hallazgo "Nota del diente" para que el texto no se pierda.
    .map((h) => ({
      diente: h.toothNumber,
      cara: h.surface ? (SURFACE_NAMES[h.surface as keyof typeof SURFACE_NAMES]?.es ?? h.surface) : null,
      hallazgo:
        h.conditionId === "__note__"
          ? "Nota del diente"
          : (COND_BY_ID[h.conditionId]?.es ?? h.conditionId),
      notas: h.notes,
      actualizado: h.updatedAt.toISOString(),
    }));

  const planesDoc: ExpedientePlan[] = planes.map((p) => ({
    nombre: p.name,
    descripcion: p.description,
    estado: ESTADO_PLAN[p.status] ?? p.status,
    inicio: p.startDate ? p.startDate.toISOString() : null,
    fin: p.endDate ? p.endDate.toISOString() : null,
    doctor: p.doctor ? `Dr/a. ${p.doctor.firstName} ${p.doctor.lastName}`.trim() : null,
    sesionesTotales: p.totalSessions,
    sesiones: p.sessions.map((s) => ({
      numero: s.sessionNumber,
      completadaEl: s.completedAt ? s.completedAt.toISOString() : null,
      notas: s.notes,
    })),
  }));

  const recetasDoc: ExpedienteReceta[] = recetas.map((r) => ({
    folio: r.qrCode,
    emitidaEl: r.issuedAt.toISOString(),
    venceEl: r.expiresAt ? r.expiresAt.toISOString() : null,
    doctor: r.doctor ? `Dr/a. ${r.doctor.firstName} ${r.doctor.lastName}`.trim() : null,
    doctorCedula: r.doctor?.cedulaProfesional ?? null,
    diagnostico: r.diagnosis,
    indicaciones: r.indications,
    estado: r.status,
    anuladaEl: r.voidedAt ? r.voidedAt.toISOString() : null,
    motivoAnulacion: r.voidReason,
    medicamentos: r.items.map((it) => ({
      nombre: [it.cums?.descripcion ?? it.cumsKey, it.cums?.presentacion]
        .filter((x) => typeof x === "string" && x.trim().length > 0)
        .join(" · "),
      dosis: it.dosage,
      duracion: it.duration,
      cantidad: it.quantity,
      notas: it.notes,
    })),
  }));

  const nombrePaciente = `${paciente.firstName} ${paciente.lastName}`.trim();

  const consentimientosDoc: ExpedienteConsentimiento[] = consentimientos.map((c, i) => ({
    procedimiento: c.procedure,
    creadoEl: c.createdAt.toISOString(),
    firmadoEl: c.signedAt ? c.signedAt.toISOString() : null,
    revocadoEl: c.revokedAt ? c.revokedAt.toISOString() : null,
    motivoRevocacion: c.revokedReason,
    texto: c.content,
    // `buildSignatureBlocks` es el MISMO criterio que usa el PDF de la carta
    // suelta: quién firma (paciente o representante legal), el profesional y
    // los testigos, y qué hacer cuando no hay firma. Aquí se reusa para que el
    // expediente no invente un bloque de firmas distinto del de la carta.
    firmas: buildSignatureBlocks({
      patientName: nombrePaciente,
      signerName: c.signerName,
      signerRelation: c.signerRelation,
      // Sin nombre de profesional la línea sale con su rótulo y en blanco, que
      // es lo correcto: una carta sin estomatólogo asignado se ve incompleta
      // porque lo está.
      doctorName: c.doctorId ? (nombrePorId.get(c.doctorId) ?? "") : "",
      signedAt: c.signedAt,
      doctorSignedAt: c.doctorSignedAt,
      witness1Name: c.witness1Name,
      witness1SignedAt: c.witness1SignedAt,
      witness2Name: c.witness2Name,
      witness2SignedAt: c.witness2SignedAt,
      patientSig: firmasPorConsentimiento[i]?.paciente ?? null,
      doctorSig: firmasPorConsentimiento[i]?.doctor ?? null,
      witness1Sig: firmasPorConsentimiento[i]?.testigo1 ?? null,
      witness2Sig: firmasPorConsentimiento[i]?.testigo2 ?? null,
    }).map((b) => ({
      rol: b.role,
      nombre: b.name,
      firmadoEl: b.signedAt,
      imagen: b.dataUrl,
    })),
    hashDelTexto: c.contentHash,
  }));

  const citasDoc: ExpedienteCita[] = citas.map((a) => ({
    fecha: a.startsAt.toISOString(),
    tipo: a.type,
    estado: ESTADO_CITA[a.status] ?? a.status,
    doctor: a.doctor ? `Dr/a. ${a.doctor.firstName} ${a.doctor.lastName}`.trim() : null,
    consultorio: a.resource?.name ?? a.room ?? null,
    notas: a.notes,
  }));

  const props: ExpedienteDocumentProps = {
    ...membrete,
    clinicTaxId: paciente.clinic?.taxId ?? null,
    clinicClues: paciente.clinic?.clues ?? null,
    timeZone: tz,
    paciente: {
      nombre: nombrePaciente,
      folio: paciente.patientNumber,
      curp: paciente.curp,
      dob: paciente.dob ? paciente.dob.toISOString() : null,
      genero: GENERO[paciente.gender] ?? paciente.gender,
      tipoSangre: paciente.bloodType,
      telefono: paciente.phone,
      correo: paciente.email,
      direccion: paciente.address,
      contactoEmergencia:
        paciente.emergencyContactName || paciente.emergencyContactPhone
          ? {
              nombre: paciente.emergencyContactName,
              telefono: paciente.emergencyContactPhone,
              parentesco: paciente.emergencyContactRelation,
            }
          : null,
      alergias: paciente.allergies ?? [],
      padecimientos: paciente.chronicConditions ?? [],
      medicamentos: paciente.currentMedications ?? [],
      antecedentesFamiliares: paciente.familyHistory,
      antecedentesNoPatologicos: paciente.personalNonPathologicalHistory,
      doctorDeCabecera: paciente.primaryDoctor
        ? `Dr/a. ${paciente.primaryDoctor.firstName} ${paciente.primaryDoctor.lastName}`.trim()
        : null,
      altaEnLaClinica: paciente.createdAt.toISOString(),
    },
    emisor: {
      nombre: `${user.firstName} ${user.lastName}`.trim() || "Usuario de la clínica",
      cedula: user.cedulaProfesional ?? null,
      rol: user.role ?? null,
    },
    generadoEl: new Date().toISOString(),
    periodo: periodoCubierto(notasDoc, citasDoc, estudios, recetasDoc, consentimientosDoc),
    antecedentes: cuestionario
      ? {
          llenadoEl: cuestionario.filledAt.toISOString(),
          llenadoPor,
          padecimientos: respuestas(answers, PADECIMIENTOS),
          alergias: respuestas(answers, ALERGIAS),
          habitos: respuestas(answers, HABITOS),
          medicamentos: paciente.currentMedications ?? [],
          avisosDeRiesgo: (cuestionario.riskFlags ?? []).map((f) => RISK_FLAG_LABELS[f] ?? f),
          notas: cuestionario.notes,
          heredoFamiliares: leerHeredoFamiliares(answers),
          aparatosSistemas: leerAparatosSistemas(answers),
        }
      : null,
    notas: notasDoc,
    notasPrivadasOmitidas: Math.max(0, notasTotales - notas.length),
    odontograma,
    odontogramaActualizado: ultimaFecha(hallazgos.map((h) => h.updatedAt)),
    planes: planesDoc,
    recetas: recetasDoc,
    consentimientos: consentimientosDoc,
    firmasOmitidas,
    estudios,
    citas: citasDoc,
    administrativo: incluirAdministrativo
      ? {
          facturas: facturas.map((f) => ({
            folio: f.invoiceNumber,
            fecha: f.createdAt.toISOString(),
            concepto: conceptoDeFactura(f.items) ?? f.notes ?? null,
            total: importe(f.total),
            pagado: importe(f.paid),
            estado: ESTADO_FACTURA[f.status] ?? f.status,
          })),
          presupuestos: presupuestos.map((q) => ({
            folio: q.folio,
            fecha: q.createdAt.toISOString(),
            concepto: q.title,
            total: importe(Number(q.total)),
            estado: ESTADO_PRESUPUESTO[q.status] ?? q.status,
          })),
        }
      : null,
    opciones: { incluirImagenes, incluirAdministrativo },
  };

  const buffer = await renderToBuffer(<ExpedienteDocument {...props} />);
  await lecturaP;

  const fechaSlug = new Date().toISOString().slice(0, 10);
  const nombreArchivo = `expediente-${slug(paciente.patientNumber)}-${fechaSlug}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
      // Un expediente completo NO se cachea en ningún sitio, ni en el navegador.
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Traducciones de enum → lo que lee una persona
// ═══════════════════════════════════════════════════════════════════════════

const GENERO: Record<string, string> = { M: "Masculino", F: "Femenino", OTHER: "Otro" };

const ESTADO_PLAN: Record<string, string> = {
  ACTIVE: "Activo",
  COMPLETED: "Completado",
  ABANDONED: "Abandonado",
  PAUSED: "En pausa",
};

const ESTADO_CITA: Record<string, string> = {
  PENDING: "Pendiente",
  SCHEDULED: "Agendada",
  CONFIRMED: "Confirmada",
  CHECKED_IN: "Llegó",
  IN_CHAIR: "En sillón",
  IN_PROGRESS: "En consulta",
  COMPLETED: "Atendida",
  CHECKED_OUT: "Salió",
  CANCELLED: "Cancelada",
  NO_SHOW: "No asistió",
};

const ESTADO_FACTURA: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING: "Pendiente",
  PARTIAL: "Pago parcial",
  PAID: "Pagada",
  OVERDUE: "Vencida",
  CANCELLED: "Cancelada",
};

/**
 * Importe con SUS CENTAVOS.
 *
 * `formatCurrency` de `@/lib/utils` redondea a pesos enteros
 * (`maximumFractionDigits: 0`), que está bien para una tarjeta del panel y muy
 * mal para un documento foliado y fechado que se entrega: una factura de
 * $1,234.56 no se imprime «$1,235» en un papel que alguien puede cotejar.
 */
function importe(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

const ESTADO_PRESUPUESTO: Record<string, string> = {
  DRAFT: "Borrador",
  PRESENTED: "Presentado",
  ACCEPTED: "Aceptado",
  REJECTED: "Rechazado",
  EXPIRED: "Vencido",
};

const CATEGORIA_ARCHIVO: Record<string, string> = {
  XRAY_PERIAPICAL: "Radiografía periapical",
  XRAY_PANORAMIC: "Radiografía panorámica",
  XRAY_BITEWING: "Radiografía de aleta de mordida",
  XRAY_OCCLUSAL: "Radiografía oclusal",
  XRAY_CBCT: "Tomografía (CBCT)",
  PHOTO_FRONTAL: "Fotografía frontal",
  PHOTO_LATERAL: "Fotografía lateral",
  PHOTO_OCCLUSAL_UPPER: "Fotografía oclusal superior",
  PHOTO_OCCLUSAL_LOWER: "Fotografía oclusal inferior",
  PHOTO_INTRAORAL: "Fotografía intraoral",
  PHOTO_PATIENT: "Fotografía del paciente",
  ORTHO_PHOTO_T0: "Set fotográfico inicial (T0)",
  ORTHO_PHOTO_T1: "Set fotográfico intermedio (T1)",
  ORTHO_PHOTO_T2: "Set fotográfico final (T2)",
  ORTHO_PHOTO_CONTROL: "Fotografía de control",
  CEPH_ANALYSIS_PDF: "Análisis cefalométrico (PDF)",
  SCAN_STL: "Escaneo 3D (STL)",
  OTHER: "Otro archivo del expediente",
};

// ═══════════════════════════════════════════════════════════════════════════
// Lectores de los JSON de la nota
// ═══════════════════════════════════════════════════════════════════════════

function comoObjeto(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function estadoDeLaNota(specialtyData: unknown): "DRAFT" | "SIGNED" {
  return comoObjeto(specialtyData).status === "SIGNED" ? "SIGNED" : "DRAFT";
}

function firmadaEl(specialtyData: unknown): string | null {
  const v = comoObjeto(specialtyData).signedAt;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function procedimientos(specialtyData: unknown): string[] {
  const raw = comoObjeto(specialtyData).procedures;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => (typeof p === "string" ? p : comoObjeto(p).name))
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
}

/** Diagnósticos del snapshot viejo, cuando la tabla normalizada está vacía. */
function diagnosticosLegacy(specialtyData: unknown): Array<{ code: string; description: string }> {
  const raw = comoObjeto(specialtyData).icd10;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => comoObjeto(d))
    .filter((d) => typeof d.code === "string")
    .map((d) => ({ code: String(d.code), description: typeof d.label === "string" ? d.label : "" }));
}

/**
 * Las adendas de una nota, saneadas y en orden cronológico.
 *
 * Mismo criterio que `readNoteAddenda` del PDF de nota suelta: sin texto o sin
 * fecha no se imprime el bloque —anunciar una corrección que no dice nada es
 * peor que no anunciarla—, y una fecha ilegible no reordena nada.
 */
function adendas(specialtyData: unknown): ExpedienteAdenda[] {
  const raw = comoObjeto(specialtyData).addenda;
  if (!Array.isArray(raw)) return [];
  const limpias = raw
    .map((a) => comoObjeto(a))
    .filter((a) => typeof a.text === "string" && a.text.trim().length > 0)
    .filter((a) => typeof a.createdAt === "string" && (a.createdAt as string).length > 0)
    .map((a) => ({
      texto: String(a.text).trim(),
      autor:
        typeof a.authorName === "string" && a.authorName.trim().length > 0
          ? a.authorName.trim()
          : null,
      fecha: String(a.createdAt),
    }));
  return limpias
    .map((row, i) => ({ row, i, t: new Date(row.fecha).getTime() }))
    .sort((a, b) => {
      if (isNaN(a.t) || isNaN(b.t)) return a.i - b.i;
      return a.t - b.t || a.i - b.i;
    })
    .map((x) => x.row);
}

const ETIQUETAS_VITALES: Array<[string, string, string]> = [
  // [clave en el JSON, etiqueta, sufijo]
  ["bloodPressure", "Tensión arterial", ""],
  ["heartRate", "Frecuencia cardiaca", ""],
  ["respiratoryRate", "Frecuencia respiratoria", ""],
  ["temperature", "Temperatura", ""],
  ["oxygenSat", "Saturación de O₂", ""],
  ["weight", "Peso", " kg"],
  ["height", "Estatura", " cm"],
  ["bmi", "IMC", ""],
  ["notes", "Notas", ""],
];

function signosVitales(vitals: unknown): Array<{ etiqueta: string; valor: string }> {
  const v = comoObjeto(vitals);
  const out: Array<{ etiqueta: string; valor: string }> = [];
  for (const [clave, etiqueta, sufijo] of ETIQUETAS_VITALES) {
    const dato = v[clave];
    if (dato === null || dato === undefined) continue;
    const texto = String(dato).trim();
    if (!texto) continue;
    out.push({ etiqueta, valor: `${texto}${sufijo}` });
  }
  return out;
}

/**
 * Las respuestas del cuestionario, con su detalle cuando lo hay.
 *
 * 🔴 SON TRES ESTADOS, NO DOS. El formulario guarda `true`, `false` y AUSENTE
 * (arranca en `{}` y solo escribe la pregunta que alguien toca), así que un
 * cuestionario contestado a medias tiene la mayoría de las preguntas sin
 * valor. Tratar el ausente como `false` haría que el expediente afirmara
 * «VIH / SIDA: No» o «Embarazo o lactancia: No» de trece preguntas que nadie
 * hizo — y eso, en un documento que se entrega y que puede acabar en una
 * reclamación, dice «se le preguntó y lo negó». Por eso el ausente se delega a
 * `siNo`, que escribe «No capturado».
 */
function respuestas(
  answers: Record<string, unknown> | null,
  defs: Array<{ key: string; label: string }>,
): Array<{ etiqueta: string; valor: string }> {
  if (!answers) return [];
  return defs.map((d) => {
    const bruto = answers[d.key];
    const detalle = answers[`${d.key}Detail`];
    const texto = typeof detalle === "string" ? detalle.trim() : "";
    const valor = siNo(bruto);
    return {
      etiqueta: d.label,
      // El detalle solo acompaña a un «Sí»: un detalle colgando de un «No» o
      // de un «No capturado» es basura que quedó de una respuesta anterior.
      valor: bruto === true && texto ? `Sí — ${texto}` : valor,
    };
  });
}

/** El primer concepto de una factura, para que la fila diga de qué era. */
function conceptoDeFactura(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const primero = comoObjeto(items[0]);
  const nombre =
    (typeof primero.name === "string" && primero.name) ||
    (typeof primero.description === "string" && primero.description) ||
    (typeof primero.concept === "string" && primero.concept) ||
    null;
  if (!nombre) return null;
  return items.length > 1 ? `${nombre} (+${items.length - 1} más)` : nombre;
}

function ultimaFecha(fechas: Date[]): string | null {
  if (fechas.length === 0) return null;
  const max = fechas.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
  return max.toISOString();
}

/** Del dato más viejo al más nuevo: es lo que el documento declara cubrir. */
function periodoCubierto(
  notas: ExpedienteNota[],
  citas: ExpedienteCita[],
  estudios: ExpedienteEstudio[],
  recetas: ExpedienteReceta[],
  consentimientos: ExpedienteConsentimiento[],
): { desde: string | null; hasta: string | null } {
  // Entran TODAS las colecciones fechadas. Con solo tres, un paciente que solo
  // tiene una receta y un consentimiento imprimía «Periodo que cubre: No
  // capturado» aunque el documento sí cubriera un periodo.
  const todas = [
    ...notas.map((n) => n.fecha),
    ...citas.map((c) => c.fecha),
    ...estudios.map((e) => e.fecha),
    ...recetas.map((r) => r.emitidaEl),
    ...consentimientos.map((c) => c.creadoEl),
  ]
    .map((iso) => new Date(iso).getTime())
    .filter((t) => !isNaN(t));
  if (todas.length === 0) return { desde: null, hasta: null };
  return {
    desde: new Date(Math.min(...todas)).toISOString(),
    hasta: new Date(Math.max(...todas)).toISOString(),
  };
}

function slug(s: string): string {
  return (s || "sin-folio")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "sin-folio";
}

// ═══════════════════════════════════════════════════════════════════════════
// Imágenes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ¿@react-pdf sabe pintar esto?
 *
 * SOLO PNG y JPEG. Con un webp, un gif o un svg `<Image>` NO lanza: escribe
 * "Base64 image invalid format" y deja el hueco EN BLANCO — que es justo lo que
 * un expediente no puede hacer. Se descarta aquí y el PDF explica por qué.
 */
function esImagenIncrustable(mimeType: string | null | undefined): boolean {
  const m = (mimeType ?? "").toLowerCase();
  return m === "image/png" || m === "image/jpeg" || m === "image/jpg";
}

type FilaArchivo = {
  name: string;
  url: string;
  category: string;
  mimeType: string | null;
  size: number | null;
  toothNumber: number | null;
  notes: string | null;
  takenAt: Date | null;
  createdAt: Date;
  uploadedBy: string | null;
};

/**
 * Los estudios del expediente, con su imagen SOLO si se pidió y cabe.
 *
 * Con la casilla apagada (el default) no se firma ni se descarga NADA: la
 * sección sale como tabla y el PDF pesa lo que pesa el texto.
 */
async function armarEstudios(
  archivos: FilaArchivo[],
  nombrePorId: Map<string, string>,
  incluirImagenes: boolean,
  /** Instante (epoch ms) a partir del cual ya no se baja nada. */
  limite: number,
): Promise<ExpedienteEstudio[]> {
  const base: ExpedienteEstudio[] = archivos.map((f) => ({
    nombre: f.name,
    tipo: CATEGORIA_ARCHIVO[f.category] ?? f.category,
    fecha: (f.takenAt ?? f.createdAt).toISOString(),
    subidoPor: f.uploadedBy ? (nombrePorId.get(f.uploadedBy) ?? null) : null,
    diente: f.toothNumber,
    notas: f.notes,
    bytes: f.size,
    imagen: null,
    motivoSinImagen: null,
  }));

  if (!incluirImagenes || base.length === 0) return base;

  // Qué se intenta bajar, y por qué se descarta lo demás. Los topes se aplican
  // en el orden del expediente (cronológico), así que si se corta, se corta por
  // el final y el papel lo dice estudio por estudio.
  let presupuesto = MAX_BYTES_IMAGENES;
  let cupo = MAX_IMAGENES;
  const aBajar: Array<{ i: number; url: string }> = [];

  for (let i = 0; i < archivos.length; i++) {
    const f = archivos[i];
    if (!esImagenIncrustable(f.mimeType)) {
      base[i].motivoSinImagen = `formato no imprimible (${f.mimeType ?? "sin tipo"})`;
      continue;
    }
    if ((f.size ?? 0) > MAX_BYTES_POR_IMAGEN) {
      base[i].motivoSinImagen = `el archivo pesa ${pesoLegible(f.size ?? 0)} y el tope por imagen es ${pesoLegible(MAX_BYTES_POR_IMAGEN)}`;
      continue;
    }
    if (cupo <= 0) {
      base[i].motivoSinImagen = `se alcanzó el tope de ${MAX_IMAGENES} imágenes por documento`;
      continue;
    }
    if ((f.size ?? 0) > presupuesto) {
      base[i].motivoSinImagen = `se alcanzó el tope de ${pesoLegible(MAX_BYTES_IMAGENES)} de imágenes por documento`;
      continue;
    }
    cupo--;
    presupuesto -= f.size ?? 0;
    aBajar.push({ i, url: f.url });
  }

  if (aBajar.length === 0) return base;

  // Una sola llamada a createSignedUrls para todas (3 round-trips, no N×).
  const firmadas = await signMaybeUrls(
    aBajar.map((x) => x.url),
    TTL_DESCARGA,
  ).catch(() => [] as string[]);

  // Presupuesto REAL de bytes: se descuenta lo que de verdad pesó cada archivo
  // descargado, no lo que decía la fila. `PatientFile.size` es nullable, y
  // reservar 0 por un tamaño desconocido dejaba el tope global sin efecto para
  // esas filas — con 40 de ellas se podían incrustar cientos de MB.
  let bytesGastados = 0;

  for (let inicio = 0; inicio < aBajar.length; inicio += TANDA_IMAGENES) {
    const tanda = aBajar.slice(inicio, inicio + TANDA_IMAGENES);

    if (Date.now() >= limite) {
      for (const x of tanda) base[x.i].motivoSinImagen = "se agotó el tiempo de descarga";
      continue;
    }
    if (bytesGastados >= MAX_BYTES_IMAGENES) {
      for (const x of tanda) {
        base[x.i].motivoSinImagen = `se alcanzó el tope de ${pesoLegible(MAX_BYTES_IMAGENES)} de imágenes por documento`;
      }
      continue;
    }

    const bajadas = await Promise.all(
      tanda.map((x, j) => descargarImagen(firmadas[inicio + j] ?? "", MAX_BYTES_POR_IMAGEN, TIMEOUT_IMAGEN_MS)),
    );
    bajadas.forEach((dataUrl, j) => {
      const idx = tanda[j].i;
      if (!dataUrl) {
        base[idx].motivoSinImagen = "no se pudo descargar el archivo";
        return;
      }
      // Un data URL en base64 pesa ~4/3 de los bytes originales; lo que ocupa
      // en el PDF es esto, así que esto es lo que se contabiliza.
      if (bytesGastados + dataUrl.length > MAX_BYTES_IMAGENES) {
        base[idx].motivoSinImagen = `se alcanzó el tope de ${pesoLegible(MAX_BYTES_IMAGENES)} de imágenes por documento`;
        return;
      }
      bytesGastados += dataUrl.length;
      base[idx].imagen = dataUrl;
    });
  }

  return base;
}

/**
 * Bytes de una URL firmada → data URL, o null.
 *
 * Falla SIEMPRE en suave: el expediente tiene que salir aunque el bucket esté
 * caído, devuelva 404 o guarde algo que @react-pdf no sabe pintar. El formato
 * se comprueba mirando los BYTES (`imageAspect`), no el content-type: un bucket
 * que sirva `application/octet-stream` sigue valiendo, y un HTML de error que
 * se anuncie como imagen ya no cuela.
 */
async function descargarImagen(
  url: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const declarado = Number(res.headers.get("content-length"));
    if (Number.isFinite(declarado) && declarado > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    if (imageAspect(buf) == null) return null; // no es PNG ni JPEG de verdad
    const mime = buf[0] === 0x89 ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

type FirmasDeCarta = {
  paciente: string | null;
  doctor: string | null;
  testigo1: string | null;
  testigo2: string | null;
};

/**
 * Las imágenes de firma de cada consentimiento, ya en memoria.
 *
 * Van SIEMPRE (no dependen de la casilla de imágenes): una carta de
 * consentimiento sin su firma no acredita nada, y son PNG de unos pocos kB. Lo
 * que sí llevan es su propio tope, por si un expediente trae cuarenta cartas.
 * Sin imagen, `buildSignatureBlocks` deja la línea en blanco con el nombre
 * debajo — exactamente como la carta suelta.
 */
async function armarFirmas(
  consentimientos: Array<{
    signatureUrl: string | null;
    doctorSignatureUrl: string | null;
    witness1SignatureUrl: string | null;
    witness2SignatureUrl: string | null;
  }>,
  /** Instante (epoch ms) a partir del cual ya no se baja nada. */
  limite: number,
): Promise<{ firmas: FirmasDeCarta[]; omitidas: number }> {
  const vacio = (): FirmasDeCarta => ({ paciente: null, doctor: null, testigo1: null, testigo2: null });
  const salida = consentimientos.map(vacio);
  if (consentimientos.length === 0) return { firmas: salida, omitidas: 0 };

  const claves = ["paciente", "doctor", "testigo1", "testigo2"] as const;
  const todas: Array<{ i: number; clave: (typeof claves)[number]; url: string }> = [];
  consentimientos.forEach((c, i) => {
    const urls: Record<(typeof claves)[number], string | null> = {
      paciente: c.signatureUrl,
      doctor: c.doctorSignatureUrl,
      testigo1: c.witness1SignatureUrl,
      testigo2: c.witness2SignatureUrl,
    };
    for (const clave of claves) {
      const u = urls[clave];
      if (u) todas.push({ i, clave, url: u });
    }
  });
  // El tope se cuenta APARTE de aplicarse: una carta firmada que se imprime
  // con la línea en blanco y sin explicar por qué es la peor de las salidas
  // posibles, y es justo lo que las imágenes ya prometen no hacer. Lo que
  // sobra del tope se devuelve para que el documento lo diga.
  const pendientes = todas.slice(0, MAX_FIRMAS);
  let omitidas = todas.length - pendientes.length;
  if (pendientes.length === 0) return { firmas: salida, omitidas };

  const firmadas = await signMaybeUrls(
    pendientes.map((p) => p.url),
    TTL_DESCARGA,
    BUCKETS.PATIENT_FILES,
  ).catch(() => [] as string[]);

  for (let inicio = 0; inicio < pendientes.length; inicio += TANDA_IMAGENES) {
    const tanda = pendientes.slice(inicio, inicio + TANDA_IMAGENES);
    if (Date.now() >= limite) {
      omitidas += pendientes.length - inicio;
      break;
    }
    const bajadas = await Promise.all(
      tanda.map((_, j) =>
        descargarImagen(firmadas[inicio + j] ?? "", MAX_BYTES_POR_FIRMA, TIMEOUT_FIRMA_MS),
      ),
    );
    bajadas.forEach((dataUrl, j) => {
      if (dataUrl) salida[tanda[j].i][tanda[j].clave] = dataUrl;
      else omitidas += 1;
    });
  }

  return { firmas: salida, omitidas };
}
