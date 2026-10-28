"use client";

/**
 * La tarjeta de detalles al pasar el mouse sobre una cita (decisión de Rafael, 28-oct-2026).
 *
 * Lo ligero sale de `CitaVista` en cuanto aparece la tarjeta; lo pesado (alergias, «En esta cita», «Debe
 * hoy», teléfono, edad, primera vez) se pide a `/api/appointments/[id]/detalles-al-pasar` AL PASAR: tras
 * `RETARDO_DETALLES_MS` quieto, con caché por cita y cancelable (`AbortController`) si el mouse se va antes.
 * Pasar el mouse por encima de la agenda sin detenerse no pide nada.
 *
 * Solo con mouse: en táctil no sale (`pointerType`), y tocar sigue abriendo el panel de la cita. Un clic,
 * un arrastre o un scroll la esconden. La tarjeta no recibe el puntero (`pointer-events: none`): nunca
 * tapa ni roba el clic a la cita de abajo.
 *
 * El interruptor «Mostrar detalles al pasar el mouse» vive en el filtro de la barra y se guarda en la cuenta
 * de cada persona (`/api/agenda/detalles-al-pasar`). Viene encendido; sin el SQL, encendido y sin guardar.
 * Con la tarjeta apagada, la cita conserva su `title` nativo de siempre.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Armchair,
  CalendarClock,
  CircleCheck,
  Clock,
  Layers,
  MessageCircle,
  Phone,
  Stethoscope,
  UserRound,
  Video,
  Wallet,
} from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { fmtMXNdec } from "@/lib/format";
import {
  avisosAlPasar,
  CacheDeDetalles,
  claveDeDetalles,
  detallesDesdeRespuesta,
  estadoAlPasar,
  posicionDeLaTarjeta,
  RETARDO_DETALLES_MS,
  type DetallesPesados,
} from "@/lib/agenda-nueva/detalles-al-pasar";
import type { CitaVista } from "@/lib/agenda-nueva/vista-modelo";
import { CLASES_PORTAL_AGENDA } from "./ropa";
import s from "./detalles-al-pasar.module.css";

interface ValorDetallesAlPasar {
  /** La preferencia de quien mira. */
  encendida: boolean;
  /** `false` mientras no se pegue el SQL: el cambio solo vale en esta pestaña. */
  seGuarda: boolean;
  /** ¿Este equipo tiene mouse? En táctil la tarjeta no existe y la cita conserva su `title`. */
  conMouse: boolean;
  alternar: () => void;
  /** Lo llama la tarjeta de la cita en `pointerenter`/`pointermove`/`pointerleave`/`pointerdown`. */
  entrar: (cita: CitaVista, el: HTMLElement, e: { pointerType: string; clientX: number; clientY: number; buttons: number }) => void;
  /** Dónde está el puntero mientras espera el retardo (para anclar la tarjeta a él si no cabe junto a la cita). */
  mover: (e: { pointerType: string; clientX: number; clientY: number }) => void;
  salir: () => void;
}

const Ctx = createContext<ValorDetallesAlPasar | null>(null);

/** `null` fuera del proveedor (arneses, la agenda de siempre): la tarjeta de cita se porta como siempre. */
export function useDetallesAlPasar(): ValorDetallesAlPasar | null {
  return useContext(Ctx);
}

type Visible = { cita: CitaVista; rect: DOMRect; puntero: { x: number; y: number } };
type Pesado = { clave: string; estado: "cargando" | "listo" | "error"; datos: DetallesPesados | null };

