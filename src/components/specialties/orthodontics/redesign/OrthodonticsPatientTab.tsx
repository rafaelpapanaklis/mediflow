"use client";

// Ortodoncia — Ola 0 (ws1-t1): el cableado de la pestaña «Ortodoncia» de la
// ficha del paciente, sacado tal cual de `patient-detail-client.tsx`
// (líneas ~2010-2652 antes de este movimiento — ver REPORTE-ws1-t1.md).
// Movimiento MECÁNICO: mismas props, mismos handlers, mismo comportamiento.
// A partir de aquí, patient-detail-client.tsx NO vuelve a tocar ortodoncia:
// cada parte de la Ola 1 trabaja en este archivo o en los suyos propios
// (ver «MAPA DE PARTES», REPORTE-ws1-t1.md), nunca en la ficha compartida.
//
// Mantiene la MISMA carga perezosa que tenía en patient-detail-client.tsx:
// los dos `next/dynamic` de abajo (Fase 1 rediseño + fallback legacy) siguen
// siendo el punto de corte del bundle — moverlos aquí no cambia qué se
// descarga ni cuándo.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamicImport from "next/dynamic";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { useTextosFirmaControl } from "./textos-firma-control";
import { getInitials } from "@/lib/utils";
import { ageFromDob } from "@/lib/format";
import type { OrthoTabData } from "@/lib/orthodontics/load-data";
import { labelParentesco } from "@/lib/consent/default-signer";
import type { OrthoRedesignViewModel } from "./types";
import type { OrthoRedesignBundle } from "@/lib/orthodontics/redesign/loader";
import {
  signTreatmentCard,
  saveTreatmentCardDraft,
  createOrthoTAD,
  addWireStep,
  advanceTreatmentPhase,
  selectQuoteScenario,
  sendSignAtHomeLink,
  confirmCollect,
  createOrthoLabOrder,
  toggleRetentionPreSurvey,
  createPhotoSet,
  uploadPhotoToSet,
  updateFinancialPlan,
  updateDiagnosis,
  updateOrthoAppliances,
  createReferralLetter,
  updateRetentionRegimenConfig,
  updateNpsConfig,
  scheduleG15Checkpoint,
  updateQuoteScenario,
  createDiagnosis,
  createTreatmentPlan,
  updateTreatmentPlan,
  getCaseIntakeOptions,
} from "@/app/actions/orthodontics";
import { moverControlesFuturosAlDoctor } from "@/app/actions/orthodontics/moverControlesFuturosAlDoctor";
import { isFailure, type ActionResult } from "@/app/actions/orthodontics/result";
import { vistaDePestanaOrto } from "@/lib/orthodontics/pestana-ficha";
import { RUTA_CONTRATAR_ORTODONCIA } from "@/lib/orthodontics/contratar";
import { alergiasReales } from "@/lib/alergias-reales";
import { estadoSalud, saludPendiente, type EstadoCuestionario } from "@/lib/patients/salud-capturada";
import { textoAsentimientoMenor } from "@/lib/orthodontics/asentimiento-menor";
import { elegirSetParaFoto } from "@/lib/orthodontics/redesign/set-de-foto-por-visita";
import { agregarFotoExtra } from "@/app/actions/orthodontics/fotosDelJuego";
import { esVistaEnExtras } from "@/lib/orthodontics/fotos-del-juego";
import { OrtodonciaSinCaso } from "./OrtodonciaSinCaso";
import { CasosMigrados } from "./CasosMigrados";
import { DrawerNewCase, type DrawerEditarPlanSubmit, type DrawerNewCaseSubmit } from "./drawers/DrawerNewCase";
import { guardarPlanDeTratamiento } from "@/app/actions/orthodontics/guardarPlanDeTratamiento";
import { guardarDiagnosticoYPlan } from "@/app/actions/orthodontics/guardarDiagnosticoYPlan";
import { olvidarDiagnosticoCompleto } from "./diagnostico/useDiagnosticoCompleto";
import { cambiarCostoDelCaso } from "@/app/actions/orthodontics/cobro/cambiarCostoDelCaso";
import { crearPlanDelCaso } from "@/app/actions/orthodontics/cobro/crearPlanDelCaso";
import { Btn } from "./atoms/Btn";
import orto from "./orto.module.css";
import { RAIZ_ORTO } from "./raiz";

// Fallback de carga de los módulos lazy — idéntico al de
// patient-detail-client.tsx (componente cliente para poder traducir con
// useT dentro del árbol que ya tiene el I18nProvider).
function ModuleLoading({ labelKey }: { labelKey: string }) {
  const t = useT();
  // Ocupa el alto de la cabecera del paciente: cuando el módulo termina de
  // bajar, lo de debajo no da un salto.
  return (
    <div className={`${RAIZ_ORTO} ${orto.lienzo}`} role="status" aria-live="polite">
      <div
        className={`${orto.cabecera} ${orto.tonoApagado} flex items-center justify-center text-xs`}
        style={{ minHeight: 168 }}
      >
        {t(labelKey)}
      </div>
    </div>
  );
}

// Fase 1 rediseño usa OrthodonticsRedesignClient (Hero + Diagnóstico + Plan +
// Treatment Card G1 + drawers + sidebar derecha). Fallback al cliente legacy
// `OrthodonticsClient` cuando no hay viewModel.
const OrthodonticsRedesignClient = dynamicImport(
  () =>
    import("./OrthodonticsRedesignClient").then(
      (m) => ({ default: m.OrthodonticsRedesignClient }),
    ),
  {
    ssr: false,
    loading: () => (
      <ModuleLoading labelKey="moduleLoading.orthodontics" />
    ),
  },
);

const OrthodonticsClient = dynamicImport(
  () =>
    import("@/components/specialties/orthodontics/OrthodonticsClient").then((m) => ({
      default: m.OrthodonticsClient,
    })),
  {
    ssr: false,
    loading: () => (
      <ModuleLoading labelKey="moduleLoading.orthodonticsLegacy" />
    ),
  },
);

// resolveFileUrl es función — no se puede pasar de server a client. Este
// archivo ya es "use client" (igual que antes en patient-detail-client.tsx),
// mismo patrón que /dashboard/patients/[id]/orthodontics/page.tsx.
function resolveOrthoFileUrl(fileId: string): string {
  return `/api/patient-files/${fileId}`;
}

// Mapeo slotId del SectionPhotos → OrthoPhotoView del API. Solo las 8 vistas
// AAO persistibles tienen mapeo; sobremordida y resalte (extra-AAO) no
// tienen columna en OrthoPhotoSet y se documentan como Fase 2.
const SLOT_TO_VIEW: Record<
  string,
  | "EXTRA_FRONTAL"
  | "EXTRA_PROFILE"
  | "EXTRA_SMILE"
  | "INTRA_FRONTAL_OCCLUSION"
  | "INTRA_LATERAL_RIGHT"
  | "INTRA_LATERAL_LEFT"
  | "INTRA_OCCLUSAL_UPPER"
  | "INTRA_OCCLUSAL_LOWER"
