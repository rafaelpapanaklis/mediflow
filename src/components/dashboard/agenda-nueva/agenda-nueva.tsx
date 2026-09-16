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
 * Los DATOS son los de siempre: este armazón vive DENTRO del `AgendaProvider`
 * que ya existe, así que las citas, los doctores, las unidades, el refetch con
 * caché, las actualizaciones optimistas y el rollback son los mismos que usa
 * la agenda actual. Aquí no hay ni un `useReducer` nuevo.
 */

import type { Role } from "@prisma/client";
import { instrumentSans } from "@/fonts/menu";
import { BarraHerramientas } from "./barra-herramientas";
import { AgendaNuevaProvider, useAgendaNueva } from "./contexto-agenda-nueva";
import { PanelCita } from "./panel-cita";
import { PanelHuecos } from "./panel-huecos";
import { VistaDia } from "./vista-dia";
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
}

export function AgendaNueva(props: AgendaNuevaProps) {
  return (
    <AgendaNuevaProvider>
      <Armazon {...props} />
    </AgendaNuevaProvider>
  );
}

function Armazon({ clinicTaxMode, userRole }: AgendaNuevaProps) {
  const ag = useAgendaNueva();

  return (
    <div className={`${s.raiz} ${instrumentSans.variable}`}>
      <BarraHerramientas />

      <div className={s.cuerpo}>
        <div className={s.zonaAgenda}>
          {/* ── Las tres vistas ──
              Día es de ws1-t1. Semana y Mes las trae ws1-t2 en
              `feat/agenda-semana-mes`: cuando lleguen, sus dos componentes
              sustituyen los dos `null` de abajo y no hace falta tocar nada
              más de este archivo. Consumen la misma `Cuadricula`, la misma
              `TarjetaCita` y el mismo `useAgendaNueva()`. */}
          {ag.vista === "dia" && <VistaDia />}
          {/* ws1-t2 sustituye estos dos por <VistaSemana /> y <VistaMes />. */}
          {ag.vista === "semana" && <EnConstruccion vista="Semana" />}
          {ag.vista === "mes" && <EnConstruccion vista="Mes" />}
        </div>

        {ag.panel === "cita" && <PanelCita clinicTaxMode={clinicTaxMode} userRole={userRole} />}
        {ag.panel === "huecos" && <PanelHuecos />}
      </div>
    </div>
  );
}

/**
 * Lo que se ve mientras Semana y Mes no estén enchufadas.
 *
 * Existe para que, si esta rama se integra antes que la de ws1-t2, pulsar
 * «Semana» no deje la pantalla en blanco sin explicación: una pantalla vacía
 * y muda parece una avería.
 */
function EnConstruccion({ vista }: { vista: string }) {
  const ag = useAgendaNueva();
  return (
    <div className={s.enConstruccion}>
      <p className={s.enConstruccionTitulo}>{vista} todavía no está lista</p>
      <p className={s.enConstruccionTexto}>
        La vista {vista.toLowerCase()} del diseño nuevo llega en la siguiente entrega.
        Mientras tanto puedes seguir trabajando en la vista Día.
      </p>
      <button type="button" className={s.navHoy} onClick={() => ag.irAVista("dia")}>
        Volver a Día
      </button>
    </div>
  );
}
