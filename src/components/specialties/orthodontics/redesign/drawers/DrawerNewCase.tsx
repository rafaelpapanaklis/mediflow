"use client";
// DrawerNewCase — LA ventana del caso de ortodoncia (ws1-t12, decisión de Rafael, 29-sep-2026).
//
// «Abrir caso» es UNA ventana con dos pasos: 1 · Diagnóstico → 2 · Plan de tratamiento (con el cobro dentro).
// Y «Editar» —el del resumen del plan, el de «Editar aparatología», el de los avisos «Completar plan»— abre ESTA
// MISMA ventana en su paso: un solo formulario para crear y para editar, sin versiones básicas duplicadas.
//
//  · Paso 1 · Diagnóstico: los datos del caso que van en la cabecera (quién lo refirió, «en observación») y la
//    exploración del paciente. El diagnóstico es de ws1-t8: este paso usa hoy los campos de siempre y es el punto
//    donde entra su componente de paso (`PasoDeDiagnostico`, sin ventana propia).
//  · Paso 2 · Plan de tratamiento: técnica y doctor (lo ÚNICO obligatorio para abrir), tiempo y controles,
//    anclaje, aditamentos, extracciones, control radiográfico, aparatología, tubos-bandas-cementación,
//    interconsultas, plan de retención y el COBRO (modo, responsable del pago, costo, enganche, pagos o pago por
//    control, «lo armo después»). Todo lo demás se puede dejar a medias; sin costo el caso se abre sin factura.
//
// Al pulsar «Abrir caso» el padre crea el caso y enseguida su factura (`crearPlanDelCaso`) con el plan de pago
// escrito aquí. Al editar, el padre guarda técnica, doctor, plan, y —si cambia el costo de un caso con factura—
// lo hace con las reglas de «editar factura con pagos» (no bajar de lo pagado; se avisa que las mensualidades se
// recalculan). Las reglas viven en `ventana-del-caso.ts`, `plan-detalle.ts` y `cobro/plan-al-abrir.ts` (puros, con tests).
//
// Sin repetir datos entre el diagnóstico y el plan (reglas de Rafael):
//  · «Requiere TADs» y las «extracciones» ya no son casillas: salen de Aditamentos y de las piezas indicadas.
//  · El anclaje general, la prescripción y el cementado generales se DERIVAN de lo elegido en el plan.
//  · La aparatología ofrecida sigue a la técnica (alineadores solo con alineadores o mixta).
//  · La duración y los controles previstos son uno solo; los controles se proponen (duración ÷ frecuencia).
//
// Las opciones de doctores/tutores/referentes se piden en caliente a getCaseIntakeOptions (solo lectura).

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DateField } from "@/components/ui/date-field";
import { hoyISO, hoyMasAniosISO } from "@/lib/orthodontics/fechas-de-formulario";
import { ArrowLeft, ArrowRight, Check, ClipboardList, Info, ListChecks, Loader2, Plus, Receipt, Stethoscope, UserCog, UserRound, Wallet, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { getCaseIntakeOptions, buscarTutoresDeLaClinica, type TutorDeLaClinica } from "@/app/actions/orthodontics";
import { cargarOpcionesDelPlan } from "@/app/actions/orthodontics/cargarOpcionesDelPlan";
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
  leerCostoTotal,
  pistaDelModoDelCaso,
  referenteParaGuardar,
  referenteYaRegistrado,
  textosDelCosto,
  type ModoResponsable,
} from "@/lib/orthodontics/alta-caso-formulario";
import { pagosPropuestos, pesos, vistaPreviaDelPlan, type EstadoDelPlan, type PlanDePagoAlAbrir } from "@/lib/orthodontics/cobro/plan-al-abrir";
import {
  SECCIONES_DE_LA_VENTANA,
  formularioAPeticion,
  formularioDesdeLaVista,
  formularioTocado,
  formularioVacio,
  seccionesConDatos,
  type ClaveDeLaVentana,
  type FormularioDelPlan,
} from "@/lib/orthodontics/plan-detalle-formulario";
import {
  anclajeGeneralDerivado,
  aparatologiaPermitida,
  controlesSugeridos,
  estimadoPorControles,
  FRECUENCIA_DE_CONTROL_DIAS_POR_OMISION,
  FRECUENCIAS_DE_CONTROL,
  planPideTads,
  sinAparatologiaIncompatible,
  textoDelEstimado,
  type OpcionesDelPlan,
  type PlanDeTratamientoVista,
} from "@/lib/orthodontics/plan-detalle";
import {
  costoParaGuardar,
  faltantesDelDiagnostico,
  faltantesDelPlanCompleto,
  fraseDeLoQueFalta,
  hayQueCrearLaFactura,
  notaDelCobro,
  planDePagoAlAbrir,
  type PasoDeLaVentana,
} from "@/lib/orthodontics/ventana-del-caso";
import { useCajon } from "../atoms/useCajon";
import { usePresupuestoDelAlta } from "./usePresupuestoDelAlta";
import { CamposDelPlan, idDeSeccion } from "./CamposDelPlan";
import { EJEMPLO_DE_RETENCION } from "@/lib/orthodontics/retencion-ejemplo";
import { costoAProponer } from "@/lib/orthodontics/precios-por-tecnica";
import {
  ID_TECNICA_ACTUAL,
  nombrePropioAGuardar,
  opcionesDeEdicion,
  tecnicasDeSiempre,
  type TecnicaClinica,
} from "@/lib/orthodontics/tecnicas-de-la-clinica";
import orto from "../orto.module.css";
import alta from "../alta-caso.module.css";
import planCss from "../plan-tratamiento.module.css";

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
   * Precio del caso al abrirlo (0 = «lo armo después»). Con «Precio total» la factura del tratamiento se crea con
   * ESTE precio en el mismo alta (`planDePago`); si se elige «después», no hay costo o no hay permiso de cobro, la
   * factura la abre Cobro luego ("Abrir plan de pago"). Cuando exista `orthodonticTreatmentPlan.invoiceId`, el
   * número que cuenta es `invoice.total`, no este campo.
   */
  totalCostMxn: number;
  anchorageType: string;
  extractionsRequired: boolean;
  iprRequired: boolean;
  tadsRequired: boolean;
  treatmentObjectives: string;
  /** Opcional: se puede definir al llegar a la etapa de retención (vacío = ""). */
  retentionPlanText: string;
  treatingDoctorId: string | null;
  responsibleGuardianId: string | null;
  newResponsibleGuardian: { fullName: string; phone: string; parentesco: string } | null;
  /** Fila 32 (ws1-t4 ronda 6): el modo de cobro de ESTE caso; propuesto el de la clínica. */
  billingMode: OrthoBillingMode;
  /**
   * ws1-t12 — el «Plan de tratamiento» completo (opcional: se puede completar después). Va tal cual a
   * `validarPlanDetalle`; `extractionsTeethFdi` son las indicadas (columna de siempre).
   */
  planDetalle?: Record<string, unknown> | null;
  extractionsTeethFdi?: number[];
}