> = {
  normal: "EXTRA_FRONTAL",
  lateral: "EXTRA_PROFILE",
  sonrisa: "EXTRA_SMILE",
  frontal: "INTRA_FRONTAL_OCCLUSION",
  lat_der: "INTRA_LATERAL_RIGHT",
  lat_izq: "INTRA_LATERAL_LEFT",
  oclusal_sup: "INTRA_OCCLUSAL_UPPER",
  oclusal_inf: "INTRA_OCCLUSAL_LOWER",
};

export interface OrthodonticsPatientTabPatient {
  id: string;
  firstName: string;
  lastName: string;
  dob: string | Date | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  bloodType: string | null;
  allergies: unknown;
}

export interface OrthodonticsPatientTabProps {
  patient: OrthodonticsPatientTabPatient;
  fullName: string;
  // `appointments` es `any[]` en patient-detail-client.tsx (sin tipar):
  // `date` viaja tal cual venga del server component, sin garantía de forma.
  nextAppt: { id: string; date: any } | undefined;
  lastAppt: { date: any } | undefined;
  completedCount: number;
  pediatricsModuleActive: boolean;
  /** Interruptor `menu-dos-niveles`. Ya no decide nada aquí: el módulo viste
   *  el idioma nuevo por sí mismo (ver más abajo). Se conserva en la firma
   *  para no tocar a quien monta la pestaña. */
  rediseno: boolean;
  orthoData: OrthoTabData | null | undefined;
  /**
   * La sede ya no tiene el módulo pero este paciente tiene o tuvo un caso:
   * se enseña para LEER (NOM-004: el expediente no se oculta) y no se ofrece
   * abrir otro caso. Crear y cobrar los rechaza además el servidor.
   */
  soloLectura?: boolean;
  /** ws1-t2 (12h): frescura del cuestionario de salud; sin él (o vencido) la cabecera avisa «Salud sin capturar». */
  questionnaireStatus?: EstadoCuestionario | null;
  orthoRedesignVM: OrthoRedesignViewModel | null | undefined;
  orthoRedesignBundle: OrthoRedesignBundle | null | undefined;
  /** Antes `() => setTab("agenda")` en patient-detail-client.tsx. */
  onScheduleNext: () => void;
  /** Antes `openBillingTab` en patient-detail-client.tsx. */
  onCollect: () => void;
  /**
   * Se llegó desde «Nueva consulta» eligiendo el tipo «Ortodoncia» (Rafael,
   * 28-sep-2026): la hoja de control se abre sola al entrar, la misma de
   * «Registrar control». Sin caso con el que registrar un control no abre
   * nada: la pestaña ya ofrece lo que toca (abrir el caso).
   */
  abrirControlAlEntrar?: boolean;
  /** La pestaña ya atendió el aviso: que la ficha lo apague. */
  onControlAbierto?: () => void;
  /**
   * ws1-t8 (ticket BEVADENT, punto 3): la cita de la consulta en curso. La hoja se liga a ella y, al firmarla, la
   * consulta queda cerrada con la nota de la hoja (una sola nota por visita).
   */
  citaEnCursoId?: string | null;
  /** La firma de la hoja cerró la cita de la consulta en curso: que la ficha cierre la consulta sin pedir otra nota. */
  onConsultaCerradaPorLaHoja?: (appointmentId: string) => void;
  /**
   * ws1-t8 (revisión de ws1-t9, fallo 3): la cita de `?appointment=` aunque no esté en curso (p. ej. la del 6-oct
   * abierta hoy con «Iniciar consulta»). La hoja la recibe para AVISAR, antes de firmar, que esa cita no se toca.
   */
  citaDeLaDireccionId?: string | null;
  /** «Iniciar visita»: el mismo «Iniciar consulta» de la cabecera (arranca la cita de hoy). */
  onIniciarConsulta?: () => void;
}