export function DetallesAlPasarProvider({ children }: { children: ReactNode }) {
  const [encendida, setEncendida] = useState(true);
  const [seGuarda, setSeGuarda] = useState(true);
  const [conMouse, setConMouse] = useState(false);
  const [visible, setVisible] = useState<Visible | null>(null);
  const [pesado, setPesado] = useState<Pesado | null>(null);

  const cache = useRef(new CacheDeDetalles());
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peticion = useRef<AbortController | null>(null);
  const puntero = useRef({ x: 0, y: 0 });

  // La preferencia de la cuenta. Hasta que llega (o si falla), encendida: es el valor por defecto.
  useEffect(() => {
    let vivo = true;
    fetch("/api/agenda/detalles-al-pasar", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { encendida?: unknown } | null) => {
        if (vivo && typeof d?.encendida === "boolean") setEncendida(d.encendida);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const leer = () => setConMouse(mq.matches);
    leer();
    mq.addEventListener?.("change", leer);
    return () => mq.removeEventListener?.("change", leer);
  }, []);

  const cancelar = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = null;
    peticion.current?.abort();
    peticion.current = null;
  }, []);

  const salir = useCallback(() => {
    cancelar();
    setVisible(null);
  }, [cancelar]);

  const pedir = useCallback((cita: CitaVista) => {
    const clave = claveDeDetalles(cita);
    const guardado = cache.current.leer(clave);
    if (guardado) {
      setPesado({ clave, estado: "listo", datos: guardado });
      return;
    }
    // Paciente restringido para quien mira: la agenda ya lo enmascara; no se pide nada de él.
    if (!cita.pacienteId) {
      setPesado(null);
      return;
    }
    const ctl = new AbortController();
    peticion.current = ctl;
    setPesado({ clave, estado: "cargando", datos: null });
    fetch(`/api/appointments/${encodeURIComponent(cita.id)}/detalles-al-pasar`, {
      credentials: "include",
      signal: ctl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((crudo) => {
        const datos = detallesDesdeRespuesta(crudo);
        if (!datos) throw new Error("respuesta");
        cache.current.guardar(clave, datos);
        setPesado((p) => (p?.clave === clave ? { clave, estado: "listo", datos } : p));
      })
      .catch(() => {
        if (ctl.signal.aborted) return;
        setPesado((p) => (p?.clave === clave ? { clave, estado: "error", datos: null } : p));
      })
      .finally(() => {
        if (peticion.current === ctl) peticion.current = null;
      });
  }, []);

  const entrar = useCallback(
    (cita: CitaVista, el: HTMLElement, e: { pointerType: string; clientX: number; clientY: number; buttons: number }) => {
      // Con un botón apretado se está arrastrando una cita (o seleccionando): las que cruza no enseñan nada.
      if (!encendida || e.pointerType !== "mouse" || e.buttons !== 0) return;
      cancelar();
      puntero.current = { x: e.clientX, y: e.clientY };
      temporizador.current = setTimeout(() => {
        temporizador.current = null;
        if (!el.isConnected) return;
        setVisible({ cita, rect: el.getBoundingClientRect(), puntero: { ...puntero.current } });
        pedir(cita);
      }, RETARDO_DETALLES_MS);
    },
    [encendida, cancelar, pedir],
  );

  // Solo se apunta mientras espera: ya pintada, la tarjeta no persigue al cursor.
  const mover = useCallback((e: { pointerType: string; clientX: number; clientY: number }) => {
    if (e.pointerType === "mouse" && temporizador.current) puntero.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Un scroll mueve la cita debajo de la tarjeta: se esconde. Y al desmontar, nada colgando.
  useEffect(() => {
    if (!visible) return;
    const esconder = () => salir();
    window.addEventListener("scroll", esconder, true);
    window.addEventListener("resize", esconder);
    return () => {
      window.removeEventListener("scroll", esconder, true);
      window.removeEventListener("resize", esconder);
    };
  }, [visible, salir]);
  useEffect(() => cancelar, [cancelar]);

  const alternar = useCallback(() => {
    const nueva = !encendida;
    setEncendida(nueva);
    if (!nueva) salir();
    fetch("/api/agenda/detalles-al-pasar", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encendida: nueva }),
    })
      .then((r) => setSeGuarda(r.status !== 503))
      .catch(() => {});
  }, [encendida, salir]);

  const valor = useMemo<ValorDetallesAlPasar>(
    () => ({ encendida, seGuarda, conMouse, alternar, entrar, mover, salir }),
    [encendida, seGuarda, conMouse, alternar, entrar, mover, salir],
  );

  const datos = visible && pesado?.clave === claveDeDetalles(visible.cita) ? pesado : null;

  return (
    <Ctx.Provider value={valor}>
      {children}
      {visible && encendida && typeof document !== "undefined"
        ? createPortal(
            <div className={CLASES_PORTAL_AGENDA}>
              <TarjetaAlPasar cita={visible.cita} rect={visible.rect} puntero={visible.puntero} pesado={datos} />
            </div>,
            document.body,
          )
        : null}
    </Ctx.Provider>
  );
}

