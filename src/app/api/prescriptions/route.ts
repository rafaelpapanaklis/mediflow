import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import {
  expiresForCofeprisGroup,
  folioObligatorioActivo,
  hasLegalExpiryCap,
  mostRestrictiveCofeprisGroup,
  plazoLegalTexto,
  requiresCofeprisFolio,
} from "@/lib/clinical/cofepris";

export const dynamic = "force-dynamic";

function buildVerifyUrl(req: NextRequest, id: string) {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host  = req.headers.get("host") ?? "www.dalecontrol.com";
  return `${proto}://${host}/portal/prescription/${id}/verify`;
}

/** Fecha corta para los mensajes de error que ve el médico. */
function fechaHumana(d: Date): string {
  return d.toLocaleString("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  });
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // ISO-03: antes `hasPermission(ctx.role, "prescription.read")`, la capa por
  // rol que ignoraba permissionsOverride. Ahora el interruptor "Ver recetas"
  // del modal manda (mismos roles por default: SA/ADMIN/DOCTOR).
  const deniedPerm = denyIfMissingPermission(ctx, "prescription.view");
  if (deniedPerm) return deniedPerm;
  const patientId = req.nextUrl.searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });

  // Visibilidad por paciente: lee un solo paciente por id → 404 si no lo puede ver.
  const denied = await assertPatientVisible(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  // NOM-004 conservación / NOM-024 §7: las recetas ANULADAS (status=VOIDED) se
  // conservan y se MUESTRAN marcadas — nunca se ocultan. Devolvemos todas las del
  // paciente (status/voidedAt/voidReason llegan por ser campos escalares).
  const list = await prisma.prescription.findMany({
    where: { clinicId: ctx.clinicId, patientId },
    include: {
      doctor: { select: { id: true, firstName: true, lastName: true } },
      items:  { include: { cums: true } },
    },
    orderBy: { issuedAt: "desc" },
  });
  // Vigentes primero, luego anuladas; dentro de cada grupo se preserva issuedAt
  // desc (Array.sort es estable y el query ya viene ordenado).
  const ordered = [...list].sort(
    (a, b) => Number(a.status === "VOIDED") - Number(b.status === "VOIDED"),
  );
  return NextResponse.json(ordered);
}

interface PrescriptionItemBody {
  cumsKey?: string;
  dosage?: string;
  duration?: string;
  quantity?: string;
  notes?: string;
}