/** Lo que la ventana entrega al confirmar. `planDePago` = null: el caso se abre SIN factura (después, sin permiso, sin costo, observación). */
export interface DrawerNewCaseSubmit {
  diagnosis: DrawerNewCaseDiagnosisPayload | null;
  plan: DrawerNewCasePlanPayload | null;
  planDePago?: PlanDePagoAlAbrir | null;
}

/** Lo que la ventana entrega al EDITAR un caso ya abierto: el padre lo guarda en pasos y dice qué falló. */
export interface DrawerEditarPlanSubmit {
  treatmentPlanId: string;
  /** Solo si cambió la técnica. */
  tecnica: { technique: string; techniqueLabel: string | null } | null;
  columnas: {
    treatmentObjectives: string;
    retentionPlanText: string;
    treatingDoctorId: string | null;
    responsibleGuardianId: string | null;
    newResponsibleGuardian: { fullName: string; phone: string; parentesco: string } | null;
    /** Solo si cambió la fecha de colocación (ISO), para no mover el estado del caso sin querer. */
    installedAt?: string | null;
    iprRequired: boolean;
  };
  /** El plan completo, tal cual a `guardarPlanDeTratamiento` (más la duración y las extracciones indicadas). */
  plan: Record<string, unknown>;
  extraccionesIndicadas: number[];
  duracionMeses: number;
  /** El costo escrito (0 = vacío) y si cambió respecto de lo guardado. */
  costo: { total: number; cambio: boolean };
  /** Solo si el caso aún no tiene factura y se quiere crear ahora. */
  planDePago: PlanDePagoAlAbrir | null;
}

export interface DrawerNewCaseProps {
  patientId: string;
  patientFullName: string;
  /** Si ya hay diagnóstico, la ventana solo pide el plan de tratamiento (arranca en el paso 2). */
  existingDiagnosisId: string | null;
  onClose: () => void;
  onConfirm: (payload: DrawerNewCaseSubmit) => Promise<void> | void;
  /** ws1-t12 — `editar`: el caso ya está abierto; la ventana parte de `vista` y guarda con `onEditar`. */
  modo?: "crear" | "editar";
  /** Paso con el que se abre al CREAR (los avisos «Completar diagnóstico» abren el paso 1). */
  pasoInicial?: PasoDeLaVentana;
  vista?: PlanDeTratamientoVista | null;
  /** Editar: devuelve `false` si algo no se guardó (la ventana se queda abierta). */
  onEditar?: (payload: DrawerEditarPlanSubmit) => Promise<boolean | void> | boolean | void;
  /**
   * Textos propios cuando la ventana se reutiliza (p. ej. una REEVALUACIÓN de ws1-t8, que la abre PRECARGADA con un
   * plan —`vista` armada con `vistaDeUnPlanCompleto`— y guarda una versión nueva por su propio `onEditar`).
   */
  etiquetas?: { ceja?: string; titulo?: string; subtitulo?: string; guardar?: string };
}

const soloFecha = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "");

