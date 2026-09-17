"use client";

/**
 * El estado de PANTALLA de la agenda nueva: qué vista se ve, qué panel está
 * abierto, qué cita hay seleccionada y qué responsables/unidades están
 * marcados en el filtro.
 *
 * ⛔ Lo que NO vive aquí: las citas, los doctores, las unidades, el día, la
 * zona horaria y todas las mutaciones. Eso sigue saliendo de `useAgenda()`
 * (`agenda-provider.tsx`), que ya trae el refetch con caché, las
 * actualizaciones optimistas y el rollback. Duplicarlo sería repetir el error
 * de `bot-booking-service.ts`, que copió las reglas de agendar y hoy le faltan
 * siete validaciones.
 *
 * Este contexto es lo que ws1-t2 consume desde Semana y Mes para que las tres
 * vistas filtren por lo mismo y pinten a los responsables en el MISMO orden.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import type { AgendaViewMode } from "@/lib/agenda/types";
import { TREATMENT_KINDS, type DoctorColumnDTO, type ResourceDTO } from "@/lib/agenda/types";
import {
  aResponsablesVista,
  type ResponsableVista,
} from "@/lib/agenda-nueva/vista-modelo";

export type VistaAgenda = "dia" | "semana" | "mes";
export type PanelAbierto = null | "cita" | "huecos";

export interface AgendaNuevaValor {
  vista: VistaAgenda;
  irAVista: (v: VistaAgenda) => void;

  panel: PanelAbierto;
  /** Id de la cita abierta en el panel, o `null`. */
  citaAbiertaId: string | null;
  /** Abre el panel de cita (y cierra el de huecos: son excluyentes). */
  abrirCita: (id: string) => void;
  /** Abre/cierra el panel «Buscar hueco» (y cierra el de cita). */
  alternarHuecos: () => void;
  cerrarPanel: () => void;

  /**
   * Los responsables VISIBLES, en el orden del servidor. Las tres vistas y la
   * leyenda leen esta lista; si cada una ordenara por su cuenta, el mismo
   * doctor cambiaría de sitio al cambiar de vista.
   */
  responsablesVisibles: ResponsableVista[];
  /** Todos los responsables, visibles o no (para pintar el desplegable). */
  responsablesTodos: ResponsableVista[];
  /** Las unidades de tratamiento de la clínica (sillones y consultorios). */
  unidadesTodas: ResourceDTO[];

  /** Ids marcados. Vacío NO significa «ninguno»: significa «todavía nadie tocó el filtro». */
  docsVisibles: ReadonlySet<string>;
  unidadesVisibles: ReadonlySet<string>;
  alternarDoctor: (id: string) => void;
  alternarUnidad: (id: string) => void;
  marcarTodo: () => void;
  /** Cuántos elementos hay DESMARCADOS (el contador negro del botón). */
  desmarcados: number;
  /** ¿Está todo marcado? Entonces el botón va en su pinta neutra. */
  todoMarcado: boolean;

  /** ¿Esta cita pasa el filtro? */
  citaVisible: (doctorId: string | null, unidadId: string | null) => boolean;
}

const Ctx = createContext<AgendaNuevaValor | null>(null);

export function useAgendaNueva(): AgendaNuevaValor {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAgendaNueva fuera de <AgendaNuevaProvider>");
  return v;
}

/** La vista de la agenda nueva → la del proveedor de datos de siempre. */
const VISTA_A_PROVEEDOR: Record<VistaAgenda, AgendaViewMode> = {
  dia: "day",
  semana: "week",
  mes: "month",
};

/**
 * `?view=day|week|month` → la vista con la que ARRANCA la agenda nueva.
 *
 * Son los mismos nombres que ya usa el proveedor de datos (`AgendaViewMode`) y
 * el `?view=week` con el que «Ver agenda semanal» de Hoy manda a la agenda.
 * Cualquier otra cosa, o nada, es Día, como siempre. Solo se lee al montar:
 * después manda el control segmentado de la barra, como hasta ahora.
 *
 * Con la bandera apagada este proveedor no se monta (`agenda-page-client.tsx`
 * elige `AgendaShell`), así que la agenda de siempre sigue ignorando `?view=`
 * exactamente igual que hoy.
 */
