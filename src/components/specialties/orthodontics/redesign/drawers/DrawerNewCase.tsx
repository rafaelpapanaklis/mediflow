"use client";
// DrawerNewCase — Ola 1 (ws1-t6), «Alta del caso»: el asistente de alta
// DENTRO de la ficha nueva (reemplaza el puente a la vista antigua S1).
//
// 29-sep-2026 (ws1-t10): ya NO es un cajón pegado a la derecha, es una ventana
// centrada (pantalla completa en el teléfono) con secciones: Paciente y
// responsable · Diagnóstico · Datos del caso · Plan de pago · Doctor. Y el cobro
// se arma AQUÍ, al abrir el caso: «Precio total» pide enganche, número de pagos
// y primer pago; «Pago por control» pide el precio de la colocación. Al pulsar
// «Abrir caso» el padre crea el caso y enseguida su factura (`crearPlanDelCaso`).
// Las reglas viven en `src/lib/orthodontics/cobro/plan-al-abrir.ts` (con tests).
// El nombre del archivo y de los `Drawer*` se queda: lo importan varias pantallas.
//
// Dos escenarios, según si el paciente ya tiene diagnóstico:
//   - Sin diagnóstico: captura diagnóstico + (plan de tratamiento O paciente
//     en observación, A12) — un caso en observación no lleva plan todavía.
//   - Con diagnóstico (sin plan): solo captura el plan de tratamiento, con
//     doctor tratante (A5) y responsable del pago (A11).
//
// Las opciones de doctores/tutores/referentes se piden en caliente a
// getCaseIntakeOptions (server action de solo lectura) — mismo patrón que
// DiagnosisWizard/TreatmentPlanWizard llamando acciones directo desde un
// componente cliente.
//
// 28-sep-2026 (ws1-t3, H18 de la QA en vivo). Tres arreglos, con sus reglas en
// `src/lib/orthodontics/alta-caso-formulario.ts` (puro, con tests):
//   (a) el teléfono del responsable dice que es obligatorio y por qué, y junto
//       al botón sale lo que falta cuando está gris;
//   (b) «Quién lo refirió» deja agregar un referente ahí mismo;
//   (c) el costo nace VACÍO: antes traía 45000 escrito en el código.

