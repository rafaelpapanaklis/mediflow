"use client";
// Drawer Treatment Card detallado (Sección D ⭐).
//
// Modal lateral derecho que sustituye temporalmente la sidebar derecha.
// Editable: SOAP, elásticos, IPR, brackets caídos, higiene, foto.
// Maneja modo edición (DRAFT) y vista firmada (SIGNED) read-only.
//
// El submit/firma del card se delega vía callbacks — la persistencia (server
// action) se conecta en commit posterior.

import { useEffect, useMemo, useReducer, useState } from "react";
import { DateField } from "@/components/ui/date-field";
import { DateTimeField } from "@/components/ui/date-time-field";
import { hoyISO, hoyMasAniosISO } from "@/lib/orthodontics/fechas-de-formulario";
import {
  Camera,
  Check,
  ChevronRight,
  MessageCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Pill } from "../atoms/Pill";
import { fmtDate, fmtFechaHoraLarga } from "../atoms/format";
import {
  ELASTIC_CLASS_LABELS,
  ELASTIC_ZONE_LABELS,
  GINGIVITIS_LABELS,
  PHASE_LABELS,
  type ElasticDTO,
  type IPRPointDTO,
  type BrokenBracketDTO,
  type OrthoElasticClass,
  type OrthoElasticZone,
  type OrthoGingivitisLevel,
  type OrthoPhaseKey,
  type SOAP,
  type TreatmentCardDTO,
  type WireStepDTO,
} from "../types";
import { useCajon } from "../atoms/useCajon";
import { EvolutionTemplatePicker } from "@/components/clinical-shared/EvolutionTemplatePicker";
import { aplicarPlantillaAlControl } from "@/lib/orthodontics/consulta-ortodoncia";
import { avisoSinArcosPlanificados, huecosDeLaNota, mensajeDeHuecos, proximaFechaDeControl } from "@/lib/orthodontics/hoja-de-control-reglas";
import { citaAlFirmar } from "@/lib/orthodontics/cerrar-cita-al-firmar";
import { pasoAlFirmar } from "@/lib/orthodontics/caso-por-colocar";
import { zonaFijada } from "../atoms/format";
import { useTextosFirmaControl } from "../textos-firma-control";
import { progresoDeControles, textoControlQueSigue } from "@/lib/orthodontics/plan-detalle";
import { claveDeFase } from "@/lib/orthodontics/fase-de-hoja";
import { plantillaAplicaALaTecnica } from "@/lib/orthodontics/plantillas-por-tecnica";
import { AgendarControlBoton } from "@/components/specialties/orthodontics/modulo/agendar-control";
import { AgendarProximoControlButton } from "@/components/specialties/orthodontics/AgendarProximoControlButton";
import { AvisarProximoControlButton } from "@/components/specialties/orthodontics/AvisarProximoControlButton";
import { addWireStep } from "@/app/actions/orthodontics/addWireStep";
import { isFailure } from "@/app/actions/orthodontics/result";
import { WIRE_GAUGE_RECT, WIRE_GAUGE_ROUND, WIRE_MATERIAL_OPTIONS } from "./wire-options";
import { lineasDeArcosActuales, textoDeArcoConArcada } from "@/lib/orthodontics/material-de-arco";
import {
  initialState,
  notaBaseParaPlantilla,
  puedeFirmarNota,
  reducer,
  type PrecargaHoja,
} from "./treatment-card-state";
import { ProcedimientosDeVisita, type SeleccionDeProcedimiento } from "./ProcedimientosDeVisita";
import orto from "../orto.module.css";
import { DictationMic, appendDictado } from "@/components/clinical/shared/dictation-mic";

export type DrawerCardSubmit = {
  cardId: string | null;
  /** «Procedimientos de esta visita»: solo qué y cuántos (el precio sale del catálogo). undefined = no se tocan. */
  procedimientos?: SeleccionDeProcedimiento[];
  /** ws1-t12: extracciones del plan de tratamiento (FDI) que se hicieron en esta visita; se anotan en el plan al firmar. */
  extraccionesRealizadas?: number[];
  soap: SOAP;
  hygiene: {
    plaquePct: number | null;
    gingivitis: OrthoGingivitisLevel | null;
    whiteSpots: boolean;
  };
  elastics: Array<{ elasticClass: OrthoElasticClass; config: string; zone: OrthoElasticZone }>;
  iprPoints: Array<{ toothA: number; toothB: number; amountMm: number; done: boolean }>;
  brokenBrackets: Array<{ toothFdi: number; brokenDate: string; reBondedDate: string | null }>;
  hasProgressPhoto: boolean;
  /** C4: qué foto-set existente (ya subido) corresponde a esta visita. */
  photoSetId: string | null;
  wireToId: string | null;
  nextDate: string | null;
  nextDurationMin: number | null;
  /** C2: activaciones de mecánica auxiliar de ESTA visita (texto libre). */
  activationsNote: string | null;
  /** C3: indicaciones para el paciente de ESTA visita (texto libre). */
  indications: string | null;
  /**
   * M6 (ws1-t8, Ronda 6): la cita de Agenda que originó esta hoja, tomada de
   * `props.appointmentId` — "una sola forma de registrar el control" incluye
   * que el CAJÓN sea quien manda este dato, no cada llamador por su cuenta
   * (antes solo `BotonHojaControl.tsx` lo sabía, desde su propio prop; la
   * ficha no lo mandaba nunca — hallazgo 6).
   */
  appointmentId: string | null;
  /**
   * ws1-t10: lo que el cajón MOSTRÓ en el encabezado de una hoja NUEVA (número, fase, mes, arco de llegada y fecha).
   * Quien guarda lo manda tal cual: antes la ficha lo volvía a calcular por su cuenta y firmaba una fase distinta
   * («Alineación» abierta, «Nivelación» firmada). Ausente en una hoja que ya existe: esa ya trae sus valores.
   */
  encabezado?: {
    cardNumber: number;
    phaseKey: OrthoPhaseKey | null;
    monthAt: number;
    wireFromId: string | null;
    visitDate: string;
  };
};