export function vistaInicialDesdeParametro(view: string | null | undefined): VistaAgenda {
  if (view === "week") return "semana";
  if (view === "month") return "mes";
  return "dia";
}

export function AgendaNuevaProvider({ children }: { children: ReactNode }) {
  const { state, setViewMode } = useAgenda();
  const searchParams = useSearchParams();

  const [vista, setVista] = useState<VistaAgenda>(() =>
    vistaInicialDesdeParametro(searchParams.get("view")),
  );

  const [panel, setPanel] = useState<PanelAbierto>(null);
  const [citaAbiertaId, setCitaAbiertaId] = useState<string | null>(null);

  // `null` = nadie tocó el filtro todavía = todo visible. Se guarda como
  // conjunto de OCULTOS y no de visibles: así un doctor que se da de alta
  // mañana aparece solo, sin que nadie tenga que volver a marcarlo.
  const [docsOcultos, setDocsOcultos] = useState<ReadonlySet<string>>(new Set());
  const [unidadesOcultas, setUnidadesOcultas] = useState<ReadonlySet<string>>(new Set());

  /**
   * La vista nueva y la del proveedor tienen que ir a la par.
   *
   * El proveedor recuerda su `viewMode` en `localStorage`, así que alguien que
   * dejó la agenda vieja en «Semana» abría la nueva en «Día» pero con el
   * proveedor pidiendo el rango de la SEMANA — y con el eje calculado sobre
   * los siete días en vez del que se está mirando. Al revés es peor: cuando
   * ws1-t2 enchufe Semana, sin esto pintaría siete columnas con las citas de
   * un solo día.
   *
   * Se sincroniza en el montaje y en cada cambio de vista, y de paso es lo que
   * hace que el rango que se pide a la base sea el que la vista necesita.
   */
  useEffect(() => {
    const destino = VISTA_A_PROVEEDOR[vista];
    if (state.viewMode !== destino) setViewMode(destino);
  }, [vista, state.viewMode, setViewMode]);

  /**
   * Los responsables que la agenda enseña, y solo ésos.
   *
   * `state.doctors` trae TODOS los usuarios con rol DOCTOR activos, estén o no
   * puestos en la agenda (`fetchActiveDoctors` marca cuál con `activeInAgenda`,
   * que sale de `agendaActive`). Meterlos a todos tenía dos consecuencias, y la
   * segunda es la grave:
   *
   *  · En Semana, cada doctor que no atiende se lleva su tajada del ancho de
   *    los siete días y deja un carril vacío.
   *  · En Mes, la capacidad del día es «minutos abiertos × carriles», así que
   *    cada doctor de adorno infla el denominador: una clínica con 3 doctores
   *    de verdad y 2 administrativos con rol DOCTOR leería 40 % de ocupación
   *    donde va al 67 %. Ése es el número con el que un dueño decide si
   *    contrata. [Lo encontró ws1-t2 con datos de muestra.]
   *
   * Y además enseñar en el filtro doctores que la agenda de siempre no enseña
   * sería cambiar la funcionalidad, que es justo lo que el contrato prohíbe.
   *
   * Los HUÉRFANOS —quien tiene citas en el rango cargado pero ya no está
   * marcado en la agenda, porque lo desactivaron con la agenda llena— sí
   * entran: si no, sus citas desaparecerían de la pantalla sin dejar rastro.
   * Es el mismo criterio que `computeColumns` en la agenda de siempre.
   */
  const responsablesTodos = useMemo(() => {
    const enAgenda = state.doctors.filter((d) => d.activeInAgenda);
    const yaEstan = new Set(enAgenda.map((d) => d.id));

    const huerfanos: DoctorColumnDTO[] = [];
    const vistos = new Set<string>();
    for (const cita of state.appointments) {
      const id = cita.doctor?.id;
      if (!id || yaEstan.has(id) || vistos.has(id)) continue;
      vistos.add(id);
      const conocido = state.doctors.find((d) => d.id === id);
      huerfanos.push(
        conocido ?? {
          // El doctor no está ni en `state.doctors` (lo dieron de baja del
          // todo). Se reconstruye lo mínimo con lo que trae la propia cita.
          id,
          displayName: cita.doctor?.shortName ?? "Profesional",
          shortName: cita.doctor?.shortName ?? "Profesional",
          color: null,
          activeInAgenda: false,
        },
      );
    }

    return aResponsablesVista([...enAgenda, ...huerfanos]);
  }, [state.doctors, state.appointments]);

  // Solo lugares donde se atiende: recepción, sala de espera, laboratorio y
  // radiografía se gestionan en su modal pero no son columnas de agenda.
  // Mismo criterio que la agenda de siempre (`TREATMENT_KINDS`).
  const unidadesTodas = useMemo(
    () => state.resources.filter((r) => TREATMENT_KINDS.includes(r.kind)),
    [state.resources],
  );

  const responsablesVisibles = useMemo(
    () => responsablesTodos.filter((r) => !docsOcultos.has(r.id)),
    [responsablesTodos, docsOcultos],
  );

  const docsVisibles = useMemo(
    () => new Set(responsablesVisibles.map((r) => r.id)),
    [responsablesVisibles],
  );

  const unidadesVisibles = useMemo(
    () => new Set(unidadesTodas.filter((u) => !unidadesOcultas.has(u.id)).map((u) => u.id)),
    [unidadesTodas, unidadesOcultas],
  );

  const alternar = useCallback(
    (
      id: string,
      set: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
    ) => {
      set((prev) => {
        const s = new Set(prev);
        if (s.has(id)) s.delete(id);
        else s.add(id);
        return s;
      });
    },
    [],
  );

  const alternarDoctor = useCallback((id: string) => alternar(id, setDocsOcultos), [alternar]);
  const alternarUnidad = useCallback((id: string) => alternar(id, setUnidadesOcultas), [alternar]);

  const marcarTodo = useCallback(() => {
    setDocsOcultos(new Set());
    setUnidadesOcultas(new Set());
  }, []);

  const desmarcados = docsOcultos.size + unidadesOcultas.size;
  const todoMarcado = desmarcados === 0;

  const citaVisible = useCallback(
    (doctorId: string | null, unidadId: string | null) => {
      if (doctorId !== null && docsOcultos.has(doctorId)) return false;
      // Una cita SIN unidad no se esconde al desmarcar unidades: si se colara
      // en el filtro de sillones, una clínica que no usa sillones se quedaría
      // con la agenda en blanco al tocar el desplegable.
      if (unidadId !== null && unidadesOcultas.has(unidadId)) return false;
      return true;
    },
    [docsOcultos, unidadesOcultas],
  );

  const abrirCita = useCallback((id: string) => {
    setCitaAbiertaId(id);
    setPanel("cita");
  }, []);

  const alternarHuecos = useCallback(() => {
    setPanel((p) => (p === "huecos" ? null : "huecos"));
    setCitaAbiertaId(null);
  }, []);

  const cerrarPanel = useCallback(() => {
    setPanel(null);
    setCitaAbiertaId(null);
  }, []);

  const irAVista = useCallback((v: VistaAgenda) => {
    setVista(v);
    // Cambiar de vista conserva la fecha (README) y cierra el panel de cita,
    // que hablaba de una cita que quizá ya no está en pantalla. El de huecos
    // sobrevive: sirve igual en las tres vistas.
    setPanel((p) => (p === "cita" ? null : p));
    setCitaAbiertaId(null);
  }, []);

  const valor = useMemo<AgendaNuevaValor>(
    () => ({
      vista,
      irAVista,
      panel,
      citaAbiertaId,
      abrirCita,
      alternarHuecos,
      cerrarPanel,
      responsablesVisibles,
      responsablesTodos,
      unidadesTodas,
      docsVisibles,
      unidadesVisibles,
      alternarDoctor,
      alternarUnidad,
      marcarTodo,
      desmarcados,
      todoMarcado,
      citaVisible,
    }),
    [
      vista,
      irAVista,
      panel,
      citaAbiertaId,
      abrirCita,
      alternarHuecos,
      cerrarPanel,
      responsablesVisibles,
      responsablesTodos,
      unidadesTodas,
      docsVisibles,
      unidadesVisibles,
      alternarDoctor,
      alternarUnidad,
      marcarTodo,
      desmarcados,
      todoMarcado,
      citaVisible,
    ],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
