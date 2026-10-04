"use client";
// DrawerColocacion — «Registrar colocación» / «Colocar aparatos hoy» (ws1-t8, auditoría de BEVADENT: F12 y mejora 5).
//
// Lo abren la fila de un caso «Por colocar» en Casos y la cabecera del caso en la ficha (y el aviso de la hoja de
// control de un caso «Por colocar»). Pide la fecha (hoy propuesta, en la zona de la clínica), la técnica (las de
// «Técnicas y precios») y los controles previstos (los del plan, o la propuesta con la duración del caso y la frecuencia
// de control de la clínica). Al guardar, el caso pasa a «En curso» y el cajón enseña el calendario de controles
// propuesto con «Agendar el primer control» (la «Nueva cita» de siempre, con el día, el motivo y el doctor puestos).
// Nada se agenda solo ni se avisa al paciente desde aquí. Las reglas las vuelve a comprobar `registrarColocacion`.

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, CheckCircle2, Loader2, Shield, Wrench, X } from "lucide-react";
import { DateField } from "@/components/ui/date-field";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { datosParaColocar, registrarColocacion, type DatosParaColocar } from "@/app/actions/orthodontics/registrarColocacion";
import { listarTecnicasActivasDeLaClinica } from "@/app/actions/orthodontics/listarTecnicasDeLaClinica";
import { isFailure } from "@/app/actions/orthodontics/result";
import { opcionesDeEdicion, type TecnicaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica";
import { calendarioDeControles, type CalendarioPropuesto } from "@/lib/orthodontics/colocacion";
import { CONTROLES_MAXIMOS, FRECUENCIAS_DE_CONTROL } from "@/lib/orthodontics/plan-detalle";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import type { CasoGuardado } from "@/lib/orthodontics/redesign/caso-guardado";
import { Btn } from "../atoms/Btn";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

export interface DrawerColocacionProps {
  patientId: string;
  treatmentPlanId: string;
  onClose: () => void;
  /** El caso ya quedó «En curso»: la ficha lo pinta al momento (y la página se refresca). */
  onColocado: (guardado: CasoGuardado) => void;
}

/** «2026-11-02» → «lun 2 nov 2026», sin zona (es un día del calendario). */
function diaLegible(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(a, m - 1, d, 12)),
  );
}