export interface DrawerTreatmentCardProps {
  /** Card existente (modo edición/lectura) o null para nueva. */
  card: TreatmentCardDTO | null;
  /** Catálogo de wire steps planificados para el dropdown wire-to. */
  availableWires: WireStepDTO[];
  /**
   * H48: con el plan, el select de arco deja «Otro arco…» para escribir el que
   * se puso hoy y sumarlo a la secuencia (antes solo ofrecía lo planeado).
   */
  treatmentPlanId?: string;
  /**
   * ws1-t10: los controles que prevé el plan («Control X de N»). Sin él el encabezado dice solo «Control X».
   */
  controlesPrevistos?: number | null;
  /** ws1-t10: la técnica del caso (`OrthoTechnique`); con ella las plantillas de nota se filtran («Cambio de alineador» no sale en brackets). */
  tecnica?: string | null;
  /** Para una nueva cita, se sugieren defaults: número, fase, mes, wire actual. */
  defaultsForNew?: {
    cardNumber: number;
    /** ws1-t10: el número de ESTE control con la cuenta de la ficha (visitas del caso); si falta se usa `cardNumber`. */
    controlNumero?: number | null;
    /** La CLAVE de la fase («ALIGNMENT») o su nombre; el cajón resuelve las dos. */
    phase: string;
    monthAt: number;
    wireFrom: WireStepDTO | null;
    /**
     * ws1-t12 (revisión en panel.108, fallo 4): el arco que lleva puesto en CADA arcada (`arcosActuales`). Tras cambiar
     * solo el superior son dos: «Actual» los dice los dos. Sin él se pinta `wireFrom` con su arcada.
     */
    arcosActuales?: { superior: WireStepDTO | null; inferior: WireStepDTO | null } | null;
    visitDate: string;
    /** Duración estimada del caso, en meses. La usan las plantillas de nota («Mes 4 de 18»). */
    monthTotal?: number | null;
    /**
     * M12 (ws1-t8, Ronda 6 — hallazgo 12, "la hoja empieza en blanco cada
     * vez"): lo que la última hoja FIRMADA dejó anotado, para no recapturar
     * elásticos e indicaciones en cada control. Solo se usan una vez, al
     * crear (mismo criterio que ya usa `wireFrom` para precargar el arco).
     */
    lastElastics?: Array<{ elasticClass: OrthoElasticClass; config: string; zone: OrthoElasticZone }>;
    lastIndications?: string | null;
    /** Duración sugerida de «Próximo control», de Configuración. */
    proximoControlMin?: number | null;
    /**
     * Fila 12: brackets que la última hoja FIRMADA dejó caídos sin
     * recementar — siguen pendientes en esta.
     */
    lastPendingBrackets?: Array<{ toothFdi: number; brokenDate: string; notes: string | null }>;
    /** Fila 12: nota S/O/A/P con la que arranca la hoja (soap-prefill). */
    soapPrefill?: SOAP | null;
    /** Revisión de ws1-t9, fallo 6: lo escrito en «Nueva consulta» antes de cambiar a Ortodoncia (va delante de la precarga). */
    notaDeLaConsulta?: SOAP | null;
  };
  /**
   * C4: foto-sets ya existentes del caso (subidos desde la sección de fotos)
   * para ligar el que corresponde a ESTA visita. Sin esta prop (p. ej. desde
   * la ficha del paciente) el bloque de foto cae al toggle simple de
   * siempre — nadie más está obligado a pasarla.
   */
  availablePhotoSets?: Array<{ id: string; label: string }>;
  /**
   * M6 (ws1-t8, Ronda 6): la cita de Agenda que origina esta hoja, si la
   * hay. `BotonHojaControl.tsx` (Agenda) y `OrthodonticsRedesignClient.tsx`
   * (ficha) la resuelven ANTES de abrir el cajón — los dos con el mismo
   * cargador (`getTreatmentCardContextForAppointment`/`...ForPatient`) — y
   * el cajón la manda tal cual en `buildSubmit()` para que `onSave`/`onSign`
   * no tengan que llevar su propia copia. `null` = control sin cita ligada.
   */
  appointmentId?: string | null;
  /**
   * ws1-t8 (ticket BEVADENT, punto 12): estado y fecha de esa cita. Si es de un día futuro y el paciente no ha
   * llegado, el cajón avisa antes de firmar que la hoja queda como visita de hoy y la cita no se toca.
   */
  cita?: { estado: string | null; inicio: string | null } | null;
  /**
   * El paciente de la hoja, para ofrecer «Agendar el próximo control» tras firmar cuando no se
   * capturó fecha (ws1-t9 #11). Sin él (la Agenda no lo pasa) ese botón no se ofrece.
   */
  paciente?: { id: string; nombre: string; doctorId?: string | null } | null;
  /**
   * ws1-t8 (decisión 13 de Rafael): el caso sigue «Por colocar». «Firmar control» pregunta antes, con dos
   * botones: «Registrar la colocación primero» / «Firmar el control de todos modos». No bloquea.
   */
  casoPorColocar?: boolean;
  /**
   * «Registrar la colocación primero»: el cajón guarda la hoja como borrador (con `onSave`) y, si se guardó,
   * llama a esto. La ficha abre «Datos del caso» (fecha de colocación); la Agenda lleva a la ficha. Sin él, el
   * aviso solo ofrece firmar igual.
   */
  onRegistrarColocacion?: () => void;
  onClose: () => void;
  /**
   * Devuelve el `cardId` con el que quedó la tarjeta (creada o
   * actualizada) — o `null`/`void` si no se sabe (falló, o el caller no lo
   * dice; `BotonHojaControl.tsx` en Agenda es un caller así hoy, fuera del
   * alcance de este arreglo). Cuando SÍ llega, el cajón lo recuerda (§1
   * completo, ws1-t8): sin esto, "Guardar borrador" y luego "Firmar" en
   * la MISMA sesión abierta volvían a mandar `cardId: null` los dos, y el
   * segundo intentaba CREAR una tarjeta nueva con el mismo `cardNumber`
   * de la que el primero ya había creado — "Unique constraint failed on
   * (treatmentPlanId, cardNumber)".
   */
  onSave?: (payload: DrawerCardSubmit) => Promise<string | null | void> | string | null | void;
  onSign?: (payload: DrawerCardSubmit) => Promise<string | null | void> | string | null | void;
  onSharePatient?: (cardId: string) => void;
}

