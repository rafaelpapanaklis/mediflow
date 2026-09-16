"use client";

/**
 * El panel «Buscar hueco» (400 px). Se abre con el botón de la barra y es
 * excluyente con el panel de cita.
 *
 * Tres grupos de chips (responsable, duración, cuándo) y hasta seis
 * resultados. El cálculo NO se hace aquí: se pide a `GET /api/agenda/huecos`,
 * que reusa el buscador de huecos que ya valida como el `POST` de citas
 * (horario de la clínica, horario de la unidad, solapes, pasado). En el
 * navegador solo están las citas del día que se está mirando — buscar en él
 * daría huecos falsos en cuanto se pidiera «Próxima semana».
 *
 * «Agendar» abre el diálogo de Nueva cita de siempre, con fecha, hora, doctor
 * y unidad ya puestos. La cita la sigue creando `POST /api/appointments` con
 * todas sus reglas; este panel no crea nada.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import toast from "react-hot-toast";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import { deHora } from "@/lib/agenda-nueva/geometria";
import { diaAbreviado, esHoy, numeroDeDia } from "@/lib/agenda-nueva/fechas";
import { useAgendaNueva } from "./contexto-agenda-nueva";
import s from "./agenda-nueva.module.css";

const DURACIONES = [30, 45, 60, 90];

const CUANDOS: { clave: Cuando; etiqueta: string }[] = [
  { clave: "asap", etiqueta: "Lo antes posible" },
  { clave: "semana", etiqueta: "Esta semana" },
  { clave: "proxima", etiqueta: "Próxima semana" },
];

type Cuando = "asap" | "semana" | "proxima";

interface Hueco {
  fecha: string;
  hora: string;
  horaFin: string;
  doctorId: string;
  doctorNombre: string;
  unidadId: string | null;
  unidadNombre: string | null;
}

export function PanelHuecos() {
  const { state, setDay, permissions } = useAgenda();
  const ag = useAgendaNueva();
  const { open: abrirNuevaCita } = useNewAppointmentDialog();

  const [doctorSel, setDoctorSel] = useState<string>("cualquiera");
  const [duracion, setDuracion] = useState(45);
  const [cuando, setCuando] = useState<Cuando>("asap");

  const [huecos, setHuecos] = useState<Hueco[]>([]);
  // Sube en uno tras agendar, para repetir la búsqueda: si no, el hueco que
  // se acaba de ocupar seguía en la lista hasta cambiar de chip, y ofrecía una
  // hora que ya no existe.
  const [repetir, setRepetir] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  // Si el responsable elegido deja de estar visible en el filtro, el panel
  // vuelve a «Cualquiera» en vez de quedarse buscando a alguien que ya no sale.
  useEffect(() => {
    if (doctorSel !== "cualquiera" && !ag.docsVisibles.has(doctorSel)) {
      setDoctorSel("cualquiera");
    }
  }, [doctorSel, ag.docsVisibles]);

  const idsBuscados = useMemo(
    () =>
      doctorSel === "cualquiera"
        ? ag.responsablesVisibles.map((r) => r.id)
        : [doctorSel],
    [doctorSel, ag.responsablesVisibles],
  );

  const clave = `${cuando}|${duracion}|${idsBuscados.join(",")}|${repetir}`;

  useEffect(() => {
    if (idsBuscados.length === 0) {
      setHuecos([]);
      setFallo(null);
      return;
    }
    const abortar = new AbortController();
    setCargando(true);
    setFallo(null);

    const params = new URLSearchParams({
      cuando,
      duracion: String(duracion),
      doctorIds: idsBuscados.join(","),
    });

    fetch(`/api/agenda/huecos?${params.toString()}`, { signal: abortar.signal })
      .then(async (res) => {
        const cuerpo = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(cuerpo?.error ?? "No se pudieron buscar los huecos.");
        setHuecos(Array.isArray(cuerpo.huecos) ? cuerpo.huecos : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setHuecos([]);
        setFallo(err instanceof Error ? err.message : "No se pudieron buscar los huecos.");
      })
      .finally(() => {
        if (!abortar.signal.aborted) setCargando(false);
      });

    return () => abortar.abort();
    // `clave` resume las tres entradas; separarlas dispararía tres peticiones
    // al cambiar dos chips seguidos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const agendar = useCallback(
    (h: Hueco) => {
      const min = deHora(h.hora);
      if (min === null) return;
      if (!permissions.canCreate) {
        toast.error("No tienes permiso para crear citas.");
        return;
      }
      abrirNuevaCita({
        initialSlot: {
          // La hora local del hueco → instante UTC, con la zona de la CLÍNICA.
          startsAt: tzLocalToUtc(h.fecha, Math.floor(min / 60), min % 60, state.timezone).toISOString(),
          doctorId: h.doctorId,
          resourceId: h.unidadId,
        },
        openAgendaAfter: true,
        // Al crearse la cita, el hueco deja de existir: se vuelve a buscar
        // para no seguir ofreciéndolo.
        onCreated: () => setRepetir((n) => n + 1),
      });
    },
    [abrirNuevaCita, permissions.canCreate, state.timezone],
  );

  return (
    <aside className={`${s.panel} ${s.panelHuecos}`} aria-label="Buscar hueco">
      <div className={s.huecosCabecera}>
        <Search size={22} strokeWidth={2.2} color="var(--ag-morado-texto)" />
        <span className={s.huecosTitulo}>Buscar hueco</span>
        <button
          type="button"
          className={`${s.panelIconoBoton} ${s.panelCerrar}`}
          onClick={ag.cerrarPanel}
          aria-label="Cerrar el panel"
        >
          <X size={20} strokeWidth={2} />
        </button>
      </div>

      {/* ── Responsable ── */}
      <div className={s.huecosGrupo}>
        <div className={s.rotuloSeccion}>Responsable</div>
        <div className={s.chips}>
          <Chip
            activo={doctorSel === "cualquiera"}
            onClick={() => setDoctorSel("cualquiera")}
            etiqueta="Cualquiera"
          />
          {ag.responsablesVisibles.map((r) => (
            <Chip
              key={r.id}
              activo={doctorSel === r.id}
              onClick={() => setDoctorSel(r.id)}
              etiqueta={r.nombreCorto}
              color={r.color}
            />
          ))}
        </div>
      </div>

      {/* ── Duración ── */}
      <div className={s.huecosGrupo}>
        <div className={s.rotuloSeccion}>Duración</div>
        <div className={s.chips}>
          {DURACIONES.map((d) => (
            <Chip
              key={d}
              activo={duracion === d}
              onClick={() => setDuracion(d)}
              etiqueta={`${d} min`}
            />
          ))}
        </div>
      </div>

      {/* ── Cuándo ── */}
      <div className={s.huecosGrupo}>
        <div className={s.rotuloSeccion}>Cuándo</div>
        <div className={s.chips}>
          {CUANDOS.map((c) => (
            <Chip
              key={c.clave}
              activo={cuando === c.clave}
              onClick={() => setCuando(c.clave)}
              etiqueta={c.etiqueta}
            />
          ))}
        </div>
      </div>

      <div className={s.huecosSeparador} />

      <div className={s.rotuloSeccion}>Próximos huecos de {duracion} min</div>

      <div className={s.huecosLista}>
        {cargando && (
          <div className={s.huecosCargando}>
            <Loader2 size={16} className={s.girando} />
            Buscando…
          </div>
        )}

        {!cargando && fallo && <div className={s.huecosVacio}>{fallo}</div>}

        {!cargando && !fallo && idsBuscados.length === 0 && (
          <div className={s.huecosVacio}>
            No hay ningún responsable seleccionado.
            <br />
            Marca alguno en el filtro de la barra.
          </div>
        )}

        {!cargando && !fallo && idsBuscados.length > 0 && huecos.length === 0 && (
          <div className={s.huecosVacio}>
            No hay huecos con estos filtros.
            <br />
            Prueba otra duración o «Próxima semana».
          </div>
        )}

        {!cargando &&
          !fallo &&
          huecos.map((h, i) => {
            const hoy = esHoy(h.fecha, state.timezone);
            const color = ag.responsablesVisibles.find((r) => r.id === h.doctorId)?.color;
            return (
              <div
                key={`${h.fecha}-${h.hora}-${h.doctorId}`}
                className={s.hueco}
                role="button"
                tabIndex={0}
                onClick={() => setDay(h.fecha)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDay(h.fecha);
                  }
                }}
                title="Ir a ese día en la agenda"
              >
                <div className={s.huecoFecha}>
                  <div className={`${s.huecoDia} ${hoy ? s.huecoDiaHoy : ""}`}>
                    {hoy ? "Hoy" : diaAbreviado(h.fecha)}
                  </div>
                  <div className={s.huecoNum}>{numeroDeDia(h.fecha)}</div>
                </div>
                <div className={s.huecoCuerpo}>
                  <div className={s.huecoHora}>
                    {h.hora}–{h.horaFin}
                  </div>
                  <div className={s.huecoQuien}>
                    {color && <span className={s.cuadritoColor} style={{ background: color }} />}
                    {h.doctorNombre}
                    {h.unidadNombre ? ` · ${h.unidadNombre}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className={`${s.huecoAgendar} ${i === 0 ? s.huecoAgendarPrimero : ""}`}
                  disabled={!permissions.canCreate}
                  onClick={(e) => {
                    e.stopPropagation();
                    agendar(h);
                  }}
                >
                  Agendar
                </button>
              </div>
            );
          })}
      </div>

      <div className={s.huecosPie}>Clic en un hueco te lleva a ese día en la agenda.</div>
    </aside>
  );
}

function Chip({
  activo,
  etiqueta,
  color,
  onClick,
}: {
  activo: boolean;
  etiqueta: string;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${s.chip} ${activo ? s.chipActivo : ""}`}
      aria-pressed={activo}
      onClick={onClick}
    >
      {color && <span className={s.cuadritoColor} style={{ background: color }} />}
      {etiqueta}
    </button>
  );
}
