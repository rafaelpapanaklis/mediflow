"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertTriangle, ChevronRight, ClipboardList, Grid3x3, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { COND_BY_ID, PERM, PRIMARY, SURFACE_NAMES, classify } from "@/components/dashboard/odontogram-v2/data";
import {
  CARAS, FASES, FASE_CLAVE, PLAN_VACIO, PRONOSTICOS, PRONOSTICO_CLAVE,
  alternarDiente, avisosDeOrden, componerDescripcion, fechaDeMarca, hallazgosPorTratar, importeRenglon,
  leerDientes, letraCentro, soloEntero, subtotalesPorFase, totalProcedimientos,
  type EntradaOdontograma, type Fase, type Hallazgo, type PlanClinico, type Pronostico, type Renglon,
} from "./plan-clinico";
import s from "./plan.module.css";
import { etiquetasDeProfesionales } from "@/lib/agenda/etiqueta-profesional";
import { DictationMic, appendDictado } from "@/components/clinical/shared/dictation-mic";
import { buscarEnTarifario, exactoEnTarifario } from "./buscar-tarifario";
import { renglonesDelPlanSinPrecio, useTextosSinPrecio } from "@/lib/quotes/sin-precio";
import { dineroExacto } from "@/lib/treatments/dinero-exacto";
import { PROCEDIMIENTOS, type ProcedimientoTarifario } from "@/lib/treatments/sugerir-procedimiento";
import { DIAS_ENTRE_SESIONES, agregarDesdeChip, chipsDelPlan, filasParaGuardar, nombrePorDefecto, sillon, type Chip } from "./armar-plan";
import { filasEnPlanesDelPaciente, guardarPlan, presentarDisponible, presentarPlan } from "./guardar-plan";
import type { FilaEnPlan } from "@/lib/treatments/ya-en-planes";

/**
 * «Nuevo plan de tratamiento» rápido (ws1-t5, fase 2 · P3), con el lenguaje del menú de dos niveles.
 *
 * Se arma tocando: doctor (el de la sesión) y nombre («Plan 20 oct 2026») vienen solos; cada chip
 * del odontograma entra como un procedimiento con precio, minutos y fase del tarifario
 * (`armar-plan.ts`, `sugerir-procedimiento.ts`); el procedimiento se corrige con el buscador del
 * tarifario de siempre. Diagnóstico, pronóstico, alternativa y notas van plegados y son opcionales
 * (el diagnóstico se precarga de la última consulta). Ya NO se piden sesiones, días entre sesiones
 * ni costo: salen de los procedimientos.
 *
 * Guarda ella misma (`guardar-plan.ts`): las FILAS del contrato de t12 y, como siempre, el plan
 * como texto en `description`. Sin el SQL de filas la API guarda el texto y el plan queda como hoy.
 *
 * Se pinta dentro del apartado (no en un portal), pero monta `CLASES_MENU` él mismo para no
 * depender de quién lo abra.
 */

export interface FormPlan {
  doctorId: string;
  name: string;
  description: string;
  totalSessions: string;
  sessionIntervalDays: string;
  totalCost: string;
}

export interface VentanaNuevoPlanProps {
  paciente: { id: string; nombre: string; esNino: boolean };
  doctores: { id: string; firstName: string; lastName: string }[];
  /** Doctor y nombre del plan (los pone la ficha al abrir: el doctor es el de la sesión). */
  form: FormPlan;
  setForm: Dispatch<SetStateAction<FormPlan>>;
  /** Nombres comunes de plan (plegados en «Más detalles»). */
  sugerencias: string[];
  guardando: boolean;
  onCerrar: () => void;
  /**
   * Ya no se usa: la ventana guarda sus filas ella misma (ws1-t5, P3). Se queda en la interfaz
   * para no tocar la ficha, que la sigue pasando.
   */
  onCrear?: () => void;
  /** Al guardar, el plan que contestó la API. Sin él, la ventana refresca la página y se cierra. */
  onGuardado?: (plan: Record<string, unknown>) => void;
  /**
   * Lo que ya trae quien abre la ventana —la Nueva consulta, P9—: con ello no se vuelve a leer ni
   * a pedir. `entradas`: el odontograma de ESA consulta (con lo marcado aún sin guardar);
   * `diagnostico`: el de la consulta; `pronostico`: si la consulta ya lo tiene, no se pide otra vez.
   */
  precarga?: { entradas?: EntradaOdontograma[]; diagnostico?: string; pronostico?: Pronostico };
}

let contador = 0;
const nuevoId = () => `r${++contador}`;
const renglonNuevo = (parcial: Partial<Renglon> = {}): Renglon => ({
  id: nuevoId(),
  fase: "higienica",
  procedimiento: "",
  procedimientoId: null,
  dientes: "",
  caras: [],
  motivo: "",
  cantidad: "1",
  precio: "",
  precioDelTarifario: false,
  minutos: 0,
  ...parcial,
});

type Accion = "guardar" | "presentar";