export function DrawerTreatmentCard(props: DrawerTreatmentCardProps) {
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  const isNew = props.card === null;
  const isReadOnly = props.card?.status === "SIGNED";
  // Fila 12: una hoja NUEVA nace con lo del control anterior (arco actual,
  // elásticos, brackets pendientes, indicaciones) y la nota precargada. Va en
  // el estado inicial —una sola vez—; antes eran efectos tras montar.
  const [state, dispatch] = useReducer(reducer, props.card, (card) =>
    initialState(card, card ? null : precargaDesdeDefaults(props.defaultsForNew)),
  );
  // Hallazgo ws1-t1/ws1-t4 §1, cerrado en dos partes (ws1-t8): "Firmar
  // control" fallaba en dev.108 con "Unique constraint failed on
  // (treatmentPlanId, cardNumber)" por DOS caminos —
  //   1. Doble clic en "Guardar borrador"/"Firmar control": `enVuelo`
  //      deshabilita los dos botones mientras la llamada sigue en vuelo.
  //   2. Guardar un borrador y FIRMAR después sin cerrar el cajón:
  //      `props.card` no cambia dentro de la misma sesión (el padre solo
  //      lo actualiza si remonta el componente), así que sin más nada
  //      `buildSubmit()` seguía mandando `cardId: null` en el segundo
  //      submit — el servidor intentaba CREAR la tarjeta otra vez con el
  //      mismo `cardNumber`. `state.learnedCardId` (reducer, acción
  //      "learn-card-id") es lo que arregla esto: se pone al valor que
  //      `onSave`/`onSign` confirma, y `buildSubmit()` lo usa primero.
  const [enVuelo, setEnVuelo] = useState(false);
  // ws1-t8 (decisión 13): el aviso «Por colocar» antes de firmar, y si ya se eligió firmar igual.
  const [preguntaPorColocar, setPreguntaPorColocar] = useState(false);
  const [firmarIgualAceptado, setFirmarIgualAceptado] = useState(false);

  // Re-init si cambia la card target.
  useEffect(() => {
    // No usamos useReducer init dynamic; en su lugar, si la card cambia entre
    // mounts, el componente se remonta porque el padre debe usar key={cardId}.
  }, [props.card]);

  // M12 (Ronda 6, hallazgo 12) + fila 12: el arco, los elásticos vigentes y
  // las indicaciones de la última hoja FIRMADA se precargan en
  // `initialState` (ver `precargaDesdeDefaults` abajo), no en efectos: los
  // efectos corrían dos veces en desarrollo (elásticos duplicados) y el del
  // arco volvía a ponerlo cada vez que el doctor elegía «Sin cambio».

  // M11 (Ronda 6, hallazgo 11): tras firmar, el cajón se queda abierto en
  // vez de cerrarse en silencio, y ofrece agendar/avisar el próximo control
  // EN EL MOMENTO — antes solo aparecía al reabrir una hoja ya firmada.
  // `justSigned` no depende de `props.card` (el padre puede no remontar el
  // componente con el card fresco): se arma con lo que el propio `onSign`
  // devolvió.
  // «Procedimientos de esta visita»: lo elegido en esta hoja (undefined = aún no se cargó lo guardado).
  const [procSel, setProcSel] = useState<SeleccionDeProcedimiento[] | undefined>(undefined);
  const [extraccionesHoy, setExtraccionesHoy] = useState<number[]>([]);
  const [procRecarga, setProcRecarga] = useState(0);
  const [justSigned, setJustSigned] = useState<{
    cardId: string;
    nextDate: string | null;
    nextDurationMin: number | null;
  } | null>(null);

  const headerTitle = useMemo(() => {
    if (isNew && props.defaultsForNew) {
      // Llega la CLAVE de la fase («ALIGNMENT») o su nombre ya traducido: aquí se muestra siempre el nombre.
      const fase = props.defaultsForNew.phase;
      const clave = claveDeFase(fase);
      const nombre = clave ? PHASE_LABELS[clave] : fase;
      return `${fmtDate(props.defaultsForNew.visitDate)} · ${nombre}`;
    }
    if (props.card) {
      return `${fmtDate(props.card.visitDate)} · ${PHASE_LABELS[props.card.phaseKey]}`;
    }
    return "Hoja de control";
  }, [isNew, props.card, props.defaultsForNew]);

  // Sección H (ws1-t4 ronda 6): «control» es la visita, «hoja de control»
  // lo que se registra de ella.
  // ws1-t10: «Control X de N» con la cuenta de la ficha. Una hoja nueva lleva el número de la visita
  // (`controlNumero`); una que ya existe, el suyo.
  const numeroDeControl = isNew
    ? (props.defaultsForNew?.controlNumero ?? props.defaultsForNew?.cardNumber ?? null)
    : props.card!.cardNumber;
  const textoDelControl =
    numeroDeControl !== null ? textoControlQueSigue(progresoDeControles(numeroDeControl - 1, props.controlesPrevistos ?? null)) : null;
  const headerEyebrow = isNew
    ? textoDelControl
      ? `Hoja de control nueva · ${textoDelControl}`
      : "Hoja de control nueva"
    : `Hoja del ${(textoDelControl ?? `control ${props.card!.cardNumber}`).toLowerCase()}`;

  // ws1-t12 (revisión en panel.108, fallo 4): todo arco dice su arcada, y en una hoja nueva «Actual» dice los dos
  // arcos si arriba y abajo son distintos (antes solo uno, sin decir de cuál).
  const arcosDeLlegada = isNew && props.defaultsForNew?.arcosActuales ? lineasDeArcosActuales(props.defaultsForNew.arcosActuales) : [];
  const wireFromLineas =
    arcosDeLlegada.length > 0 ? arcosDeLlegada : [wireText(props.card?.wireFrom ?? props.defaultsForNew?.wireFrom ?? null)];
  const [avisoArco, setAvisoArco] = useState<string | null>(null);
  // H48: arcos escritos en esta hoja (ya guardados en la secuencia del caso).
  const [otroArco, setOtroArco] = useState(false);
  const [arcosNuevos, setArcosNuevos] = useState<WireStepDTO[]>([]);
  const todosLosArcos = [...props.availableWires, ...arcosNuevos];
  const wireToCurrent = todosLosArcos.find((w) => w.id === state.wireToId) ?? null;
  const wireToLabel = wireText(wireToCurrent);

  // Plantillas de nota (Rafael, 28-sep-2026): las seis de ortodoncia que ya
  // existían y nadie usaba (Cementado de brackets, Activación de arco, Control
  // mensual general, Cambio de alineador, Retiro de brackets, Entrega de
  // retenedor). Al elegir una se rellena la nota con lo que esta hoja ya sabe
  // —mes, fase, arcos— y lo demás queda como un hueco a la vista. No pisa lo
  // que ya esté escrito: se añade debajo.
  const aplicarPlantilla = (plantilla: { S: string; O: string; A: string; P: string }) => {
    const clave = props.card?.phaseKey ?? claveDeFase(props.defaultsForNew?.phase) ?? props.defaultsForNew?.phase ?? null;
    const arcoDe = props.card?.wireFrom ?? props.defaultsForNew?.wireFrom ?? null;
    // Fila 12 (b): lo que sigue tal cual se precargó lo reemplaza la
    // plantilla; lo que el doctor escribió se conserva (va debajo).
    const base = notaBaseParaPlantilla(state.soap, state.notaPrecargada, plantilla);
    const nota = aplicarPlantillaAlControl(base, plantilla, {
      mes: props.card?.monthAt ?? props.defaultsForNew?.monthAt ?? null,
      duracionMeses: props.defaultsForNew?.monthTotal ?? null,
      fase: clave ? ((PHASE_LABELS as Record<string, string>)[clave] ?? clave) : null,
      arcoActual: arcoDe || arcosDeLlegada.length > 0 ? wireFromLineas.join(" / ") : null,
      arcoNuevo: wireToCurrent ? wireText(wireToCurrent) : null,
    });
    (["s", "o", "a", "p"] as const).forEach((campo) => {
      if (nota[campo] !== state.soap[campo]) dispatch({ kind: "set-soap", field: campo, value: nota[campo] });
    });
  };
  // NOM-004 (ws1-t9 #2): una nota con huecos «____» de la plantilla no se firma; el mensaje dice cuántos y dónde.
  // ws1-t8 (ticket BEVADENT, punto 10): solo bloquea un hueco en el Plan (lo obligatorio). Los de S/O/A se avisan
  // y se firman escritos «[sin dato]» (signTreatmentCard → rellenarHuecosOpcionales).
  const avisoDeHuecos = mensajeDeHuecos(state.soap);
  const textosFirma = useTextosFirmaControl();
  const huecosOpcionales = huecosDeLaNota(state.soap).porCampo.filter((c) => c.campo !== "p");
  const avisoHuecosOpcionales = huecosOpcionales.length
    ? textosFirma.huecosOpcionales(
        huecosOpcionales.reduce((n, c) => n + c.huecos, 0),
        huecosOpcionales.map((c) => c.campo as "s" | "o" | "a"),
      )
    : null;
  // ws1-t8 (punto 12): cita de un día futuro sin el paciente presente → la firma no la toca.
  const decisionCita =
    props.appointmentId && props.cita?.estado && props.cita.inicio
      ? citaAlFirmar(
          { status: props.cita.estado, startsAt: new Date(props.cita.inicio) },
          new Date(),
          zonaFijada() ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        )
      : null;
  const avisoCitaDeOtroDia = decisionCita && "diaDeLaCita" in decisionCita ? textosFirma.citaDeOtroDia(decisionCita.diaDeLaCita) : null;

  const buildSubmit = (): DrawerCardSubmit => ({
    cardId: state.learnedCardId,
    soap: state.soap,
    hygiene: {
      plaquePct: state.plaquePct,
      gingivitis: state.gingivitis,
      whiteSpots: state.whiteSpots,
    },
    elastics: state.elastics.map((e) => ({
      elasticClass: e.elasticClass,
      config: e.config,
      zone: e.zone,
    })),
    iprPoints: state.iprPoints.map((p) => ({
      toothA: p.toothA,
      toothB: p.toothB,
      amountMm: p.amountMm,
      done: p.done,
    })),
    brokenBrackets: state.brokenBrackets.map((b) => ({
      toothFdi: b.toothFdi,
      brokenDate: b.brokenDate,
      reBondedDate: b.reBondedDate,
    })),
    hasProgressPhoto: state.hasProgressPhoto,
    photoSetId: state.photoSetId,
    wireToId: state.wireToId,
    nextDate: state.nextDate,
    nextDurationMin: state.nextDurationMin,
    activationsNote: state.activationsNote.trim() ? state.activationsNote : null,
    indications: state.indications.trim() ? state.indications : null,
    appointmentId: props.appointmentId ?? null,
    ...(isNew && props.defaultsForNew
      ? {
          encabezado: {
            cardNumber: props.defaultsForNew.cardNumber,
            phaseKey: claveDeFase(props.defaultsForNew.phase),
            monthAt: props.defaultsForNew.monthAt,
            wireFromId: props.defaultsForNew.wireFrom?.id ?? null,
            visitDate: props.defaultsForNew.visitDate,
          },
        }
      : {}),
    ...(procSel !== undefined ? { procedimientos: procSel } : {}),
    ...(extraccionesHoy.length > 0 ? { extraccionesRealizadas: extraccionesHoy } : {}),
  });

  // Fila 12 (c): solo el Plan es obligatorio (S/O/A opcionales); un Plan
  // precargado sin tocar no cuenta. Misma regla en el servidor (canSignSoap).
  const canSign = puedeFirmarNota(state.soap, state.notaPrecargada) && !avisoDeHuecos;

  const firmar = async () => {
    if (enVuelo || !props.onSign) return;
    setEnVuelo(true);
    try {
      const submit = buildSubmit();
      const id = await props.onSign(submit);
      if (id) {
        dispatch({ kind: "learn-card-id", id });
        // M11: solo se ofrece Agendar/Avisar si el llamador
        // confirmó un cardId real — si falló, `id` viene
        // falsy y el error ya se mostró por su cuenta
        // (toast/aviso propio de cada caller).
        setJustSigned({ cardId: id, nextDate: submit.nextDate, nextDurationMin: submit.nextDurationMin });
        setProcRecarga((n) => n + 1);
      }
    } finally {
      setEnVuelo(false);
    }
  };

  // ws1-t8 (decisión 13): «Registrar la colocación primero» no pierde lo escrito: guarda la hoja como borrador y,
  // solo si se guardó, pasa a registrar la colocación. Si no se guardó, el error ya salió y la hoja sigue abierta.
  const registrarColocacionPrimero = async () => {
    if (enVuelo || !props.onRegistrarColocacion) return;
    setEnVuelo(true);
    try {
      if (props.onSave) {
        const id = await props.onSave(buildSubmit());
        if (!id) return;
        dispatch({ kind: "learn-card-id", id });
      }
      setPreguntaPorColocar(false);
      props.onRegistrarColocacion();
    } finally {
      setEnVuelo(false);
    }
  };

  // M11 (Ronda 6): control recién firmado en ESTA sesión del cajón —
  // pantalla de cierre con Agendar/Avisar en el momento, en vez de cerrar en
  // silencio (hallazgo 11 y 13). No usa `isReadOnly`/`props.card` porque el
  // padre no siempre remonta el componente con el card ya firmado.
  if (justSigned) {
    return (
      <>
        <div className={orto.velo} onClick={props.onClose} aria-hidden />
        <aside
          ref={cajonRef}
          tabIndex={-1}
          className={orto.cajon}
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-tcard-title"
        >
          <header className={orto.cajonCabeza}>
            <div className={orto.cajonTextos}>
              <div className={orto.cajonCeja}>Control firmado</div>
              <h3 id="drawer-tcard-title" className={`${orto.cajonTitulo} flex items-center gap-2`}>
                <Check size={17} strokeWidth={2.2} className={orto.tonoExito} aria-hidden />
                Listo
              </h3>
            </div>
            <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
              <X size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </header>
          <div className={orto.cajonCuerpo}>
            {props.treatmentPlanId ? (
              <ProcedimientosDeVisita
                treatmentPlanId={props.treatmentPlanId}
                cardId={justSigned.cardId}
                soloLectura
                seleccion={undefined}
                onSeleccion={() => {}}
                recarga={procRecarga}
              />
            ) : null}
            <section className={orto.bloque}>
              <div className={orto.bloqueCabeza}>
                <h4 className={orto.bloqueTitulo}>Próximo control</h4>
              </div>
              {justSigned.nextDate ? (
                <>
                  <div className={orto.caja} style={{ marginBottom: 10 }}>
                    {fmtFechaHoraLarga(justSigned.nextDate)}
                    {justSigned.nextDurationMin ? ` · ${justSigned.nextDurationMin} min` : ""}
                  </div>
                  <div className="flex flex-wrap items-center gap-[8px]">
                    <AgendarProximoControlButton cardId={justSigned.cardId} />
                    <AvisarProximoControlButton cardId={justSigned.cardId} />
                  </div>
                </>
              ) : (
                <>
                  <div className={orto.vacioLinea} style={{ marginBottom: 10 }}>Sin próximo control capturado en esta hoja.</div>
                  {props.paciente ? (
                    <AgendarControlBoton patientId={props.paciente.id} patientName={props.paciente.nombre} doctorId={props.paciente.doctorId} />
                  ) : null}
                </>
              )}
            </section>
          </div>
          <footer className={orto.cajonPie}>
            <Btn variant="ghost" size="md" onClick={props.onClose} className="ml-auto">
              Cerrar
            </Btn>
          </footer>
        </aside>
      </>
    );
  }

  return (
    <>
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside
        ref={cajonRef}
        tabIndex={-1}
        className={orto.cajon}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-tcard-title"
      >
        <header className={orto.cajonCabeza}>
          <div className={orto.cajonTextos}>
            <div className={orto.cajonCeja}>
              {headerEyebrow}
              {isReadOnly ? <span className={orto.tonoApagado}> · firmado</span> : null}
            </div>
            <h3 id="drawer-tcard-title" className={orto.cajonTitulo}>
              {headerTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            className={orto.botonIcono}
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div className={orto.cajonCuerpo}>
          {/* ARCO */}
          <section className={orto.bloque}>
            <div className={orto.bloqueCabeza}>
              <h4 className={orto.bloqueTitulo}>Arco</h4>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-0">
                <div className={orto.campoEtiqueta}>Actual</div>
                <div className="flex items-center h-[38px] text-[13.5px] font-semibold">
                  <span className="flex flex-col">
                    {wireFromLineas.map((l) => (
                      <span key={l}>{l}</span>
                    ))}
                  </span>
                </div>
              </div>
              <ChevronRight
                size={16}
                strokeWidth={1.75}
                className={`${orto.tonoApagado} mb-[11px] flex-none`}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className={`${orto.campoEtiqueta} mb-[5px]`}>
                Nuevo
                {!isReadOnly && state.delAnterior.arco ? (
                  <DelAnterior className="ml-[6px]" />
                ) : null}
              </div>
                {isReadOnly ? (
                  <div className={`${orto.tonoVioleta} flex items-center h-[38px] text-[13.5px] font-semibold`}>
                    {wireToLabel}
                  </div>
                ) : (
                  <select
                    value={state.wireToId ?? ""}
                    onChange={(e) => {
                      if (e.target.value === "__otro__") {
                        setOtroArco(true);
                        return;
                      }
                      setOtroArco(false);
                      setAvisoArco(null);
                      dispatch({ kind: "set-wire-to", value: e.target.value || null });
                    }}
                    className={orto.entrada}
                    aria-label="Arco nuevo"
                  >
                    <option value="">Sin cambio</option>
                    {todosLosArcos.map((w) => (
                      <option key={w.id} value={w.id}>
                        {textoDeArcoConArcada(w)}
                      </option>
                    ))}
                    {props.treatmentPlanId ? <option value="__otro__">Otro arco…</option> : null}
                  </select>
                )}
                {!isReadOnly && avisoSinArcosPlanificados(todosLosArcos.length, Boolean(props.treatmentPlanId)) ? (
                  <p className={`${orto.bloqueNota} mt-[6px]`} data-sin-arcos>
                    {avisoSinArcosPlanificados(todosLosArcos.length, Boolean(props.treatmentPlanId))}
                  </p>
                ) : null}
                {otroArco && props.treatmentPlanId ? (
                  <OtroArcoForm
                    treatmentPlanId={props.treatmentPlanId}
                    phaseKey={todosLosArcos[todosLosArcos.length - 1]?.phaseKey ?? "ALIGNMENT"}
                    nextOrder={todosLosArcos.length + 1}
                    onCreated={(w, aviso) => {
                      setAvisoArco(aviso);
                      setArcosNuevos((prev) => [...prev, w]);
                      dispatch({ kind: "set-wire-to", value: w.id });
                      setOtroArco(false);
                    }}
                    onCancel={() => setOtroArco(false)}
                  />
                ) : null}
                {!isReadOnly && avisoArco ? (
                  <p className={`${orto.bloqueNota} mt-[6px]`} role="status" data-aviso-material>
                    {avisoArco}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {/* ELÁSTICOS */}
          <ElasticsBlock
            elastics={state.elastics}
            heredados={isReadOnly ? [] : state.delAnterior.elasticos}
            readOnly={isReadOnly}
            onAdd={(e) => dispatch({ kind: "add-elastic", value: e })}
            onUpdate={(id, patch) => dispatch({ kind: "update-elastic", id, patch })}
            onRemove={(id) => dispatch({ kind: "remove-elastic", id })}
          />

          {/* IPR */}
          <IprBlock
            points={state.iprPoints}
            readOnly={isReadOnly}
            onAdd={(p) => dispatch({ kind: "add-ipr", value: p })}
            onUpdate={(id, patch) => dispatch({ kind: "update-ipr", id, patch })}
            onToggle={(id) => dispatch({ kind: "toggle-ipr", id })}
            onRemove={(id) => dispatch({ kind: "remove-ipr", id })}
          />

          {/* BROKEN BRACKETS */}
          <BrokenBlock
            list={state.brokenBrackets}
            heredados={isReadOnly ? [] : state.delAnterior.brackets}
            readOnly={isReadOnly}
            onAdd={(b) => dispatch({ kind: "add-bracket", value: b })}
            onUpdate={(id, patch) => dispatch({ kind: "update-bracket", id, patch })}
            onMarkRebonded={(id) => dispatch({ kind: "mark-rebonded", id })}
            onRemove={(id) => dispatch({ kind: "remove-bracket", id })}
          />

          {/* PROCEDIMIENTOS DE ESTA VISITA (incluidos / con costo aparte) */}
          {props.treatmentPlanId ? (
            <ProcedimientosDeVisita
              treatmentPlanId={props.treatmentPlanId}
              cardId={state.learnedCardId ?? props.card?.id ?? null}
              soloLectura={isReadOnly}
              seleccion={procSel}
              onSeleccion={setProcSel}
              recarga={procRecarga}
              extracciones={extraccionesHoy}
              onExtracciones={setExtraccionesHoy}
            />
          ) : null}

          {/* ACTIVACIONES (C2) */}
          <section className={orto.bloque}>
            <div className={orto.bloqueCabeza}>
              <h4 className={orto.bloqueTitulo}>Activaciones de este control</h4>
              {!isReadOnly ? (
                <DictationMic onText={(t) => dispatch({ kind: "set-activations-note", value: appendDictado(state.activationsNote, t) })} />
              ) : null}
            </div>
            {isReadOnly ? (
              <Lectura vacio="Sin activaciones anotadas.">{state.activationsNote}</Lectura>
            ) : (
              <textarea
                value={state.activationsNote}
                onChange={(e) =>
                  dispatch({ kind: "set-activations-note", value: e.target.value })
                }
                rows={2}
                placeholder="Vueltas del expansor, activación de resortes o arcos auxiliares…"
                className={orto.entrada}
                aria-label="Activaciones de este control"
              />
            )}
          </section>

          {/* SOAP */}
          <section className={orto.bloque}>
            <div className={orto.bloqueCabeza}>
              <h4 className={orto.bloqueTitulo}>Nota de evolución</h4>
              {!isReadOnly ? (
                <span className={orto.plantillas}>
                  <EvolutionTemplatePicker
                    module="orthodontics"
                    ensureDefaults
                    align="right"
                    filter={(plantilla) => plantillaAplicaALaTecnica(plantilla, props.tecnica)}
                    onApply={(plantilla) => aplicarPlantilla(plantilla.soapTemplate)}
                  />
                </span>
              ) : null}
              {!isReadOnly && !canSign ? (
                <span className={`${orto.bloqueNota} ${orto.tonoAlerta}`}>
                  {state.notaPrecargada && state.soap.p.trim()
                    ? "Revisa el Plan (P): para firmar, escribe lo de este control"
                    : "El Plan (P) es obligatorio para firmar"}
                </span>
              ) : null}
            </div>
            {!isReadOnly && state.notaPrecargada ? (
              <p className={`${orto.bloqueNota} mb-[10px]`}>
                Nota precargada con los datos del caso: edítala o elige una plantilla.
              </p>
            ) : null}
            {!isReadOnly && avisoDeHuecos ? (
              <p className={`${orto.bloqueNota} ${orto.tonoAlerta} mb-[10px]`} role="alert" data-huecos>
                {avisoDeHuecos}
              </p>
            ) : null}
            {!isReadOnly && avisoHuecosOpcionales ? (
              <p className={`${orto.bloqueNota} mb-[10px]`} data-huecos-opcionales>
                {avisoHuecosOpcionales}
              </p>
            ) : null}
            <div className="flex flex-col gap-[10px]">
              {(
                [
                  ["s", "Subjetivo (opcional)", "Lo que refiere el paciente…"],
                  ["o", "Objetivo (opcional)", "Lo que encuentras en la exploración…"],
                  ["a", "Análisis (opcional)", "Tu valoración de cómo va el caso…"],
                  ["p", "Plan", "Lo que sigue para el próximo control…"],
                ] as const
              ).map(([key, label, pista]) => (
                <div key={key} className={orto.campo}>
                  <div className={`${orto.campoEtiqueta} flex items-center justify-between gap-2`}>
                    <span>
                      <span className={`${orto.tonoVioleta} font-bold mr-[5px]`}>
                        {key.toUpperCase()}
                      </span>
                      {label}
                    </span>
                    {!isReadOnly ? (
                      <DictationMic onText={(t) => dispatch({ kind: "set-soap", field: key, value: appendDictado(state.soap[key], t) })} />
                    ) : null}
                  </div>
                  {isReadOnly ? (
                    <Lectura vacio="Sin anotar.">{state.soap[key]}</Lectura>
                  ) : (
                    <textarea
                      value={state.soap[key]}
                      onChange={(e) =>
                        dispatch({ kind: "set-soap", field: key, value: e.target.value })
                      }
                      rows={2}
                      placeholder={pista}
                      className={orto.entrada}
                      aria-label={`SOAP ${label}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* INDICACIONES (C3) */}
          <section className={orto.bloque}>
            <div className={orto.bloqueCabeza}>
              <h4 className={orto.bloqueTitulo}>Indicaciones para el paciente</h4>
              <span className="inline-flex items-center gap-2">
                {!isReadOnly && state.delAnterior.indicaciones ? <DelAnterior /> : null}
                {!isReadOnly ? (
                  <DictationMic onText={(t) => dispatch({ kind: "set-indications", value: appendDictado(state.indications, t) })} />
                ) : null}
              </span>
            </div>
            {isReadOnly ? (
              <Lectura vacio="Sin indicaciones para este control.">{state.indications}</Lectura>
            ) : (
              <textarea
                value={state.indications}
                onChange={(e) => dispatch({ kind: "set-indications", value: e.target.value })}
                rows={2}
                placeholder="Horas de elásticos, higiene, qué no comer, qué hacer si se despega un bracket…"
                className={orto.entrada}
                aria-label="Indicaciones para el paciente"
              />
            )}
          </section>

          {/* HIGIENE */}
          <HygieneBlock
            plaquePct={state.plaquePct}
            gingivitis={state.gingivitis}
            whiteSpots={state.whiteSpots}
            readOnly={isReadOnly}
            onPlaque={(v) => dispatch({ kind: "set-plaque", value: v })}
            onGingivitis={(v) => dispatch({ kind: "set-gingivitis", value: v })}
            onWhiteSpots={(v) => dispatch({ kind: "set-white-spots", value: v })}
          />

          {/* FOTO (C4: liga un foto-set ya subido cuando hay catálogo disponible) */}
          <section className={orto.bloque}>
            <div className={orto.bloqueCabeza}>
              <h4 className={orto.bloqueTitulo}>Fotos de progreso</h4>
            </div>
            {props.availablePhotoSets && props.availablePhotoSets.length > 0 ? (
              isReadOnly ? (
                <div className={`${orto.tonoTexto2} text-[13px]`}>
                  {state.photoSetId
                    ? (props.availablePhotoSets.find((s) => s.id === state.photoSetId)?.label ??
                      "Juego de fotos vinculado")
                    : "Sin fotos ligadas a este control."}
                </div>
              ) : (
                <select
                  value={state.photoSetId ?? ""}
                  onChange={(e) =>
                    dispatch({ kind: "set-photo-set", value: e.target.value || null })
                  }
                  className={orto.entrada}
                  aria-label="Fotos de este control"
                >
                  <option value="">Sin fotos ligadas</option>
                  {props.availablePhotoSets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )
            ) : state.hasProgressPhoto ? (
              <div className={`${orto.caja} ${orto.cajaExito} flex items-center gap-2 text-[13px]`}>
                <Check size={16} strokeWidth={1.75} className={orto.tonoExito} aria-hidden />
                <span className={orto.tonoExito}>Fotos de progreso tomadas</span>
                {!isReadOnly ? (
                  <button
                    type="button"
                    onClick={() => dispatch({ kind: "set-has-photo", value: false })}
                    className={`${orto.enlace} ml-auto`}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
            ) : isReadOnly ? (
              <div className={orto.vacioLinea}>Sin fotos registradas en este control.</div>
            ) : (
              <Btn
                variant="violet-soft"
                size="md"
                className="w-full"
                icon={<Camera size={15} strokeWidth={1.75} aria-hidden />}
                onClick={() => dispatch({ kind: "set-has-photo", value: true })}
              >
                Marcar que se tomaron fotos
              </Btn>
            )}
          </section>

          {/* PRÓXIMA CITA (C5: "próximo control en N semanas" al cerrar la
              hoja — Recepción es quien la agenda de verdad, con un clic,
              cuando cobra; ver REPORTE-ws1-t4.md) */}
          {!isReadOnly ? (
            <section className={orto.bloque}>
              <div className={orto.bloqueCabeza}>
                <h4 className={orto.bloqueTitulo}>Próximo control en…</h4>
              </div>
              <div className="flex gap-[6px] flex-wrap mb-[10px]">
                {[2, 4, 6, 8].map((weeks) => {
                  const fecha = addWeeks(
                    props.card?.visitDate ?? props.defaultsForNew?.visitDate ?? null,
                    weeks,
                    Boolean(props.appointmentId),
                  );
                  const elegido = state.nextDate != null && state.nextDate === fecha;
                  return (
                    <button
                      key={weeks}
                      type="button"
                      aria-pressed={elegido}
                      onClick={() => dispatch({ kind: "set-next-date", value: fecha })}
                      className={[orto.chip, elegido ? orto.chipActivo : ""].filter(Boolean).join(" ")}
                    >
                      {weeks} semanas
                    </button>
                  );
                })}
              </div>
              <div className={orto.rejilla2}>
                <DateTimeField
                  value={toDatetimeLocalValue(state.nextDate)}
                  max={hoyMasAniosISO(3)}
                  onChange={(e) =>
                    dispatch({
                      kind: "set-next-date",
                      value: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    })
                  }
                  className={orto.entrada}
                  aria-label="Fecha próxima cita"
                />
                <select
                  value={state.nextDurationMin ?? 30}
                  onChange={(e) =>
                    dispatch({ kind: "set-next-duration", value: parseInt(e.target.value, 10) })
                  }
                  className={orto.entrada}
                  aria-label="Duración próxima cita"
                >
                  {[15, 30, 45, 60, 90].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>
            </section>
          ) : state.nextDate ? (
            // ws1-t1 ronda 2 — punto pendiente de la ronda 1: firmado el
            // control, se ofrece agendarlo de una vez (createBotAppointment,
            // mismos candados que cualquier alta) y avisar al paciente si
            // hay ventana de 24 h. Ambos usan cardId, no appointmentId: el
            // card puede no venir todavía de una cita real.
            <section className={orto.bloque}>
              <div className={orto.bloqueCabeza}>
                <h4 className={orto.bloqueTitulo}>Próximo control</h4>
              </div>
              <div className={orto.caja} style={{ marginBottom: 10 }}>
                {fmtFechaHoraLarga(state.nextDate)}
                {state.nextDurationMin ? ` · ${state.nextDurationMin} min` : ""}
              </div>
              {props.card?.id ? (
                <div className="flex flex-wrap items-center gap-[8px]">
                  <AgendarProximoControlButton cardId={props.card.id} />
                  <AvisarProximoControlButton cardId={props.card.id} />
                </div>
              ) : null}
            </section>
          ) : null}
          {!isReadOnly && avisoCitaDeOtroDia ? (
            <div className={`${orto.aviso} ${orto.avisoAlerta}`} role="status" data-cita-de-otro-dia>
              {avisoCitaDeOtroDia}
            </div>
          ) : null}
        </div>

        {!isReadOnly && preguntaPorColocar ? (
          // Entre el cuerpo y el pie: siempre a la vista junto a «Firmar control», sin hacer scroll.
          <div
            className={`${orto.aviso} ${orto.avisoAlerta}`}
            style={{ margin: "0 20px 12px" }}
            role="alertdialog"
            aria-labelledby="aviso-por-colocar-titulo"
            aria-describedby="aviso-por-colocar-cuerpo"
            data-aviso-por-colocar
          >
            <div className={orto.avisoTexto}>
              <strong id="aviso-por-colocar-titulo" className="block">{textosFirma.porColocarTitulo}</strong>
              <span id="aviso-por-colocar-cuerpo">{textosFirma.porColocarCuerpo}</span>
            </div>
            <div className="flex flex-wrap items-center gap-[8px]">
              {props.onRegistrarColocacion ? (
                <Btn variant="primary" size="sm" autoFocus disabled={enVuelo} onClick={() => void registrarColocacionPrimero()}>
                  {textosFirma.porColocarRegistrar}
                </Btn>
              ) : null}
              <Btn
                variant="secondary"
                size="sm"
                autoFocus={!props.onRegistrarColocacion}
                disabled={enVuelo}
                onClick={() => {
                  setFirmarIgualAceptado(true);
                  setPreguntaPorColocar(false);
                  void firmar();
                }}
              >
                {textosFirma.porColocarFirmarIgual}
              </Btn>
            </div>
          </div>
        ) : null}

        <footer className={orto.cajonPie}>
          {props.card && props.onSharePatient ? (
            <Btn
              variant="ghost"
              size="md"
              className="mr-auto"
              icon={<MessageCircle size={15} strokeWidth={1.75} aria-hidden />}
              onClick={() => props.onSharePatient!(props.card!.id)}
            >
              Compartir con el paciente
            </Btn>
          ) : null}
          <Btn variant="ghost" size="md" onClick={props.onClose} disabled={enVuelo}>
            {isReadOnly ? "Cerrar" : "Cancelar"}
          </Btn>
          {!isReadOnly && props.onSave ? (
            <Btn
              variant="secondary"
              size="md"
              disabled={enVuelo}
              onClick={async () => {
                if (enVuelo) return;
                setEnVuelo(true);
                try {
                  const id = await props.onSave!(buildSubmit());
                  if (id) dispatch({ kind: "learn-card-id", id });
                } finally {
                  setEnVuelo(false);
                }
              }}
            >
              {enVuelo ? "Guardando…" : "Guardar borrador"}
            </Btn>
          ) : null}
          {!isReadOnly && props.onSign ? (
            <Btn
              variant="primary"
              size="md"
              icon={<Check size={15} strokeWidth={1.75} aria-hidden />}
              onClick={async () => {
                if (enVuelo) return;
                // ws1-t8 (decisión 13): caso «Por colocar» → primero el aviso con sus dos botones.
                if (pasoAlFirmar({ casoPorColocar: props.casoPorColocar, firmarIgualAceptado }) === "preguntar") {
                  setPreguntaPorColocar(true);
                  return;
                }
                await firmar();
              }}
              disabled={!canSign || enVuelo}
              title={avisoDeHuecos ?? (!canSign ? "Escribe el Plan (P) de este control para firmarlo" : undefined)}
            >
              {enVuelo ? "Firmando…" : "Firmar control"}
            </Btn>
          ) : null}
        </footer>
      </aside>
    </>
  );
}

/** Fila 12: marca de lo que la hoja nueva heredó del control anterior. */
function DelAnterior({ className = "" }: { className?: string }) {
  return (
    <Pill color="sky" size="xs" className={className}>
      Del control anterior
    </Pill>
  );
}

/** Fila 12: `defaultsForNew` → lo que hereda la hoja nueva (ver `initialState`). */
function precargaDesdeDefaults(d: DrawerTreatmentCardProps["defaultsForNew"]): PrecargaHoja | null {
  if (!d) return null;
  return {
    arcoId: d.wireFrom?.id ?? null,
    elastics: d.lastElastics ?? [],
    brackets: d.lastPendingBrackets ?? [],
    indications: d.lastIndications ?? null,
    nota: d.soapPrefill ?? null,
    notaDeLaConsulta: d.notaDeLaConsulta ?? null,
    duracionProximoMin: d.proximoControlMin ?? null,
  };
}

/** Un campo en modo lectura (control ya firmado). */
function Lectura({ children, vacio }: { children: string; vacio: string }) {
  return children ? (
    <div className={`${orto.caja} text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]`}>
      {children}
    </div>
  ) : (
    <div className={orto.vacioLinea}>{vacio}</div>
  );
}

// ─── Sub-blocks ─────────────────────────────────────────────────────────

function ElasticsBlock(props: {
  elastics: ElasticDTO[];
  /** Fila 12: ids heredados del control anterior (se marcan). */
  heredados: string[];
  readOnly: boolean;
  onAdd: (e: ElasticDTO) => void;
  onUpdate: (id: string, patch: Partial<Pick<ElasticDTO, "config" | "zone">>) => void;
  onRemove: (id: string) => void;
}) {
  const onPick = (cls: OrthoElasticClass) => {
    const id = `tmp-${Math.random().toString(36).slice(2)}`;
    props.onAdd({
      id,
      elasticClass: cls,
      config: '1/4" 6oz',
      zone: "INTERMAXILAR",
    });
  };
  return (
    <section className={orto.bloque}>
      <div className={orto.bloqueCabeza}>
        <h4 className={orto.bloqueTitulo}>Elásticos</h4>
      </div>
      {!props.readOnly ? (
        <div className="flex gap-[6px] flex-wrap mb-[10px]">
          {(["CLASE_I", "CLASE_II", "CLASE_III", "BOX"] as const).map((c) => (
            <button key={c} type="button" onClick={() => onPick(c)} className={orto.chip}>
              <Plus size={13} strokeWidth={2} aria-hidden />
              {ELASTIC_CLASS_LABELS[c]}
            </button>
          ))}
        </div>
      ) : null}
      {props.elastics.length === 0 ? (
        <div className={orto.vacioLinea}>Sin elásticos en este control.</div>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {props.elastics.map((e) =>
            props.readOnly ? (
              <div key={e.id} className={`${orto.caja} flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]`}>
                <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                  {ELASTIC_CLASS_LABELS[e.elasticClass]} {e.config}
                </span>
                <span className={`${orto.tonoApagado} ml-auto text-xs`}>
                  {ELASTIC_ZONE_LABELS[e.zone]}
                </span>
              </div>
            ) : (
              // Con «Del control anterior» la fila no cabe en el cajón (390 y 520 px): salta de línea
              // en vez de salirse por la derecha, y el campo de texto puede encogerse (`min-w-0`).
              <div key={e.id} className={`${orto.caja} flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px]`}>
                <span className="font-semibold shrink-0">{ELASTIC_CLASS_LABELS[e.elasticClass]}</span>
                {props.heredados.includes(e.id) ? <DelAnterior className="shrink-0" /> : null}
                <input
                  type="text"
                  value={e.config}
                  onChange={(ev) => props.onUpdate(e.id, { config: ev.target.value })}
                  className={`${orto.entrada} min-w-[120px] flex-1 basis-[120px]`}
                  aria-label="Descripción del elástico (medida y onzas)"
                />
                <select
                  value={e.zone}
                  onChange={(ev) => props.onUpdate(e.id, { zone: ev.target.value as OrthoElasticZone })}
                  className={`${orto.entrada} w-[140px] min-w-0 max-w-full shrink-0`}
                  aria-label="Zona del elástico"
                >
                  {(["ANTERIOR", "POSTERIOR", "INTERMAXILAR"] as const).map((z) => (
                    <option key={z} value={z}>
                      {ELASTIC_ZONE_LABELS[z]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => props.onRemove(e.id)}
                  aria-label="Quitar elástico"
                  className={`${orto.botonIcono} ${orto.botonIconoPeligro} -my-1 -mr-1 shrink-0`}
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function IprBlock(props: {
  points: IPRPointDTO[];
  readOnly: boolean;
  onAdd: (p: IPRPointDTO) => void;
  onUpdate: (id: string, patch: Partial<Pick<IPRPointDTO, "toothA" | "toothB" | "amountMm">>) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const onAddRow = () => {
    const id = `tmp-${Math.random().toString(36).slice(2)}`;
    props.onAdd({ id, toothA: 13, toothB: 14, amountMm: 0.3, done: true });
  };
  return (
    <section className={orto.bloque}>
      <div className={orto.bloqueCabeza}>
        <h4 className={orto.bloqueTitulo}>IPR realizado</h4>
        {!props.readOnly ? (
          <button type="button" onClick={onAddRow} className={orto.chip}>
            <Plus size={13} strokeWidth={2} aria-hidden />
            Agregar
          </button>
        ) : null}
      </div>
      {props.points.length === 0 ? (
        <div className={orto.vacioLinea}>Sin IPR en este control.</div>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {props.points.map((p) => (
            <div
              key={p.id}
              className={`${orto.caja} ${p.done ? orto.cajaExito : ""} flex items-center gap-2 text-[13px]`}
            >
              {props.readOnly ? (
                <>
                  <span className="font-semibold">
                    {p.toothA}-{p.toothB}
                  </span>
                  <span className={`${p.done ? orto.tonoExito : orto.tonoTexto2} font-semibold`}>
                    {p.amountMm.toFixed(1)} mm
                  </span>
                </>
              ) : (
                <>
                  <div className="w-[34px] shrink-0">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={11}
                      max={48}
                      value={p.toothA}
                      onChange={(e) =>
                        props.onUpdate(p.id, {
                          toothA: e.target.value === "" ? p.toothA : parseInt(e.target.value, 10),
                        })
                      }
                      className={`${orto.entrada} ${orto.entradaCorta}`}
                      aria-label="Diente mesial del IPR"
                    />
                  </div>
                  <span className="font-semibold">-</span>
                  <div className="w-[34px] shrink-0">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={11}
                      max={48}
                      value={p.toothB}
                      onChange={(e) =>
                        props.onUpdate(p.id, {
                          toothB: e.target.value === "" ? p.toothB : parseInt(e.target.value, 10),
                        })
                      }
                      className={`${orto.entrada} ${orto.entradaCorta}`}
                      aria-label="Diente distal del IPR"
                    />
                  </div>
                  <div className="w-[52px] shrink-0">
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      value={p.amountMm}
                      onChange={(e) =>
                        props.onUpdate(p.id, {
                          amountMm: e.target.value === "" ? 0 : parseFloat(e.target.value),
                        })
                      }
                      className={`${orto.entrada} ${orto.entradaCorta}`}
                      aria-label="Milímetros de desgaste"
                    />
                  </div>
                  <span className={`${orto.tonoApagado} text-xs`}>mm</span>
                </>
              )}
              <span className={`${orto.tonoApagado} ml-auto text-xs`}>
                {p.done ? "Realizado" : "Pendiente"}
              </span>
              {!props.readOnly ? (
                <>
                  <button
                    type="button"
                    onClick={() => props.onToggle(p.id)}
                    className={orto.enlace}
                    aria-label={p.done ? "Marcar pendiente" : "Marcar realizado"}
                  >
                    {p.done ? "Dejar pendiente" : "Marcar realizado"}
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onRemove(p.id)}
                    aria-label="Quitar IPR"
                    className={`${orto.botonIcono} ${orto.botonIconoPeligro} -my-1 -mr-1`}
                  >
                    <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                  </button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BrokenBlock(props: {
  list: BrokenBracketDTO[];
  /** Fila 12: ids de pendientes heredados del control anterior (se marcan). */
  heredados: string[];
  readOnly: boolean;
  onAdd: (b: BrokenBracketDTO) => void;
  onUpdate: (id: string, patch: Partial<Pick<BrokenBracketDTO, "toothFdi" | "brokenDate">>) => void;
  onMarkRebonded: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const onAddRow = () => {
    const id = `tmp-${Math.random().toString(36).slice(2)}`;
    props.onAdd({
      id,
      toothFdi: 25,
      brokenDate: new Date().toISOString(),
      reBondedDate: null,
      notes: null,
    });
  };
  return (
    <section className={orto.bloque}>
      <div className={orto.bloqueCabeza}>
        <h4 className={orto.bloqueTitulo}>Brackets caídos</h4>
        {!props.readOnly ? (
          <button type="button" onClick={onAddRow} className={orto.chip}>
            <Plus size={13} strokeWidth={2} aria-hidden />
            Reportar
          </button>
        ) : null}
      </div>
      {props.list.length === 0 ? (
        <div className={orto.vacioLinea}>Ningún bracket caído.</div>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {props.list.map((b) => (
            <div
              key={b.id}
              className={`${orto.caja} ${b.reBondedDate ? "" : orto.cajaPeligro} flex items-center gap-2 text-[13px]`}
            >
              {props.readOnly ? (
                <span className="font-semibold">Diente {b.toothFdi}</span>
              ) : (
                <>
                  <span className="font-semibold shrink-0">Diente</span>
                  <div className="w-[34px] shrink-0">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={11}
                      max={48}
                      value={b.toothFdi}
                      onChange={(e) =>
                        props.onUpdate(b.id, {
                          toothFdi: e.target.value === "" ? b.toothFdi : parseInt(e.target.value, 10),
                        })
                      }
                      className={`${orto.entrada} ${orto.entradaCorta}`}
                      aria-label="Diente FDI del bracket caído"
                    />
                  </div>
                  {/* H50: «se me cayó hace diez días» — la fecha ya no es siempre hoy. */}
                  <DateField
                    value={b.brokenDate.slice(0, 10)}
                    max={hoyISO()}
                    onChange={(e) =>
                      e.target.value
                        ? props.onUpdate(b.id, { brokenDate: new Date(`${e.target.value}T12:00:00`).toISOString() })
                        : undefined
                    }
                    className={orto.entrada}
                    aria-label="Fecha en que se cayó el bracket"
                  />
                </>
              )}
              <span className="ml-auto flex items-center gap-2">
                {props.heredados.includes(b.id) ? <DelAnterior /> : null}
                {b.reBondedDate ? (
                  <Pill color="emerald" size="xs">
                    Recementado
                  </Pill>
                ) : (
                  <span className={`${orto.tonoPeligro} text-xs font-semibold`}>Pendiente</span>
                )}
                {!props.readOnly && !b.reBondedDate ? (
                  <button
                    type="button"
                    onClick={() => props.onMarkRebonded(b.id)}
                    className={orto.enlace}
                  >
                    Marcar recementado
                  </button>
                ) : null}
              </span>
              {!props.readOnly ? (
                <button
                  type="button"
                  onClick={() => props.onRemove(b.id)}
                  aria-label="Quitar bracket caído"
                  className={`${orto.botonIcono} ${orto.botonIconoPeligro} -my-1 -mr-1`}
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HygieneBlock(props: {
  plaquePct: number | null;
  gingivitis: OrthoGingivitisLevel | null;
  whiteSpots: boolean;
  readOnly: boolean;
  onPlaque: (v: number | null) => void;
  onGingivitis: (v: OrthoGingivitisLevel | null) => void;
  onWhiteSpots: (v: boolean) => void;
}) {
  return (
    <section className={orto.bloque}>
      <div className={orto.bloqueCabeza}>
        <h4 className={orto.bloqueTitulo}>Higiene</h4>
      </div>
      <div className={orto.rejilla3}>
        <div className={orto.campo}>
          <div className={orto.campoEtiqueta}>Placa (%)</div>
          {props.readOnly ? (
            <div className="flex items-center h-[38px] text-[13.5px] font-semibold">
              {props.plaquePct ?? "—"}%
            </div>
          ) : (
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={props.plaquePct ?? ""}
              onChange={(e) =>
                props.onPlaque(e.target.value === "" ? null : parseInt(e.target.value, 10))
              }
              className={orto.entrada}
              aria-label="Placa porcentaje"
            />
          )}
        </div>
        <div className={orto.campo}>
          <div className={orto.campoEtiqueta}>Gingivitis</div>
          {props.readOnly ? (
            <div className="flex items-center h-[38px] text-[13.5px] font-semibold">
              {props.gingivitis ? GINGIVITIS_LABELS[props.gingivitis] : "—"}
            </div>
          ) : (
            <select
              value={props.gingivitis ?? ""}
              onChange={(e) =>
                props.onGingivitis(
                  e.target.value === "" ? null : (e.target.value as OrthoGingivitisLevel),
                )
              }
              className={orto.entrada}
              aria-label="Gingivitis nivel"
            >
              <option value="">—</option>
              {(["AUSENTE", "LEVE", "MODERADA", "SEVERA"] as const).map((g) => (
                <option key={g} value={g}>
                  {GINGIVITIS_LABELS[g]}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className={orto.campo}>
          <div className={orto.campoEtiqueta}>Manchas blancas</div>
          {props.readOnly ? (
            <div className="flex items-center h-[38px] text-[13.5px] font-semibold">
              {props.whiteSpots ? "Sí" : "No"}
            </div>
          ) : (
            <label className={`${orto.casilla} h-[38px]`}>
              <input
                type="checkbox"
                checked={props.whiteSpots}
                onChange={(e) => props.onWhiteSpots(e.target.checked)}
              />
              Presentes
            </label>
          )}
        </div>
      </div>
    </section>
  );
}

function OtroArcoForm(props: {
  treatmentPlanId: string;
  phaseKey: WireStepDTO["phaseKey"];
  nextOrder: number;
  onCreated: (w: WireStepDTO, aviso: string | null) => void;
  onCancel: () => void;
}) {
  const [material, setMaterial] = useState("NITI_SUPER");
  const [gauge, setGauge] = useState("014");
  // ws1-t12 (punto 4c): la arcada se elige, como en «Agregar arco». Antes era siempre de las dos.
  const [archUpper, setArchUpper] = useState(true);
  const [archLower, setArchLower] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shape = gauge.includes("x") ? "RECT" : "ROUND";
  const guardar = async () => {
    if (!archUpper && !archLower) {
      setError("Marca al menos una arcada: superior, inferior o las dos.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const res = await addWireStep({
        treatmentPlanId: props.treatmentPlanId,
        phase: props.phaseKey,
        material,
        shape,
        gauge,
        archUpper,
        archLower,
        durationWeeks: 6,
        auxiliaries: [],
      });
      if (isFailure(res)) {
        setError(res.error);
        return;
      }
      // ws1-t12 (punto 4d): la fila tal como quedó guardada (material y arcada), no una adivinanza de la pantalla.
      // Revisión en panel.108 (fallo 5): sin el SQL de materiales un NiTi superelástico/termoactivado queda «NiTi» y se dice.
      props.onCreated(res.data.paso, res.data.aviso ?? null);
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className="mt-2 flex flex-col gap-[6px]">
      <select value={material} onChange={(e) => setMaterial(e.target.value)} className={orto.entrada} aria-label="Material del arco">
        {WIRE_MATERIAL_OPTIONS.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
      <select value={gauge} onChange={(e) => setGauge(e.target.value)} className={orto.entrada} aria-label="Calibre del arco">
        {[...WIRE_GAUGE_ROUND, ...WIRE_GAUGE_RECT].map((g) => (
          <option key={g.key} value={g.key}>
            {g.label}
          </option>
        ))}
      </select>
      <div className="flex gap-3" role="group" aria-label="Arcada del arco">
        <label className={orto.casilla}>
          <input type="checkbox" checked={archUpper} onChange={(e) => setArchUpper(e.target.checked)} />
          Superior
        </label>
        <label className={orto.casilla}>
          <input type="checkbox" checked={archLower} onChange={(e) => setArchLower(e.target.checked)} />
          Inferior
        </label>
      </div>
      {error ? <div className="text-[12px]" role="alert">{error}</div> : null}
      <div className="flex gap-2">
        <Btn variant="secondary" size="sm" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Agregar arco"}
        </Btn>
        <Btn variant="secondary" size="sm" onClick={props.onCancel}>
          Cancelar
        </Btn>
      </div>
    </div>
  );
}

/** «NiTi 014 · Ambas»: con su arcada (ws1-t12, revisión en panel.108, fallo 4). */
function wireText(wire: { gauge: string; material: string; archUpper?: boolean; archLower?: boolean } | null): string {
  if (!wire) return "—";
  return textoDeArcoConArcada(wire);
}

/** C5: "próximo control en N semanas" — parte de la fecha de ESTA visita, no de hoy. */
function addWeeks(fromIso: string | null, weeks: number, horaDeCita = false): string {
  // ws1-t9 #11: la hora sale de la CITA, o cae dentro del horario (no «la hora actual», que a las
  // 10:26 p. m. hacía fallar «Agendar este control» por caer fuera del horario de la clínica).
  return proximaFechaDeControl({ desde: fromIso, semanas: weeks, horaDeCita });
}

/**
 * ISO UTC → el string local que pide `<input type="datetime-local">`.
 * Hallazgo ws1-t4 §4: `iso.slice(0, 16)` pintaba los dígitos UTC tal cual
 * (05:45 UTC salía como "05:45" en la casilla, cuando en México son las
 * 23:45 del día anterior o similar según la fecha). `getHours()`/
 * `getMinutes()` etc. SÍ convierten a la zona del navegador — mismo
 * criterio que ya usan `fmtDate`/`fmtTime` de `atoms/format.ts` para el
 * resto de fechas de esta pantalla (sin timezone explícita de la clínica:
 * el equipo que llena la hoja trabaja desde la propia clínica).
 */
export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