const ANCHO_TARJETA = 320;

/** La tarjeta. Exportada para el arnés de pruebas (se pinta sola, con datos de ejemplo). */
export function TarjetaAlPasar({
  cita,
  rect,
  puntero = null,
  pesado,
}: {
  cita: CitaVista;
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom">;
  puntero?: { x: number; y: number } | null;
  pesado: Pesado | null;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Se mide ya pintada (el alto depende de lo que trae) y se coloca junto a la cita, dentro de la ventana.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const p = posicionDeLaTarjeta(
      rect,
      { ancho: window.innerWidth, alto: window.innerHeight },
      { ancho: el.offsetWidth || ANCHO_TARJETA, alto: el.offsetHeight },
      puntero,
    );
    setPos((v) => (v && v.left === p.left && v.top === p.top ? v : { left: p.left, top: p.top }));
  }, [rect, puntero, pesado?.estado]);

  const d = pesado?.estado === "listo" ? pesado.datos : null;
  const cargando = pesado?.estado === "cargando";
  const estado = estadoAlPasar(cita, d ? d.confirmadaPorWhatsapp : null);
  const avisos = avisosAlPasar(cita);
  const conDinero = !!d && (d.enEstaCita.length > 0 || d.debeHoy > 0.005);

  const lineaPaciente = [
    d?.paciente.edad != null ? t("agenda.alPasar.edad", { n: d.paciente.edad }) : null,
    // «Primera vez» va aparte, como marca: es lo que recepción tiene que ver de un vistazo.
    d && !d.paciente.primeraVez ? t("agenda.alPasar.recurrente") : null,
  ].filter(Boolean);

  return (
    <div
      ref={ref}
      role="tooltip"
      id={`detalles-cita-${cita.id}`}
      className={s.tarjeta}
      data-detalles-al-pasar={cita.id}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width: ANCHO_TARJETA,
        ["--color-doctor" as string]: cita.colorResponsable,
      }}
    >
      {d && d.alergias.length > 0 && (
        <div className={s.alergias} data-alergias>
          <AlertTriangle size={15} strokeWidth={2.4} aria-hidden />
          <span>
            <strong>{t("agenda.alPasar.alergias")}:</strong> {d.alergias.join(", ")}
          </span>
        </div>
      )}

      <div className={s.cabecera}>
        <span className={s.nombre}>{cita.nombrePaciente}</span>
        <div className={s.marcas}>
          <span className={`${s.estado} ${s[`tono_${estado.tono}`]}`} data-estado={estado.clave}>
            {estado.clave === "confirmadaWhatsapp" ? (
              <MessageCircle size={12} strokeWidth={2.4} aria-hidden />
            ) : (
              <span className={s.punto} aria-hidden />
            )}
            {t(`agenda.alPasar.estado.${estado.clave}`)}
            {estado.minutos !== null ? ` · ${t("agenda.alPasar.minutos", { n: estado.minutos })}` : ""}
          </span>
          {d?.paciente.primeraVez && <span className={s.marcaPrimera}>{t("agenda.alPasar.primeraVez")}</span>}
        </div>
        {cita.pacienteId ? (
          <div className={s.subPaciente}>
            {lineaPaciente.length > 0 && <span>{lineaPaciente.join(" · ")}</span>}
            {d?.paciente.telefono && (
              <span className={s.telefono}>
                <Phone size={12} strokeWidth={2.2} aria-hidden />
                {d.paciente.telefono}
              </span>
            )}
            {cargando && !d && <span className={s.esqueleto} style={{ width: 140 }} aria-hidden />}
          </div>
        ) : (
          <div className={s.subPaciente}>{t("agenda.alPasar.restringido")}</div>
        )}
      </div>

      <dl className={s.datos}>
        <div className={s.dato}>
          <dt>
            <Clock size={14} strokeWidth={2.2} aria-label={t("agenda.alPasar.hora")} />
          </dt>
          <dd>
            {cita.rango}
            {cita.duracionReal !== null && cita.duracionReal > 0 && (
              <span className={s.tenue}> · {t("agenda.alPasar.minutos", { n: Math.round(cita.duracionReal) })}</span>
            )}
          </dd>
        </div>
        <div className={s.dato}>
          <dt>
            <UserRound size={14} strokeWidth={2.2} aria-label={t("agenda.alPasar.doctor")} />
          </dt>
          <dd>
            <span className={s.puntoDoctor} aria-hidden />
            {cita.responsableNombre}
          </dd>
        </div>
        {(cita.unidadNombre || cita.esTeleconsulta) && (
          <div className={s.dato}>
            <dt>
              {cita.esTeleconsulta ? (
                <Video size={14} strokeWidth={2.2} aria-label={t("agenda.alPasar.teleconsulta")} />
              ) : (
                <Armchair size={14} strokeWidth={2.2} aria-label={t("agenda.alPasar.unidad")} />
              )}
            </dt>
            <dd>{cita.esTeleconsulta ? t("agenda.alPasar.teleconsulta") : cita.unidadNombre}</dd>
          </div>
        )}
        <div className={s.dato}>
          <dt>
            <Stethoscope size={14} strokeWidth={2.2} aria-label={t("agenda.alPasar.motivo")} />
          </dt>
          <dd className={cita.tratamiento ? "" : s.tenue}>
            {cita.procedimiento && <span className={s.puntoProc} style={{ background: cita.procedimiento.color }} aria-hidden />}
            {cita.tratamiento || t("agenda.alPasar.sinMotivo")}
          </dd>
        </div>
      </dl>

      {cargando && !d && (
        <div className={s.cargando} aria-live="polite">
          <span className={s.esqueleto} style={{ width: "70%" }} aria-hidden />
          <span className={s.esqueleto} style={{ width: "45%" }} aria-hidden />
          <span className={s.oculto}>{t("agenda.alPasar.cargando")}</span>
        </div>
      )}
      {pesado?.estado === "error" && <div className={s.error}>{t("agenda.alPasar.errorCarga")}</div>}

      {conDinero && d && (
        <div className={s.dinero} data-dinero>
          {d.enEstaCita.length > 0 && (
            <>
              <div className={s.rotulo}>{t("agenda.alPasar.enEstaCita")}</div>
              <ul className={s.filas}>
                {d.enEstaCita.map((f) => (
                  <li key={f.id} className={s.fila} data-fila-cita={f.id}>
                    <span className={s.filaNombre}>{f.nombre}</span>
                    <span className={s.filaImporte}>{fmtMXNdec(f.importe)}</span>
                    <span className={`${s.filaEstado} ${f.estado === "hecho" ? s.filaHecha : ""}`}>
                      {f.estado === "hecho"
                        ? t("agenda.alPasar.fila.hecho")
                        : f.estado === "en_curso"
                          ? t("agenda.alPasar.fila.enCurso")
                          : t("agenda.alPasar.fila.porHacer")}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className={`${s.debe} ${d.debeHoy > 0.005 ? s.debeConDeuda : ""}`} data-debe-hoy={d.debeHoy}>
            <span>
              <Wallet size={13} strokeWidth={2.2} aria-hidden /> {t("agenda.alPasar.debeHoy")}
            </span>
            <strong>{fmtMXNdec(d.debeHoy)}</strong>
          </div>
        </div>
      )}

      {avisos.length > 0 && (
        <ul className={s.avisos}>
          {avisos.map((a) => (
            <li key={a.clave} className={`${s.aviso} ${s[`tono_${a.tono}`]}`} data-aviso={a.clave}>
              {a.clave === "sobreagendada" ? (
                <Layers size={12} strokeWidth={2.4} aria-hidden />
              ) : a.clave === "anticipoPagado" ? (
                <CircleCheck size={12} strokeWidth={2.4} aria-hidden />
              ) : a.clave === "porValidar" ? (
                <CalendarClock size={12} strokeWidth={2.4} aria-hidden />
              ) : (
                <Wallet size={12} strokeWidth={2.4} aria-hidden />
              )}
              {a.clave === "apartada" && a.texto
                ? a.texto
                : a.clave === "anticipoPedido"
                  ? t("agenda.alPasar.avisos.anticipoPedido", { monto: fmtMXNdec(a.monto ?? 0) })
                  : t(`agenda.alPasar.avisos.${a.clave}`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