/**
 * POST /api/prescriptions — crea receta NOM-024 completa.
 *
 * Body: {
 *   patientId,                   // requerido
 *   medicalRecordId?,            // opcional — receta standalone si se omite
 *   items: [{ cumsKey, dosage, duration?, quantity?, notes? }],
 *   indications?, cofeprisFolio?, expiresAt? (sugerencia, nunca por encima del tope legal)
 * }
 *
 * `cofeprisGroup` se IGNORA si llega: el grupo real lo decide el servidor a
 * partir del catálogo CUMS, y con él el tope de vigencia y si hace falta folio.
 *
 * La receta puede emitirse standalone (sin consulta asociada) o
 * vinculada a un MedicalRecord existente (flujo "Iniciar consulta").
 *
 * Compat: `medications` (JSON legacy) se sigue guardando para datos históricos,
 * pero SIEMPRE armado desde `items`. Lo que mande el cliente en ese campo se
 * ignora: la verificación pública lo publica sin auth, así que era una segunda
 * puerta para decir en el QR algo distinto de lo recetado.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // ISO-03: "Crear/firmar recetas" del modal, con override incluido.
  const deniedPerm = denyIfMissingPermission(ctx, "prescription.create");
  if (deniedPerm) return deniedPerm;

  const body = await req.json();
  // OJO: `body.cofeprisGroup` NO se lee. El grupo sale del catálogo CUMS más
  // abajo; leerlo del cuerpo era el fallo de seguridad que este bloque tapa.
  const { medicalRecordId, patientId, items, indications, diagnosis, cofeprisFolio, expiresAt: expiresAtOverride } = body;
  // `body.medications` NO se lee. Era el último campo de medicamentos que
  // controlaba el cliente, y `GET /api/prescriptions/[id]/verify` —público, sin
  // auth, el que consumiría una farmacia— lo publica tal cual. Se podía recetar
  // paracetamol en `items` (grupo V, sin tope) y mandar fentanilo en
  // `medications`: la verificación pública decía fentanilo vigente hasta 2028.
  // Es el mismo agujero que tapa este bloque, por otra puerta. El snapshot
  // legacy se guarda igual, pero armado desde `items`, que es lo que ya pasaba
  // en el flujo real (el modal nunca ha mandado `medications`).

  // Evidencia opcional del chequeo IA de contraindicaciones. Se guarda tal cual
  // en Prescription.aiCheck (nunca se expone en la verificación pública — el
  // endpoint /verify no selecciona este campo). Cap de tamaño defensivo.
  const aiCheckRaw = body.aiCheck;
  let safeAiCheck: any = null;
  if (aiCheckRaw && typeof aiCheckRaw === "object") {
    try {
      if (JSON.stringify(aiCheckRaw).length <= 20000) safeAiCheck = aiCheckRaw;
    } catch {
      safeAiCheck = null;
    }
  }

  if (!patientId) {
    return NextResponse.json({ error: "patientId requerido" }, { status: 400 });
  }

  if (diagnosis !== undefined && diagnosis !== null && typeof diagnosis !== "string") {
    return NextResponse.json({ error: "diagnosis_invalid" }, { status: 400 });
  }

  // Tenant + visibilidad por paciente en un solo query (barrido Ola 3): el GET
  // de esta ruta ya asserta — recetar a un paciente restringido exige verlo.
  const visDenied = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (visDenied) return visDenied;

  // Items con FK a CUMS — preferido (NOM-024).
  const itemsArray: PrescriptionItemBody[] = Array.isArray(items) ? items : [];
  if (itemsArray.length === 0) {
    return NextResponse.json({
      error: "items_required",
      detail: "La receta requiere al menos un medicamento con cumsKey + dosage.",
    }, { status: 400 });
  }
  for (const it of itemsArray) {
    if (!it.cumsKey || typeof it.cumsKey !== "string") {
      return NextResponse.json({ error: "item_cumsKey_required" }, { status: 400 });
    }
    if (!it.dosage || typeof it.dosage !== "string" || it.dosage.trim().length === 0) {
      return NextResponse.json({ error: "item_dosage_required" }, { status: 400 });
    }
  }

  // Si la receta viene vinculada a una consulta, validar que pertenece a la
  // clínica del usuario y al mismo paciente. Si es standalone, omitir.
  if (medicalRecordId) {
    const record = await prisma.medicalRecord.findFirst({
      where: { id: medicalRecordId, clinicId: ctx.clinicId, patientId },
      select: { id: true },
    });
    if (!record) return NextResponse.json({ error: "Expediente no encontrado" }, { status: 404 });
  }

  // NOM-024: el médico debe tener cédula profesional registrada.
  const doctor = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { cedulaProfesional: true },
  });
  if (!doctor?.cedulaProfesional) {
    return NextResponse.json({
      error: "doctor_sin_cedula",
      detail: "El doctor debe tener cédula profesional registrada antes de emitir recetas. Configurar en /dashboard/team.",
    }, { status: 422 });
  }

  // Validar que todas las claves CUMS existan en el catálogo. Se pide también
  // `cofeprisGroup`: es el único dato de grupo en el que se puede confiar.
  const cumsKeys = itemsArray.map((it) => it.cumsKey!).filter(Boolean);
  const foundCums = await prisma.cumsItem.findMany({
    where: { clave: { in: cumsKeys } },
    select: { clave: true, cofeprisGroup: true },
  });
  const foundSet = new Set(foundCums.map((c) => c.clave));
  const missing = cumsKeys.filter((k) => !foundSet.has(k));
  if (missing.length > 0) {
    return NextResponse.json({ error: "cums_not_found", missing }, { status: 404 });
  }

  // ── NOM-024 · controlados: la regla legal la aplica el SERVIDOR ───────────
  // El `cofeprisGroup` del body es un dato del cliente y se DESCARTA. El grupo
  // real de la receta es el más restrictivo (I < II < … < VI) de sus
  // medicamentos según el catálogo CUMS, que nadie puede mandar por API. Sobre
  // ese grupo —y solo ese— se calcula el tope legal de vigencia.
  const grupoReal = mostRestrictiveCofeprisGroup(foundCums.map((c) => c.cofeprisGroup));

  const issuedAt = new Date();
  const topeLegal = expiresForCofeprisGroup(grupoReal, issuedAt);

  let expiresAt = topeLegal;
  if (expiresAtOverride !== undefined && expiresAtOverride !== null && expiresAtOverride !== "") {
    const pedida = new Date(expiresAtOverride);
    if (Number.isNaN(pedida.getTime())) {
      return NextResponse.json({
        error: "expiresAt_invalid",
        detail: "La fecha de vigencia no es una fecha válida.",
      }, { status: 400 });
    }
    if (pedida.getTime() <= issuedAt.getTime()) {
      return NextResponse.json({
        error: "expiresAt_in_the_past",
        detail: "La vigencia no puede ser anterior a la emisión de la receta.",
      }, { status: 400 });
    }
    // Tope duro solo para I, II y III. Para IV-VI y sin grupo se respeta lo que
    // pida el médico: los 180 días son un default prudente, no una obligación
    // legal, y apretarlos rompería las recetas comunes sin ganar nada.
    if (hasLegalExpiryCap(grupoReal) && pedida.getTime() > topeLegal.getTime()) {
      return NextResponse.json({
        error: "expiresAt_over_legal_cap",
        detail:
          `La receta incluye un medicamento controlado del grupo COFEPRIS ${grupoReal}, ` +
          `cuya vigencia legal es de ${plazoLegalTexto(grupoReal)}. ` +
          `El máximo para esta receta es el ${fechaHumana(topeLegal)}. ` +
          `Deja el campo Vigencia vacío para que se calcule solo.`,
        cofeprisGroup: grupoReal,
        maxExpiresAt: topeLegal.toISOString(),
      }, { status: 422 });
    }
    expiresAt = pedida;
  }

  // Folio del recetario oficial: obligatorio para grupos I y II. Detrás del
  // interruptor RECETAS_FOLIO_OBLIGATORIO (ver @/lib/clinical/cofepris) porque
  // bloquea a quien hoy receta clonazepam o codeína sin folio.
  const folio = typeof cofeprisFolio === "string" ? cofeprisFolio.trim() : "";
  if (folioObligatorioActivo() && requiresCofeprisFolio(grupoReal) && !folio) {
    return NextResponse.json({
      error: "cofeprisFolio_required",
      detail:
        `La receta incluye un medicamento controlado del grupo COFEPRIS ${grupoReal}. ` +
        `La ley exige el folio del recetario oficial para emitirla.`,
      cofeprisGroup: grupoReal,
    }, { status: 422 });
  }

  // Snapshot legacy de medicamentos, armado desde los items ya validados. Campos
  // explícitos y `null` en vez de `undefined`: esto va a una columna JSON, y
  // `undefined` no es un valor JSON (el typecheck lo canta).
  const medicationsSnapshot = itemsArray.map((it) => ({
    cumsKey: it.cumsKey!,
    dosage: it.dosage!,
    duration: it.duration ?? null,
    quantity: it.quantity ?? null,
    notes: it.notes ?? null,
  }));

  const qrCode = randomBytes(16).toString("hex");

  // Transacción atómica: receta + items.
  const created = await prisma.$transaction(async (tx) => {
    const rx = await tx.prescription.create({
      data: {
        medicalRecordId: medicalRecordId ?? null,
        patientId,
        doctorId: ctx.userId,
        clinicId: ctx.clinicId,
        medications: medicationsSnapshot, // snapshot legacy, SIEMPRE desde items
        indications: indications ?? null,
        diagnosis: (typeof diagnosis === "string" && diagnosis.trim()) ? diagnosis.trim().slice(0, 2000) : null,
        qrCode,
        verifyUrl: "",
        // El grupo que se guarda es el del catálogo, no el que mandó el cliente:
        // es el que acaba impreso en el PDF y en la página pública del QR.
        cofeprisGroup: grupoReal,
        cofeprisFolio: folio || null,
        issuedAt,
        expiresAt,
        aiCheck: safeAiCheck,
      },
    });
    await tx.prescriptionItem.createMany({
      data: itemsArray.map((it) => ({
        prescriptionId: rx.id,
        cumsKey: it.cumsKey!,
        dosage: it.dosage!.slice(0, 200),
        duration: it.duration?.slice(0, 100) ?? null,
        quantity: it.quantity?.slice(0, 50) ?? null,
        notes: it.notes ?? null,
      })),
    });
    return rx;
  });

  const verifyUrl = buildVerifyUrl(req, created.id);
  const updated = await prisma.prescription.update({
    where: { id: created.id },
    data: { verifyUrl },
    include: { items: { include: { cums: true } } },
  });

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "prescription",
    entityId: updated.id,
    action: "create",
    after: {
      patientId: updated.patientId,
      itemsCount: itemsArray.length,
      cofeprisGroup: updated.cofeprisGroup,
      expiresAt: updated.expiresAt,
    },
  });

  revalidatePath("/dashboard/clinical");
  return NextResponse.json(updated, { status: 201 });
}
