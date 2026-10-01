export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { prisma } from "@/lib/prisma";
import { labelParentesco } from "@/lib/consent/default-signer";
import { getPatientVisibility, clinicScopeFilter, sharedRecordScope, ownPrivateRecordsOnly } from "@/lib/branches";
import { getPatientCreditBalance } from "@/lib/patient-credit";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { stripPatientSecrets } from "@/lib/patient-secrets";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { logRead } from "@/lib/audit";
import { PatientDetailClient } from "./patient-detail-client";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { dateISOInTz, timeHHMMInTz, durationMinutes } from "@/lib/agenda/legacy-helpers";
import { fetchActiveDoctors, fetchResources } from "@/lib/agenda/server";
import { hasPermission } from "@/lib/auth/permissions";
import { canSeePediatrics, PEDIATRICS_MODULE_KEY } from "@/lib/pediatrics/permissions";
import { loadPediatricsData } from "@/lib/pediatrics/load-data";
import type { PediatricsTabData } from "@/components/patient-detail/pediatrics/PediatricsTab";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import type { ImplantFull } from "@/lib/types/implants";
import { PERIODONTICS_MODULE_KEY, ENDODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { loadOrthoData, type OrthoTabData } from "@/lib/orthodontics/load-data";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { accesoDeOrtodonciaEnLaFicha, vistaOrtoPorPermisos } from "@/lib/orthodontics/pestana-ficha";
import { COOKIE_VISTA_PREVIA_SIN_MODULO, moduloActivoALaVista, vistaPreviaSinModulo } from "@/lib/orthodontics/contratar";
import { pacienteTuvoCasoDeOrtodoncia } from "@/lib/orthodontics/tuvo-caso";
import { leerCasoPedido, type CasoDelPaciente } from "@/lib/orthodontics/casos-del-paciente";
import { cargarCasosDelPaciente } from "@/lib/orthodontics/casos-del-paciente-db";
import {
  loadOrthoRedesignData,
  type OrthoRedesignBundle,
} from "@/lib/orthodontics/redesign/loader";
import type { OrthoRedesignViewModel } from "@/components/specialties/orthodontics/redesign/types";
import { loadPerioData, type PerioTabData } from "@/lib/periodontics/load-data";
import { loadEndoSoapPrefill } from "@/lib/endodontics/load-soap-prefill";
import { loadEndoToothSummaries } from "@/lib/helpers/loadEndoToothData";
import type { SoapPrefill, EndoToothSummary } from "@/lib/types/endodontics";
import { getActiveClinicModuleKeys } from "@/lib/clinical-shared/get-active-clinic-modules";
import {
  getPatientActivityCounts,
  type PatientActivityCounts,
} from "@/lib/clinical-shared/get-patient-activity-counts";
import { questionnaireFreshness } from "@/lib/health-questionnaire";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { CONSENT_DTO_SELECT, toConsentDTO } from "@/lib/consent/types";
import { getEffectiveReminderSettings } from "@/lib/reminders/config";
import { resolveReminderOutcome } from "@/lib/reminders/promise";
import { parseNotifPrefs } from "@/lib/patient-notifications/types";

export default async function PatientDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { caso?: string | string[] };
}) {
  const user = await getCurrentUser();
  const { t } = await getServerT();
  const tz = user.clinic.timezone;

  // CONSENTIMIENTOS — permiso granular "consents.view". Sin él la ficha no
  // muestra la pestaña (ni en QuickNav ni en la tab bar móvil) y las cartas ni
  // siquiera salen del server: se manda [] y los endpoints revalidan con 403.
  const permsUser = { role: user.role, permissionsOverride: user.permissionsOverride ?? [] };
  const canViewConsents = hasPermission(permsUser, "consents.view");

  // MULTI-CLÍNICA · FASE 2 — sedes cuyo expediente puede LEER esta sesión.
  // Con el flag apagado devuelve [user.clinicId] sin tocar la BD, así que la
  // query de abajo queda exactamente como estaba.
  const visibility = await getPatientVisibility(user.clinicId);

  const [patient, doctors, consentRows] = await Promise.all([
    prisma.patient.findFirst({
      // MULTI-CLÍNICA: clinicScopeFilter permite el expediente de una sede vinculada
      // (con el flag apagado = user.clinicId pelado). Visibilidad por paciente: esta
      // página arma el expediente en el server, así que el gate de GET
      // /api/patients/[id] NO la cubre — sin este AND, la URL directa renderizaba el
      // expediente de un restringido. Si no lo puede ver, no existe → notFound() (404).
      where: {
        id: params.id,
        clinicId: clinicScopeFilter(visibility.clinicIds),
        AND: patientVisibilityAnd({ userId: user.id, role: user.role, clinicId: user.clinicId }),
      },
      include: {
        primaryDoctor: { select: { id: true, firstName: true, lastName: true, color: true } },
        // Citas y facturas SIEMPRE de la sede activa: aunque el paciente venga
        // prestado de otra sucursal, cada sede agenda y cobra por separado.
        // No-op para un paciente propio.
        appointments: {
          where: { clinicId: user.clinicId },
          orderBy: { startsAt: "desc" },
          take: 30,
          include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
        },
        // El expediente SÍ se comparte: es el contenido clínico de la Fase 2.
        // Scope explícito = defensa en profundidad (no-op para paciente propio)
        // + excluye notas privadas de otro doctor cuando la sede es ajena.
        // Notas privadas (P1-N2): `sharedRecordScope` sólo excluye las privadas
        // de OTRA sede; con una clínica sola es `{ clinicId }` pelado y esta
        // página entregaba el SOAP privado de cualquier doctor a quien abriera
        // la ficha, recepción incluida. Mismo criterio que /api/records: la
        // privada la ve sólo su autor. En AND porque `sharedRecordScope` puede
        // ocupar `OR` cuando hay sedes vinculadas.
        records: {
          where: {
            AND: [
              sharedRecordScope(user.clinicId, visibility.clinicIds),
              ownPrivateRecordsOnly(user.id),
            ],
          },
          orderBy: { visitDate: "desc" },
          take: 20,
          include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
        },
        invoices: { where: { clinicId: user.clinicId }, include: { payments: true, patient: { select: { rfcPaciente: true, razonSocialPac: true, regimenFiscalPac: true, cpPaciente: true } } } },
        // FIX: fetch treatment plans for the Tratamientos tab
        // FASE 2: scopeado a la sede activa — un plan de tratamiento lleva
        // costo y sesiones que se cobran en la sede donde se pactó.
        treatments: {
          where: { clinicId: user.clinicId },
          orderBy: { createdAt: "desc" },
          include: {
            doctor:   { select: { id: true, firstName: true, lastName: true, color: true } },
            sessions: { orderBy: { sessionNumber: "asc" } },
          },
        },
      },
    }),
    prisma.user.findMany({
      where:  { clinicId: user.clinicId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    }),
    // Consentimientos del paciente en ESTA sede. Los borrados lógicos quedan
    // fuera; los firmados nunca se borran, así que siempre están. Sin permiso
    // ni se consulta. .catch(()=>[]): si sql/consent-informado-v2.sql todavía
    // no corrió en esta base, la ficha entera NO se cae — solo falta el tab.
    canViewConsents
      ? prisma.consentForm.findMany({
          where:   { patientId: params.id, clinicId: user.clinicId, deletedAt: null },
          orderBy: { createdAt: "desc" },
          select:  CONSENT_DTO_SELECT,
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  if (!patient) notFound();

  const portalUrl = patient.portalToken
    ? `${process.env.NEXT_PUBLIC_APP_URL}/portal/${patient.portalToken}`
    : null;

  // ── ClinicModule gating ──────────────────────────────────────────────────
  // Una sola lectura del marketplace: derivamos el set de specialty keys
  // activas (o todas, si la clínica está en trial vigente) y reusamos esa
  // lista para Pediatría / Periodoncia / prefill endo. Reemplaza tres
  // llamadas previas a canAccessModule() — mismo contrato, una query.
  const [clinicModuleKeys, activityCounts, latestQuestionnaire, creditBalance, fotosCount, portalAccountLink, portalNotifPrefsRow] = await Promise.all([
    getActiveClinicModuleKeys(user.clinicId),
    getPatientActivityCounts({ clinicId: user.clinicId, patientId: patient.id }),
    // Cuestionario de salud vigente (anamnesis WS1-T2). .catch(()=>null) lo
    // hace resiliente: si la tabla aún no está migrada, NO tumba la página
    // (mismo espíritu que la resiliencia de clinic-layout).
    prisma.healthQuestionnaire.findFirst({
      where: { clinicId: user.clinicId, patientId: patient.id },
      orderBy: { filledAt: "desc" },
      select: { riskFlags: true, filledAt: true },
    }).catch(() => null),
    // Saldo a favor (crédito) del paciente. El helper ya es resiliente si la
    // tabla patient_credits aún no está migrada (devuelve 0).
    getPatientCreditBalance(user.clinicId, patient.id),
    // Fotos clínicas (ficha v3) — count para el badge del menú. .catch(()=>0):
    // si el enum `general` aún no corrió en la DB (sql/fotos-clinicas-general.sql),
    // la ficha NO se cae; solo el tab Fotos falla al listar.
    prisma.clinicalPhoto.count({
      where: { clinicId: user.clinicId, patientId: patient.id, module: "general", deletedAt: null },
    }).catch(() => 0),
    // Estado del portal con CUENTA REAL (PatientAccount) para la ficha: sin
    // cuenta / invitada pendiente / activa. Se deriva del link de la sesión y
    // del passwordHash (null = invitada). .catch(()=>null): si la tabla/relación
    // no está disponible, la ficha degrada a "sin cuenta" sin caerse.
    prisma.patientAccountLink.findFirst({
      where: { patientId: patient.id, clinicId: user.clinicId },
      select: { account: { select: { passwordHash: true } } },
      orderBy: { createdAt: "asc" },
    }).catch(() => null),
    // Override de recordatorios del paciente (PatientAccount.notifPrefs), para
    // que la tarjeta "Reglas automáticas" diga el momento y el canal que de
    // verdad le van a llegar. Va en su PROPIA query, no pegada al select de
    // arriba, a propósito: notifPrefs es una columna reciente y si a una BD
    // todavía le falta el SQL, seleccionarla ahí tumbaría también el estado del
    // portal (quedaría "sin cuenta"). Aquí el .catch() solo cuesta el override
    // — exactamente la misma degradación best-effort que hace el cron.
    prisma.patientAccountLink.findFirst({
      where: { patientId: patient.id, clinicId: user.clinicId },
      select: { account: { select: { notifPrefs: true } } },
      orderBy: { createdAt: "asc" },
    }).catch(() => null),
  ]);

  // REDISEÑO DE PACIENTES — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`).
  // A propósito, y no uno propio: Rafael está probando «el diseño nuevo» como
  // una sola cosa, y dos interruptores serían dos cosas que recordar apagar.
  // Falla cerrado — sin la tabla, sin fila o con error devuelve false y la
  // pantalla se pinta exactamente como hoy. El clinicId sale de la sesión.
  //
  // FUERA del Promise.all de arriba, y no por gusto: ese lote ya iba en siete
  // consultas y la regla de la casa es «menos de 7 por Promise.all, que el
  // pooler se satura». Además, en frío este interruptor son DOS viajes (el
  // to_regclass y la fila), así que el lote habría llegado a nueve. No depende
  // de nada de arriba, y su respuesta vive 60 s en memoria por clínica: la
  // inmensa mayoría de las cargas no llegan ni a tocar la base.
  // Es el ÚNICO interruptor de la ficha: lo miran tanto el rediseño de la
  // cabecera, el Resumen, la Historia clínica, el Cuestionario y Nueva consulta
  // (WS1-T4) como los apartados clínicos y de documentos —Historial, Recetas,
  // Consentimientos, Referencias, Modelos 3D— y el encaje del odontograma
  // (WS1-T5). Los dos trabajos lo leían por su cuenta; al juntarlos, una sola
  // lectura y un solo `rediseno` hacia el cliente.
  //
  // NOM-004 §5.12 / NOM-024 §6.3.5 — bitácora de LECTURA del expediente: quién
  // abrió la ficha y cuándo. Solo ids (nunca nombre ni dato clínico), con dedupe
  // en memoria para que un re-render no escriba otra fila. NO se espera aquí: se
  // lanza DESPUÉS del lote de siete de arriba (no lo engorda) y se recoge tras
  // `menuDosNivelesEncendido`, solapada con él: ningún viaje en serie de más. clinicId/userId SIEMPRE de sesión.
  const lecturaP = (() => {
    const h = headers();
    const xff = h.get("x-forwarded-for");
    const ip =
      (xff ? xff.split(",")[0]!.trim() : null) ??
      h.get("x-real-ip") ??
      h.get("cf-connecting-ip") ??
      undefined;
    return logRead({
      clinicId:  user.clinicId,
      userId:    user.id,
      kind:      "ficha",
      patientId: patient.id,
      ipAddress: ip || undefined,
      userAgent: h.get("user-agent") || undefined,
    });
  })();
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  await lecturaP; // nunca tira y tiene tope de 1,5 s (ver logRead)

  // CITAS EDITABLES DESDE EL EXPEDIENTE (ws1-t3) — solo con la bandera. La
  // pestaña Citas abre «Editar cita», la MISMA ventana de la agenda, y esa
  // ventana necesita lo que en /dashboard/agenda baja el servidor: doctores,
  // unidades, zona horaria y los mismos dos permisos. Se cargan con las mismas
  // funciones que usa la agenda. Con la bandera apagada no hay ni consulta ni
  // prop: la página queda como estaba.
  const agendaCitas = rediseno
    ? await Promise.all([
        fetchActiveDoctors(user.clinicId, user.clinic.category),
        fetchResources(user.clinicId),
      ]).then(([agendaDoctors, agendaResources]) => ({
        timezone: tz,
        doctors: agendaDoctors,
        resources: agendaResources,
        permisos: {
          canEdit: hasPermission(permsUser, "agenda.edit"),
          canCancel: hasPermission(permsUser, "agenda.delete"),
        },
      }))
    : null;
  // Estado del portal con cuenta real: "none" sin cuenta ligada; "invited" ligada
  // pero sin contraseña (invitación pendiente); "active" ya con contraseña.
  const linkedPortalAccount = portalAccountLink?.account ?? null;
  const portalAccountStatus: "none" | "invited" | "active" = !linkedPortalAccount
    ? "none"
    : linkedPortalAccount.passwordHash === null
      ? "invited"
      : "active";

  // RECORDATORIOS — qué va a pasar DE VERDAD con este paciente.
  // La tarjeta "Reglas automáticas" del rail prometía a todo el mundo un
  // "recordatorio por WhatsApp 24h antes (si la clínica tiene WhatsApp
  // activado)": el paréntesis miraba la CONEXIÓN de WhatsApp y no el
  // interruptor de los recordatorios, así que en una clínica con los
  // recordatorios apagados el aviso prometía un mensaje que no sale nunca —
  // y la hora estaba escrita a mano aunque el momento sea configurable.
  // getEffectiveReminderSettings es la MISMA función que lee el cron (ahí vive
  // la trampa de que waReminderActive en NULL significa ENCENDIDO), y
  // resolveReminderOutcome repite sus cortes en orden. Al cliente viaja SOLO el
  // veredicto derivado: ni la fila Clinic, ni la plantilla del mensaje.
  const reminderOutcome = resolveReminderOutcome({
    settings: getEffectiveReminderSettings(user.clinic),
    waConnected: Boolean(user.clinic.waConnected),
    patientHasPhone: Boolean(patient.phone),
    patientHasEmail: Boolean(patient.email),
    patientPrefs: parseNotifPrefs(portalNotifPrefsRow?.account?.notifPrefs ?? null),
  });

  // FACTURACIÓN — permiso granular "billing.view" (el mismo que gatea Caja y el
  // link del sidebar). Sin él la ficha NO muestra la pestaña Facturación ni el
  // card "Estado de cuenta", y las facturas ni siquiera salen del server: se
  // manda [] en vez de patient.invoices, así que el payload del cliente no lleva
  // folios, montos ni UUIDs. Los endpoints de lectura lo revalidan con 403.
  const canViewBilling = hasPermission(
    { role: user.role, permissionsOverride: user.permissionsOverride ?? [] },
    "billing.view",
  );

  // H14: qué botones de COBRO ve la sesión en la ficha (cabecera, rail y facturas).
  // Se resuelve aquí y no en el cliente: son permisos por persona. Cada acción los
  // vuelve a exigir en su ruta (billing.charge, rol administrador para timbrar,
  // whatsapp.send para enviar).
  const permisosCobro = {
    cobrar: hasPermission({ role: user.role, permissionsOverride: user.permissionsOverride ?? [] }, "billing.charge"),
    timbrar: user.role === "ADMIN" || user.role === "SUPER_ADMIN",
    enviar: hasPermission({ role: user.role, permissionsOverride: user.permissionsOverride ?? [] }, "whatsapp.send"),
    // ws1-t4: «Editar» abre el editor de la factura (PATCH exige billing.edit).
    editar: hasPermission({ role: user.role, permissionsOverride: user.permissionsOverride ?? [] }, "billing.edit"),
  };

  // Consentimientos: los tres permisos del módulo + el del canal de envío. Se
  // resuelven aquí (no en el cliente) porque el SUPER_ADMIN los enciende y
  // apaga persona a persona desde el modal de equipo; cada endpoint los
  // revalida con 403.
  const canCreateConsents  = hasPermission(permsUser, "consents.create");
  const canRevokeConsents  = hasPermission(permsUser, "consents.revoke");
  const canSendWhatsApp    = hasPermission(permsUser, "whatsapp.send");

  // INICIAR una conversación de WhatsApp desde la tarjeta del rail. El permiso
  // es "inbox.send" —el mismo con el que el Inbox deja responder— y no
  // "whatsapp.send": el mensaje se manda desde el Inbox, cae en su hilo y queda
  // atribuido a quien lo envió, así que quien puede escribirle a un paciente ahí
  // es exactamente quien puede escribirle desde aquí. /api/inbox/compose lo
  // revalida con 403.
  const canStartConversation = hasPermission(permsUser, "inbox.send");

  // RADIOGRAFÍAS y ARCHIVOS (EQ-07): "Ver radiografías" decide si la pestaña
  // existe; subir, analizar con IA y borrar tienen cada uno su interruptor. Se
  // resuelven aquí, del modal (rol + override), y GET/POST /api/xrays,
  // /analyze y DELETE los revalidan con 403. Recepción sube y organiza los
  // archivos por default; interpretar la placa con IA y borrarla son clínicos.
  const canViewXrays    = hasPermission(permsUser, "xrays.view");
  const canUploadXrays  = hasPermission(permsUser, "xrays.upload");
  const canAnalyzeXrays = hasPermission(permsUser, "xrays.analyze");
  const canEditRecords  = hasPermission(permsUser, "medicalRecord.edit");
  // RECETAS (ISO-03): la pestaña salía para todos aunque GET /api/prescriptions
  // ya le diera 403 a recepción y solo-lectura. Misma key que el endpoint.
  const canViewPrescriptions = hasPermission(permsUser, "prescription.view");
  // PLANES DE TRATAMIENTO (EQ-07): crear/editar/borrar y registrar sesiones.
  const canEditTreatments = hasPermission(permsUser, "treatments.edit");

  // Mismo criterio para el EXPEDIENTE (P1-N2): sin "Ver expediente clínico" la
  // ficha se sigue abriendo (contacto, citas, facturación) pero el SOAP no sale
  // del server. Se manda [] en vez de negar la página entera: quien no tiene el
  // permiso sí tiene trabajo que hacer en la ficha. /api/records y /api/clinical
  // ya exigían esta key; la ficha SSR era la puerta que se quedó abierta.
  const canViewRecords = hasPermission(
    { role: user.role, permissionsOverride: user.permissionsOverride ?? [] },
    "medicalRecord.view",
  );

  const questionnaireRiskFlags = latestQuestionnaire?.riskFlags ?? [];
  const questionnaireFilledAt  = latestQuestionnaire?.filledAt ? latestQuestionnaire.filledAt.toISOString() : null;
  const questionnaireStatus    = questionnaireFreshness(latestQuestionnaire?.filledAt ?? null, Date.now());
  const isDental = user.clinic.category === "DENTAL";

  // Pediatría — predicado puro existente: categoría DENTAL|MEDICINE +
  // módulo activo + DOB + edad < cutoff (default 18, LGDNNA). Reportamos
  // por separado al cliente si la clínica tiene el módulo activo
  // (`pediatricsModuleActive`) para que el tab pueda mostrarse en estado
  // disabled cuando el admin lo contrató pero el paciente actual es adulto.
  const pediatricsModuleActive = clinicModuleKeys.includes(PEDIATRICS_MODULE_KEY);
  let pediatricsData: PediatricsTabData | null = null;
  if (
    canSeePediatrics({
      clinicCategory: user.clinic.category,
      clinicModules: clinicModuleKeys,
      patientDob: patient.dob,
    })
  ) {
    pediatricsData = await loadPediatricsData({
      clinicId: user.clinicId,
      patientId: patient.id,
    }, { userId: user.id, role: user.role, clinicId: user.clinicId });
  }

  // Periodoncia — solo DENTAL con el módulo activo. Sin gate por edad
  // (aplica a adultos y adolescentes con dentición permanente).
  let perioData: PerioTabData | null = null;
  if (isDental && clinicModuleKeys.includes(PERIODONTICS_MODULE_KEY)) {
    perioData = await loadPerioData({
      clinicId: user.clinicId,
      patientId: patient.id,
    }, { userId: user.id, role: user.role, clinicId: user.clinicId });
  }

  // Endodoncia — solo DENTAL con el módulo activo. Sin gate por edad.
  // Cargamos: (1) summaries de los 32 dientes para el odontograma miniatura
  // del tab, y (2) prefill SOAP para hidratar el editor cuando el paciente
  // tiene tratamiento o diagnóstico endodóntico activo. El cliente decide
  // qué mostrar — `endoSummaries === null` significa módulo inactivo y el
  // tab no se renderiza.
  let endoSummaries: EndoToothSummary[] | null = null;
  let endoSoapPrefill: SoapPrefill | null = null;
  if (isDental && clinicModuleKeys.includes(ENDODONTICS_MODULE_KEY)) {
    [endoSummaries, endoSoapPrefill] = await Promise.all([
      loadEndoToothSummaries({ clinicId: user.clinicId, patientId: patient.id }),
      loadEndoSoapPrefill({ clinicId: user.clinicId, patientId: patient.id }),
    ]);
  }

  // Implantes — solo DENTAL con el módulo activo. Sin gate por edad. La
  // tabla `implants` no tiene helper extraído todavía (el módulo lo
  // carga inline en /dashboard/specialties/implants/[patientId]/page.tsx);
  // replicamos los mismos includes para que ImplantsTab reciba la shape
  // ImplantFull que espera. null cuando módulo inactivo.
  let implants: ImplantFull[] | null = null;
  if (isDental && clinicModuleKeys.includes(IMPLANTS_MODULE_KEY)) {
    implants = (await prisma.implant.findMany({
      where: { patientId: patient.id, clinicId: user.clinicId },
      include: {
        surgicalRecord:  true,
        healingPhase:    true,
        secondStage:     true,
        prostheticPhase: true,
        complications:   { orderBy: { detectedAt: "desc" } },
        followUps:       { orderBy: { scheduledAt: "asc" } },
        consents:        { orderBy: { createdAt: "desc" } },
        passport:        true,
      },
      orderBy: { placedAt: "desc" },
    })) as unknown as ImplantFull[];
  }

  // Ortodoncia — solo DENTAL con el módulo REAL activo (ws1-t3, Ola 1):
  // hasActiveOrthodonticsModule, NO clinicModuleKeys.includes(...), que abre
  // TODAS las especialidades durante el trial de cualquier clínica dental
  // (ver src/lib/orthodontics/access.ts). Sin gate por edad. El helper
  // loadOrthoData devuelve null cuando el paciente no existe o está
  // soft-deleted (caso ya descartado arriba via notFound), por eso el null
  // aquí solo refleja "módulo inactivo" para el cliente.
  let orthoData: OrthoTabData | null = null;
  let orthoRedesignVM: OrthoRedesignViewModel | null = null;
  let orthoRedesignBundle: OrthoRedesignBundle | null = null;
  // ws1-t8: los casos vivos del paciente, para «Casos de este paciente» (solo se enseña con más de uno).
  let orthoCasos: CasoDelPaciente[] = [];
  // Decisión 3 del gerente: sin el módulo (venció, o nunca lo pagó) el paciente
  // que YA tiene o tuvo un caso conserva la LECTURA de su expediente (NOM-004:
  // no se oculta); crear o cobrar sigue bloqueado por el servidor. Solo se
  // pregunta por el caso cuando falta el módulo: con módulo, cero consultas más.
  // La vista previa «sin módulo» (solo fuera de producción) solo puede QUITAR
  // el acceso a la vista, igual que en el guardia del módulo.
  const orthoModuloActivo = isDental && moduloActivoALaVista(
    await hasActiveOrthodonticsModule(user.clinicId),
    vistaPreviaSinModulo({ nodeEnv: process.env.NODE_ENV, cookie: cookies().get(COOKIE_VISTA_PREVIA_SIN_MODULO)?.value }),
  );
  // X2 / MAPA 19: además del contrato, dos llaves de la PERSONA — la del
  // módulo (sin ella no hay pestaña) y la del expediente (sin ella solo la
  // cara administrativa, y lo clínico ni se carga). Ver vistaOrtoPorPermisos.
  const orthoLlaveModulo = hasPermission(permsUser, "specialties.orthodontics");
  const orthoAcceso = isDental && orthoLlaveModulo
    ? accesoDeOrtodonciaEnLaFicha({
        moduloActivo: orthoModuloActivo,
        tuvoCaso: orthoModuloActivo ? false : await pacienteTuvoCasoDeOrtodoncia(user.clinicId, patient.id),
      })
    : "oculto";
  const orthoSoloLectura = orthoAcceso === "solo-lectura";
  const orthoVista = vistaOrtoPorPermisos({
    acceso: orthoAcceso,
    llaveModulo: orthoLlaveModulo,
    verExpediente: hasPermission(permsUser, "medicalRecord.view"),
  });
  const orthoSoloAdministrativo = orthoVista === "administrativa";
  if (orthoVista === "clinica") {
    // ws1-t6: la lista de casos solo depende del paciente y la clínica: se pide junto con el cargador (medido en
    // panel.108: la ficha tardaba por idas a la base en fila, no por una consulta lenta). Si el cargador no
    // devuelve nada, esa lista no se usa.
    const pCasos = cargarCasosDelPaciente(user.clinicId, patient.id);
    pCasos.catch(() => {});
    const redesign = await loadOrthoRedesignData({
      clinicId: user.clinicId,
      patientId: patient.id,
      // ws1-t8: con más de un caso, `?caso=` elige cuál se ve (sin él, el activo).
      planId: leerCasoPedido(searchParams?.caso),
    }, { userId: user.id, role: user.role, clinicId: user.clinicId });
    if (redesign) {
      orthoData = redesign.legacy;
      orthoRedesignVM = redesign.viewModel;
      orthoRedesignBundle = redesign.bundle;
      orthoCasos = await pCasos;
    }
  }

  // H24 (QA ws1-t9): «Nuevo consentimiento» defaulteaba el profesional al
  // usuario CONECTADO (casi nunca el que firma) y el representante legal
  // salía en blanco aunque el caso de ortodoncia ya tuviera tutora
  // registrada (A11, "Alta del caso"). `treatingDoctorId` ya viaja en
  // `orthoData.plan`; el nombre/parentesco del tutor pide una consulta
  // aparte — una sola fila por `id`, tolerante a que no exista.
  // En la cara administrativa (sin expediente) el caso no se carga, pero el
  // consentimiento que prepara recepción sigue queriendo al doctor tratante y
  // al tutor: solo esas dos columnas del último plan, con filtro de clínica.
  let orthoPlanAdministrativo: { treatingDoctorId: string | null; responsibleGuardianId: string | null } | null = null;
  if (orthoSoloAdministrativo) {
    orthoPlanAdministrativo = await prisma.orthodonticTreatmentPlan
      .findFirst({
        where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { treatingDoctorId: true, responsibleGuardianId: true },
      })
      .catch(() => null);
  }
  const orthoTreatingDoctorId = orthoData?.plan?.treatingDoctorId ?? orthoPlanAdministrativo?.treatingDoctorId ?? null;
  let orthoResponsibleGuardian: { nombre: string; relacion: string } | null = null;
  const responsibleGuardianId = orthoData?.plan?.responsibleGuardianId ?? orthoPlanAdministrativo?.responsibleGuardianId ?? null;
  if (responsibleGuardianId) {
    const guardian = await prisma.guardian
      // X1: con filtro de clínica — la del paciente, que puede ser otra sede
      // visible del grupo (el Guardian puede ser el de un hermano,
      // decisión 5, así que no se filtra por paciente).
      .findFirst({
        where: { id: responsibleGuardianId, clinicId: patient.clinicId, deletedAt: null },
        select: { fullName: true, parentesco: true },
      })
      .catch(() => null);
    if (guardian) {
      orthoResponsibleGuardian = {
        nombre: guardian.fullName,
        relacion: labelParentesco(guardian.parentesco),
      };
    }
  }

  // Nota: totales financieros (totalPaid/Balance/Plan) se derivan client-side
  // desde el state local `invoices` (ver patient-detail-client.tsx) para que
  // el card "Finanzas" y el sidebar "Estado de cuenta" se mantengan en sync
  // ante mutaciones (cobrar/cancelar/editar/reembolsar) sin depender de un
  // round-trip al server component.

  // Serialize + override legacy strings derivados de startsAt/endsAt en clinic tz.
  const serializedAppts = patient.appointments.map(a => ({
    ...a,
    date:         dateISOInTz(a.startsAt, tz),
    startTime:    timeHHMMInTz(a.startsAt, tz),
    endTime:      timeHHMMInTz(a.endsAt, tz),
    durationMins: durationMinutes(a.startsAt, a.endsAt),
    startsAt:     a.startsAt.toISOString(),
    endsAt:       a.endsAt.toISOString(),
    createdAt:    a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
    updatedAt:    a.updatedAt instanceof Date ? a.updatedAt.toISOString() : String(a.updatedAt),
  }));

  // P1-N1: `patient` es la fila completa y cruza al cliente dentro del payload
  // RSC. `portalUrl` ya se armó arriba con el token, así que aquí el token
  // sobra: se va. (El link legacy del portal SÍ sigue llegando al navegador,
  // como prop `portalUrl` — es una función deliberada de la ficha, el botón
  // "copiar liga de solo lectura". Lo que se corta aquí es que el token viaje
  // además dentro del objeto paciente, donde nadie lo pide y de donde se cuela
  // a cada respuesta de la API.)
  //
  // Y el strip es SHALLOW: copia `{...patient}`, así que se lleva también las
  // relaciones del include. Sin vaciarlas aquí, `records` e `invoices` cruzaban
  // ENTEROS en el flight data aunque los props de abajo mandaran `[]`: una
  // recepcionista sin "Ver expediente clínico" recibía igual los 20 SOAP, y sin
  // "Ver facturación" los folios y montos. Los props gatean lo que se PINTA;
  // esto gatea lo que se MANDA, que es lo que importa.
  const patientForClient = {
    ...stripPatientSecrets(patient),
    records:  canViewRecords ? patient.records  : [],
    invoices: canViewBilling ? patient.invoices : [],
  };

  const serializedRecords = (canViewRecords ? patient.records : []).map(r => ({
    ...r,
    visitDate: r.visitDate instanceof Date ? r.visitDate.toISOString() : String(r.visitDate),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  }));

  const serializedTreatments = patient.treatments.map(t => ({
    ...t,
    startDate:        t.startDate instanceof Date ? t.startDate.toISOString() : String(t.startDate),
    endDate:          t.endDate instanceof Date ? t.endDate.toISOString() : (t.endDate ?? null),
    nextExpectedDate: t.nextExpectedDate instanceof Date ? t.nextExpectedDate.toISOString() : (t.nextExpectedDate ?? null),
    lastFollowUpSent: t.lastFollowUpSent instanceof Date ? t.lastFollowUpSent.toISOString() : (t.lastFollowUpSent ?? null),
    createdAt:        t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
    updatedAt:        t.updatedAt instanceof Date ? t.updatedAt.toISOString() : String(t.updatedAt),
    sessions: t.sessions.map(s => ({
      ...s,
      completedAt: s.completedAt instanceof Date ? s.completedAt.toISOString() : (s.completedAt ?? null),
      createdAt:   s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    })),
  }));

  // Ficha v3: la cabecera es ÚNICA — HeroCard (dentro del cliente) absorbe
  // las alertas clínicas que antes duplicaba PatientContextPanel aquí.
  return (
    <div>
      <ErrorBoundary fallbackTitle={t("patients.page.loadError")}>
        <PatientDetailClient
          key={user.clinicId}
          originClinicName={
            patient.clinicId === user.clinicId
              ? null
              : visibility.otherClinicNames[patient.clinicId] ?? null
          }
          patient={patientForClient as any}
          records={serializedRecords as any}
          appointments={serializedAppts as any}
          invoices={canViewBilling ? (patient.invoices as any) : []}
          treatments={serializedTreatments as any}
          doctors={doctors}
          currentUser={{
            id:                 user.id,
            firstName:          user.firstName,
            lastName:           user.lastName,
            cedulaProfesional:  user.cedulaProfesional ?? null,
            // El picker de visibilidad y el badge "restringida" son solo de admin.
            role:               user.role,
          }}
          specialty={user.clinic.specialty}
          // Solo decide dónde cae una consulta recién iniciada (spa/salón
          // conservan el editor SOAP) — ver consult-landing.ts.
          clinicCategory={user.clinic.category}
          // Permiso granular (no el rol): el SUPER_ADMIN puede dárselo o
          // quitárselo a cualquier miembro desde el modal de equipo. Controla el
          // ítem "Eliminar paciente" del menú; el endpoint lo revalida con 403.
          canDeletePatient={hasPermission(
            { role: user.role, permissionsOverride: user.permissionsOverride ?? [] },
            "patients.delete",
          )}
          // Permiso granular "Editar pacientes" (P1-3): controla el botón
          // Editar del hero; PUT/PATCH de /api/patients lo revalidan con 403.
          canEditPatient={hasPermission(
            { role: user.role, permissionsOverride: user.permissionsOverride ?? [] },
            "patients.edit",
          )}
          // Permiso granular "medicalRecord.export" (WS1-T4): controla el ítem
          // "Descargar expediente completo" del menú y el diálogo de las dos
          // casillas. Por default solo SUPER_ADMIN y ADMIN; se concede a quien
          // haga falta desde Equipo → Permisos. GET
          // /api/patients/[id]/expediente-pdf lo revalida con 403.
          canExportRecord={hasPermission(permsUser, "medicalRecord.export")}
          canViewBilling={canViewBilling}
          permisosCobro={permisosCobro}
          consents={consentRows.map((c) => toConsentDTO(c))}
          canViewConsents={canViewConsents}
          canCreateConsents={canCreateConsents}
          canRevokeConsents={canRevokeConsents}
          canSendWhatsApp={canSendWhatsApp}
          canStartConversation={canStartConversation}
          canViewXrays={canViewXrays}
          canUploadXrays={canUploadXrays}
          canAnalyzeXrays={canAnalyzeXrays}
          canEditRecords={canEditRecords}
          canViewPrescriptions={canViewPrescriptions}
          canViewRecords={canViewRecords}
          canEditTreatments={canEditTreatments}
          facturApiEnabled={Boolean((user.clinic as any).facturApiEnabled)}
          // Solo el modo fiscal (no la fila de Clinic): con qué impuestos nace
          // una factura nueva desde la ficha — igual que en Caja.
          clinicTaxMode={(user.clinic as any).cfdiTaxMode ?? "exempt"}
          reminderOutcome={reminderOutcome}
          portalUrl={portalUrl}
          portalAccountStatus={portalAccountStatus}
          pediatricsData={pediatricsData}
          pediatricsModuleActive={pediatricsModuleActive}
          perioData={perioData}
          endoSummaries={endoSummaries}
          endoSoapPrefill={endoSoapPrefill}
          implants={implants}
          orthoData={orthoData}
          orthoSoloLectura={orthoSoloLectura}
          orthoSoloAdministrativo={orthoSoloAdministrativo}
          orthoRedesignVM={orthoRedesignVM}
          orthoRedesignBundle={orthoRedesignBundle}
          orthoCasos={orthoCasos}
          orthoTreatingDoctorId={orthoTreatingDoctorId}
          orthoResponsibleGuardian={orthoResponsibleGuardian}
          activityCounts={activityCounts}
          questionnaireStatus={questionnaireStatus}
          questionnaireFilledAt={questionnaireFilledAt}
          questionnaireRiskFlags={questionnaireRiskFlags}
          creditBalance={creditBalance}
          fotosCount={fotosCount}
          rediseno={rediseno}
          {...(agendaCitas ? { agendaCitas } : {})}
        />
      </ErrorBoundary>
    </div>
  );
}