import { useEffect, useId, useRef, useState } from "react";
import { DateField } from "@/components/ui/date-field";
import { hoyISO, hoyMasAniosISO } from "@/lib/orthodontics/fechas-de-formulario";
import { ClipboardList, Info, Loader2, Plus, Receipt, Stethoscope, UserCog, UserRound, Wallet, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { getCaseIntakeOptions, buscarTutoresDeLaClinica, type TutorDeLaClinica } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import { createDoctorContact } from "@/app/actions/clinical-shared/referrals";
import { isFailure as referenteFallo } from "@/lib/clinical-shared/result";
import {
  ORTHO_BILLING_MODE_DEFAULT,
  ORTHO_BILLING_MODE_LABELS,
  normalizarOrthoBillingMode,
  type OrthoBillingMode,
} from "@/lib/orthodontics/billing-mode";
import {
  MENSAJE_FALTA_DOCTOR,
  motivoFaltaDoctor,
  textoDeLaPropuesta,
  type MotivoDeLaPropuesta,
} from "@/lib/orthodontics/doctores-tratantes";
import {
  ETIQUETAS_MODO_RESPONSABLE,
  MOTIVO_TELEFONO_TUTOR,
  errorReferenteNuevo,
  errorTelefonoTutor,
  faltantesDelAlta,
  fraseDeFaltantes,
  leerCostoTotal,
  costoDelAlta,
  pistaDelModoDelCaso,
  referenteParaGuardar,
  referenteYaRegistrado,
  textosDelCosto,
  type ModoResponsable,
} from "@/lib/orthodontics/alta-caso-formulario";
import {
  faltantesDelPlanDePago,
  notaDelCobroAlAbrir,
  pagosPropuestos,
  pesos,
  planDePagoParaEnviar,
  vistaPreviaDelPlan,
  type EstadoDelPlan,
  type PlanDePagoAlAbrir,
} from "@/lib/orthodontics/cobro/plan-al-abrir";
import { useCajon } from "../atoms/useCajon";
import { usePresupuestoDelAlta } from "./usePresupuestoDelAlta";
import { EJEMPLO_DE_RETENCION } from "@/lib/orthodontics/retencion-ejemplo";
import { costoAProponer } from "@/lib/orthodontics/precios-por-tecnica";
import { nombrePropioAGuardar, tecnicasDeSiempre, type TecnicaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica";
import orto from "../orto.module.css";
import alta from "../alta-caso.module.css";

const ANGLE_OPTIONS = [
  { v: "CLASS_I", l: "Clase I" },
  { v: "CLASS_II_DIV_1", l: "Clase II div. 1" },
  { v: "CLASS_II_DIV_2", l: "Clase II div. 2" },
  { v: "CLASS_III", l: "Clase III" },
  { v: "ASYMMETRIC", l: "Asimétrica" },
] as const;

const DENTAL_PHASE_OPTIONS = [
  { v: "DECIDUOUS", l: "Dentición temporal" },
  { v: "MIXED_EARLY", l: "Mixta temprana" },
  { v: "MIXED_LATE", l: "Mixta tardía" },
  { v: "PERMANENT", l: "Permanente" },
] as const;

const MODO_DE_COBRO_OPTIONS = (["PRECIO_TOTAL", "PAGO_POR_CONTROL"] as const).map((v) => ({
  v,
  l: ORTHO_BILLING_MODE_LABELS[v],
}));

const ANCHORAGE_OPTIONS = [
  { v: "MAXIMUM", l: "Máximo" },
  { v: "MODERATE", l: "Moderado" },
  { v: "MINIMUM", l: "Mínimo" },
  { v: "COMPOUND", l: "Compuesto" },
] as const;

const OBJECTIVE_OPTIONS = [
  { v: "AESTHETIC_ONLY", l: "Solo estético" },
  { v: "FUNCTIONAL_ONLY", l: "Solo funcional" },
  { v: "AESTHETIC_AND_FUNCTIONAL", l: "Estético y funcional" },
] as const;

const GUARDIAN_RELATION_OPTIONS = [
  { v: "madre", l: "Madre" },
  { v: "padre", l: "Padre" },
  { v: "tutor_legal", l: "Tutor legal" },
  { v: "abuelo", l: "Abuelo" },
  { v: "abuela", l: "Abuela" },
  { v: "tio", l: "Tío" },
  { v: "tia", l: "Tía" },
  { v: "hermano", l: "Hermano" },
  { v: "hermana", l: "Hermana" },
  { v: "otro", l: "Otro" },
] as const;

export interface DrawerNewCaseDiagnosisPayload {
  angleClassRight: string;
  angleClassLeft: string;
  overbiteMm: number;
  overbitePercentage: number;
  overjetMm: number;
  crowdingUpperMm: number | null;
  crowdingLowerMm: number | null;
  crossbite: boolean;
  crossbiteDetails: string | null;
  openBite: boolean;
  openBiteDetails: string | null;
  dentalPhase: string;
  tmjPainPresent: boolean;
  tmjClickingPresent: boolean;
  clinicalSummary: string;
  referredByDoctorId: string | null;
  inObservation: boolean;
  nextObservationDate: string | null;
}

export interface DrawerNewCasePlanPayload {
  /** Tipo base (enum OrthoTechnique): de él dependen consentimientos, alineadores y expediente. */
  technique: string;
  /** Nombre propio de la técnica de la clínica, solo si difiere del de su tipo base (ws1-t10). */
  techniqueLabel: string | null;
  estimatedDurationMonths: number;
  installedAt: string | null;
  /**
   * Precio del caso al abrirlo. ws1-t10: con «Precio total» la factura del
   * tratamiento se crea con ESTE precio en el mismo alta (`planDePago`); si se
   * elige «después» o no hay permiso de cobro, la factura la abre Cobro luego
   * ("Abrir plan de pago"). Cuando exista `orthodonticTreatmentPlan.invoiceId`,
   * el número que cuenta es `invoice.total`, no este campo.
   */
  totalCostMxn: number;
  anchorageType: string;
  extractionsRequired: boolean;
  iprRequired: boolean;
  tadsRequired: boolean;
  treatmentObjectives: string;
  retentionPlanText: string;
  treatingDoctorId: string | null;
  responsibleGuardianId: string | null;
  newResponsibleGuardian: { fullName: string; phone: string; parentesco: string } | null;
  /** Fila 32 (ws1-t4 ronda 6): el modo de cobro de ESTE caso; propuesto el de la clínica. */
  billingMode: OrthoBillingMode;
}

/** Lo que el popup entrega al confirmar. `planDePago` = null: el caso se abre SIN factura (después, sin permiso, observación). */
export interface DrawerNewCaseSubmit {
  diagnosis: DrawerNewCaseDiagnosisPayload | null;
  plan: DrawerNewCasePlanPayload | null;
  planDePago?: PlanDePagoAlAbrir | null;
}

export interface DrawerNewCaseProps {
  patientId: string;
  patientFullName: string;
  /** Si ya hay diagnóstico, este drawer solo pide el plan de tratamiento. */
  existingDiagnosisId: string | null;
  onClose: () => void;
  onConfirm: (payload: DrawerNewCaseSubmit) => Promise<void> | void;
}

export function DrawerNewCase(props: DrawerNewCaseProps) {
  const cajonRef = useCajon<HTMLDivElement>(props.onClose);
  const needsDiagnosis = !props.existingDiagnosisId;

  const [loadingOptions, setLoadingOptions] = useState(true);
  const [doctors, setDoctors] = useState<Array<{ id: string; fullName: string }>>([]);
  const [guardians, setGuardians] = useState<
    Array<{ id: string; fullName: string; parentesco: string; phone: string }>
  >([]);
  const [referringDoctors, setReferringDoctors] = useState<
    Array<{ id: string; fullName: string; clinicName: string | null }>
  >([]);
  // A5/A11 — igual que en DrawerCaseSettings: si el SQL aún no está pegado,
  // se sabe ANTES de elegir doctor/responsable, no después de guardar.
  const [columnsExist, setColumnsExist] = useState({ treatingDoctorId: true, responsibleGuardianId: true });
  const [billingMode, setBillingMode] = useState<OrthoBillingMode>(ORTHO_BILLING_MODE_DEFAULT);
  /** Cómo cobra la clínica: la propuesta para el modo de este caso (fila 32). */
  const [modoDeLaClinica, setModoDeLaClinica] = useState<OrthoBillingMode>(ORTHO_BILLING_MODE_DEFAULT);
  // ws1-t10 — el plan de pago se arma aquí. `puedeCobrar` llega con las opciones; sin él la sección no se pide.
  const [puedeCobrar, setPuedeCobrar] = useState(false);
  const [despues, setDespues] = useState(false);
  const [precioColocacion, setPrecioColocacion] = useState("");
  const [enganche, setEnganche] = useState("");
  const [numPagos, setNumPagos] = useState(() => String(pagosPropuestos(18)));
  /** Mientras nadie edite «Número de pagos», sigue a la duración estimada. */
  const [pagosTocados, setPagosTocados] = useState(false);
  const [primerPago, setPrimerPago] = useState(() => hoyISO());
  const [treatingDoctorId, setTreatingDoctorId] = useState("");
  /** El doctor con el que arrancó el alta (quien abre, o el único de la sede) y de dónde salió. */
  const [doctorPropuesto, setDoctorPropuesto] = useState("");
  const [motivoPropuesta, setMotivoPropuesta] = useState<MotivoDeLaPropuesta | null>(null);
  /** H60: la oclusión de abajo viene de la última consulta (se dice en pantalla). */
  const [oclusionPrecargada, setOclusionPrecargada] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCaseIntakeOptions({ patientId: props.patientId }).then((res) => {
      if (cancelled || isFailure(res)) return;
      setDoctors(res.data.doctors);
      setGuardians(res.data.guardians);
      setReferringDoctors(res.data.referringDoctors);
      setColumnsExist(res.data.columnsExist);
      setBillingMode(res.data.billingMode);
      setModoDeLaClinica(res.data.billingMode);
      setPuedeCobrar(res.data.puedeCobrar);
      // El precio de la colocación arranca con el del catálogo (editable); sin él, se teclea.
      setPrecioColocacion((actual) => (actual !== "" || res.data.precioColocacion == null ? actual : String(res.data.precioColocacion)));
      // Solo las ACTIVAS de la clínica; si quitó todas, el selector queda vacío y el alta lo pide.
      setTecnicas(res.data.tecnicas);
      setTecnicaId((actual) => (res.data.tecnicas.some((x) => x.id === actual) ? actual : (res.data.tecnicas[0]?.id ?? "")));
      // «Responsable del pago»: el paciente, o —si es menor y ya tiene tutor— ese tutor.
      setGuardianMode(res.data.responsablePropuesto.modo);
      setResponsibleGuardianId(res.data.responsablePropuesto.tutorId);
      // H60: lo que el doctor ya midió en «Nueva consulta» se propone aquí (editable).
      const o = res.data.oclusionDeConsulta;
      if (o) {
        if (o.angleClass) {
          setAngleR(o.angleClass);
          setAngleL(o.angleClass);
        }
        if (o.overbiteMm !== null) setOverbiteMm(o.overbiteMm);
        if (o.overjetMm !== null) setOverjetMm(o.overjetMm);
        if (o.crossbite) setCrossbite(true);
        if (o.openBite) setOpenBite(true);
        setOclusionPrecargada(true);
      }
      // ws1-t10: el alta arranca con quien abre el caso (si es doctor con
      // acceso a Ortodoncia) o con el único doctor de la sede; si no hay
      // ninguno de los dos, queda vacío y hay que elegir. Solo si nadie
      // eligió ya a otro mientras cargaba, y si la columna existe.
      if (res.data.columnsExist.treatingDoctorId && res.data.suggestedTreatingDoctorId) {
        setDoctorPropuesto(res.data.suggestedTreatingDoctorId);
        setMotivoPropuesta(res.data.suggestedTreatingDoctorReason);
        setTreatingDoctorId((actual) => actual || res.data.suggestedTreatingDoctorId);
      }
    }).finally(() => {
      if (!cancelled) setLoadingOptions(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.patientId]);

  // ── Diagnóstico ──────────────────────────────────────────────────────
  const [angleR, setAngleR] = useState("CLASS_I");
  const [angleL, setAngleL] = useState("CLASS_I");
  const [overbiteMm, setOverbiteMm] = useState(2);
  const [overbitePct, setOverbitePct] = useState(20);
  const [overjetMm, setOverjetMm] = useState(2);
  const [crowdU, setCrowdU] = useState(0);
  const [crowdL, setCrowdL] = useState(0);
  const [crossbite, setCrossbite] = useState(false);
  const [crossbiteDetails, setCrossbiteDetails] = useState("");
  const [openBite, setOpenBite] = useState(false);
  const [openBiteDetails, setOpenBiteDetails] = useState("");
  const [dentalPhase, setDentalPhase] = useState("PERMANENT");
  const [tmjPain, setTmjPain] = useState(false);
  const [tmjClick, setTmjClick] = useState(false);
  const [summary, setSummary] = useState("");
  const [referredByDoctorId, setReferredByDoctorId] = useState("");
  // (b) Agregar un referente sin salir del alta.
  const [agregandoReferente, setAgregandoReferente] = useState(false);
  const [referenteNuevo, setReferenteNuevo] = useState({ fullName: "", clinicName: "", phone: "" });
  const [guardandoReferente, setGuardandoReferente] = useState(false);
  const [errorReferente, setErrorReferente] = useState<string | null>(null);
  const [inObservation, setInObservation] = useState(false);
  const [nextObservationDate, setNextObservationDate] = useState("");

  // ── Plan de tratamiento ──────────────────────────────────────────────
  // ws1-t10: la lista de técnicas es de la clínica (activas, por su nombre). `tecnicaId` es el id estable de
  // la elegida; el tipo base y el nombre propio salen de ella al guardar.
  const [tecnicas, setTecnicas] = useState<TecnicaClinica[]>(() => tecnicasDeSiempre());
  const [tecnicaId, setTecnicaId] = useState("METAL_BRACKETS");
  const tecnica = tecnicas.find((x) => x.id === tecnicaId) ?? tecnicas[0] ?? null;
  const [duration, setDuration] = useState(18);
  useEffect(() => {
    if (!pagosTocados) setNumPagos(String(pagosPropuestos(duration)));
  }, [duration, pagosTocados]);
  const [installedAt, setInstalledAt] = useState("");
  // (c) Vacío a propósito: el precio lo escribe la clínica, no el código.
  const [totalCost, setTotalCost] = useState("");
  // Mapa 14: si el alta llega desde un presupuesto aceptado, propone su
  // importe de ortodoncia (sin pisar lo que ya se escribió).
  const presupuesto = usePresupuestoDelAlta(props.patientId);
  useEffect(() => {
    if (presupuesto) setTotalCost((c) => (c.trim() === "" ? String(presupuesto.importe) : c));
  }, [presupuesto]);
  // ws1-t10 (decisión 2 de Rafael): el costo se PROPONE con el precio de la técnica
  // elegida (tabla de Configuración → Precio por técnica). Solo toca el campo si está
  // vacío o si aún trae lo que esta tabla propuso; nunca pisa lo que se tecleó ni el
  // importe de un presupuesto aceptado.
  const [costoSugerido, setCostoSugerido] = useState<string | null>(null);
  const costoSugeridoRef = useRef<string | null>(null);
  const totalCostRef = useRef(totalCost);
  totalCostRef.current = totalCost;
  useEffect(() => {
    const precio = tecnica?.precio ?? null;
    const nuevo = costoAProponer({ actual: totalCostRef.current, ultimoSugerido: costoSugeridoRef.current, precio, hayPresupuesto: presupuesto != null });
    if (nuevo === null) return;
    costoSugeridoRef.current = nuevo === "" ? null : nuevo;
    setCostoSugerido(costoSugeridoRef.current);
    setTotalCost(nuevo);
  }, [tecnica, presupuesto]);
  const [anchorage, setAnchorage] = useState("MODERATE");
  const [extractions, setExtractions] = useState(false);
  const [iprRequired, setIprRequired] = useState(false);
  const [tadsRequired, setTadsRequired] = useState(false);
  const [objectives, setObjectives] = useState("AESTHETIC_AND_FUNCTIONAL");
  const [retention, setRetention] = useState("");
  const [guardianMode, setGuardianMode] = useState<ModoResponsable>("none");
  const [responsibleGuardianId, setResponsibleGuardianId] = useState("");
  const [newGuardianName, setNewGuardianName] = useState("");
  const [newGuardianPhone, setNewGuardianPhone] = useState("");
  const [newGuardianRelation, setNewGuardianRelation] = useState("madre");
  const idTelefonoTutor = useId();
  // ws1-t10 (decisión 5, Rafael) — «hermanos»: buscar un tutor YA REGISTRADO
  // de OTRO paciente de la clínica, para reusar el MISMO Guardian.id en vez
  // de crear uno nuevo (así «Cobrar a los dos», R5, se enciende solo).
  const [tutorQuery, setTutorQuery] = useState("");
  const [tutoresDeHermanos, setTutoresDeHermanos] = useState<TutorDeLaClinica[]>([]);
  const [buscandoTutor, setBuscandoTutor] = useState(false);
  useEffect(() => {
    if (guardianMode !== "existing" || tutorQuery.trim().length < 2) {
      setTutoresDeHermanos([]);
      return;
    }
    let cancelled = false;
    setBuscandoTutor(true);
    const espera = setTimeout(() => {
      buscarTutoresDeLaClinica({ q: tutorQuery, excludePatientId: props.patientId }).then((res) => {
        if (cancelled) return;
        if (!isFailure(res)) setTutoresDeHermanos(res.data);
      }).finally(() => { if (!cancelled) setBuscandoTutor(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(espera); };
  }, [tutorQuery, guardianMode, props.patientId]);
  const idCosto = useId();
  const idColocacion = useId();
  const idEnganche = useId();
  const idPagos = useId();
  const idFaltantes = useId();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summaryValid = summary.trim().length >= 40;
  const retentionValid = retention.trim().length >= 20;
  const costo = leerCostoTotal(totalCost);
  const textosCosto = textosDelCosto(billingMode);
  const errorTelefono = errorTelefonoTutor(newGuardianPhone);

  // Lo que falta, dicho para quien llena el formulario: es lo que decide si
  // el botón se puede pulsar Y lo que se pinta junto a él cuando no.
  const faltantes = faltantesDelAlta({
    necesitaDiagnostico: needsDiagnosis,
    enObservacion: inObservation,
    resumen: summary,
    proximaRevision: nextObservationDate,
    retencion: retention,
    costoTotal: totalCost,
    costoOpcional: billingMode === "PAGO_POR_CONTROL",
    modoResponsable: guardianMode,
    tutorElegidoId: responsibleGuardianId,
    tutorNombre: newGuardianName,
    tutorTelefono: newGuardianPhone,
    sinTecnica: tecnica === null,
    sinDoctor: motivoFaltaDoctor({ treatingDoctorId, columnaExiste: columnsExist.treatingDoctorId }) !== null,
  });
  // ws1-t10: lo del plan de pago también cuenta, pero solo si se va a crear la factura.
  const estadoPlan: EstadoDelPlan = { modo: billingMode, costoTotal: costo, precioColocacion, enganche, numPagos, primerPago };
  const pideElPlan = !inObservation && puedeCobrar && !despues;
  const faltantesPlan = pideElPlan ? faltantesDelPlanDePago(estadoPlan) : [];
  const vistaPrevia = vistaPreviaDelPlan(estadoPlan);
  const esPorControl = billingMode === "PAGO_POR_CONTROL";
  const todosLosFaltantes = [...faltantes, ...faltantesPlan];
  const fraseFaltantes = fraseDeFaltantes(todosLosFaltantes, inObservation);
  // Hasta que llegan las opciones no se sabe si quien abre puede cobrar: el botón espera.
  const canSubmit = todosLosFaltantes.length === 0 && !loadingOptions;

  const guardarReferente = async () => {
    const problema = errorReferenteNuevo(referenteNuevo);
    if (problema) {
      setErrorReferente(problema);
      return;
    }
    // Si ya está en la lista, se elige ese: no se guarda dos veces.
    const repetido = referenteYaRegistrado(referringDoctors, referenteNuevo.fullName);
    if (repetido) {
      setReferredByDoctorId(repetido.id);
      setAgregandoReferente(false);
      setReferenteNuevo({ fullName: "", clinicName: "", phone: "" });
      setErrorReferente(null);
      return;
    }
    setGuardandoReferente(true);
    setErrorReferente(null);
    try {
      const datos = referenteParaGuardar(referenteNuevo);
      const res = await createDoctorContact(datos);
      if (referenteFallo(res)) {
        setErrorReferente(res.error || "No se pudo guardar el referente. Intenta de nuevo.");
        return;
      }
      setReferringDoctors((lista) =>
        [...lista, { id: res.data.id, fullName: datos.fullName, clinicName: datos.clinicName }].sort((a, b) =>
          a.fullName.localeCompare(b.fullName, "es"),
        ),
      );
      setReferredByDoctorId(res.data.id);
      setAgregandoReferente(false);
      setReferenteNuevo({ fullName: "", clinicName: "", phone: "" });
    } catch {
      setErrorReferente("No se pudo guardar el referente. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setGuardandoReferente(false);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    // Sin plan (observación) no hay costo; con plan, `faltantes` ya lo exigió.
    const costoAGuardar = costoDelAlta(totalCost, billingMode === "PAGO_POR_CONTROL");
    if (!inObservation && costoAGuardar === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const diagnosis: DrawerNewCaseDiagnosisPayload | null = needsDiagnosis
        ? {
            angleClassRight: angleR,
            angleClassLeft: angleL,
            overbiteMm,
            overbitePercentage: overbitePct,
            overjetMm,
            crowdingUpperMm: crowdU || null,
            crowdingLowerMm: crowdL || null,
            crossbite,
            crossbiteDetails: crossbite ? crossbiteDetails || null : null,
            openBite,
            openBiteDetails: openBite ? openBiteDetails || null : null,
            dentalPhase,
            tmjPainPresent: tmjPain,
            tmjClickingPresent: tmjClick,
            clinicalSummary: summary.trim(),
            referredByDoctorId: referredByDoctorId || null,
            inObservation,
            nextObservationDate:
              inObservation && nextObservationDate
                ? new Date(nextObservationDate).toISOString()
                : null,
          }
        : null;

      const plan: DrawerNewCasePlanPayload | null = inObservation
        ? null
        : {
            technique: tecnica?.base ?? "METAL_BRACKETS", // sin técnica el alta no se puede confirmar (faltantes)
            techniqueLabel: nombrePropioAGuardar(tecnica),
            estimatedDurationMonths: duration,
            installedAt: installedAt ? new Date(installedAt).toISOString() : null,
            totalCostMxn: costoAGuardar as number,
            anchorageType: anchorage,
            extractionsRequired: extractions,
            iprRequired,
            tadsRequired,
            treatmentObjectives: objectives,
            retentionPlanText: retention.trim(),
            treatingDoctorId: treatingDoctorId || null,
            responsibleGuardianId: guardianMode === "existing" ? responsibleGuardianId || null : null,
            newResponsibleGuardian:
              guardianMode === "new"
                ? {
                    fullName: newGuardianName.trim(),
                    phone: newGuardianPhone.trim(),
                    parentesco: newGuardianRelation,
                  }
                : null,
            billingMode,
          };

      const planDePago = planDePagoParaEnviar({
        enObservacion: inObservation,
        puedeCobrar,
        despues,
        modo: billingMode,
        costoTotal: costo,
        precioColocacion,
        enganche,
        numPagos,
        primerPago,
      });
      await props.onConfirm({ diagnosis, plan, planDePago });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <div className={alta.marco}>
        <div
          ref={cajonRef}
          tabIndex={-1}
          className={alta.ventana}
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-case-title"
        >
          <header className={alta.cabeza}>
            <div className="min-w-0">
              <div className={orto.cajonCeja}>
                Abrir caso de ortodoncia
              </div>
              <h3 id="new-case-title" className={orto.cajonTitulo}>
                {needsDiagnosis ? "Diagnóstico y datos del caso · " : "Datos del caso · "}
                {props.patientFullName}
              </h3>
              <p className={orto.cajonSub}>
                {needsDiagnosis ? "Diagnóstico, datos del caso y plan de pago, en un solo paso." : "Datos del caso y plan de pago, en un solo paso."}
              </p>
            </div>
            <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
              <X className="w-5 h-5" aria-hidden />
            </button>
          </header>

          <div className={alta.cuerpo}>
            {loadingOptions ? (
              <div className="flex items-center gap-2 text-xs text-[color:var(--pr-texto-3)]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Cargando doctores y responsables…
              </div>
            ) : null}

            {/* 1 · Paciente y responsable del pago */}
            <Seccion
              icono={<UserRound size={16} strokeWidth={1.75} />}
              titulo="Paciente y responsable del pago"
              sub={inObservation ? undefined : "Quién es el paciente y quién paga el tratamiento."}
            >
              <div className={alta.paciente}>
                <div>
                  <div className={alta.pacienteRotulo}>Paciente</div>
                  {props.patientFullName}
                </div>
              </div>
              {!inObservation ? (
                <div className={alta.subbloque}>
                  <h5 className={alta.subtitulo}>Responsable del pago</h5>
                  {!columnsExist.responsibleGuardianId ? (
                    <p className="text-[11px] text-[color:var(--pr-alerta)]">
                      Falta pegar el SQL de esta parte (sql/ortodoncia-alta-caso.sql) — no se puede elegir
                      responsable todavía.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <GuardianModeButton active={guardianMode === "none"} onClick={() => setGuardianMode("none")}>{ETIQUETAS_MODO_RESPONSABLE.none}</GuardianModeButton>
                    <GuardianModeButton active={guardianMode === "existing"} onClick={() => setGuardianMode("existing")} disabled={!columnsExist.responsibleGuardianId}>{ETIQUETAS_MODO_RESPONSABLE.existing}</GuardianModeButton>
                    <GuardianModeButton active={guardianMode === "new"} onClick={() => setGuardianMode("new")} disabled={!columnsExist.responsibleGuardianId}>{ETIQUETAS_MODO_RESPONSABLE.new}</GuardianModeButton>
                  </div>
                  {guardianMode === "existing" ? (
                    <div className="space-y-2">
                      {guardians.length > 0 ? (
                        <Field label="Responsable de este paciente">
                          <select value={responsibleGuardianId} onChange={(e) => setResponsibleGuardianId(e.target.value)} className={inputCls}>
                            <option value="">— elegir —</option>
                            {guardians.map((g) => (
                              <option key={g.id} value={g.id}>{g.fullName} · {g.parentesco} · {g.phone}</option>
                            ))}
                          </select>
                        </Field>
                      ) : null}
                      <Field label="¿Ya paga lo de un hermano? Búscalo por nombre o teléfono">
                        <input
                          value={tutorQuery}
                          onChange={(e) => setTutorQuery(e.target.value)}
                          placeholder="Nombre o teléfono del responsable"
                          className={inputCls}
                        />
                      </Field>
                      {buscandoTutor ? (
                        <p className="text-[11px] text-[color:var(--pr-texto-3)]">Buscando…</p>
                      ) : tutorQuery.trim().length >= 2 && tutoresDeHermanos.length === 0 ? (
                        <p className="text-[11px] text-[color:var(--pr-texto-3)]">Sin resultados.</p>
                      ) : tutoresDeHermanos.length > 0 ? (
                        <ul className="space-y-1">
                          {tutoresDeHermanos.map((tut) => (
                            <li key={tut.id}>
                              <button
                                type="button"
                                onClick={() => { setResponsibleGuardianId(tut.id); setTutorQuery(""); setTutoresDeHermanos([]); }}
                                className={`w-full text-left text-xs rounded-[8px] border px-2 py-1.5 ${responsibleGuardianId === tut.id ? "border-[color:var(--pr-acento)]" : "border-[color:var(--pr-borde-suave)]"}`}
                              >
                                {tut.fullName} · {tut.parentesco} · {tut.phone} — responsable de {tut.patientName}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {responsibleGuardianId && !guardians.some((g) => g.id === responsibleGuardianId) && tutoresDeHermanos.length === 0 && !tutorQuery ? (
                        <p className="text-[11px] text-[color:var(--pr-texto-3)]">Responsable de un hermano ya elegido.</p>
                      ) : null}
                    </div>
                  ) : null}
                  {guardianMode === "new" ? (
                    <div className={alta.cuadricula}>
                      <Field label="Nombre completo (obligatorio)">
                        <input value={newGuardianName} onChange={(e) => setNewGuardianName(e.target.value)} className={inputCls} />
                      </Field>
                      <Field label="Teléfono (obligatorio)" hint={MOTIVO_TELEFONO_TUTOR} htmlFor={idTelefonoTutor}>
                        <input
                          id={idTelefonoTutor}
                          type="tel"
                          inputMode="tel"
                          autoComplete="off"
                          required
                          value={newGuardianPhone}
                          onChange={(e) => setNewGuardianPhone(e.target.value)}
                          placeholder="10 dígitos"
                          aria-invalid={errorTelefono !== null}
                          className={inputCls}
                        />
                        {errorTelefono ? (
                          <p className="mt-1 text-[11px] text-[color:var(--pr-peligro)]" role="alert">
                            {errorTelefono}
                          </p>
                        ) : null}
                      </Field>
                      <Field label="Parentesco">
                        <Select value={newGuardianRelation} onChange={setNewGuardianRelation} options={GUARDIAN_RELATION_OPTIONS} />
                      </Field>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Seccion>

            {/* 2 · Diagnóstico */}
            {needsDiagnosis ? (
              <Seccion
                icono={<Stethoscope size={16} strokeWidth={1.75} />}
                titulo="Diagnóstico ortodóntico"
                sub="Oclusión, ATM y resumen clínico del paciente."
              >
                {oclusionPrecargada ? (
                  <p className="text-xs text-[color:var(--pr-texto-3)]">
                    Clase, sobremordida, overjet y mordida vienen de tu última consulta; revísalos y cámbialos si hace falta.
                  </p>
                ) : null}
                <div className={alta.cuadricula}>
                  <Field label="Angle derecha">
                    <Select value={angleR} onChange={setAngleR} options={ANGLE_OPTIONS} />
                  </Field>
                  <Field label="Angle izquierda">
                    <Select value={angleL} onChange={setAngleL} options={ANGLE_OPTIONS} />
                  </Field>
                  <Field label="Overbite (mm)">
                    <NumberInput value={overbiteMm} onChange={setOverbiteMm} step={0.5} min={-10} max={15} />
                  </Field>
                  <Field label="Overbite (%)">
                    <NumberInput value={overbitePct} onChange={setOverbitePct} step={1} min={0} max={100} />
                  </Field>
                  <Field label="Overjet (mm)">
                    <NumberInput value={overjetMm} onChange={setOverjetMm} step={0.5} min={-5} max={20} />
                  </Field>
                  <Field label="Fase dental">
                    <Select value={dentalPhase} onChange={setDentalPhase} options={DENTAL_PHASE_OPTIONS} />
                  </Field>
                  <Field label="Apiñamiento sup. (mm)">
                    <NumberInput value={crowdU} onChange={setCrowdU} step={0.5} min={0} max={20} />
                  </Field>
                  <Field label="Apiñamiento inf. (mm)">
                    <NumberInput value={crowdL} onChange={setCrowdL} step={0.5} min={0} max={20} />
                  </Field>
                </div>
                <div className={alta.cuadricula}>
                  <Field label="Mordida cruzada">
                    <Checkbox label="Presente" checked={crossbite} onChange={setCrossbite} />
                  </Field>
                  <Field label="Mordida abierta">
                    <Checkbox label="Presente" checked={openBite} onChange={setOpenBite} />
                  </Field>
                </div>
                {crossbite ? (
                  <Field label="Detalles mordida cruzada">
                    <input value={crossbiteDetails} onChange={(e) => setCrossbiteDetails(e.target.value)} className={inputCls} placeholder="lateral derecha 15-45" />
                  </Field>
                ) : null}
                {openBite ? (
                  <Field label="Detalles mordida abierta">
                    <input value={openBiteDetails} onChange={(e) => setOpenBiteDetails(e.target.value)} className={inputCls} />
                  </Field>
                ) : null}
                <div className={alta.cuadricula}>
                  <Field label="Dolor ATM">
                    <Checkbox label="Presente" checked={tmjPain} onChange={setTmjPain} />
                  </Field>
                  <Field label="Chasquido ATM">
                    <Checkbox label="Presente" checked={tmjClick} onChange={setTmjClick} />
                  </Field>
                </div>
                <Field label="Resumen clínico (mín. 40 caracteres)">
                  <textarea value={summary} onChange={(e) => setSummary(e.target.value)} className={`${inputCls} min-h-[90px]`} placeholder="Clase, problema principal, etiología, plan general…" />
                  <div className={`text-[11px] mt-1 ${summaryValid ? "text-[color:var(--pr-exito)]" : "text-[color:var(--pr-alerta)]"}`}>
                    {summary.trim().length} / 40 mínimo
                  </div>
                </Field>

                <div className={alta.subbloque}>
                  <h5 className={alta.subtitulo}>Origen del paciente</h5>
                  <Field
                    label="Quién lo refirió (opcional)"
                    hint={
                      referringDoctors.length === 0 && !agregandoReferente && !loadingOptions
                        ? "Aún no hay referentes registrados en la clínica. Agrega el primero aquí mismo."
                        : undefined
                    }
                  >
                    <div className="flex gap-2">
                      <select
                        value={referredByDoctorId}
                        onChange={(e) => setReferredByDoctorId(e.target.value)}
                        className={inputCls}
                        aria-label="Quién lo refirió"
                      >
                        <option value="">— sin referente —</option>
                        {referringDoctors.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.fullName}{d.clinicName ? ` · ${d.clinicName}` : ""}
                          </option>
                        ))}
                      </select>
                      {!agregandoReferente ? (
                        <Btn
                          variant="secondary"
                          size="md"
                          className="shrink-0"
                          icon={<Plus size={15} strokeWidth={1.75} aria-hidden />}
                          onClick={() => {
                            setAgregandoReferente(true);
                            setErrorReferente(null);
                          }}
                        >
                          Agregar
                        </Btn>
                      ) : null}
                    </div>
                  </Field>
                  {agregandoReferente ? (
                    <div
                      className="rounded-[10px] border border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta-2)] p-3 space-y-3"
                      role="group"
                      aria-label="Nuevo referente"
                    >
                      <div className={alta.cuadricula}>
                        <Field label="Nombre de quien lo refirió">
                          <input
                            autoFocus
                            value={referenteNuevo.fullName}
                            onChange={(e) => setReferenteNuevo({ ...referenteNuevo, fullName: e.target.value })}
                            className={inputCls}
                            placeholder="Ej. Dra. Laura Méndez"
                            maxLength={120}
                          />
                        </Field>
                        <Field label="Consultorio o clínica (opcional)">
                          <input
                            value={referenteNuevo.clinicName}
                            onChange={(e) => setReferenteNuevo({ ...referenteNuevo, clinicName: e.target.value })}
                            className={inputCls}
                            maxLength={120}
                          />
                        </Field>
                        <Field label="Teléfono (opcional)">
                          <input
                            type="tel"
                            inputMode="tel"
                            value={referenteNuevo.phone}
                            onChange={(e) => setReferenteNuevo({ ...referenteNuevo, phone: e.target.value })}
                            className={inputCls}
                            maxLength={40}
                          />
                        </Field>
                      </div>
                      {errorReferente ? (
                        <p className="text-[11.5px] text-[color:var(--pr-peligro)]" role="alert">
                          {errorReferente}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <Btn variant="primary" size="sm" onClick={guardarReferente} disabled={guardandoReferente}>
                          {guardandoReferente ? "Guardando…" : "Guardar referente"}
                        </Btn>
                        <Btn
                          variant="ghost"
                          size="sm"
                          disabled={guardandoReferente}
                          onClick={() => {
                            setAgregandoReferente(false);
                            setErrorReferente(null);
                          }}
                        >
                          Cancelar
                        </Btn>
                        <span className="text-[11px] text-[color:var(--pr-texto-3)]">
                          Queda en el directorio de la clínica para los siguientes casos.
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className={alta.subbloque}>
                  <label className={`${alta.casilla} ${inObservation ? alta.casillaActiva : ""}`}>
                    <input type="checkbox" checked={inObservation} onChange={(e) => setInObservation(e.target.checked)} />
                    <span>
                      <span className={alta.casillaTitulo}>Paciente en observación</span>
                      <span className={alta.casillaPista}>
                        Aún no inicia tratamiento: se revisa periódicamente hasta que convenga empezar. No se
                        abre plan de tratamiento todavía.
                      </span>
                    </span>
                  </label>
                  {inObservation ? (
                    <Field label="Próxima revisión">
                      <DateField value={nextObservationDate} onChange={(e) => setNextObservationDate(e.target.value)} max={hoyMasAniosISO(5)} className={inputCls} aria-label="Próxima revisión" />
                    </Field>
                  ) : null}
                </div>
              </Seccion>
            ) : null}

            {/* 3 · Datos del caso */}
            {!inObservation ? (
              <Seccion
                icono={<ClipboardList size={16} strokeWidth={1.75} />}
                titulo="Datos del caso"
                sub="Aparatología, duración, precio acordado y plan de retención."
              >
                <div className={alta.cuadricula}>
                  <Field label="Aparatología">
                    {tecnicas.length > 0 ? (
                      <Select value={tecnica?.id ?? ""} onChange={setTecnicaId} options={tecnicas.map((x) => ({ v: x.id, l: x.nombre }))} />
                    ) : (
                      <p className="text-[11px] text-[color:var(--pr-alerta)]">
                        La clínica no tiene técnicas activas. Agrégalas en Configuración → Técnicas y precios.
                      </p>
                    )}
                  </Field>
                  <Field label="Duración estimada (meses)">
                    <NumberInput value={duration} onChange={setDuration} step={1} min={3} max={60} />
                  </Field>
                  <Field label="Fecha de colocación (opcional)">
                    <DateField value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} max={hoyMasAniosISO(5)} className={inputCls} aria-label="Fecha de colocación" />
                  </Field>
                  <Field label="Cómo se cobra este caso" hint={pistaDelModoDelCaso(billingMode, modoDeLaClinica)}>
                    <Select
                      value={billingMode}
                      onChange={(v) => setBillingMode(normalizarOrthoBillingMode(v))}
                      options={MODO_DE_COBRO_OPTIONS}
                    />
                  </Field>
                  <Field label={textosCosto.rotulo} hint={presupuesto && totalCost === String(presupuesto.importe) ? presupuesto.nota : costoSugerido !== null && totalCost === costoSugerido ? "Es el precio de tu tabla para esta técnica (Configuración → Precio por técnica). Cámbialo si este paciente pactó otro." : textosCosto.pista} htmlFor={idCosto}>
                    <input
                      id={idCosto}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={totalCost}
                      onChange={(e) => setTotalCost(e.target.value)}
                      placeholder="Escribe el importe"
                      aria-invalid={totalCost.trim() !== "" && costo === null}
                      className={inputCls}
                    />
                    {totalCost.trim() !== "" && costo === null ? (
                      <p className="mt-1 text-[11px] text-[color:var(--pr-peligro)]" role="alert">
                        Escribe solo el importe, mayor que cero. Por ejemplo: 36000.
                      </p>
                    ) : null}
                  </Field>
                  <Field label="Anclaje">
                    <Select value={anchorage} onChange={setAnchorage} options={ANCHORAGE_OPTIONS} />
                  </Field>
                  <Field label="Objetivos">
                    <Select value={objectives} onChange={setObjectives} options={OBJECTIVE_OPTIONS} />
                  </Field>
                </div>
                <div className={alta.cuadricula3}>
                  <Checkbox label="Extracciones" checked={extractions} onChange={setExtractions} />
                  <Checkbox label="Requiere IPR" checked={iprRequired} onChange={setIprRequired} />
                  <Checkbox label="Requiere TADs" checked={tadsRequired} onChange={setTadsRequired} />
                </div>
                <Field label="Plan de retención (mín. 20 caracteres)">
                  <textarea value={retention} onChange={(e) => setRetention(e.target.value)} placeholder={`Ejemplo: ${EJEMPLO_DE_RETENCION}`} className={`${inputCls} min-h-[70px]`} />
                  <div className={`text-[11px] mt-1 ${retentionValid ? "text-[color:var(--pr-exito)]" : "text-[color:var(--pr-alerta)]"}`}>
                    {retention.trim().length} / 20 mínimo
                  </div>
                </Field>
              </Seccion>
            ) : null}

            {/* 4 · Plan de pago (ws1-t10): la factura se crea al abrir el caso */}
            {!inObservation ? (
              <Seccion
                icono={<Wallet size={16} strokeWidth={1.75} />}
                titulo="Plan de pago"
                sub={esPorControl ? "Pago por control: se factura la colocación." : "Precio total a plazos: se factura el tratamiento completo."}
              >
                {loadingOptions ? (
                  <div className={alta.pendiente}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Cargando…
                  </div>
                ) : !puedeCobrar ? (
                  <div className={alta.pendiente} role="status">
                    <Info size={15} strokeWidth={1.75} aria-hidden />
                    <span>Recepción armará el plan de pago.</span>
                  </div>
                ) : (
                  <>
                    <label className={`${alta.casilla} ${despues ? alta.casillaActiva : ""}`}>
                      <input type="checkbox" checked={despues} onChange={(e) => setDespues(e.target.checked)} />
                      <span>
                        <span className={alta.casillaTitulo}>Crear el plan de pago después</span>
                        <span className={alta.casillaPista}>
                          El caso se abre sin factura. Cuando lo tengas definido, lo armas en Cobro con «Abrir plan de pago».
                        </span>
                      </span>
                    </label>

                    {!despues && esPorControl ? (
                      <>
                        <div className={alta.cuadricula}>
                          <Field
                            label="Precio de la colocación (MXN)"
                            hint={precioColocacion.trim() === "" ? "No hay precio de «Colocación de aparatología» en tu catálogo: escríbelo." : "Sale del catálogo de ortodoncia. Cámbialo si este paciente pactó otro."}
                            htmlFor={idColocacion}
                          >
                            <input
                              id={idColocacion}
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={precioColocacion}
                              onChange={(e) => setPrecioColocacion(e.target.value)}
                              placeholder="Escribe el importe"
                              className={inputCls}
                            />
                          </Field>
                        </div>
                        <PlanVistaPrevia texto={vistaPrevia} />
                      </>
                    ) : null}

                    {!despues && !esPorControl ? (
                      <>
                        <div className={alta.cuadricula}>
                          <Field label="Costo total" hint="Lo escribes arriba, en «Datos del caso».">
                            <div className={alta.valor}>{costo !== null ? pesos(costo) : "—"}</div>
                          </Field>
                          <Field label="Enganche (opcional)" htmlFor={idEnganche}>
                            <input
                              id={idEnganche}
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={enganche}
                              onChange={(e) => setEnganche(e.target.value)}
                              placeholder="Sin enganche"
                              aria-invalid={faltantesPlan.some((f) => f.includes("enganche"))}
                              className={inputCls}
                            />
                          </Field>
                          <Field
                            label="Número de pagos"
                            hint={pagosTocados ? undefined : `Propuesto: la duración estimada (${duration} meses).`}
                            htmlFor={idPagos}
                          >
                            <input
                              id={idPagos}
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              value={numPagos}
                              onChange={(e) => { setPagosTocados(true); setNumPagos(e.target.value); }}
                              aria-invalid={faltantesPlan.some((f) => f.includes("número de pagos"))}
                              className={inputCls}
                            />
                          </Field>
                          <Field label="Fecha del primer pago">
                            <DateField value={primerPago} onChange={(e) => setPrimerPago(e.target.value)} max={hoyMasAniosISO(5)} className={inputCls} aria-label="Fecha del primer pago" />
                          </Field>
                        </div>
                        <PlanVistaPrevia texto={vistaPrevia} />
                      </>
                    ) : null}
                  </>
                )}
              </Seccion>
            ) : null}

            {/* 5 · Doctor tratante */}
            {!inObservation ? (
              <Seccion
                icono={<UserCog size={16} strokeWidth={1.75} />}
                titulo="Doctor tratante"
                sub="Quién lleva el caso."
              >
                <Field label="Quién lleva el caso (obligatorio)">
                  <select
                    value={treatingDoctorId}
                    onChange={(e) => setTreatingDoctorId(e.target.value)}
                    className={inputCls}
                    disabled={!columnsExist.treatingDoctorId}
                  >
                    <option value="">{columnsExist.treatingDoctorId ? "— elige al doctor —" : "— sin asignar —"}</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>{d.fullName}</option>
                    ))}
                  </select>
                </Field>
                {doctorPropuesto && treatingDoctorId === doctorPropuesto && textoDeLaPropuesta(motivoPropuesta) ? (
                  <p className="text-[11px] text-[color:var(--pr-texto-3)]">{textoDeLaPropuesta(motivoPropuesta)}</p>
                ) : null}
                {!loadingOptions && columnsExist.treatingDoctorId && doctors.length > 0 && treatingDoctorId === "" ? (
                  <p className="text-[11px] text-[color:var(--pr-alerta)]">{MENSAJE_FALTA_DOCTOR}</p>
                ) : null}
                {!loadingOptions && columnsExist.treatingDoctorId && doctors.length === 0 ? (
                  <p className="text-[11px] text-[color:var(--pr-alerta)]">
                    Nadie de esta clínica aparece como doctor. Revisa en Equipo que quien atiende tenga rol de
                    doctor o esté en la Agenda.
                  </p>
                ) : null}
                {!columnsExist.treatingDoctorId ? (
                  <p className="text-[11px] text-[color:var(--pr-alerta)]">
                    Falta pegar el SQL de la Ola 0 (sql/ortodoncia-nucleo.sql) — no se puede asignar todavía.
                  </p>
                ) : null}
              </Seccion>
            ) : null}

            {error ? (
              <div className={alta.error} role="alert">
                {error}
              </div>
            ) : null}
          </div>

          <footer className={alta.pie}>
            {fraseFaltantes ? (
              // (a) El botón gris ya no es un misterio: aquí dice qué falta.
              <span id={idFaltantes} className={`${alta.pieNota} ${alta.pieNotaFalta}`} role="status">
                {fraseFaltantes}
              </span>
            ) : (
              <span className={`${alta.pieNota} inline-flex items-center gap-1`}>
                <Receipt className="w-3 h-3 shrink-0" aria-hidden /> {notaDelCobroAlAbrir({ enObservacion: inObservation, puedeCobrar, despues })}
              </span>
            )}
            <div className={alta.pieBotones}>
              <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
              <Btn
                variant="primary"
                size="md"
                onClick={submit}
                disabled={!canSubmit || submitting}
                aria-describedby={fraseFaltantes ? idFaltantes : undefined}
              >
                {submitting ? "Guardando…" : inObservation ? "Guardar en observación" : "Abrir caso"}
              </Btn>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

/** «Enganche $X y N pagos de $Y, el primero el dd/mm/aaaa». */
function PlanVistaPrevia({ texto }: { texto: string | null }) {
  return texto ? (
    <div className={alta.vistaPrevia} role="status">
      <Receipt size={16} strokeWidth={1.75} aria-hidden />
      <span>{texto}</span>
    </div>
  ) : (
    <div className={`${alta.vistaPrevia} ${alta.vistaPreviaVacia}`}>
      <Receipt size={16} strokeWidth={1.75} aria-hidden />
      <span>Completa los datos para ver cómo queda el plan.</span>
    </div>
  );
}

function Seccion({
  icono,
  titulo,
  sub,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  sub?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section className={alta.seccion} aria-labelledby={id}>
      <header className={alta.seccionCabeza}>
        <span className={alta.seccionIcono} aria-hidden>{icono}</span>
        <div className={alta.seccionTextos}>
          <h4 id={id} className={alta.seccionTitulo}>{titulo}</h4>
          {sub ? <p className={alta.seccionSub}>{sub}</p> : null}
        </div>
      </header>
      <div className={alta.seccionCuerpo}>{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  /** El `id` del campo, para que pulsar el rótulo lo enfoque y el lector de pantalla los una. */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={orto.campo}>
      <label htmlFor={htmlFor} className={orto.campoEtiqueta}>{label}</label>
      {children}
      {hint ? <p className={orto.campoPista}>{hint}</p> : null}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ v: string; l: string }>;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {options.map((o) => (
        <option key={o.v} value={o.v}>{o.l}</option>
      ))}
    </select>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className={inputCls}
    />
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-[color:var(--pr-texto-2)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function GuardianModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-[8px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "bg-[color:var(--pr-activo)] border-[color:var(--pr-activo)] text-[color:var(--pr-activo-texto)]"
          : "border-[color:var(--pr-borde)] text-[color:var(--pr-texto-2)] hover:bg-[color:var(--pr-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

const inputCls =
  orto.entrada;
