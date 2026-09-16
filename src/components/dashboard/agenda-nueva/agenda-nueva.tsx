"use client";

/**
 * La agenda nueva de Claude Design — el armazón.
 *
 * Barra de herramientas arriba (64 px, común a las tres vistas), la vista
 * debajo, y a la derecha uno de los dos paneles: el de la cita o el de buscar
 * hueco. Nunca los dos: abrir uno cierra el otro.
 *
 * ⛔ SOLO se monta con el interruptor `menu-dos-niveles` encendido para la
 * clínica. Con la bandera apagada, `AgendaPageClient` renderiza el `AgendaShell`
 * de siempre y de aquí no se monta ni un nodo: las dos agendas no comparten
 * árbol, así que la de siempre no puede cambiar ni un píxel por culpa de ésta.
 *
 * Lo que la agenda de siempre hace y el diseño no dibuja NO se pierde: la cola
 * de citas del portal por validar, las solicitudes de cambio del paciente y el
 * `?highlight=` con el que el inicio, la paleta de comandos y Nueva cita
 * mandan a una cita concreta. Se montan los MISMOS componentes (validar,
 * solicitudes) y el resaltado abre el panel de esa cita. La lista de espera
 * (la barra lateral con arrastrar a la cuadrícula) todavía no está.
 *
 * Crear y mover citas también son los de siempre: el botón «Nueva cita» y el
 * clic en un hueco abren la MISMA ventana (`NewAppointmentDialog`), y arrastrar
 * una cita usa la MISMA lógica que `AgendaShell` (`reschedule-flow.ts`).
 *
 * Los DATOS son los de siempre: este armazón vive DENTRO del `AgendaProvider`
 * que ya existe, así que las citas, los doctores, las unidades, el refetch con
 * caché, las actualizaciones optimistas y el rollback son los mismos que usa
 * la agenda actual. Aquí no hay ni un `useReducer` nuevo.
 */

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Role } from "@prisma/client";
import { instrumentSans } from "@/fonts/menu";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { AgendaValidateBanner } from "@/components/dashboard/agenda/agenda-validate-banner";
import { ChangeRequestsPanel } from "@/components/dashboard/change-requests-panel";
import { ArrastreCitas } from "./arrastre-citas";
import { BarraHerramientas } from "./barra-herramientas";
import { AgendaNuevaProvider, useAgendaNueva } from "./contexto-agenda-nueva";
import { PanelCita } from "./panel-cita";
import { PanelHuecos } from "./panel-huecos";
import { VistaDia } from "./vista-dia";
import { VistaSemana } from "./vista-semana";
import { VistaMes } from "./vista-mes";
import s from "./agenda-nueva.module.css";

export interface AgendaNuevaProps {
  /**
   * `Clinic.cfdiTaxMode` ("exempt" | "iva16"), ya resuelto en el servidor.
   * Baja hasta el cobro del panel: sin él, el CFDI se timbraría EXENTO en una
   * clínica con IVA, y eso sería una diferencia FISCAL causada por la bandera.
   */
  clinicTaxMode: string | null;
  /** El rol de quien mira, para no ofrecer transiciones que su rol no permite. */
  userRole?: Role;
  /** `?highlight=<id>`: la cita a la que mandan desde fuera. Se abre su panel. */
  highlightId?: string | null;
}

export function AgendaNueva(props: AgendaNuevaProps) {
  return (
    <AgendaNuevaProvider>
      <Armazon {...props} />
    </AgendaNuevaProvider>
  );
}

function Armazon({ clinicTaxMode, userRole, highlightId }: AgendaNuevaProps) {
  const ag = useAgendaNueva();
  const { state, invalidateRangeCache } = useAgenda();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Tras aprobar o rechazar una solicitud de cambio, la cita cambió en el
  // servidor: lo mismo que hace la agenda de siempre.
  const alResolverSolicitud = useCallback(() => {
    invalidateRangeCache();
    router.refresh();
  }, [invalidateRangeCache, router]);

  // `?highlight=`: en cuanto la cita está cargada se abre su panel (una vez) y
  // se quita el parámetro, como hace `AgendaHighlightListener`. Si la cita no
  // está en el rango cargado no se hace nada, igual que allí.
  const resaltada = useRef<string | null>(null);
  const { abrirCita } = ag;
  useEffect(() => {
    if (!highlightId || resaltada.current === highlightId) return;
    if (!state.appointments.some((a) => a.id === highlightId)) return;
    resaltada.current = highlightId;
    abrirCita(highlightId);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("highlight");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [highlightId, state.appointments, abrirCita, searchParams, pathname, router]);

  return (
    <div className={`${s.raiz} ${instrumentSans.variable}`}>
      <BarraHerramientas />

      <div className={s.cuerpo}>
        <div className={s.zonaAgenda}>
          <div className={s.colasPortal}>
            <AgendaValidateBanner />
            <ChangeRequestsPanel onResolved={alResolverSolicitud} />
          </div>
          {/* ── Las tres vistas ──
              Día es de ws1-t1; Semana y Mes, de ws1-t2. Las tres comparten la
              misma `Cuadricula`, la misma `TarjetaCita`, los mismos tokens y
              el mismo `useAgendaNueva()`: no hay una rejilla por vista. */}
          {/* Día y Semana se agendan con un clic en un hueco y se reordenan
              arrastrando las citas; Mes no (igual que la agenda de siempre). */}
          <ArrastreCitas>
            {ag.vista === "dia" && <VistaDia />}
            {ag.vista === "semana" && <VistaSemana />}
          </ArrastreCitas>
          {ag.vista === "mes" && <VistaMes />}
        </div>

        {ag.panel === "cita" && <PanelCita clinicTaxMode={clinicTaxMode} userRole={userRole} />}
        {ag.panel === "huecos" && <PanelHuecos />}
      </div>
    </div>
  );
}