export function DrawerNewCase(props: DrawerNewCaseProps) {
  const cajonRef = useCajon<HTMLDivElement>(props.onClose);
  const vista = props.vista ?? null;
  const caso = vista?.caso ?? null;
  const editar = props.modo === "editar" && vista !== null && caso !== null;
  const needsDiagnosis = !props.existingDiagnosisId && !editar;
  /** El caso YA tiene factura (en «Pago por control», la de colocación): no se vuelve a pedir el plan de pago. */
  const tieneFactura = editar && caso!.factura !== null;
  /** «Precio total» con factura: el costo del plan ES el total de la factura y cambiarlo sigue las reglas de «editar factura con pagos». */
  const conFactura = tieneFactura && caso!.billingMode === "PRECIO_TOTAL";

  const [paso, setPaso] = useState<PasoDeLaVentana>(needsDiagnosis ? (props.pasoInicial ?? "diagnostico") : "plan");

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
  const [billingMode, setBillingMode] = useState<OrthoBillingMode>(caso?.billingMode ?? ORTHO_BILLING_MODE_DEFAULT);
  /** Cómo cobra la clínica: la propuesta para el modo de este caso (fila 32). */
  const [modoDeLaClinica, setModoDeLaClinica] = useState<OrthoBillingMode>(ORTHO_BILLING_MODE_DEFAULT);
  // ws1-t10 — el plan de pago se arma aquí. `puedeCobrar` llega con las opciones; sin él la sección no se pide.
  const [puedeCobrar, setPuedeCobrar] = useState(false);
  const [despues, setDespues] = useState(false);
  const [precioColocacion, setPrecioColocacion] = useState("");
  /** ws1-t12: precio de «Control de ortodoncia» del catálogo, para estimar el total en «Pago por control». */
  const [precioControl, setPrecioControl] = useState<number | null>(null);
  const [enganche, setEnganche] = useState("");
  const [numPagos, setNumPagos] = useState(() => String(pagosPropuestos(caso ? (vista?.duracionMeses ?? 18) : 18)));
  /** Mientras nadie edite «Número de pagos», sigue a la duración estimada. */
  const [pagosTocados, setPagosTocados] = useState(false);
  const [primerPago, setPrimerPago] = useState(() => hoyISO());
  const [treatingDoctorId, setTreatingDoctorId] = useState(caso?.doctorId ?? "");
  /** El doctor con el que arrancó el alta (quien abre, o el único de la sede) y de dónde salió. */
  const [doctorPropuesto, setDoctorPropuesto] = useState("");
  const [motivoPropuesta, setMotivoPropuesta] = useState<MotivoDeLaPropuesta | null>(null);
  /** H60: la oclusión de abajo viene de la última consulta (se dice en pantalla). */
  const [oclusionPrecargada, setOclusionPrecargada] = useState(false);

  // ── Datos del CASO (cabecera): quién lo refirió y «en observación» ───────
  const [referredByDoctorId, setReferredByDoctorId] = useState("");
  // (b) Agregar un referente sin salir del alta.
  const [agregandoReferente, setAgregandoReferente] = useState(false);
  const [referenteNuevo, setReferenteNuevo] = useState({ fullName: "", clinicName: "", phone: "" });
  const [guardandoReferente, setGuardandoReferente] = useState(false);
  const [errorReferente, setErrorReferente] = useState<string | null>(null);
  const [inObservation, setInObservation] = useState(false);
  const [nextObservationDate, setNextObservationDate] = useState("");

  // ── Diagnóstico (paso 1: el componente de paso de ws1-t8 entra aquí) ────
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

  // ── Plan de tratamiento (paso 2) ─────────────────────────────────────
  // ws1-t10: la lista de técnicas es de la clínica (activas, por su nombre). `tecnicaId` es el id estable de
  // la elegida; el tipo base y el nombre propio salen de ella al guardar.
  const [tecnicas, setTecnicas] = useState<TecnicaClinica[]>(() => tecnicasDeSiempre());
  const [tecnicaId, setTecnicaId] = useState(editar ? "" : "METAL_BRACKETS");
  // Al editar, la técnica del caso sale aunque la clínica ya no la ofrezca («(actual)»).
  const listaDeTecnicas = useMemo<TecnicaClinica[]>(() => {
    if (!editar || !caso) return tecnicas;
    const { opciones } = opcionesDeEdicion(tecnicas, { base: caso.tecnica, label: caso.tecnicaNombrePropio, nombreVisible: caso.tecnicaVisible });
    return opciones.map((o) => ({ id: o.id, nombre: o.nombre, base: o.base, precio: tecnicas.find((t) => t.id === o.id)?.precio ?? null, activa: true }));
  }, [editar, caso, tecnicas]);
  const tecnica = listaDeTecnicas.find((x) => x.id === tecnicaId) ?? (editar ? null : (listaDeTecnicas[0] ?? null));
  const [planForm, setPlanForm] = useState<FormularioDelPlan>(() => (vista ? formularioDesdeLaVista(vista) : formularioVacio(18)));
  const duration = Number(planForm.duracion) || 0;
  useEffect(() => {
    if (!pagosTocados) setNumPagos(String(pagosPropuestos(duration)));
  }, [duration, pagosTocados]);
  const [installedAt, setInstalledAt] = useState(soloFecha(caso?.colocadoEl));
  // (c) Vacío a propósito: el precio lo escribe la clínica, no el código.
  const [totalCost, setTotalCost] = useState(() => (caso ? String(caso.factura?.total ?? (caso.costoReferencia > 0 ? caso.costoReferencia : "")) : ""));
  // Mapa 14: si el alta llega desde un presupuesto aceptado, propone su
  // importe de ortodoncia (sin pisar lo que ya se escribió).
  const presupuesto = usePresupuestoDelAlta(props.patientId);
  useEffect(() => {
    if (!editar && presupuesto) setTotalCost((c) => (c.trim() === "" ? String(presupuesto.importe) : c));
  }, [presupuesto, editar]);
  // ws1-t10 (decisión 2 de Rafael): el costo se PROPONE con el precio de la técnica
  // elegida (tabla de Configuración → Precio por técnica). Solo toca el campo si está
  // vacío o si aún trae lo que esta tabla propuso; nunca pisa lo que se tecleó ni el
  // importe de un presupuesto aceptado. Al editar un caso no se propone nada.
  const [costoSugerido, setCostoSugerido] = useState<string | null>(null);
  const costoSugeridoRef = useRef<string | null>(null);
  const totalCostRef = useRef(totalCost);
  totalCostRef.current = totalCost;
  useEffect(() => {
    if (editar) return;
    const precio = tecnica?.precio ?? null;
    const nuevo = costoAProponer({ actual: totalCostRef.current, ultimoSugerido: costoSugeridoRef.current, precio, hayPresupuesto: presupuesto != null });
    if (nuevo === null) return;
    costoSugeridoRef.current = nuevo === "" ? null : nuevo;
    setCostoSugerido(costoSugeridoRef.current);
    setTotalCost(nuevo);
  }, [tecnica, presupuesto, editar]);
  // El anclaje general y la prescripción/cementado generales SE DERIVAN del plan; esto es solo el valor de
  // arranque si no se elige ningún anclaje por arcada (el modelo lo exige).
  const anchorage = caso ? (vista?.anchorageType ?? "MODERATE") : "MODERATE";
  const [iprRequired, setIprRequired] = useState(caso?.iprRequerido ?? false);
  const [objectives, setObjectives] = useState(caso?.objetivos ?? "AESTHETIC_AND_FUNCTIONAL");
  const [retention, setRetention] = useState(caso?.retencion ?? "");
  const [opcionesPlan, setOpcionesPlan] = useState<OpcionesDelPlan | null>(null);
  const [frecuenciaControl, setFrecuenciaControl] = useState<number>(FRECUENCIA_DE_CONTROL_DIAS_POR_OMISION);
  const [avisoDeTecnica, setAvisoDeTecnica] = useState<string | null>(null);
  const [guardianMode, setGuardianMode] = useState<ModoResponsable>(caso?.responsableId ? "existing" : "none");
  const [responsibleGuardianId, setResponsibleGuardianId] = useState(caso?.responsableId ?? "");
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
  const prefijo = useId();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Lo que llega del servidor ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    getCaseIntakeOptions({ patientId: props.patientId }).then((res) => {
      if (cancelled || isFailure(res)) return;
      setDoctors(res.data.doctors);
      setGuardians(res.data.guardians);
      setReferringDoctors(res.data.referringDoctors);
      setColumnsExist(res.data.columnsExist);
      setModoDeLaClinica(res.data.billingMode);
      // Un caso abierto conserva el modo con el que nació: no se cambia.
      if (!editar) setBillingMode(res.data.billingMode);
      setPuedeCobrar(res.data.puedeCobrar);
      setPrecioControl(res.data.precioControl ?? null);
      // El precio de la colocación arranca con el del catálogo (editable); sin él, se teclea.
      setPrecioColocacion((actual) => (actual !== "" || res.data.precioColocacion == null ? actual : String(res.data.precioColocacion)));
      // Solo las ACTIVAS de la clínica; si quitó todas, el selector queda vacío y el alta lo pide.
      setTecnicas(res.data.tecnicas);
      if (!editar) setTecnicaId((actual) => (res.data.tecnicas.some((x) => x.id === actual) ? actual : (res.data.tecnicas[0]?.id ?? "")));
      if (!editar) {
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

  // Las listas del plan (brackets, alineadores, placas…) y la frecuencia de control son de la clínica.
  useEffect(() => {
    let cancelado = false;
    cargarOpcionesDelPlan()
      .then((r) => {
        if (cancelado || isFailure(r)) return;
        setOpcionesPlan(r.data.opciones);
        setFrecuenciaControl(r.data.frecuenciaControlDias);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  // Al editar, la técnica del caso queda elegida en cuanto llegan las técnicas de la clínica.
  const tecnicaDelCasoLista = useRef(false);
  useEffect(() => {
    if (!editar || !caso || tecnicaDelCasoLista.current || loadingOptions) return;
    const { seleccionadaId } = opcionesDeEdicion(tecnicas, { base: caso.tecnica, label: caso.tecnicaNombrePropio, nombreVisible: caso.tecnicaVisible });
    setTecnicaId(seleccionadaId);
    tecnicaDelCasoLista.current = true;
  }, [editar, caso, tecnicas, loadingOptions]);

  // ── Controles previstos: se PROPONEN (duración ÷ frecuencia de control de la clínica); editable ──────
  const propuestaDeControles = controlesSugeridos(duration, frecuenciaControl);
  const frecuenciaTexto = FRECUENCIAS_DE_CONTROL.find((f) => f.dias === frecuenciaControl)?.texto ?? `Cada ${frecuenciaControl} días`;
  const controlesTocados = useRef(Boolean(vista?.detalle.controlesPrevistos));
  useEffect(() => {
    if (propuestaDeControles === null || controlesTocados.current) return;
    setPlanForm((f) => (f.controles === String(propuestaDeControles) ? f : { ...f, controles: String(propuestaDeControles) }));
  }, [propuestaDeControles]);

  const cambiarPlan = (p: Partial<FormularioDelPlan>) => {
    if ("controles" in p) controlesTocados.current = true;
    setPlanForm((f) => ({ ...f, ...p }));
  };

  // La aparatología que se ofrece sigue a la técnica: al cambiarla se quita lo que ya no aplica y se dice qué.
  const cambiarTecnica = (id: string) => {
    setTecnicaId(id);
    const nueva = listaDeTecnicas.find((x) => x.id === id) ?? null;
    const r = sinAparatologiaIncompatible(planForm, nueva?.base);
    if (r.quitados.length > 0) {
      setPlanForm(r.plan);
      setAvisoDeTecnica(`Se quitaron de «Aparatología» por no aplicar con la nueva técnica: ${r.quitados.join(", ")}.`);
    } else {
      setAvisoDeTecnica(null);
    }
  };

  // ── Lo que falta, dicho para quien llena el formulario ───────────────
  const peticionDelPlan = !inObservation ? formularioAPeticion(planForm) : null;
  const errorDelPlanCompleto = peticionDelPlan && peticionDelPlan.ok === false ? peticionDelPlan.error : null;
  const costo = leerCostoTotal(totalCost);
  const textosCosto = textosDelCosto(billingMode);
  const errorTelefono = errorTelefonoTutor(newGuardianPhone);
  const esPorControl = billingMode === "PAGO_POR_CONTROL";
  const yaPagado = conFactura ? caso!.factura!.pagado : undefined;
  const estadoDelPlan = {
    sinTecnica: tecnica === null,
    sinDoctor: motivoFaltaDoctor({ treatingDoctorId, columnaExiste: columnsExist.treatingDoctorId }) !== null,
    costoTexto: totalCost,
    modo: billingMode,
    modoResponsable: guardianMode,
    tutorElegidoId: responsibleGuardianId,
    tutorNombre: newGuardianName,
    tutorTelefono: newGuardianPhone,
    errorDelPlanCompleto,
    yaPagado,
    despues,
    puedeCobrar,
    precioColocacion,
    enganche,
    numPagos,
    primerPago,
    conFactura: tieneFactura,
  };
  const faltantesDx = faltantesDelDiagnostico({ necesitaDiagnostico: needsDiagnosis, enObservacion: inObservation, resumen: summary, proximaRevision: nextObservationDate });
  const faltantesDelPlan = faltantesDelPlanCompleto(estadoDelPlan);
  const todosLosFaltantes = [...faltantesDelPlan.obligatorios, ...faltantesDelPlan.correcciones];
  const fraseFaltantes = paso === "diagnostico"
    ? (faltantesDx.length > 0 ? `${inObservation ? "Para guardarlo en observación" : "Para continuar"} falta: ${faltantesDx.join("; ")}.` : null)
    : fraseDeLoQueFalta(faltantesDelPlan, editar ? "editar" : "crear");
  // Hasta que llegan las opciones no se sabe si quien abre puede cobrar: el botón espera.
  const canSubmit = todosLosFaltantes.length === 0 && !loadingOptions;
  const seCreaLaFactura = hayQueCrearLaFactura(estadoDelPlan);

  const estadoPlan: EstadoDelPlan = { modo: billingMode, costoTotal: costo, precioColocacion, enganche, numPagos, primerPago };
  const vistaPrevia = vistaPreviaDelPlan(estadoPlan);
  const estimadoDeControles = esPorControl ? estimadoPorControles(Number(planForm.controles) || null, precioControl) : null;

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

  const diagnosticoParaEnviar = (): DrawerNewCaseDiagnosisPayload | null =>
    needsDiagnosis
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
          nextObservationDate: inObservation && nextObservationDate ? new Date(nextObservationDate).toISOString() : null,
        }
      : null;

  const submit = async () => {
    if (paso === "diagnostico") {
      if (faltantesDx.length > 0) return;
      // Un paciente en observación no lleva plan todavía: se guarda solo el diagnóstico.
      if (inObservation) {
        setSubmitting(true);
        setError(null);
        try {
          await props.onConfirm({ diagnosis: diagnosticoParaEnviar(), plan: null, planDePago: null });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error al guardar");
        } finally {
          setSubmitting(false);
        }
        return;
      }
      setPaso("plan");
      return;
    }
    if (!canSubmit || !peticionDelPlan || peticionDelPlan.ok === false) return;
    const costoAGuardar = costoParaGuardar(totalCost);
    const peticion = peticionDelPlan.peticion;
    const planDePago = planDePagoAlAbrir({ ...estadoDelPlan, enObservacion: inObservation });
    setSubmitting(true);
    setError(null);
    try {
      const responsable = {
        responsibleGuardianId: guardianMode === "existing" ? responsibleGuardianId || null : null,
        newResponsibleGuardian:
          guardianMode === "new"
            ? { fullName: newGuardianName.trim(), phone: newGuardianPhone.trim(), parentesco: newGuardianRelation }
            : null,
      };
      if (editar && vista && caso) {
        const eligida = tecnica;
        const base = eligida?.base ?? caso.tecnica;
        const etiqueta = eligida?.id === ID_TECNICA_ACTUAL ? caso.tecnicaNombrePropio : nombrePropioAGuardar(eligida);
        const cambioTecnica = base !== caso.tecnica || (etiqueta ?? null) !== (caso.tecnicaNombrePropio ?? null);
        const cambioCosto = Math.abs(costoAGuardar - (caso.factura?.total ?? caso.costoReferencia)) >= 0.005 && costoAGuardar > 0;
        const ok = await props.onEditar?.({
          treatmentPlanId: vista.treatmentPlanId,
          tecnica: cambioTecnica ? { technique: base, techniqueLabel: etiqueta ?? null } : null,
          columnas: {
            treatmentObjectives: objectives,
            retentionPlanText: retention.trim(),
            treatingDoctorId: treatingDoctorId || null,
            ...responsable,
            ...(soloFecha(caso.colocadoEl) !== installedAt ? { installedAt: installedAt ? new Date(installedAt).toISOString() : null } : {}),
            iprRequired,
          },
          plan: peticion.plan,
          extraccionesIndicadas: peticion.extraccionesIndicadas,
          duracionMeses: peticion.duracionMeses ?? (duration || 18),
          costo: { total: costoAGuardar, cambio: cambioCosto },
          planDePago,
        });
        if (ok === false) return;
        return;
      }
      const diagnosis = diagnosticoParaEnviar();
      const plan: DrawerNewCasePlanPayload = {
        technique: tecnica?.base ?? "METAL_BRACKETS", // sin técnica el alta no se puede confirmar (faltantes)
        techniqueLabel: nombrePropioAGuardar(tecnica),
        estimatedDurationMonths: peticion.duracionMeses ?? 18,
        installedAt: installedAt ? new Date(installedAt).toISOString() : null,
        totalCostMxn: costoAGuardar,
        // Lo indicado en el plan manda sobre lo de siempre; el anclaje por arcada, sobre el general.
        anchorageType: anclajeGeneralDerivado(planForm.anclajeSuperior || null, planForm.anclajeInferior || null) ?? anchorage,
        extractionsRequired: peticion.extraccionesIndicadas.length > 0,
        iprRequired,
        tadsRequired: planPideTads(planForm.aditamentos),
        treatmentObjectives: objectives,
        retentionPlanText: retention.trim(),
        treatingDoctorId: treatingDoctorId || null,
        ...responsable,
        billingMode,
        ...(formularioTocado(planForm) ? { planDetalle: peticion.plan } : {}),
        extractionsTeethFdi: peticion.extraccionesIndicadas,
      };
      await props.onConfirm({ diagnosis, plan, planDePago });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Navegación del paso 2 ────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activa, setActiva] = useState<ClaveDeLaVentana>("tecnica");
  useEffect(() => {
    const raiz = scrollRef.current;
    if (paso !== "plan" || !raiz || typeof IntersectionObserver === "undefined") return;
    const ratios = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) ratios.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        let mejor: ClaveDeLaVentana | null = null;
        let mejorRatio = 0;
        for (const sec of SECCIONES_DE_LA_VENTANA) {
          const r = ratios.get(idDeSeccion(prefijo, sec.clave)) ?? 0;
          if (r > mejorRatio) {
            mejorRatio = r;
            mejor = sec.clave;
          }
        }
        if (mejor) setActiva(mejor);
      },
      { root: raiz, rootMargin: "0px 0px -55% 0px", threshold: [0, 0.1, 0.25, 0.5, 1] },
    );
    for (const sec of SECCIONES_DE_LA_VENTANA) {
      const el = document.getElementById(idDeSeccion(prefijo, sec.clave));
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [paso, prefijo, opcionesPlan, loadingOptions]);
  const irA = (clave: ClaveDeLaVentana) => {
    setActiva(clave);
    document.getElementById(idDeSeccion(prefijo, clave))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const conDatos: Record<ClaveDeLaVentana, boolean> = {
    ...seccionesConDatos(planForm),
    tecnica: tecnica !== null && treatingDoctorId !== "",
    retencion: retention.trim().length > 0,
    cobro: tieneFactura || seCreaLaFactura || costo !== null,
  };

  const titulo = props.etiquetas?.titulo ?? (editar ? "Plan de tratamiento" : needsDiagnosis ? "Diagnóstico y plan de tratamiento" : "Plan de tratamiento");
  const pasos: Array<{ id: PasoDeLaVentana; texto: string; hecho: boolean }> = [
    { id: "diagnostico", texto: "Diagnóstico", hecho: !needsDiagnosis || paso === "plan" },
    { id: "plan", texto: "Plan de tratamiento", hecho: false },
  ];

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
                {props.etiquetas?.ceja ?? (editar ? "Caso de ortodoncia" : "Abrir caso de ortodoncia")}
              </div>
              <h3 id="new-case-title" className={orto.cajonTitulo}>
                {titulo} · {props.patientFullName}
              </h3>
              {needsDiagnosis && !inObservation ? (
                <ol className={planCss.pasos} aria-label="Pasos">
                  {pasos.map((p, i) => (
                    <li key={p.id} className={`${planCss.paso} ${paso === p.id ? planCss.pasoOn : ""} ${p.hecho && paso !== p.id ? planCss.pasoHecho : ""}`} aria-current={paso === p.id ? "step" : undefined}>
                      <span className={planCss.pasoNumero} aria-hidden>{p.hecho && paso !== p.id ? <Check size={12} strokeWidth={2.6} /> : i + 1}</span>
                      {p.texto}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={orto.cajonSub}>
                  {props.etiquetas?.subtitulo ?? (editar
                    ? "Todo lo planeado para el caso, y su cobro, en un solo lugar."
                    : needsDiagnosis
                      ? "Paciente en observación: solo se guarda el diagnóstico."
                      : "Técnica y doctor para abrir; lo demás puedes completarlo después.")}
                </p>
              )}
            </div>
            <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
              <X className="w-5 h-5" aria-hidden />
            </button>
          </header>

          {paso === "diagnostico" ? (
            <div className={alta.cuerpo}>
              {loadingOptions ? (
                <div className="flex items-center gap-2 text-xs text-[color:var(--pr-texto-3)]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Cargando doctores y responsables…
                </div>
              ) : null}

              {/* Datos del CASO (cabecera): quién lo refirió y «en observación». No son del diagnóstico. */}
              <Seccion
                icono={<UserRound size={16} strokeWidth={1.75} />}
                titulo="Datos del caso"
                sub="Quién es el paciente, quién lo refirió y si aún no inicia tratamiento."
              >
                <div className={alta.paciente}>
                  <div>
                    <div className={alta.pacienteRotulo}>Paciente</div>
                    {props.patientFullName}
                  </div>
                </div>
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

              {/* PASO DE DIAGNÓSTICO — punto de entrada del componente de paso de ws1-t8 (sin ventana propia). */}
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
                  <div className={`text-[11px] mt-1 ${summary.trim().length >= 40 ? "text-[color:var(--pr-exito)]" : "text-[color:var(--pr-alerta)]"}`}>
                    {summary.trim().length} / 40 mínimo
                  </div>
                </Field>
              </Seccion>

              {error ? (
                <div className={alta.error} role="alert">
                  {error}
                </div>
              ) : null}
            </div>
          ) : (
            <div className={planCss.popupCuerpo}>
              <nav className={planCss.nav} aria-label="Secciones del plan de tratamiento">
                {SECCIONES_DE_LA_VENTANA.map((sec) => (
                  <button
                    key={sec.clave}
                    type="button"
                    className={`${planCss.navItem} ${activa === sec.clave ? planCss.navItemOn : ""}`}
                    aria-current={activa === sec.clave ? "true" : undefined}
                    aria-label={`${sec.titulo}${conDatos[sec.clave] ? ", con datos" : ", vacía"}`}
                    onClick={() => irA(sec.clave)}
                  >
                    <span className={`${planCss.navPunto} ${conDatos[sec.clave] ? planCss.navPuntoLleno : ""}`} aria-hidden />
                    <span>{sec.titulo}</span>
                  </button>
                ))}
              </nav>

              <div ref={scrollRef} className={planCss.popupScroll}>
                {loadingOptions ? (
                  <div className="flex items-center gap-2 text-xs text-[color:var(--pr-texto-3)]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Cargando doctores y responsables…
                  </div>
                ) : null}
                {editar && vista && !vista.columna ? (
                  <div className={alta.pendiente} role="status">
                    <Info size={15} strokeWidth={1.75} aria-hidden />
                    <span>Falta pegar el SQL de esta parte (sql/ortodoncia-plan-de-tratamiento.sql): el plan completo todavía no se puede guardar.</span>
                  </div>
                ) : null}

                {/* Técnica y doctor: lo ÚNICO obligatorio para abrir el caso */}
                <div id={idDeSeccion(prefijo, "tecnica")}>
                  <Seccion
                    icono={<UserCog size={16} strokeWidth={1.75} />}
                    titulo="Técnica y doctor"
                    sub="Lo único obligatorio para abrir el caso."
                  >
                    <div className={alta.cuadricula}>
                      <Field label="Técnica (obligatoria)">
                        {listaDeTecnicas.length > 0 ? (
                          <Select value={tecnica?.id ?? ""} onChange={cambiarTecnica} options={listaDeTecnicas.map((x) => ({ v: x.id, l: x.nombre }))} />
                        ) : (
                          <p className="text-[11px] text-[color:var(--pr-alerta)]">
                            La clínica no tiene técnicas activas. Agrégalas en Configuración → Técnicas y precios.
                          </p>
                        )}
                      </Field>
                      <Field label="Doctor tratante (obligatorio)">
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
                      <Field label="Objetivos">
                        <Select value={objectives} onChange={setObjectives} options={OBJECTIVE_OPTIONS} />
                      </Field>
                      <Field label="Fecha de colocación (opcional)">
                        <DateField value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} max={hoyMasAniosISO(5)} className={inputCls} aria-label="Fecha de colocación" />
                      </Field>
                    </div>
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
                    <label className="flex items-center gap-2 text-[13px] text-[color:var(--pr-texto-2)]">
                      <input type="checkbox" checked={iprRequired} onChange={(e) => setIprRequired(e.target.checked)} />
                      Requiere IPR (desgaste interproximal)
                    </label>
                    {avisoDeTecnica ? (
                      <p className="text-[11.5px] text-[color:var(--pr-alerta)]" role="status">{avisoDeTecnica}</p>
                    ) : null}
                  </Seccion>
                </div>

                <CamposDelPlan
                  valor={planForm}
                  onCambio={cambiarPlan}
                  opciones={opcionesPlan}
                  tads={vista?.tads ?? 0}
                  conSeguimientoDeAlineadores={vista?.conSeguimientoDeAlineadores ?? false}
                  conRealizadas={editar}
                  prefijo={prefijo}
                  controlesSugeridos={propuestaDeControles !== null ? { valor: propuestaDeControles, frecuencia: frecuenciaTexto } : null}
                  aparatologiaPermitida={aparatologiaPermitida(tecnica?.base)}
                />

                <div id={idDeSeccion(prefijo, "retencion")}>
                  <Seccion
                    icono={<ClipboardList size={16} strokeWidth={1.75} />}
                    titulo="Plan de retención"
                    sub="Opcional: puedes definirlo al llegar a la etapa de retención."
                  >
                    <Field label="Plan de retención">
                      <textarea value={retention} onChange={(e) => setRetention(e.target.value)} placeholder={`Ejemplo: ${EJEMPLO_DE_RETENCION}`} className={`${inputCls} min-h-[70px]`} maxLength={2000} />
                    </Field>
                  </Seccion>
                </div>

                {/* Cobro: el modo, el responsable del pago, el costo y el plan de pago */}
                <div id={idDeSeccion(prefijo, "cobro")}>
                  <Seccion
                    icono={<Wallet size={16} strokeWidth={1.75} />}
                    titulo="Cobro"
                    sub={esPorControl ? "Pago por control: se factura la colocación y cada control al atenderlo." : "Precio total a plazos: se factura el tratamiento completo."}
                  >
                    <div className={alta.subbloque} style={{ borderTop: 0, paddingTop: 0 }}>
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

                    <div className={alta.subbloque}>
                      <h5 className={alta.subtitulo}>Cómo se cobra y cuánto</h5>
                      <div className={alta.cuadricula}>
                        {editar ? (
                          <Field label="Cómo se cobra este caso" hint="Se decidió al abrir el caso: no se cambia con el caso abierto.">
                            <div className={alta.valor}>{ORTHO_BILLING_MODE_LABELS[billingMode]}</div>
                          </Field>
                        ) : (
                          <Field label="Cómo se cobra este caso" hint={pistaDelModoDelCaso(billingMode, modoDeLaClinica)}>
                            <Select
                              value={billingMode}
                              onChange={(v) => setBillingMode(normalizarOrthoBillingMode(v))}
                              options={MODO_DE_COBRO_OPTIONS}
                            />
                          </Field>
                        )}
                        <Field label={textosCosto.rotulo.replace(/ · opcional$/, "")} hint={
                          conFactura
                            ? `Es el total de la factura del tratamiento (ya pagado: ${pesos(caso!.factura!.pagado)}). Con plan a plazos, las mensualidades se recalculan: se te avisa antes de guardar.`
                            : presupuesto && totalCost === String(presupuesto.importe)
                              ? presupuesto.nota
                              : costoSugerido !== null && totalCost === costoSugerido
                                ? "Es el precio de tu tabla para esta técnica (Configuración → Precio por técnica). Cámbialo si este paciente pactó otro."
                                : "Puedes dejarlo vacío y armar el cobro después: el caso se abre sin factura."
                        } htmlFor={idCosto}>
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
                      </div>

                      {tieneFactura ? (
                        <div className={alta.vistaPrevia} role="status">
                          <Receipt size={16} strokeWidth={1.75} aria-hidden />
                          <span>
                            {conFactura ? "Factura del tratamiento" : "Factura de colocación"}: {pesos(caso!.factura!.total)} · pagado {pesos(caso!.factura!.pagado)}. El plan de pagos y los cobros se ven y se cambian en la sección Cobro.
                          </span>
                        </div>
                      ) : loadingOptions ? (
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
                              <span className={alta.casillaTitulo}>Lo armo después</span>
                              <span className={alta.casillaPista}>
                                Crear el plan de pago después: el caso se guarda sin factura. Cuando lo tengas definido, lo armas en Cobro con «Abrir plan de pago».
                              </span>
                            </span>
                          </label>

                          {!despues && esPorControl ? (
                            <>
                              <div className={alta.cuadricula}>
                                <Field
                                  label="Precio de la colocación (MXN)"
                                  hint={precioColocacion.trim() === "" ? "No hay precio de «Colocación de aparatología» en tu catálogo: escríbelo, o déjalo vacío para armarlo después." : "Sale del catálogo de ortodoncia. Cámbialo si este paciente pactó otro."}
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
                                <Field label="Costo total" hint="Lo escribes arriba, en «Cómo se cobra y cuánto».">
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
                                    aria-invalid={faltantesDelPlan.correcciones.some((f) => f.includes("enganche"))}
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
                                    aria-invalid={faltantesDelPlan.correcciones.some((f) => f.includes("número de pagos"))}
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

                      {esPorControl && Number(planForm.controles) > 0 ? (
                        <div className={alta.vistaPrevia} role="status">
                          <Receipt size={16} strokeWidth={1.75} aria-hidden />
                          <span>
                            {estimadoDeControles
                              ? `Estimado: ${textoDelEstimado(estimadoDeControles)}`
                              : `${planForm.controles} controles previstos. Para estimar el total falta el precio de «Control de ortodoncia» en el catálogo.`}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </Seccion>
                </div>

                {error ? (
                  <div className={alta.error} role="alert">
                    {error}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <footer className={alta.pie}>
            {fraseFaltantes ? (
              // (a) El botón gris ya no es un misterio: aquí dice qué falta.
              <span id={idFaltantes} className={`${alta.pieNota} ${alta.pieNotaFalta}`} role="status">
                {fraseFaltantes}
              </span>
            ) : paso === "diagnostico" ? (
              <span className={`${alta.pieNota} inline-flex items-center gap-1`}>
                <ListChecks className="w-3 h-3 shrink-0" aria-hidden /> {inObservation ? "Queda dentro de la ficha del paciente" : "Sigue el plan de tratamiento: solo la técnica y el doctor son obligatorios."}
              </span>
            ) : (
              <span className={`${alta.pieNota} inline-flex items-center gap-1`}>
                <Receipt className="w-3 h-3 shrink-0" aria-hidden /> {notaDelCobro({ enObservacion: inObservation, puedeCobrar, despues, conFactura: tieneFactura, seCreaLaFactura, modo: editar ? "editar" : "crear" })}
              </span>
            )}
            <div className={alta.pieBotones}>
              <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
              {paso === "plan" && needsDiagnosis ? (
                <Btn variant="secondary" size="md" icon={<ArrowLeft className="w-3.5 h-3.5" aria-hidden />} onClick={() => setPaso("diagnostico")}>Atrás</Btn>
              ) : null}
              <Btn
                variant="primary"
                size="md"
                onClick={submit}
                disabled={paso === "diagnostico" ? faltantesDx.length > 0 || submitting : !canSubmit || submitting}
                aria-describedby={fraseFaltantes ? idFaltantes : undefined}
                icon={paso === "diagnostico" && !inObservation ? <ArrowRight className="w-3.5 h-3.5" aria-hidden /> : undefined}
              >
                {submitting
                  ? "Guardando…"
                  : paso === "diagnostico"
                    ? inObservation ? "Guardar en observación" : "Siguiente: plan de tratamiento"
                    : (props.etiquetas?.guardar ?? (editar ? "Guardar plan" : "Abrir caso"))}
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