/** La pestaña «Ortodoncia» completa: banda de rediseño + ficha nueva o legacy. */
export function OrthodonticsPatientTab(props: OrthodonticsPatientTabProps) {
  const {
    patient,
    fullName,
    nextAppt,
    lastAppt,
    completedCount,
    pediatricsModuleActive,
    orthoData,
    soloLectura = false,
    questionnaireStatus = null,
    orthoRedesignVM,
    orthoRedesignBundle,
    onScheduleNext,
    onCollect,
    abrirControlAlEntrar,
    onControlAbierto,
    citaEnCursoId,
    onConsultaCerradaPorLaHoja,
    citaDeLaDireccionId,
    onIniciarConsulta,
  } = props;
  const textosFirma = useTextosFirmaControl();
  const router = useRouter();
  const t = useT();

  // Ola 1 (ws1-t6) — A10: si ya hay diagnóstico, pregunta una sola vez si
  // existe un consentimiento GENERAL de ortodoncia firmado (no bloquea el
  // render mientras llega: el banner solo aparece cuando la respuesta es
  // explícitamente `false`, nunca en `null`/cargando).
  const [generalConsentSigned, setGeneralConsentSigned] = useState<boolean | null>(null);
  const diagnosisId = orthoRedesignVM?.diagnosis?.id ?? null;
  // ws1-t10 (F "Termina y regresa") — abrir un caso NUEVO cuando el último ya
  // cerró (terminado o abandono). Ver el aviso más abajo, antes de `return`.
  const [abrirNuevoCasoTrasCierre, setAbrirNuevoCasoTrasCierre] = useState(false);

  const refetchGeneralConsentSigned = useCallback(async () => {
    if (!diagnosisId) return;
    const res = await getCaseIntakeOptions({ patientId: patient.id });
    if (!isFailure(res)) setGeneralConsentSigned(res.data.generalConsentSigned);
  }, [patient.id, diagnosisId]);

  useEffect(() => {
    if (!diagnosisId) {
      setGeneralConsentSigned(null);
      return;
    }
    let cancelled = false;
    getCaseIntakeOptions({ patientId: patient.id }).then((res) => {
      if (!cancelled && !isFailure(res)) setGeneralConsentSigned(res.data.generalConsentSigned);
    });
    return () => {
      cancelled = true;
    };
  }, [patient.id, diagnosisId]);

  // H12 (QA ws1-t9): la firma del consentimiento GENERAL ocurre FUERA de esta
  // pestaña — en la liga pública que firma la tutora desde su teléfono, o en
  // otra pestaña del mostrador — así que el aviso «Falta el consentimiento…»
  // se quedaba diciendo que faltaba aunque ya se hubiera firmado, hasta un F5.
  // Mismo criterio que ya usa la pestaña «Consentimientos»
  // (`consents-tab.tsx`, "Refresco en vivo"): recargar al recuperar el foco
  // cubre el caso de la tableta sin pedirle nada a nadie, y el sondeo cada
  // 30s SOLO mientras el aviso siga activo evita tráfico de fondo perpetuo.
  useEffect(() => {
    if (!diagnosisId) return;
    const refetch = () => {
      if (document.visibilityState !== "visible") return;
      void refetchGeneralConsentSigned();
    };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, [diagnosisId, refetchGeneralConsentSigned]);

  useEffect(() => {
    if (!diagnosisId || generalConsentSigned !== false) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refetchGeneralConsentSigned();
    }, 30_000);
    return () => clearInterval(timer);
  }, [diagnosisId, generalConsentSigned, refetchGeneralConsentSigned]);

  // Abrir el caso: lo usan las dos caras de la pestaña — la completa (el
  // asistente que abre `OrthodonticsRedesignClient`) y la limpia del paciente
  // que nunca tuvo caso (`OrtodonciaSinCaso`).
  const crearCaso = async (payload: DrawerNewCaseSubmit): Promise<boolean> => {
    let diagnosisId = orthoRedesignVM?.diagnosis?.id ?? null;
    // Abrir el caso es UNA acción: con diagnóstico y plan juntos, las filas del diagnóstico quedan solo en la bitácora y
    // Movimientos muestra una («Abrió el caso de ortodoncia: …», la escribe createTreatmentPlan).
    const juntoConElPlan = Boolean(payload.diagnosis && payload.plan);
    const pasoDelAlta = juntoConElPlan ? { parteDeUnaAccion: true } : {};
    if (payload.diagnosis) {
      const res = await createDiagnosis({ patientId: patient.id, ...payload.diagnosis, ...pasoDelAlta });
      if (isFailure(res)) {
        toast.error(res.error);
        return false;
      }
      diagnosisId = res.data.id;
      // ws1-t8: el diagnóstico COMPLETO (facial, oclusal, funcional, cefalometría…) se guarda enseguida con el mismo
      // servidor que «Editar diagnóstico». Si no se pudo, el caso sigue: se dice y se completa desde el resumen.
      if (payload.diagnosis.detalle) {
        const detalle = await updateDiagnosis({ diagnosisId, ...payload.diagnosis.detalle, ...pasoDelAlta });
        if (isFailure(detalle)) {
          toast(`El diagnóstico se creó, pero el detalle no se guardó: ${detalle.error} Complétalo con «Editar diagnóstico».`, { duration: 12000 });
        } else if (detalle.data.avisoDetalle) {
          toast(detalle.data.avisoDetalle, { duration: 12000 });
        }
      }
      if (
        !res.data.altaCasoFieldsSaved &&
        (payload.diagnosis.referredByDoctorId || payload.diagnosis.inObservation)
      ) {
        toast(t("patients.ortho.altaCasoSqlPending"));
      }
    }
    if (!diagnosisId) {
      toast.error(t("patients.ortho.noPlan"));
      return false;
    }
    if (payload.plan) {
      const res = await createTreatmentPlan({
        diagnosisId,
        patientId: patient.id,
        ...payload.plan,
        ...pasoDelAlta,
        // A plazos, el resumen de toda la apertura lo escribe `crearPlanDelCaso` (la última llamada).
        ...(payload.planDePago ? { sigueElPlanDePago: true } : {}),
      });
      if (isFailure(res)) {
        toast.error(res.error);
        return false;
      }
      if (!res.data.altaCasoFieldsSaved && (payload.plan.treatingDoctorId || payload.plan.responsibleGuardianId || payload.plan.newResponsibleGuardian)) {
        toast(t("patients.ortho.altaCasoSqlPending"));
      }
      // ws1-t12: el plan de tratamiento completo no se pudo guardar (falta el SQL): el caso ya está abierto.
      if (res.data.avisoPlanDetalle) toast(res.data.avisoPlanDetalle, { duration: 12000 });
      // ws1-t10: «Pago por control» sin costo escrito: el que quedó guardado es un estimado, y se dice.
      if (res.data.avisoCosto) toast(res.data.avisoCosto, { duration: 12000 });
      // ws1-t10: el plan de pago se arma al abrir el caso. El caso YA está abierto: si la factura
      // no sale, se dice claro y Cobro sigue ofreciendo «Abrir plan de pago» para reintentar.
      if (payload.planDePago) {
        const cobro = await crearPlanDelCaso({
          treatmentPlanId: res.data.id,
          ...payload.planDePago,
          aperturaDelCaso: { diagnostico: juntoConElPlan, detalleDelPlan: Boolean(payload.plan.planDetalle) },
        });
        if (isFailure(cobro)) {
          toast.error(`El caso se abrió, pero el plan de pago no se pudo crear: ${cobro.error} Reinténtalo en Cobro, con «Abrir plan de pago».`, { duration: 12000 });
        } else if (cobro.data.aviso) {
          toast.success(t("patients.ortho.caseOpened"));
          toast(cobro.data.aviso, { duration: 12000 });
        } else {
          toast.success(cobro.data.invoiceNumber ? `Caso abierto y plan de pago creado (${cobro.data.invoiceNumber}).` : "Caso abierto y plan de pago creado.");
        }
      } else {
        toast.success(t("patients.ortho.caseOpened"));
      }
    } else {
      toast.success(t("patients.ortho.caseOpenedObservation"));
    }
    router.refresh();
    // ws1-t10 (D): true = el caso quedó abierto; la vista «sin caso» lo dice al instante en vez
    // de seguir con «no tiene caso» hasta que llega la ficha refrescada.
    return true;
  };

  // ws1-t12 — «Editar» de la ventana única del caso: guarda en pasos (técnica → doctor y columnas → plan completo →
  // costo y factura), cada uno con sus reglas y su permiso, y dice cuál falló. Devuelve `false` si algo no se guardó
  // (la ventana se queda abierta con lo escrito; volver a guardar repite los pasos sin dañar nada).
  const editarPlan = async (p: DrawerEditarPlanSubmit): Promise<boolean> => {
    const id = p.treatmentPlanId;
    if (p.tecnica) {
      const r = await updateOrthoAppliances({ treatmentPlanId: id, technique: p.tecnica.technique, techniqueLabel: p.tecnica.techniqueLabel });
      if (isFailure(r)) {
        toast.error(r.error);
        return false;
      }
    }
    // Sin cambios en estas columnas no se llama: cada llamada deja su propio movimiento «Actualizó el plan…».
    if (p.columnasCambiaron) {
      const cols = await updateTreatmentPlan({
        treatmentPlanId: id,
        treatmentObjectives: p.columnas.treatmentObjectives as never,
        retentionPlanText: p.columnas.retentionPlanText,
        treatingDoctorId: p.columnas.treatingDoctorId,
        responsibleGuardianId: p.columnas.responsibleGuardianId,
        newResponsibleGuardian: p.columnas.newResponsibleGuardian as never,
        iprRequired: p.columnas.iprRequired,
        ...(p.columnas.installedAt !== undefined ? { installedAt: p.columnas.installedAt } : {}),
      });
      if (isFailure(cols)) {
        toast.error(cols.error);
        return false;
      }
      if (!cols.data.altaCasoFieldsSaved && (p.columnas.treatingDoctorId || p.columnas.responsibleGuardianId || p.columnas.newResponsibleGuardian)) {
        toast(t("patients.ortho.altaCasoSqlPending"));
      }
      // F «Cambio de doctor»: los controles YA agendados se quedaban con el doctor anterior. Se ofrece pasarlos.
      if (cols.data.controlesConOtroDoctor > 0) {
        const n = cols.data.controlesConOtroDoctor;
        const pasar = window.confirm(
          `${n === 1 ? "Hay 1 control futuro agendado" : `Hay ${n} controles futuros agendados`} con el doctor anterior. ¿Pasarlo${n === 1 ? "" : "s"} al doctor nuevo? Solo se pasan los que no chocan con su agenda.`,
        );
        if (pasar) {
          const m = await moverControlesFuturosAlDoctor({ treatmentPlanId: id });
          if (isFailure(m)) toast.error(m.error);
          else toast.success(`${m.data.movidos} control${m.data.movidos === 1 ? "" : "es"} pasado${m.data.movidos === 1 ? "" : "s"} al doctor nuevo` + (m.data.conChoque > 0 ? `; ${m.data.conChoque} chocan con su agenda y se quedaron como estaban.` : "."));
        }
      }
    }
    const datosDelPlan = { treatmentPlanId: id, plan: p.plan, extraccionesIndicadas: p.extraccionesIndicadas, duracionMeses: p.duracionMeses };
    if (p.diagnostico) {
      // Diagnóstico y plan completo en UNA transacción: o se guardan los dos o ninguno.
      const junto = await guardarDiagnosticoYPlan({ ...datosDelPlan, diagnosisId: p.diagnostico.diagnosisId, diagnostico: p.diagnostico.peticion });
      if (isFailure(junto)) {
        toast.error(junto.error);
        return false;
      }
      olvidarDiagnosticoCompleto(p.diagnostico.diagnosisId);
      if (junto.data.aviso) toast(junto.data.aviso, { duration: 12000 });
      if (!junto.data.planGuardado) {
        router.refresh();
        return false;
      }
    } else {
      const plan = await guardarPlanDeTratamiento(datosDelPlan);
      if (isFailure(plan)) {
        toast.error(plan.error);
        return false;
      }
    }
    let todoBien = true;
    if (p.costo.cambio) {
      // Con factura, el costo sigue las reglas de «editar factura con pagos»: no bajar de lo pagado y avisar el recálculo.
      let costo = await cambiarCostoDelCaso({ treatmentPlanId: id, nuevoTotal: p.costo.total });
      if (!isFailure(costo) && costo.data.estado === "avisar") {
        if (window.confirm(`${costo.data.texto}\n\n¿Guardar el costo nuevo de todos modos?`)) {
          costo = await cambiarCostoDelCaso({ treatmentPlanId: id, nuevoTotal: p.costo.total, planAvisado: true });
        } else {
          toast("El plan se guardó; el costo quedó como estaba.");
          todoBien = false;
        }
      }
      if (isFailure(costo)) {
        toast.error(`El plan se guardó, pero el costo no: ${costo.error}`);
        todoBien = false;
      }
    }
    if (todoBien && p.planDePago) {
      const cobro = await crearPlanDelCaso({ treatmentPlanId: id, ...p.planDePago });
      if (isFailure(cobro)) {
        toast.error(`El plan se guardó, pero el plan de pago no se pudo crear: ${cobro.error} Reinténtalo en Cobro, con «Abrir plan de pago».`, { duration: 12000 });
        todoBien = false;
      } else if (cobro.data.aviso) {
        toast(cobro.data.aviso, { duration: 12000 });
      }
    }
    if (todoBien) toast.success("Plan de tratamiento guardado.");
    router.refresh();
    return todoBien;
  };

  // Qué cara toca (decisión de Rafael, 28-sep-2026; la regla y sus tests, en
  // src/lib/orthodontics/pestana-ficha.ts). `orthoData` solo llega cuando la
  // sede tiene el módulo; su `plan` es el último del paciente, en el estado
  // que sea, y su `diagnosis`, el último diagnóstico.
  const vista = vistaDePestanaOrto({
    moduloActivo: orthoData !== null && orthoData !== undefined,
    tienePlan: Boolean(orthoData?.plan),
    tieneDiagnostico: Boolean(orthoData?.diagnosis),
  });
  if (vista === "oculta") return null;
  if (vista === "solo-abrir-caso") {
    return (
      <OrtodonciaSinCaso
        patientId={patient.id}
        patientFullName={fullName}
        onCreateCase={crearCaso}
        vieneDeNuevaConsulta={abrirControlAlEntrar}
        onAvisoAtendido={onControlAbierto}
      />
    );
  }

  return (
    <>
      {/* ws1-t10 (F "Termina y regresa") — antes no había forma de abrir un
          SEGUNDO caso: la ficha solo sabía enseñar el último plan, y con
          cualquiera existente (incluido uno terminado o abandonado) el alta
          nunca se ofrecía. Con el caso último ya cerrado, se ofrece un
          diagnóstico y plan NUEVOS — el viejo (fotos, consentimientos,
          controles, factura) se queda ligado a SU plan, tal cual como está;
          esto solo abre uno adicional, no lo reemplaza. */}
      {soloLectura && (
        <div role="status" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--pr-borde-suave)", background: "var(--pr-fondo-2)" }}>
          <span className="text-xs text-[color:var(--pr-texto-2)]">
            <strong>Solo lectura.</strong> El módulo de Ortodoncia no está activo en esta sede: el expediente se conserva y se puede consultar, pero no se pueden registrar controles, abrir casos ni cobrar hasta que se vuelva a contratar.
          </span>
          <a className="text-xs underline" href={RUTA_CONTRATAR_ORTODONCIA}>Ver cómo volver a contratarlo</a>
        </div>
      )}
      {!soloLectura && (orthoData?.plan?.status === "COMPLETED" || orthoData?.plan?.status === "DROPPED_OUT") && (
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--pr-borde-suave)", background: "var(--pr-fondo-2)" }}>
          <span className="text-xs text-[color:var(--pr-texto-3)]">
            {orthoData?.plan?.status === "COMPLETED" ? "Este caso terminó." : "Este caso se marcó como abandono."} Si regresa por un tratamiento nuevo, ábrele otro caso.
          </span>
          <Btn variant="secondary" size="sm" onClick={() => setAbrirNuevoCasoTrasCierre(true)}>
            Abrir un caso nuevo
          </Btn>
        </div>
      )}
      {abrirNuevoCasoTrasCierre && (
        <DrawerNewCase
          patientId={patient.id}
          patientFullName={fullName}
          existingDiagnosisId={null}
          onClose={() => setAbrirNuevoCasoTrasCierre(false)}
          onConfirm={async (payload) => {
            await crearCaso(payload);
            setAbrirNuevoCasoTrasCierre(false);
          }}
        />
      )}
      {/* La banda «Ortodoncia · paciente» (hallazgo 21) era el escalón entre
          la ficha nueva y un módulo que conservaba su ropa vieja. El módulo
          ya habla el idioma de la ficha y abre con la cabecera del paciente,
          así que la banda repetía el nombre una tercera vez y empujaba el
          contenido 75 px: se deja de montar (SalidaOrtodoncia sigue en su
          archivo). */}
      {orthoRedesignVM && (
        <OrthodonticsRedesignClient
          vm={orthoRedesignVM}
          digitalRecords={orthoData?.digitalRecords?.map((r: any) => {
            const RECORD_LABEL: Record<string, string> = {
              CEPH_ANALYSIS_PDF: t("patients.ortho.recordCeph"),
              SCAN_STL: t("patients.ortho.recordStl"),
            };
            const RECORD_KIND: Record<string, "ceph" | "stl" | "pano" | "other"> = {
              CEPH_ANALYSIS_PDF: "ceph",
              SCAN_STL: "stl",
            };
            return {
              label: r.notes ?? RECORD_LABEL[r.recordType] ?? r.recordType,
              date: r.capturedAt instanceof Date
                ? r.capturedAt.toISOString()
                : (typeof r.capturedAt === "string" ? r.capturedAt : null),
              kind: RECORD_KIND[r.recordType] ?? "other",
            };
          }).concat(
            // H56: también lo que ya está en el expediente (Radiografías).
            (orthoData?.archivosDelPaciente ?? []).map((a) => ({
              label: a.name,
              date: a.date,
              kind: (a.category === "XRAY_PANORAMIC"
                ? "pano"
                : a.category === "XRAY_CEPHALOMETRIC" || a.category === "CEPH_ANALYSIS_PDF"
                  ? "ceph"
                  : a.category === "SCAN_STL"
                    ? "stl"
                    : "other") as "pano" | "ceph" | "stl" | "other",
            })),
          ) ?? []}
          historicalPhotoSets={orthoRedesignBundle?.historicalPhotoSets ?? []}
          installments={orthoRedesignBundle?.installments ?? []}
          quoteScenarios={orthoRedesignBundle?.quoteScenarios ?? []}
          cfdiRecords={orthoRedesignBundle?.cfdiRecords ?? []}
          retentionRegimen={orthoRedesignBundle?.retentionRegimen ?? null}
          retainerCheckups={orthoRedesignBundle?.retainerCheckups ?? []}
          npsSchedules={orthoRedesignBundle?.npsSchedules ?? []}
          referralCode={orthoRedesignBundle?.referralCode ?? null}
          labOrders={orthoRedesignBundle?.labOrders ?? []}
          consents={orthoRedesignBundle?.consents ?? []}
          referralLetters={orthoRedesignBundle?.referralLetters ?? []}
          whatsappLog={orthoRedesignBundle?.whatsappLog ?? []}
          treatmentStatus={orthoRedesignBundle?.treatmentStatus ?? "en-tratamiento"}
          generalConsentSigned={generalConsentSigned}
          financialPlan={orthoRedesignBundle?.financialPlan ?? null}
          onUpdateFinancialPlan={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await updateFinancialPlan({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              ...payload,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(
              t("patients.ortho.financialPlanUpdated", {
                count: res.data.installmentCount,
                amount: res.data.installmentAmount.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }),
              }),
            );
            router.refresh();
          }}
          canOverridePhase={true}
          patientHeader={{
            patient: {
              id: patient.id,
              fullName: fullName,
              avatarInitials: getInitials(patient.firstName, patient.lastName),
              age: patient.dob ? ageFromDob(new Date(patient.dob)) : null,
              sex:
                patient.gender === "F"
                  ? "F"
                  : patient.gender === "M"
                    ? "M"
                    : patient.gender === "OTHER"
                      ? "X"
                      : null,
              phone: patient.phone ?? null,
              email: patient.email ?? null,
              bloodType: patient.bloodType ?? null,
              // ws1-t10 (H·F "Menor con tutor"): con responsable de pago real
              // (A11) el rótulo lleva SU parentesco («madre», «tutor legal»),
              // no la palabra genérica "(tutor)" de siempre.
              guardianLabel: orthoData?.guardianName
                ? orthoData.responsibleGuardianRelation
                  ? `${orthoData.guardianName} (${labelParentesco(orthoData.responsibleGuardianRelation)})`
                  : t("patients.ortho.guardianLabel", { name: orthoData.guardianName })
                : null,
              criticalAllergies:
                alergiasReales(patient.allergies).join(", ") || null,
              estadoSalud: estadoSalud(questionnaireStatus),
            },
            // outstandingAmount ya no se calcula aquí (hallazgo ws1-t4 §5):
            // OrthodonticsRedesignClient lee la factura real del caso vía
            // cargarPanelDeCobro, no `treatment.totalCost - treatment.paid`
            // (el precio de referencia, que decía "$45,000 Pendiente" sin
            // que existiera ninguna factura).
            // En tab Ortodoncia, derivamos lastVisitAt y totalVisits del
            // modelo OrthodonticControlAppointment (visitas reales del tx
            // ortodóntico), no del Appointment genérico.
            //
            // ws1-t4 ronda 6 (fila 8): ese modelo ya no se llena — los
            // controles viven en la Agenda y en las hojas —, así que la
            // cabecera decía «0 visitas» a un paciente que viene cada mes.
            // Con `vm.visitas` (citas de control atendidas + hojas, sin
            // contar dos veces la misma visita) manda ese dato; lo de abajo
            // queda solo para una vista armada sin él.
            lastVisitAt: orthoRedesignVM.visitas ? orthoRedesignVM.visitas.ultima : (() => {
              const performed = (orthoData?.controls ?? []).filter(
                (c: any) => c.performedAt,
              );
              if (performed.length === 0) return lastAppt?.date ?? null;
              performed.sort(
                (a: any, b: any) =>
                  new Date(b.performedAt).getTime() -
                  new Date(a.performedAt).getTime(),
              );
              return performed[0].performedAt instanceof Date
                ? performed[0].performedAt.toISOString()
                : performed[0].performedAt;
            })(),
            totalVisits: {
              count: orthoRedesignVM.visitas
                ? orthoRedesignVM.visitas.total
                : (orthoData?.controls ?? []).filter(
                    (c: any) => c.attendance === "ATTENDED" && c.performedAt,
                  ).length || completedCount,
              sinceLabel: orthoRedesignVM.treatment.startDate
                ? t("patients.ortho.sinceLabel", { date: new Date(orthoRedesignVM.treatment.startDate).toLocaleDateString("es-MX", { month: "short", year: "numeric" }) })
                : null,
            },
            onStartVisit: () => {
              if (nextAppt && onIniciarConsulta) onIniciarConsulta();
              else if (nextAppt) router.push(`?appointment=${nextAppt.id}`);
              else toast(t("patients.ortho.scheduleApptFirst"));
            },
            onScheduleNext,
            onCollect,
            onMore: undefined,
          }}
          // Ola 1 (ws1-t6) — «Alta del caso»: antes estos dos handlers
          // mandaban a la vista antigua (/dashboard/specialties/orthodontics/
          // [id], S1). Ahora abren el asistente DENTRO de la ficha nueva —
          // ver `onCreateCase` más abajo — así que S1 ya no es el único
          // camino para abrir un caso y se puede ocultar cuando Rafael lo
          // decida (REPORTE-ws1-t1.md, «Ojo» de esta parte).
          onCreateCase={crearCaso}
          abrirControlAlEntrar={abrirControlAlEntrar}
          onControlAbierto={onControlAbierto}
          citaEnCursoId={citaEnCursoId ?? null}
          citaDeLaDireccionId={citaDeLaDireccionId ?? null}
          onCitaCerradaPorLaHoja={(id) => {
            if (id === citaEnCursoId) onConsultaCerradaPorLaHoja?.(id);
            else router.refresh();
          }}
          onOpenImagingRecords={() => {
            // A9 · enlaza a lo que ya existe en el expediente (radiografías,
            // panorámica, lateral de cráneo, modelos 3D) en vez de mandar al
            // asistente de diagnóstico — el alcance lo pidió reducido a
            // "enlazar", no a construir un uploader propio dentro del caso.
            router.push(`/dashboard/xrays/${patient.id}`);
          }}
          onUpdateCaseSettings={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await updateTreatmentPlan({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              ...payload,
              // `status` es `z.enum(...).optional()` — SIN `.nullable()` — a
              // diferencia de los demás campos de este payload; `null` lo
              // rechazaría cuando el estado no cambió.
              status: payload.status ?? undefined,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            if (!res.data.altaCasoFieldsSaved && (payload.treatingDoctorId || payload.responsibleGuardianId || payload.newResponsibleGuardian)) {
              toast(t("patients.ortho.altaCasoSqlPending"));
            }
            toast.success(t("patients.ortho.caseSettingsSaved"));
            if (res.data.avisoPrecioDesfasado) toast(res.data.avisoPrecioDesfasado, { duration: 12000 });
            // F «Cambio de doctor»: los controles YA agendados se quedaban con el
            // doctor anterior. Se ofrece pasarlos al nuevo (solo los que no chocan
            // con su agenda; los demás se quedan y se avisa).
            if (res.data.controlesConOtroDoctor > 0) {
              const n = res.data.controlesConOtroDoctor;
              const pasar = window.confirm(
                `${n === 1 ? "Hay 1 control futuro agendado" : `Hay ${n} controles futuros agendados`} con el doctor anterior. ¿Pasarlo${n === 1 ? "" : "s"} al doctor nuevo? Solo se pasan los que no chocan con su agenda.`,
              );
              if (pasar) {
                const r = await moverControlesFuturosAlDoctor({ treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId });
                if (isFailure(r)) toast.error(r.error);
                else toast.success(
                  `${r.data.movidos} control${r.data.movidos === 1 ? "" : "es"} pasado${r.data.movidos === 1 ? "" : "s"} al doctor nuevo` +
                  (r.data.conChoque > 0 ? `; ${r.data.conChoque} chocan con su agenda y se quedaron como estaban.` : "."),
                );
              }
            }
            router.refresh();
          }}
          onUpdateDiagnosis={async (payload) => {
            const res = await updateDiagnosis({
              ...payload,
              patientId: patient.id,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.diagnosisUpdated"));
            router.refresh();
          }}
          planDeTratamiento={orthoRedesignBundle?.planDeTratamiento ?? null}
          onEditarPlan={soloLectura ? undefined : editarPlan}
          onUpdateAppliances={async (payload) => {
            const res = await updateOrthoAppliances(payload);
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.appliancesUpdated"));
            router.refresh();
          }}
          onCreateReferralLetter={async (payload) => {
            const res = await createReferralLetter({
              patientId: patient.id,
              ...payload,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.referralLetterSent"));
            router.refresh();
          }}
          onUpdateRetentionRegimen={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await updateRetentionRegimenConfig({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              ...payload,
              upperRetainer: payload.upperRetainer as any,
              lowerRetainer: payload.lowerRetainer as any,
              fixedLingualGauge: payload.fixedLingualGauge as any,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.retentionRegimenSaved"));
            router.refresh();
          }}
          onUpdateNpsConfig={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await updateNpsConfig({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              ...payload,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(
              payload.customMessage
                ? t("patients.ortho.npsConfigSavedWhatsapp")
                : t("patients.ortho.npsConfigSaved"),
            );
            router.refresh();
          }}
          onScheduleG15Action={async () => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await scheduleG15Checkpoint({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.g15Scheduled"));
            router.refresh();
          }}
          onUpdateQuoteScenario={async (payload) => {
            const res = await updateQuoteScenario(payload);
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.scenarioUpdated"));
            router.refresh();
          }}
          onAddWireStep={undefined}
          onSubmitWireStep={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await addWireStep({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              phase: payload.phase,
              material: payload.material,
              shape: payload.shape,
              gauge: payload.gauge,
              archUpper: payload.archUpper,
              archLower: payload.archLower,
              durationWeeks: payload.durationWeeks,
              auxiliaries: payload.auxiliaries,
              purpose: payload.purpose ?? null,
              notes: payload.notes ?? null,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            // Revisión en panel.108 (fallo 5): sin el SQL de materiales un NiTi superelástico/termoactivado se guarda
            // «NiTi»; se dice en vez de dar un «agregado» a secas.
            if (res.data.aviso) toast(res.data.aviso, { icon: "⚠️", duration: 8000 });
            else toast.success(t("patients.ortho.wireStepAdded"));
            router.refresh();
            // La fila creada, para que la «Secuencia de arcos» la pinte ya (mismo
            // dato que `adaptWireStep` arma al leer el caso).
            return res.data.paso;
          }}
          // onAddTad queda sin override: OrthodonticsRedesignClient abre su
          // DrawerAddTad interno (hallazgo ws1-t4 §9 — antes 4
          // window.prompt() seguidos, sin poder corregir un campo sin
          // cancelar los cuatro).
          onAddTad={undefined}
          onSubmitAddTad={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await createOrthoTAD({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              brand: payload.brand,
              size: payload.size,
              location: payload.location,
              torqueNcm: payload.torqueNcm,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.tadRegistered"));
            router.refresh();
          }}
          onCardSigned={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const card = orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId);
            // ws1-t10: una hoja NUEVA firma lo que el cajón mostró (`payload.encabezado`); antes esto se volvía a
            // calcular aquí y salía otra fase («Alineación» abierta, «Nivelación» firmada), sin arco de llegada.
            const nueva = payload.encabezado;
            const res = await signTreatmentCard({
              cardId: payload.cardId,
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              cardNumber:
                card?.cardNumber ??
                nueva?.cardNumber ??
                orthoRedesignVM.treatmentCards.reduce((m, c) => Math.max(m, c.cardNumber), 0) + 1,
              visitDate: card?.visitDate ?? nueva?.visitDate ?? new Date().toISOString(),
              durationMin: card?.durationMin ?? 30,
              phaseKey: card?.phaseKey ?? nueva?.phaseKey ?? orthoRedesignVM.treatment.phase ?? "ALIGNMENT",
              monthAt: card?.monthAt ?? nueva?.monthAt ?? orthoRedesignVM.treatment.monthCurrent,
              wireFromId: card ? (card.wireFrom?.id ?? null) : (nueva?.wireFromId ?? null),
              wireToId: payload.wireToId,
              soap: payload.soap,
              hygiene: payload.hygiene,
              elastics: payload.elastics,
              iprPoints: payload.iprPoints,
              brokenBrackets: payload.brokenBrackets,
              hasProgressPhoto: payload.hasProgressPhoto,
              photoSetId: payload.photoSetId,
              nextDate: payload.nextDate,
              nextDurationMin: payload.nextDurationMin,
              activationsNote: payload.activationsNote,
              indications: payload.indications,
              procedimientos: payload.procedimientos,
              // ws1-t12: las extracciones del plan que se hicieron hoy se marcan al firmar.
              extraccionesRealizadas: payload.extraccionesRealizadas,
              // M6 (ws1-t8, Ronda 6 — hallazgo 6): antes esta llamada nunca
              // mandaba appointmentId — "Registrar control" desde la ficha
              // nunca quedaba ligado a la cita del día, aunque hubiera una.
              appointmentId: payload.appointmentId,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            // Ola 2 (ws1-t1) — «nada en silencio»: si el control era de una
            // cita de agenda y el modo de cobro es «Pago por control» pero
            // no se pudo facturar solo (catálogo sin precio, o un error al
            // crear la factura), la firma clínica se guardó igual pero
            // Recepción tiene que enterarse para cobrarlo a mano.
            if (res.data.avisoControlSinFacturar) {
              toast.error(res.data.avisoControlSinFacturar, { duration: 8000 });
            }
            if (res.data.avisoReposiciones) toast(res.data.avisoReposiciones, { duration: 9000 });
            if (res.data.avisoProcedimientos) toast.error(res.data.avisoProcedimientos, { duration: 9000 });
            if (res.data.avisoExtracciones) toast.error(res.data.avisoExtracciones, { duration: 9000 });
            // ws1-t8 (punto 12): la cita era de otro día y el paciente no había llegado — no se tocó.
            if (res.data.citaDeOtroDiaSinTocar) toast(textosFirma.firmadaSinTocarCita(res.data.citaDeOtroDiaSinTocar), { duration: 10000 });
            // ws1-t8 (punto 3): la firma cerró la cita de la consulta en curso con la nota de la hoja — la ficha
            // cierra la consulta sin pedir otra nota.
            if (res.data.citaCerrada && res.data.citaCerrada === citaEnCursoId) {
              toast.success(textosFirma.consultaTerminada);
              onConsultaCerradaPorLaHoja?.(res.data.citaCerrada);
            } else {
              // ws1-t9 #11: se firma un CONTROL (una hoja), no una cita.
              toast.success("Control firmado");
            }
            router.refresh();
            // §1 completo (ws1-t8): el cajón recuerda este id — así, si ya
            // se había guardado un borrador antes en la MISMA sesión y
            // ahora se firma, el siguiente submit manda este cardId en vez
            // de null (evita el "Unique constraint failed on
            // (treatmentPlanId, cardNumber)" de intentar CREAR dos veces).
            return res.data.cardId;
          }}
          onCardDraftSaved={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const card = orthoRedesignVM.treatmentCards.find(
              (c) => c.id === payload.cardId,
            );
            // ws1-t10: igual que al firmar, una hoja nueva guarda lo que el cajón mostró.
            const nueva = payload.encabezado;
            const res = await saveTreatmentCardDraft({
              cardId: payload.cardId,
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              cardNumber:
                card?.cardNumber ??
                nueva?.cardNumber ??
                orthoRedesignVM.treatmentCards.reduce(
                  (m, c) => Math.max(m, c.cardNumber),
                  0,
                ) + 1,
              visitDate: card?.visitDate ?? nueva?.visitDate ?? new Date().toISOString(),
              durationMin: card?.durationMin ?? 30,
              phaseKey:
                card?.phaseKey ?? nueva?.phaseKey ?? orthoRedesignVM.treatment.phase ?? "ALIGNMENT",
              monthAt: card?.monthAt ?? nueva?.monthAt ?? orthoRedesignVM.treatment.monthCurrent,
              wireFromId: card ? (card.wireFrom?.id ?? null) : (nueva?.wireFromId ?? null),
              wireToId: payload.wireToId,
              soap: payload.soap,
              hygiene: payload.hygiene,
              elastics: payload.elastics,
              iprPoints: payload.iprPoints,
              brokenBrackets: payload.brokenBrackets,
              hasProgressPhoto: payload.hasProgressPhoto,
              photoSetId: payload.photoSetId,
              nextDate: payload.nextDate,
              nextDurationMin: payload.nextDurationMin,
              activationsNote: payload.activationsNote,
              indications: payload.indications,
              procedimientos: payload.procedimientos,
              appointmentId: payload.appointmentId,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.draftSaved"));
            router.refresh();
            // §1 completo (ws1-t8): mismo motivo que en onCardSigned arriba.
            return res.data.cardId;
          }}
          onPhaseAdvanced={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            // El audit trail (criteriaChecked, isOverride) lo registra
            // OrthoPhaseTransition por separado; advanceTreatmentPhase solo
            // necesita treatmentPlanId + toPhase + notes.
            const notesParts = [
              payload.doctorNotes ?? "",
              payload.isOverride
                ? `OVERRIDE: ${payload.overrideReason ?? "—"}`
                : "",
              payload.criteriaChecked.length > 0
                ? `Criterios: ${payload.criteriaChecked.join(", ")}`
                : "",
            ].filter(Boolean);
            const res = await advanceTreatmentPhase({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              toPhase: payload.toPhase,
              notes: notesParts.join(" · ") || null,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.phaseAdvanced", { phase: payload.toPhase }));
            router.refresh();
          }}
          onSelectQuoteScenario={async (scenarioId) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await selectQuoteScenario({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              scenarioId,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.scenarioSelected"));
            router.refresh();
          }}
          onSendSignAtHome={async () => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const accepted = orthoRedesignBundle?.quoteScenarios.find(
              (s) => s.status === "ACCEPTED",
            );
            if (!accepted) {
              toast.error(t("patients.ortho.selectScenarioBeforeSign"));
              return;
            }
            const res = await sendSignAtHomeLink({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              scenarioId: accepted.id,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.signAtHomeSent"));
            router.refresh();
          }}
          onConfirmCollect={async (method) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await confirmCollect({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              method,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.collectRegistered"));
            if ((res.data as { cfdiTimbradoStub?: boolean }).cfdiTimbradoStub) {
              toast(t("patients.ortho.cfdiStub"));
            }
            router.refresh();
          }}
          onPedirAsentimiento={
            orthoData?.isMinor && orthoData.guardianName
              ? async () => {
                  const res = await fetch("/api/consent", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      patientId: patient.id,
                      procedure: "Asentimiento del menor — ortodoncia",
                      content: textoAsentimientoMenor(`${patient.firstName} ${patient.lastName}`.trim()),
                      signerName: orthoData.guardianName,
                      signerRelation: labelParentesco(orthoData.responsibleGuardianRelation) || "Representante legal",
                    }),
                  });
                  if (!res.ok) {
                    const body = await res.json().catch(() => null);
                    return body?.error ?? "No se pudo generar el asentimiento.";
                  }
                  router.refresh();
                  return null;
                }
              : undefined
          }
          onCreateLabOrder={async (payload) => {
            const res = await createOrthoLabOrder({
              patientId: patient.id,
              catalog: payload.catalog,
              description: payload.description,
              lab: payload.lab,
              labPartnerId: payload.labPartnerId ?? null,
              expectedDate: payload.expectedDate,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.labOrderCreated"));
            router.refresh();
          }}
          onTogglePreSurvey={async (enabled) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await toggleRetentionPreSurvey({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              enabled,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(
              enabled ? t("patients.ortho.preSurveyEnabled") : t("patients.ortho.preSurveyDisabled"),
            );
            router.refresh();
          }}
          onGeneratePdfBeforeAfter={async () => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            // Genera PDF comparativo T0 vs Tn vía endpoint existente. El
            // download se dispara en el browser; el endpoint usa puppeteer +
            // las URLs firmadas de Supabase Storage.
            const url = `/api/orthodontics/treatment-plans/${orthoRedesignVM.treatment.treatmentPlanId}/comparison-pdf`;
            window.open(url, "_blank");
            toast.success(t("patients.ortho.generatingBeforeAfterPdf"));
          }}
          onCopyReferralCode={() => {
            const code = orthoRedesignBundle?.referralCode?.code;
            if (!code) {
              toast(t("patients.ortho.noReferralCode"));
              return;
            }
            navigator.clipboard
              .writeText(code)
              .then(() => toast.success(t("patients.ortho.codeCopied", { code })))
              .catch(() => toast.error(t("patients.ortho.clipboardFailed")));
          }}
          onUploadPhoto={async (stage, slotId, file) => {
            // Persistencia real: createPhotoSet (si no existe set para esta
            // etapa) → POST /api/orthodontics/photos/upload →
            // uploadPhotoToSet → router.refresh() para que el loader
            // re-pinte con la URL firmada de Supabase.
            // Sobremordida y resalte (ws1-t12) no tienen columna en OrthoPhotoSet:
            // se guardan como fila de `ortho_photo_extras` con su `slotId`.
            const enExtras = esVistaEnExtras(slotId);
            const view = SLOT_TO_VIEW[slotId];
            if (!view && !enExtras) {
              toast.error(t("patients.ortho.slotOutsideAao"));
              return;
            }
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            try {
              // 1. Resolver setId · usar el del bundle si existe, o crear
              //    uno nuevo para esta etapa.
              // H39: un set nuevo por visita en CONTROL (no pisa las fotos
              // del control anterior); T0/T1/T2 se reusan.
              let setId = elegirSetParaFoto(
                orthoRedesignBundle?.historicalPhotoSets ?? [],
                stage,
              );
              // Una foto subida es UNA acción: el juego nuevo y la ligadura quedan solo en la bitácora; Movimientos
              // muestra la fila de la subida (una-accion.ts).
              let juegoNuevo = false;
              if (!setId) {
                const created = await createPhotoSet({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  patientId: patient.id,
                  setType: stage,
                  capturedAt: new Date().toISOString(),
                  monthInTreatment: orthoRedesignVM.treatment.monthCurrent,
                  parteDeUnaAccion: true,
                });
                if (isFailure(created)) {
                  toast.error(created.error);
                  return;
                }
                setId = (created.data as { id: string }).id;
                juegoNuevo = true;
              }

              // 2. POST file + setId + view al endpoint que sube a Supabase
              //    Storage + crea PatientFile.
              const fd = new FormData();
              fd.append("file", file);
              fd.append("setId", setId);
              fd.append("view", view ?? slotId);
              if (juegoNuevo) fd.append("juegoNuevo", "1");
              const res = await fetch(
                "/api/orthodontics/photos/upload",
                { method: "POST", body: fd },
              );
              if (!res.ok) {
                const errBody = await res.json().catch(() => null);
                toast.error(errBody?.error ?? t("patients.ortho.photoUploadFailed"));
                return;
              }
              const { fileId } = (await res.json()) as { fileId: string };

              // 3. Asocia el PatientFile a la columna del set (o, en
              //    sobremordida/resalte, a su fila de la tabla de extras).
              const attached: ActionResult<unknown> = view
                ? await uploadPhotoToSet({ setId, fileId, view, parteDeUnaAccion: true })
                : await agregarFotoExtra({ setId, fileId, slot: slotId, parteDeUnaAccion: true });
              if (isFailure(attached)) {
                toast.error(attached.error);
                return;
              }

              toast.success(
                t("patients.ortho.photoUploaded", { view: (view ?? slotId).replace(/_/g, " ").toLowerCase() }),
              );
              // 4. Re-pinta con URLs firmadas frescas del loader.
              router.refresh();
            } catch (e) {
              console.error("[ortho upload] failed:", e);
              toast.error(t("patients.ortho.photoUploadUnexpected"));
            }
          }}
          onElegirFotoExistente={async (stage, slotId, fileId) => {
            // H55: la foto ya está en el expediente: se liga a la vista sin subirla otra vez.
            const enExtras = esVistaEnExtras(slotId);
            const view = SLOT_TO_VIEW[slotId];
            if (!view && !enExtras) return t("patients.ortho.slotOutsideAao");
            if (!orthoRedesignVM.treatment.treatmentPlanId) return t("patients.ortho.noPlan");
            try {
              let setId = elegirSetParaFoto(orthoRedesignBundle?.historicalPhotoSets ?? [], stage);
              let juegoNuevo = false;
              if (!setId) {
                const created = await createPhotoSet({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  patientId: patient.id,
                  setType: stage,
                  capturedAt: new Date().toISOString(),
                  monthInTreatment: orthoRedesignVM.treatment.monthCurrent,
                  parteDeUnaAccion: true,
                });
                if (isFailure(created)) return created.error;
                setId = (created.data as { id: string }).id;
                juegoNuevo = true;
              }
              // Aquí no hay subida: esta llamada es la fila de la acción, y dice si creó el juego.
              const attached: ActionResult<unknown> = view
                ? await uploadPhotoToSet({ setId, fileId, view, juegoNuevo })
                : await agregarFotoExtra({ setId, fileId, slot: slotId, juegoNuevo });
              if (isFailure(attached)) return attached.error;
              toast.success(
                t("patients.ortho.photoUploaded", { view: (view ?? slotId).replace(/_/g, " ").toLowerCase() }),
              );
              router.refresh();
              return null;
            } catch {
              return t("patients.ortho.photoUploadUnexpected");
            }
          }}
          onComparePhotos={undefined}
          onGenerateComparePdf={async () => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const url = `/api/orthodontics/treatment-plans/${orthoRedesignVM.treatment.treatmentPlanId}/comparison-pdf`;
            window.open(url, "_blank");
            toast.success(t("patients.ortho.generatingComparePdf"));
          }}
          onCollectNow={undefined}
        />
      )}
      {!orthoRedesignVM && orthoData && (
        <OrthodonticsClient
          patientId={orthoData.patientId}
          patientName={orthoData.patientName}
          isMinor={orthoData.isMinor}
          hasPediatricProfile={orthoData.hasPediatricProfile}
          guardianName={orthoData.guardianName}
          pediatricHabits={orthoData.pediatricHabits}
          pediatricsModuleActive={pediatricsModuleActive}
          diagnosis={orthoData.diagnosis}
          plan={orthoData.plan}
          phases={orthoData.phases}
          monthInTreatment={orthoData.monthInTreatment}
          paymentPlan={orthoData.paymentPlan}
          installments={orthoData.installments}
          photoSets={orthoData.photoSets}
          controls={orthoData.controls}
          digitalRecords={orthoData.digitalRecords}
          resolveFileUrl={resolveOrthoFileUrl}
          agreementPdfHref={
            orthoData.paymentPlan
              ? `/api/orthodontics/payment-plans/${orthoData.paymentPlan.id}/financial-agreement-pdf`
              : undefined
          }
        />
      )}
      {/* I5 (revisión final): los casos migrados del sistema anterior también se ven en la ficha nueva. */}
      <CasosMigrados patientId={patient.id} conLienzo />
    </>
  );
}