export function VentanaNuevoPlan({ paciente, doctores, form, setForm, sugerencias, guardando: guardandoPadre, onCerrar, onGuardado, precarga }: VentanaNuevoPlanProps) {
  const t = useT();
  const idioma: "es" | "en" = useLocale() === "en" ? "en" : "es";
  const router = useRouter();
  const nombresDoctores = useMemo(() => etiquetasDeProfesionales(doctores), [doctores]);
  const [plan, setPlan] = useState<PlanClinico>(() => ({
    ...PLAN_VACIO,
    diagnostico: precarga?.diagnostico?.trim() ?? "",
    pronostico: precarga?.pronostico ?? "",
  }));
  const [tarifario, setTarifario] = useState<ProcedimientoTarifario[]>([]);
  const [entradas, setEntradas] = useState<EntradaOdontograma[]>(() => precarga?.entradas ?? []);
  // Lo que el paciente ya tiene en sus planes (de todos los doctores): lo rojo que ya está en uno no
  // se ofrece otra vez (v2 M1, v3). undefined = aún no contesta (lo rojo espera); null = no se pudo saber.
  const [enPlanes, setEnPlanes] = useState<FilaEnPlan[] | null | undefined>(undefined);
  const comprobandoPlanes = enPlanes === undefined;
  // Lo que trae la consulta no se vuelve a leer: ni su odontograma ni su diagnóstico.
  const odontogramaDeConsulta = precarga?.entradas !== undefined;
  const diagnosticoDeConsulta = precarga?.diagnostico !== undefined;
  // Pronóstico una sola vez (P9): si la consulta ya lo puso, aquí no se vuelve a pedir.
  const pronosticoDeConsulta = !!precarga?.pronostico;
  const [selectorAbierto, setSelectorAbierto] = useState<string | null>(null);
  // ws1-t2 (F15): el renglón cuyo buscador del tarifario está abierto y la sugerencia marcada.
  const [buscando, setBuscando] = useState<string | null>(null);
  const [marcada, setMarcada] = useState(0);
  const [nombreTocado, setNombreTocado] = useState(false);
  const [diagnosticoDe, setDiagnosticoDe] = useState<string | null>(null);
  const [detalles, setDetalles] = useState(false);
  const [guardandoPropio, setGuardandoPropio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<null | { tipo: "sinPrecio" | "sinCosto"; accion: Accion }>(null);
  const [puedePresentar, setPuedePresentar] = useState<boolean | null>(null);
  const focoPendiente = useRef<string | null>(null);
  const diagnosticoTocado = useRef(false);
  const guardando = guardandoPadre || guardandoPropio;

  // Tarifario, odontograma, última consulta y si ya existe «presentar»: lo que el repo ya sabe.
  // Si algo falla, la ventana sigue sirviendo: se teclea a mano como hoy.
  useEffect(() => {
    let vivo = true;
    fetch("/api/procedures")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (vivo && Array.isArray(d)) setTarifario(d); })
      .catch(() => {});
    if (!odontogramaDeConsulta) {
      fetch(`/api/odontogram?patientId=${encodeURIComponent(paciente.id)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!vivo || !d || !Array.isArray(d.entries)) return;
          // con la fecha de cada marca (ws1-t6 v5): lo hecho en otro plan ANTES de marcarla no la tapa
          setEntradas((d.entries as Array<EntradaOdontograma & { createdAt?: string; updatedAt?: string; estadoDesde?: string }>)
            .map((e) => ({ ...e, marcadaEn: fechaDeMarca(e) })));
        })
        .catch(() => {});
    }
    // Lo que ya está en los planes del paciente: lo rojo que ya está en uno no se vuelve a ofrecer.
    filasEnPlanesDelPaciente(paciente.id).then((f) => { if (vivo) setEnPlanes(f); });
    // El diagnóstico de la última consulta (sin `medicalRecord.view` la API dice 403 y no se precarga nada).
    if (!diagnosticoDeConsulta) fetch(`/api/clinical?patientId=${encodeURIComponent(paciente.id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const ultima = Array.isArray(d) ? d.find((x) => typeof x?.assessment === "string" && x.assessment.trim()) : null;
        if (!vivo || !ultima || diagnosticoTocado.current) return;
        setPlan((p) => (p.diagnostico.trim() ? p : { ...p, diagnostico: ultima.assessment.trim() }));
        setDiagnosticoDe(typeof ultima.visitDate === "string" ? ultima.visitDate : null);
      })
      .catch(() => {});
    presentarDisponible().then((ok) => { if (vivo) setPuedePresentar(ok); });
    return () => { vivo = false; };
    // La precarga es la de cuando se abrió la ventana: no se relee si la consulta cambia detrás.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paciente.id]);

  // El nombre se llena solo mientras nadie lo escriba (la ficha lo deja vacío al abrir).
  useEffect(() => {
    if (nombreTocado || form.name.trim()) return;
    setForm((f) => ({ ...f, name: nombrePorDefecto(new Date(), idioma) }));
  }, [form.name, nombreTocado, idioma, setForm]);

  const hallazgos: Hallazgo[] = useMemo(() => hallazgosPorTratar(entradas), [entradas]);
  const todosLosChips = useMemo(
    () => chipsDelPlan(hallazgos, tarifario, entradas, plan.renglones, enPlanes ?? []),
    [hallazgos, tarifario, entradas, plan.renglones, enPlanes],
  );
  // Las marcas ROJAS del odontograma (ws1-t6) van en su propia sección, con su precio.
  const chipsRojos = useMemo(() => todosLosChips.filter((c) => c.tipo === "por_hacer"), [todosLosChips]);
  const chips = useMemo(() => todosLosChips.filter((c) => c.tipo !== "por_hacer"), [todosLosChips]);

  const rotulos = useMemo(() => ({
    diagnostico: t("planTratamiento.texto.diagnostico"),
    pronostico: t("planTratamiento.texto.pronostico"),
    total: t("planTratamiento.texto.total"),
    alternativa: t("planTratamiento.texto.alternativa"),
    notas: t("planTratamiento.texto.notas"),
    por: t("planTratamiento.texto.por"),
    fase: (f: Fase) => t(FASE_CLAVE[f]),
    pronosticoValor: (p: Exclude<Pronostico, "">) => t(PRONOSTICO_CLAVE[p]),
    // Con centavos cuando los hay, y con la marca de «precios exactos» (ws1-t12, t8 N3-P2).
    dinero: (n: number) => dineroExacto(n),
    exacto: true,
  }), [t]);

  const total = totalProcedimientos(plan.renglones);
  const fases = subtotalesPorFase(plan.renglones);
  const avisos = avisosDeOrden(plan.renglones);
  const hayRenglones = fases.length > 0;
  const cuantos = fases.reduce((a, f) => a + f.renglones.length, 0);
  const tiempo = sillon(plan.renglones);
  // C-63 (auditoría de uso): un procedimiento sin precio no se guarda callado; se pregunta antes.
  const txSinPrecio = useTextosSinPrecio();
  const sinPrecio = renglonesDelPlanSinPrecio(plan.renglones);

  useEffect(() => {
    if (!focoPendiente.current) return;
    document.getElementById(focoPendiente.current)?.focus();
    focoPendiente.current = null;
  });

  const cambiarPlan = (cambio: (p: PlanClinico) => PlanClinico) => {
    setConfirmar(null);
    setError(null);
    setPlan(cambio);
  };

  const cambiar = (id: string, parcial: Partial<Renglon>) =>
    cambiarPlan((p) => ({ ...p, renglones: p.renglones.map((r) => (r.id === id ? { ...r, ...parcial } : r)) }));

  const agregar = () => {
    const nuevo = renglonNuevo();
    focoPendiente.current = `plan-proc-${nuevo.id}`;
    cambiarPlan((p) => ({ ...p, renglones: [...p.renglones, nuevo] }));
  };

  const quitar = (id: string) => {
    cambiarPlan((p) => ({ ...p, renglones: p.renglones.filter((r) => r.id !== id) }));
    if (selectorAbierto === id) setSelectorAbierto(null);
  };

  const nombreCondicion = (id: string) => COND_BY_ID[id]?.[idioma] ?? id;
  const nombreSugerido = (c: Chip) => (c.sugerencia ? (c.sugerencia.elegir ? c.sugerencia.nombreSugerido[idioma] : c.sugerencia.nombre) : "");
  const motivoDe = (c: Chip) =>
    c.tipo === "por_hacer"
      ? t("planTratamiento.nuevo.motivoPorHacer")
      : c.tipo === "encadenada" && c.sugerencia?.encadenadaDe
      ? t("planTratamiento.nuevo.motivoTras", { procedimiento: PROCEDIMIENTOS[c.sugerencia.encadenadaDe].nombre[idioma].toLowerCase() })
      : c.condiciones.map(nombreCondicion).join(" · ");

  // El toque en un chip: entra el procedimiento con su precio, sus minutos y su fase.
  const tocarChip = (c: Chip) =>
    cambiarPlan((p) => ({ ...p, renglones: agregarDesdeChip(p.renglones, c, { tarifario, entradas, nuevoId, motivo: motivoDe(c), idioma }) }));
  // «Agregar todo lo marcado por hacer»: un toque por cada chip rojo que falte.
  const agregarRojos = () =>
    !comprobandoPlanes && cambiarPlan((p) => ({
      ...p,
      renglones: chipsRojos.filter((c) => !c.puesto && c.enOtroPlan == null).reduce(
        (rs, c) => agregarDesdeChip(rs, c, { tarifario, entradas, nuevoId, motivo: motivoDe(c), idioma }), p.renglones),
    }));
  // «ya en el plan «X»» o, si esa fila ya se hizo, «ya hecha en el plan «X» (3 mar 2025)» (v4, m1).
  const textoYaEnPlan = (c: Chip) => {
    if (!c.enOtroPlan) return "";
    const { plan: nombrePlan, hechoEn } = c.enOtroPlan;
    if (!hechoEn) return t("planTratamiento.nuevo.yaEnPlan", { plan: nombrePlan });
    const fecha = new Intl.DateTimeFormat(idioma === "en" ? "en-US" : "es-MX", { day: "numeric", month: "short", year: "numeric" }).format(new Date(hechoEn));
    return t("planTratamiento.nuevo.yaHechaEnPlan", { plan: nombrePlan, fecha });
  };
  // «pieza 16 oclusal» / «pieza 16 MO» (la cara con su nombre cuando es una).
  const dondeRojo = (c: Chip) => {
    if (c.dientes.length !== 1) return t("planTratamiento.nuevo.nDientes", { count: c.dientes.length });
    const d = c.dientes[0];
    const letras = CARAS.filter((x) => c.caras.includes(x)).map((x) => (x === "O" ? letraCentro([d]) : x));
    let caras = letras.join("");
    if (letras.length === 1) {
      const nombre = SURFACE_NAMES[letras[0] as keyof typeof SURFACE_NAMES][idioma].split(" / ");
      caras = (letras[0] === "L" && nombre.length > 1 && !classify(d).upper ? nombre[1] : nombre[0]).toLowerCase();
    }
    return [t("planTratamiento.nuevo.pieza", { diente: String(d) }), caras].filter(Boolean).join(" ");
  };

  // Elegir del tarifario trae su nombre, su precio y su tiempo (el precio solo si el renglón no
  // tenía uno tecleado a mano).
  const elegirDelTarifario = (r: Renglon, hit: ProcedimientoTarifario, nombre = hit.name) => {
    const ponerPrecio = r.precio.trim() === "" || r.precioDelTarifario;
    cambiar(r.id, {
      procedimiento: nombre,
      procedimientoId: hit.id,
      minutos: hit.duration ?? 0,
      revisar: false,
      ...(ponerPrecio ? { precio: String(hit.basePrice), precioDelTarifario: true } : {}),
    });
  };

  // Al escribir: si el nombre es uno del tarifario (sin contar mayúsculas ni acentos) se toma
  // solo; si no, el renglón queda libre y abajo salen las sugerencias por PARTE del nombre.
  const cambiarProcedimiento = (r: Renglon, nombre: string) => {
    setBuscando(r.id);
    setMarcada(0);
    const hit = exactoEnTarifario(tarifario, nombre);
    if (!hit) {
      cambiar(r.id, {
        procedimiento: nombre,
        procedimientoId: null,
        // El precio que puso el tarifario ya no es de este nombre.
        ...(r.precioDelTarifario ? { precio: "", precioDelTarifario: false, minutos: 0 } : {}),
      });
      return;
    }
    elegirDelTarifario(r, hit, nombre);
  };

  const elegirSugerencia = (r: Renglon, hit: ProcedimientoTarifario) => {
    elegirDelTarifario(r, hit);
    setBuscando(null);
  };

  const etiquetaCaras = (c: Chip) => {
    if (c.dientes.length !== 1) return "";
    const centro = letraCentro(c.dientes);
    return CARAS.filter((x) => c.caras.includes(x)).map((x) => (x === "O" ? centro : x)).join("");
  };

  const arcadas = [PERM.upper, PERM.lower, ...(paciente.esNino ? [PRIMARY.upper, PRIMARY.lower] : [])];

  async function guardar(accion: Accion) {
    setError(null);
    if (!form.name.trim()) {
      setError(t("patients.createTreatment.nameRequired"));
      document.getElementById("plan-nombre")?.focus();
      return;
    }
    if (!form.doctorId) {
      setError(t("patients.createTreatment.doctorRequired"));
      return;
    }
    // Plan en $0 y renglones sin precio se confirman ANTES de guardar (la API también pide lo primero).
    if (total <= 0 && confirmar?.tipo !== "sinCosto") { setConfirmar({ tipo: "sinCosto", accion }); return; }
    if (total > 0 && sinPrecio > 0 && confirmar?.tipo !== "sinPrecio") { setConfirmar({ tipo: "sinPrecio", accion }); return; }
    setConfirmar(null);
    setGuardandoPropio(true);
    try {
      const r = await guardarPlan({
        patientId: paciente.id,
        doctorId: form.doctorId,
        name: form.name,
        description: componerDescripcion(plan, rotulos),
        totalSessions: Math.max(1, tiempo.citas),
        sessionIntervalDays: DIAS_ENTRE_SESIONES,
        totalCost: total,
        confirmarSinCosto: total <= 0,
        items: filasParaGuardar(plan.renglones),
      });
      if (!r.ok) {
        setError(
          r.claveError
            ? `${t(r.claveError)}${r.fila ? ` (${t("planTratamiento.nuevo.filaN", { n: r.fila })})` : ""}`
            : r.error ?? (r.status === 0 ? t("planTratamiento.nuevo.sinConexion") : t("patients.createTreatment.error")),
        );
        return;
      }
      toast.success(t("patients.createTreatment.success"));
      // El servidor avisa lo que ya estaba en otro plan (lo que no pasó por los chips, o se tecleó).
      if (r.yaEnOtrosPlanes?.length) {
        toast(t("planTratamiento.nuevo.yaEnOtrosPlanesAviso", {
          lista: r.yaEnOtrosPlanes.map((x) => `${x.nombre}${x.dientes.length ? ` ${x.dientes.join(",")}` : ""} («${x.plan}»)`).join("; "),
        }), { icon: "⚠️", duration: 9000 });
      }
      if (accion === "presentar") {
        const p = await presentarPlan(r.plan!.id);
        if (p.ok) toast.success(t("planTratamiento.nuevo.presentado", { folio: p.folio ?? "" }));
        else if (p.pronto) toast(t("planTratamiento.nuevo.presentarPronto"));
        else toast.error(p.error ?? t("planTratamiento.nuevo.presentarFallo"));
      }
      if (onGuardado) onGuardado(r.plan!);
      else {
        router.refresh();
        onCerrar();
      }
    } finally {
      setGuardandoPropio(false);
    }
  }

  const diagnosticoFecha = diagnosticoDe
    ? new Date(diagnosticoDe).toLocaleDateString(idioma === "en" ? "en-US" : "es-MX", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className={`${CLASES_MENU} ${s.velo}`} onClick={() => !guardando && onCerrar()}>
      <div
        className={s.caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-nuevo-titulo"
        data-plan-nuevo
        onClick={(e) => e.stopPropagation()}
      >
        <header className={s.cabecera}>
          <span className={s.cabeceraIcono}><ClipboardList size={17} strokeWidth={1.75} aria-hidden /></span>
          <div className={s.cabeceraTextos}>
            <h3 id="plan-nuevo-titulo" className={s.titulo}>{t("planTratamiento.nuevo.titulo")}</h3>
            <div className={s.subtitulo}>{paciente.nombre}</div>
          </div>
          <button type="button" className={s.cerrar} onClick={() => !guardando && onCerrar()} aria-label={t("common.close")}>
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </header>

        <div className={s.cuerpo}>
          {/* ── 1 · Quién y cómo se llama (vienen solos) ───────────────────── */}
          <section className={s.seccion}>
            <div className={s.dosColumnas}>
              <div className={s.campo}>
                <label className={s.rotulo} htmlFor="plan-doctor">{t("patients.treatment.doctorLabel")}</label>
                {/* El nombre visible completo, único en la lista: el mismo formateador que la Agenda. */}
                <select
                  id="plan-doctor"
                  className={s.entrada}
                  value={form.doctorId}
                  onChange={(e) => setForm((f) => ({ ...f, doctorId: e.target.value }))}
                >
                  {doctores.map((d) => (
                    <option key={d.id} value={d.id}>{nombresDoctores.get(d.id)?.nombre}</option>
                  ))}
                </select>
              </div>
              <div className={s.campo}>
                <label className={s.rotulo} htmlFor="plan-nombre">{t("planTratamiento.nuevo.nombre")}</label>
                <input
                  id="plan-nombre"
                  type="text"
                  className={s.entrada}
                  placeholder={t("patients.treatment.namePlaceholder")}
                  value={form.name}
                  title={t("planTratamiento.nuevo.nombrePista")}
                  onChange={(e) => { setNombreTocado(true); setForm((f) => ({ ...f, name: e.target.value })); }}
                />
              </div>
            </div>
          </section>

          {/* ── 2a · Marcado por hacer (rojo) en el odontograma → procedimientos (ws1-t6) ── */}
          {chipsRojos.length > 0 && (
            <section className={s.seccion} aria-labelledby="plan-por-hacer-titulo" data-plan-por-hacer>
              <div className={s.porHacerCabeza}>
                <h4 id="plan-por-hacer-titulo" className={s.seccionTitulo}>
                  <span className={s.puntoPorHacer} aria-hidden />{t("planTratamiento.nuevo.porHacer")}
                </h4>
                {chipsRojos.some((c) => !c.puesto && c.enOtroPlan == null) && (
                  <button type="button" className={s.ficha} onClick={agregarRojos} disabled={guardando || comprobandoPlanes} data-agregar-por-hacer>
                    <Plus size={12} strokeWidth={2} aria-hidden />{t("planTratamiento.nuevo.agregarTodoPorHacer")}
                  </button>
                )}
              </div>
              {comprobandoPlanes && <p className={s.pistaRenglon} role="status" data-comprobando-planes>{t("planTratamiento.nuevo.comprobandoPlanes")}</p>}
              {enPlanes === null && <p className={s.avisoPorHacer} role="alert" data-planes-sin-comprobar>{t("planTratamiento.nuevo.planesSinComprobar")}</p>}
              <div className={s.sugerencias}>
                {chipsRojos.map((c) => {
                  const sug = nombreSugerido(c);
                  const precio = c.sugerencia?.precio;
                  return (
                    <button
                      key={c.clave}
                      type="button"
                      data-chip={c.clave}
                      className={`${s.ficha} ${s.fichaPorHacer} ${c.puesto ? s.fichaPuesta : ""} ${c.enOtroPlan != null ? s.fichaEnOtroPlan : ""}`}
                      disabled={c.puesto || c.enOtroPlan != null || guardando || comprobandoPlanes}
                      onClick={() => tocarChip(c)}
                      title={c.enOtroPlan != null ? textoYaEnPlan(c) : t("planTratamiento.nuevo.hallazgoAgregar")}
                      data-en-otro-plan={c.enOtroPlan?.plan ?? undefined}
                    >
                      <span className={c.sugerencia?.elegir ? s.fichaSugeridoSinTarifario : undefined}>{sug || c.condiciones.map(nombreCondicion).join(" · ")}</span>
                      <span className={s.fichaCuenta}>· {dondeRojo(c)}</span>
                      {c.enOtroPlan != null ? (
                        <span className={s.fichaCuenta}>· {textoYaEnPlan(c)}</span>
                      ) : (
                        <span className={s.fichaPrecio}>· {precio != null ? dineroExacto(precio) : t("planTratamiento.nuevo.sinPrecio")}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── 2 · Hallazgos → procedimientos (un toque cada uno) ─────────── */}
          {chips.length > 0 && (
            <section className={s.seccion} aria-labelledby="plan-hallazgos-titulo">
              <h4 id="plan-hallazgos-titulo" className={s.seccionTitulo}>{t("planTratamiento.nuevo.hallazgos")}</h4>
              {/* sin sección roja, el «comprobando / no se pudo comprobar» va aquí (v4, M1) */}
              {chipsRojos.length === 0 && comprobandoPlanes && <p className={s.pistaRenglon} role="status" data-comprobando-planes>{t("planTratamiento.nuevo.comprobandoPlanes")}</p>}
              {chipsRojos.length === 0 && enPlanes === null && <p className={s.avisoPorHacer} role="alert" data-planes-sin-comprobar>{t("planTratamiento.nuevo.planesSinComprobar")}</p>}
              <div className={s.sugerencias}>
                {chips.map((c) => {
                  const sug = nombreSugerido(c);
                  const caras = etiquetaCaras(c);
                  return (
                    <button
                      key={c.clave}
                      type="button"
                      data-chip={c.clave}
                      className={`${s.ficha} ${s.fichaHallazgo} ${c.tipo === "encadenada" ? s.fichaEncadenada : ""} ${c.puesto ? s.fichaPuesta : ""} ${c.enOtroPlan != null ? s.fichaEnOtroPlan : ""}`}
                      // lo que ya está en otro plan no se ofrece; mientras no se sabe, se espera (v4, M1)
                      disabled={c.puesto || c.enOtroPlan != null || guardando || (comprobandoPlanes && !!c.sugerencia)}
                      onClick={() => tocarChip(c)}
                      title={c.enOtroPlan != null ? textoYaEnPlan(c) : t("planTratamiento.nuevo.hallazgoAgregar")}
                      data-en-otro-plan={c.enOtroPlan?.plan ?? undefined}
                    >
                      {c.tipo === "encadenada" && <Sparkles size={12} strokeWidth={1.75} aria-hidden />}
                      {c.dientes.length === 1 && <span className={s.fichaDiente}>{c.dientes[0]}</span>}
                      {caras && <span className={s.fichaCaras}>{caras}</span>}
                      {c.enOtroPlan != null ? (
                        <>
                          <span>{c.tipo === "encadenada" ? sug : c.condiciones.map(nombreCondicion).join(" · ")}</span>
                          <span className={s.fichaCuenta}>· {textoYaEnPlan(c)}</span>
                        </>
                      ) : c.tipo === "encadenada" ? (
                        <span>{t("planTratamiento.nuevo.sugeridoTras", { procedimiento: sug })}</span>
                      ) : (
                        <>
                          <span>{c.condiciones.map(nombreCondicion).join(" · ")}</span>
                          {c.dientes.length > 1 && <span className={s.fichaCuenta}>{t("planTratamiento.nuevo.nDientes", { count: c.dientes.length })}</span>}
                          {sug && (
                            <span className={`${s.fichaSugerido} ${c.sugerencia?.elegir ? s.fichaSugeridoSinTarifario : ""}`}>
                              <ChevronRight size={11} strokeWidth={2} aria-hidden />{sug}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── 3 · Procedimientos ──────────────────────────────────────── */}
          <section className={s.seccion}>
            <h4 className={s.seccionTitulo}>{t("planTratamiento.nuevo.procedimientos")}</h4>

            {plan.renglones.length > 0 && (
              <div className={s.renglones}>
                <div className={`${s.renglon} ${s.renglonCabeza}`} aria-hidden>
                  <span>{t("planTratamiento.nuevo.colFase")}</span>
                  <span>{t("planTratamiento.nuevo.colProcedimiento")}</span>
                  <span>{t("planTratamiento.nuevo.colDientes")}</span>
                  <span>{t("planTratamiento.nuevo.colCaras")}</span>
                  <span className={s.num}>{t("planTratamiento.nuevo.colCantidad")}</span>
                  <span className={s.num}>{t("planTratamiento.nuevo.colPrecio")}</span>
                  <span className={s.num}>{t("planTratamiento.nuevo.colImporte")}</span>
                  <span />
                </div>
                {plan.renglones.map((r) => {
                  const leidos = leerDientes(r.dientes);
                  const centro = letraCentro(leidos.dientes);
                  // Sugerencias visibles mientras se escribe (no una lista del navegador, que hay navegadores que no enseñan).
                  const deTarifario = buscando === r.id && !r.procedimientoId ? buscarEnTarifario(tarifario, r.procedimiento) : [];
                  const abiertas = deTarifario.length > 0;
                  const fueraDelTarifario = !abiertas && buscando !== r.id && r.procedimiento.trim() !== "" && !r.procedimientoId && r.precio.trim() === "";
                  return (
                    <div key={r.id} className={s.renglonCaja} data-renglon={r.clave ?? "manual"}>
                      <div className={s.renglon}>
                        <select
                          className={s.entrada}
                          aria-label={t("planTratamiento.nuevo.colFase")}
                          value={r.fase}
                          onChange={(e) => cambiar(r.id, { fase: e.target.value as Fase })}
                        >
                          {FASES.map((f) => <option key={f} value={f}>{t(FASE_CLAVE[f])}</option>)}
                        </select>
                        <input
                          id={`plan-proc-${r.id}`}
                          className={s.entrada}
                          role="combobox"
                          aria-autocomplete="list"
                          aria-expanded={abiertas}
                          aria-controls={`plan-sug-${r.id}`}
                          aria-activedescendant={abiertas ? `plan-sug-${r.id}-${Math.min(marcada, deTarifario.length - 1)}` : undefined}
                          autoComplete="off"
                          aria-label={t("planTratamiento.nuevo.colProcedimiento")}
                          placeholder={r.motivo ? t("planTratamiento.nuevo.procedimientoPara", { motivo: r.motivo }) : t("planTratamiento.nuevo.procedimientoEjemplo")}
                          value={r.procedimiento}
                          onChange={(e) => cambiarProcedimiento(r, e.target.value)}
                          onFocus={() => { setBuscando(r.id); setMarcada(0); }}
                          onBlur={() => setBuscando((b) => (b === r.id ? null : b))}
                          onKeyDown={(e) => {
                            if (!abiertas) return;
                            if (e.key === "ArrowDown") { e.preventDefault(); setMarcada((m) => (m + 1) % deTarifario.length); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); setMarcada((m) => (m - 1 + deTarifario.length) % deTarifario.length); }
                            else if (e.key === "Enter") { e.preventDefault(); elegirSugerencia(r, deTarifario[Math.min(marcada, deTarifario.length - 1)]); }
                            else if (e.key === "Escape") { e.stopPropagation(); setBuscando(null); }
                          }}
                        />
                        <div className={s.dientesCelda}>
                          <input
                            className={`${s.entrada} ${leidos.invalidos.length > 0 ? s.entradaMal : ""}`}
                            aria-label={t("planTratamiento.nuevo.colDientes")}
                            aria-invalid={leidos.invalidos.length > 0 || undefined}
                            placeholder={r.clave && r.dientes === "" ? t("planTratamiento.nuevo.todaLaBoca") : "16, 26"}
                            title={r.clave && r.dientes === "" ? t("planTratamiento.nuevo.todaLaBocaTitulo") : undefined}
                            inputMode="numeric"
                            value={r.dientes}
                            onChange={(e) => cambiar(r.id, { dientes: e.target.value })}
                          />
                          <button
                            type="button"
                            className={`${s.botonDientes} ${selectorAbierto === r.id ? s.botonDientesActivo : ""}`}
                            aria-expanded={selectorAbierto === r.id}
                            aria-label={t("planTratamiento.nuevo.elegirDientes")}
                            title={t("planTratamiento.nuevo.elegirDientes")}
                            onClick={() => setSelectorAbierto((a) => (a === r.id ? null : r.id))}
                          >
                            <Grid3x3 size={15} strokeWidth={1.75} aria-hidden />
                          </button>
                        </div>
                        <div className={s.caras} role="group" aria-label={t("planTratamiento.nuevo.colCaras")}>
                          {CARAS.map((c) => {
                            const puesta = r.caras.includes(c);
                            return (
                              <button
                                key={c}
                                type="button"
                                className={`${s.cara} ${puesta ? s.caraPuesta : ""}`}
                                aria-pressed={puesta}
                                title={t(`planTratamiento.cara.${c === "O" ? centro : c}`)}
                                onClick={() => cambiar(r.id, { caras: puesta ? r.caras.filter((x) => x !== c) : [...r.caras, c] })}
                              >
                                {c === "O" ? centro : c}
                              </button>
                            );
                          })}
                        </div>
                        {/* Solo enteros (revisión t8, N-P4): QuoteItem.quantity es Int. */}
                        <input
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          className={`${s.entrada} ${s.num}`}
                          aria-label={t("planTratamiento.nuevo.colCantidad")}
                          value={r.cantidad}
                          onChange={(e) => cambiar(r.id, { cantidad: soloEntero(e.target.value) })}
                        />
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={`${s.entrada} ${s.num}`}
                          aria-label={t("planTratamiento.nuevo.colPrecio")}
                          placeholder="0.00"
                          value={r.precio}
                          onChange={(e) => cambiar(r.id, { precio: e.target.value, precioDelTarifario: false })}
                        />
                        <span className={`${s.importe} ${s.num}`}>{dineroExacto(importeRenglon(r))}</span>
                        <button
                          type="button"
                          className={s.quitar}
                          onClick={() => quitar(r.id)}
                          aria-label={t("planTratamiento.nuevo.quitar")}
                          title={t("planTratamiento.nuevo.quitar")}
                        >
                          <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                        </button>
                      </div>
                      {abiertas && (
                        <div className={s.tarifarioSug}>
                          <span className={s.tarifarioSugTitulo}>{t("planTratamiento.nuevo.sugerencias")}</span>
                          <ul id={`plan-sug-${r.id}`} role="listbox" aria-label={t("planTratamiento.nuevo.sugerencias")} className={s.tarifarioSugLista}>
                            {deTarifario.map((p, i) => (
                              <li
                                key={p.id}
                                id={`plan-sug-${r.id}-${i}`}
                                role="option"
                                aria-selected={i === marcada}
                                className={`${s.tarifarioSugItem} ${i === marcada ? s.tarifarioSugMarcada : ""}`}
                                // mousedown y no click: el clic llega antes de que el campo pierda el foco.
                                onMouseDown={(e) => { e.preventDefault(); elegirSugerencia(r, p); }}
                                onMouseEnter={() => setMarcada(i)}
                              >
                                <span className={s.tarifarioSugNombre}>{p.name}</span>
                                <span className={`${s.tarifarioSugPrecio} ${s.num}`}>{dineroExacto(p.basePrice)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {fueraDelTarifario && (
                        <div className={s.avisoRenglon}>
                          <AlertTriangle size={12} strokeWidth={1.75} aria-hidden /> {t("planTratamiento.nuevo.sinTarifario")}
                        </div>
                      )}
                      {r.revisar && !fueraDelTarifario && !abiertas && (
                        <div className={s.pistaRenglon}>
                          <Sparkles size={12} strokeWidth={1.75} aria-hidden /> {t("planTratamiento.nuevo.revisar")}
                        </div>
                      )}
                      {leidos.invalidos.length > 0 && (
                        <div className={s.error}>{t("planTratamiento.nuevo.dienteInvalido", { dientes: leidos.invalidos.join(", ") })}</div>
                      )}
                      {selectorAbierto === r.id && (
                        <div className={s.selector}>
                          {arcadas.map((arcada, i) => (
                            <div key={i} className={s.arcada}>
                              {arcada.map((fdi, j) => {
                                const puesto = leidos.dientes.includes(fdi);
                                return (
                                  <button
                                    key={fdi}
                                    type="button"
                                    className={`${s.pieza} ${puesto ? s.piezaPuesta : ""} ${j === arcada.length / 2 ? s.piezaLineaMedia : ""}`}
                                    aria-pressed={puesto}
                                    onClick={() => cambiar(r.id, { dientes: alternarDiente(r.dientes, fdi) })}
                                  >
                                    {fdi}
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className={s.bajoRenglones}>
              <button type="button" className={s.boton} onClick={agregar}>
                <Plus size={14} strokeWidth={2} aria-hidden /> {t("planTratamiento.nuevo.agregar")}
              </button>
              {plan.renglones.length === 0 && <span className={s.pistaLinea}>{t("planTratamiento.nuevo.procedimientosPistaRapida")}</span>}
            </div>

            {avisos.length > 0 && (
              <ul className={s.avisos}>
                {avisos.map((a) => (
                  <li key={`${a.tipo}-${a.diente}`} className={s.aviso}>
                    <AlertTriangle size={13} strokeWidth={1.75} aria-hidden />
                    {t(`planTratamiento.aviso.${a.tipo}`, { diente: a.diente })}
                  </li>
                ))}
              </ul>
            )}

            {fases.length > 1 && (
              <div className={s.resumen}>
                {fases.map((f) => (
                  <div key={f.fase} className={s.resumenFila}>
                    <span>{t(FASE_CLAVE[f.fase])}</span>
                    <span className={s.resumenCuenta}>{t("planTratamiento.nuevo.nProcedimientos", { count: f.renglones.length })}</span>
                    <span className={s.num}>{dineroExacto(f.subtotal)}</span>
                  </div>
                ))}
                <div className={`${s.resumenFila} ${s.resumenTotal}`}>
                  <span>{t("planTratamiento.texto.total")}</span>
                  <span />
                  <span className={s.num}>{dineroExacto(total)}</span>
                </div>
              </div>
            )}
          </section>

          {/* ── 4 · Más detalles (opcionales, plegados) ─────────────────── */}
          <section className={s.seccion}>
            <button
              type="button"
              className={s.plegable}
              aria-expanded={detalles}
              aria-controls="plan-detalles"
              onClick={() => setDetalles((d) => !d)}
            >
              <ChevronRight size={14} strokeWidth={2} aria-hidden className={detalles ? s.plegableAbierto : undefined} />
              <span>{t("planTratamiento.nuevo.detalles")}</span>
              {!detalles && (diagnosticoFecha || (diagnosticoDeConsulta && plan.diagnostico.trim())) && (
                <span className={s.plegableNota}>
                  {t(diagnosticoDeConsulta ? "planTratamiento.nuevo.diagnosticoDeEstaConsulta" : "planTratamiento.nuevo.diagnosticoPrecargado")}
                </span>
              )}
            </button>
            {detalles && (
              <div id="plan-detalles" className={s.detalles}>
                <div className={s.dosColumnasAncha}>
                  <div className={s.campo}>
                    <div className={s.rotuloFila}>
                      <label className={s.rotulo} htmlFor="plan-diagnostico">{t("planTratamiento.nuevo.diagnosticoRotulo")}</label>
                      <DictationMic onText={(txt) => { diagnosticoTocado.current = true; setPlan((p) => ({ ...p, diagnostico: appendDictado(p.diagnostico, txt) })); }} />
                    </div>
                    <textarea
                      id="plan-diagnostico"
                      className={s.area}
                      rows={2}
                      placeholder={t("planTratamiento.nuevo.diagnosticoEjemplo")}
                      value={plan.diagnostico}
                      onChange={(e) => { diagnosticoTocado.current = true; setPlan((p) => ({ ...p, diagnostico: e.target.value })); }}
                    />
                    {diagnosticoFecha && <span className={s.pistaLinea}>{t("planTratamiento.nuevo.diagnosticoDeConsulta", { fecha: diagnosticoFecha })}</span>}
                    {diagnosticoDeConsulta && plan.diagnostico.trim() && <span className={s.pistaLinea}>{t("planTratamiento.nuevo.diagnosticoDeEstaConsultaPista")}</span>}
                  </div>
                  <div className={s.campo}>
                    {pronosticoDeConsulta && plan.pronostico ? (
                      <>
                        <span className={s.rotulo}>{t("planTratamiento.texto.pronostico")}</span>
                        <span className={s.valorFijo} data-plan-pronostico-de-consulta>{t(PRONOSTICO_CLAVE[plan.pronostico])}</span>
                        <span className={s.pistaLinea}>{t("planTratamiento.nuevo.pronosticoDeConsulta")}</span>
                      </>
                    ) : (
                      <>
                        <label className={s.rotulo} htmlFor="plan-pronostico">{t("planTratamiento.texto.pronostico")}</label>
                        <select
                          id="plan-pronostico"
                          className={s.entrada}
                          value={plan.pronostico}
                          onChange={(e) => setPlan((p) => ({ ...p, pronostico: e.target.value as Pronostico }))}
                        >
                          <option value="">{t("planTratamiento.pronostico.sinDefinir")}</option>
                          {PRONOSTICOS.map((p) => <option key={p} value={p}>{t(PRONOSTICO_CLAVE[p])}</option>)}
                        </select>
                      </>
                    )}
                  </div>
                </div>
                <div className={s.dosColumnas}>
                  <div className={s.campo}>
                    <div className={s.rotuloFila}>
                      <label className={s.rotulo} htmlFor="plan-alternativa">{t("planTratamiento.nuevo.alternativa")}</label>
                      <DictationMic onText={(txt) => setPlan((p) => ({ ...p, alternativa: appendDictado(p.alternativa, txt) }))} />
                    </div>
                    <textarea
                      id="plan-alternativa"
                      className={s.area}
                      rows={2}
                      placeholder={t("planTratamiento.nuevo.alternativaEjemplo")}
                      value={plan.alternativa}
                      onChange={(e) => setPlan((p) => ({ ...p, alternativa: e.target.value }))}
                    />
                  </div>
                  <div className={s.campo}>
                    <div className={s.rotuloFila}>
                      <label className={s.rotulo} htmlFor="plan-notas">{t("patients.treatment.descLabel")}</label>
                      <DictationMic onText={(txt) => setPlan((p) => ({ ...p, notas: appendDictado(p.notas, txt) }))} />
                    </div>
                    <textarea
                      id="plan-notas"
                      className={s.area}
                      rows={2}
                      placeholder={t("patients.treatment.descPlaceholder")}
                      value={plan.notas}
                      onChange={(e) => setPlan((p) => ({ ...p, notas: e.target.value }))}
                    />
                  </div>
                </div>
                {sugerencias.length > 0 && (
                  <div className={s.campo}>
                    <span className={s.rotulo}>{t("planTratamiento.nuevo.otrosNombres")}</span>
                    <div className={s.sugerencias}>
                      {sugerencias.map((sug) => (
                        <button key={sug} type="button" className={s.ficha} onClick={() => { setNombreTocado(true); setForm((f) => ({ ...f, name: sug })); }}>
                          {sug}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {confirmar && (
          <div className={`${s.aviso} ${s.avisoPie}`} role="alert" data-plan-confirmar={confirmar.tipo}>
            <AlertTriangle size={14} strokeWidth={2} aria-hidden />
            <span>
              {confirmar.tipo === "sinCosto" ? (
                <><strong>{t("planTratamiento.nuevo.sinCostoTitulo")}</strong> {t("planTratamiento.nuevo.sinCostoTexto")}</>
              ) : (
                <><strong>{txSinPrecio.planTitulo(sinPrecio)}.</strong> {txSinPrecio.planTexto}</>
              )}
            </span>
            <button type="button" className={s.enlace} onClick={() => setConfirmar(null)}>
              {confirmar.tipo === "sinCosto" ? t("planTratamiento.nuevo.sinCostoVolver") : txSinPrecio.volver}
            </button>
          </div>
        )}
        {error && (
          <div className={`${s.error} ${s.errorPie}`} role="alert" data-plan-error>{error}</div>
        )}
        <footer className={s.pie}>
          <div className={s.pieResumen} aria-live="polite">
            <span>{t("planTratamiento.nuevo.nProcedimientos", { count: cuantos })}</span>
            <strong data-plan-total>{dineroExacto(total)}</strong>
            {tiempo.citas > 0 && (
              <span className={s.pieCitas}>{t("planTratamiento.nuevo.citasEstimadas", { count: tiempo.citas, minutos: tiempo.minutos })}</span>
            )}
          </div>
          <div className={s.pieBotones}>
            <button type="button" className={s.boton} onClick={onCerrar} disabled={guardando}>
              {t("common.cancel")}
            </button>
            <button type="button" className={s.boton} data-plan-guardar onClick={() => guardar("guardar")} disabled={guardando}>
              {guardando
                ? t("planTratamiento.nuevo.guardando")
                : confirmar?.accion === "guardar"
                  ? (confirmar.tipo === "sinCosto" ? t("planTratamiento.nuevo.sinCostoCrear") : txSinPrecio.planSeguir)
                  : t("planTratamiento.nuevo.guardar")}
            </button>
            <button
              type="button"
              className={`${s.boton} ${s.botonPrincipal}`}
              data-plan-presentar
              onClick={() => guardar("presentar")}
              disabled={guardando || puedePresentar === false}
              title={puedePresentar === false ? t("planTratamiento.nuevo.presentarNoDisponible") : undefined}
            >
              {confirmar?.accion === "presentar" && !guardando
                ? (confirmar.tipo === "sinCosto" ? t("planTratamiento.nuevo.sinCostoCrear") : txSinPrecio.planSeguir)
                : t("planTratamiento.nuevo.guardarPresentar")}
              {puedePresentar === false && <span className={s.pronto}>{t("planTratamiento.nuevo.pronto")}</span>}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