export function DrawerColocacion(props: DrawerColocacionProps) {
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  const { open: abrirNuevaCita } = useNewAppointmentDialog();
  const [datos, setDatos] = useState<DatosParaColocar | null>(null);
  const [activas, setActivas] = useState<TecnicaClinica[]>([]);
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null);
  const [fecha, setFecha] = useState("");
  const [eleccion, setEleccion] = useState<string | null>(null);
  const [controles, setControles] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ calendario: CalendarioPropuesto; aviso?: string } | null>(null);

  useEffect(() => {
    let cancelado = false;
    datosParaColocar({ treatmentPlanId: props.treatmentPlanId }).then((r) => {
      if (cancelado) return;
      if (isFailure(r)) {
        setErrorDeCarga(r.error);
        return;
      }
      setDatos(r.data);
      setFecha(r.data.hoy);
      const previstos = r.data.controlesPrevistos ?? r.data.controlesPropuestos;
      setControles(previstos ? String(previstos) : "");
    });
    listarTecnicasActivasDeLaClinica().then((r) => {
      if (!cancelado && !isFailure(r)) setActivas(r.data.tecnicas);
    });
    return () => {
      cancelado = true;
    };
  }, [props.treatmentPlanId]);

  const { opciones, seleccionadaId } = useMemo(
    () =>
      datos
        ? opcionesDeEdicion(activas, { base: datos.tecnica.base, label: datos.tecnica.label, nombreVisible: datos.tecnica.nombre })
        : { opciones: [], seleccionadaId: "" },
    [activas, datos],
  );
  const tecnicaId = eleccion ?? seleccionadaId;
  const frecuenciaTexto = datos
    ? (FRECUENCIAS_DE_CONTROL.find((f) => f.dias === datos.frecuenciaDias)?.texto.toLowerCase() ?? `cada ${datos.frecuenciaDias} días`)
    : "";
  const controlesNum = controles.trim() === "" ? null : Number(controles);
  const controlesValidos = controlesNum === null || (Number.isInteger(controlesNum) && controlesNum >= 1 && controlesNum <= CONTROLES_MAXIMOS);
  // La vista previa del calendario, antes de guardar (la misma cuenta que hará el servidor).
  const vistaPrevia = datos && fecha ? calendarioDeControles(fecha, datos.frecuenciaDias, controlesNum, datos.diasCerrados) : null;
  // C-62: sin consentimiento de ortodoncia firmado no se registra (el servidor lo vuelve a exigir).
  const puedeGuardar = Boolean(datos?.porColocar && !datos?.sinConsentimiento && fecha && controlesValidos && !guardando);

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await registrarColocacion({
        treatmentPlanId: props.treatmentPlanId,
        fecha,
        tecnicaId,
        ...(controlesNum !== null && datos?.planGuardable ? { controlesPrevistos: controlesNum } : {}),
      });
      if (isFailure(r)) {
        setError(r.error);
        return;
      }
      setHecho({ calendario: r.data.calendario, ...(r.data.aviso ? { aviso: r.data.aviso } : {}) });
      props.onColocado(r.data.casoGuardado);
    } catch {
      setError("No se pudo registrar la colocación. No se cambió nada.");
    } finally {
      setGuardando(false);
    }
  };

  const agendarPrimerControl = (dia: string) => {
    abrirNuevaCita({
      initialPatient: { id: props.patientId, name: datos?.patientName ?? "" },
      initialReason: TIPO_CITA_CONTROL_ORTO,
      initialDateISO: dia,
      ...(datos?.treatingDoctorId ? { initialDoctorId: datos.treatingDoctorId } : {}),
    });
    props.onClose();
  };

  const calendario = hecho?.calendario ?? null;

  return (
    <>
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside ref={cajonRef} tabIndex={-1} className={orto.cajon} role="dialog" aria-modal="true" aria-labelledby="colocacion-titulo">
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>{datos?.patientName ? `Caso de ortodoncia · ${datos.patientName}` : "Caso de ortodoncia"}</div>
            <h3 id="colocacion-titulo" className={orto.cajonTitulo}>
              {hecho ? "Colocación registrada" : "Registrar colocación"}
            </h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {errorDeCarga ? (
            <p role="alert" className="text-xs text-[color:var(--pr-peligro)]">
              {errorDeCarga}
            </p>
          ) : !datos ? (
            <div className="flex items-center gap-2 text-xs text-[color:var(--pr-texto-3)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Cargando…
            </div>
          ) : hecho && calendario ? (
            <>
              <p className="flex items-start gap-2 text-sm text-[color:var(--pr-texto)]">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-[color:var(--pr-exito)]" aria-hidden />
                <span>
                  Aparatos colocados el {diaLegible(fecha)}. El caso pasó a «En curso» y desde hoy cuenta sus meses de tratamiento.
                </span>
              </p>
              {hecho.aviso ? <p className="text-xs text-[color:var(--pr-alerta)]">{hecho.aviso}</p> : null}
              <Calendario calendario={calendario} frecuenciaTexto={frecuenciaTexto} />
            </>
          ) : (
            <>
              {!datos.porColocar ? (
                <p role="alert" className="text-xs text-[color:var(--pr-alerta)]">
                  {datos.motivo}
                </p>
              ) : null}
              {datos.porColocar && datos.sinConsentimiento ? (
                <div role="alert" className={`${orto.aviso} ${orto.avisoAlerta}`} data-colocacion-sin-consentimiento>
                  <span className={orto.avisoTexto}>{datos.sinConsentimiento}</span>
                  <a className={orto.enlace} href={`/dashboard/patients/${props.patientId}?tab=consentimientos`}>
                    Ir a Consentimientos
                  </a>
                </div>
              ) : null}
              <Campo etiqueta="Fecha de colocación" ayuda="Hoy, si los colocas ahora. Puede ser un día anterior; no uno que aún no llega.">
                <DateField
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  max={datos.hoy}
                  className={orto.entrada}
                  aria-label="Fecha de colocación"
                  disabled={!datos.porColocar}
                />
              </Campo>
              <Campo etiqueta="Aparatología / técnica" ayuda="Las de Configuración → Técnicas y precios. Si cambia, los próximos controles toman su precio por control.">
                <select
                  value={tecnicaId}
                  onChange={(e) => setEleccion(e.target.value)}
                  className={orto.entrada}
                  disabled={!datos.porColocar}
                  aria-label="Aparatología o técnica"
                >
                  {opciones.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo
                etiqueta="Controles previstos"
                ayuda={
                  !datos.planGuardable
                    ? "Falta pegar sql/ortodoncia-plan-de-tratamiento.sql: este dato no se guarda todavía."
                    : datos.controlesPropuestos
                      ? `Propuesta: ${datos.controlesPropuestos} (tiempo de tratamiento del caso, un control ${frecuenciaTexto}).`
                      : "Cuántos controles prevé el tratamiento. Vacío = se decide después."
                }
              >
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={CONTROLES_MAXIMOS}
                  value={controles}
                  onChange={(e) => setControles(e.target.value)}
                  className={orto.entrada}
                  disabled={!datos.porColocar || !datos.planGuardable}
                  aria-label="Controles previstos"
                  aria-invalid={!controlesValidos}
                />
              </Campo>
              {vistaPrevia && datos.porColocar ? <Calendario calendario={vistaPrevia} frecuenciaTexto={frecuenciaTexto} previo /> : null}
              {error ? (
                <p role="alert" className="text-xs text-[color:var(--pr-peligro)]">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </div>

        <footer className={`${orto.cajonPie} ${orto.cajonPieReparto}`}>
          <span className="text-[11px] text-[color:var(--pr-texto-3)] inline-flex items-center gap-1">
            <Shield className="w-3 h-3" aria-hidden /> Queda en Movimientos del paciente
          </span>
          <div className="flex gap-2">
            {hecho && calendario ? (
              <>
                <Btn variant="ghost" size="md" onClick={props.onClose}>
                  Listo
                </Btn>
                {calendario.fechas[0] ? (
                  <Btn
                    variant="primary"
                    size="md"
                    icon={<CalendarPlus className="w-3.5 h-3.5" aria-hidden />}
                    onClick={() => agendarPrimerControl(calendario.fechas[0]!)}
                  >
                    Agendar el primer control
                  </Btn>
                ) : null}
              </>
            ) : (
              <>
                <Btn variant="ghost" size="md" onClick={props.onClose}>
                  Cancelar
                </Btn>
                <Btn
                  variant="primary"
                  size="md"
                  icon={guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Wrench className="w-3.5 h-3.5" aria-hidden />}
                  onClick={guardar}
                  disabled={!puedeGuardar}
                >
                  {guardando ? "Guardando…" : "Registrar colocación"}
                </Btn>
              </>
            )}
          </div>
        </footer>
      </aside>
    </>
  );
}

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block mb-1 text-xs font-semibold text-[color:var(--pr-texto-2)]">{etiqueta}</label>
      {children}
      {ayuda ? <p className="mt-1 text-[11px] text-[color:var(--pr-texto-3)]">{ayuda}</p> : null}
    </div>
  );
}

function Calendario({ calendario, frecuenciaTexto, previo = false }: { calendario: CalendarioPropuesto; frecuenciaTexto: string; previo?: boolean }) {
  if (calendario.fechas.length === 0) return null;
  return (
    <div>
      <div className={orto.ceja}>{previo ? "Calendario de controles que se propondrá" : "Calendario de controles propuesto"}</div>
      <p className="mt-1 text-[11px] text-[color:var(--pr-texto-3)]">
        Un control {frecuenciaTexto} desde la colocación
        {calendario.total ? ` · ${calendario.total} en total` : ""}. Nada se agenda solo: agenda cada control cuando toque.
      </p>
      <ol className="mt-2 space-y-1 text-sm text-[color:var(--pr-texto)]">
        {calendario.fechas.map((f, i) => (
          <li key={f} className="flex items-baseline gap-2">
            <span className="w-16 shrink-0 text-[11px] text-[color:var(--pr-texto-3)]">Control {i + 1}</span>
            <span>{diaLegible(f)}</span>
          </li>
        ))}
      </ol>
      {calendario.masAdelante > 0 ? (
        <p className="mt-1 text-[11px] text-[color:var(--pr-texto-3)]">y {calendario.masAdelante} más, al mismo ritmo.</p>
      ) : null}
    </div>
  );
}
