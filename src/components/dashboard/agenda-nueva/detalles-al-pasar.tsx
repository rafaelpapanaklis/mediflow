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
  areaVisible,
  avisosAlPasar,
  citaFueraDeLaVista,
  CacheDeDetalles,
  claveDeDetalles,
  detallesDesdeRespuesta,
  estadoAlPasar,
  EXTRA_DEL_CHIP,
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
  /**
   * Cómo quedó el último cambio del interruptor: `"si"` (guardado en la cuenta, o aún no se tocó), `"sinSql"`
   * (falta el SQL: vale solo en esta pestaña) o `"error"` (el servidor no lo guardó: lo mismo, con aviso).
   */
  guardado: "si" | "sinSql" | "error";
  /** ¿Este equipo tiene mouse? En táctil la tarjeta no existe y la cita conserva su `title`. */
  conMouse: boolean;
  alternar: () => void;
  /** Lo llama la tarjeta de la cita en `pointerenter`/`pointermove`/`pointerleave`/`pointerdown`. */
  entrar: (cita: CitaVista, el: HTMLElement, e: { pointerType: string; clientX: number; clientY: number; buttons: number }) => void;
  /** Dónde está el puntero mientras espera el retardo (para anclar la tarjeta a él si no cabe junto a la cita). */
  mover: (e: { pointerType: string; clientX: number; clientY: number }) => void;
  /** Foco por TECLADO en la cita (`:focus-visible`): la tarjeta sale sin esperar. Un clic no la abre. */
  enfocar: (cita: CitaVista, el: HTMLElement) => void;
  salir: () => void;
}

const Ctx = createContext<ValorDetallesAlPasar | null>(null);

/** `null` fuera del proveedor (arneses, la agenda de siempre): la tarjeta de cita se porta como siempre. */
export function useDetallesAlPasar(): ValorDetallesAlPasar | null {
  return useContext(Ctx);
}

type Visible = { cita: CitaVista; el: HTMLElement; rect: DOMRect; puntero: { x: number; y: number } | null };
type Pesado = { clave: string; estado: "cargando" | "listo" | "error"; datos: DetallesPesados | null };

export function DetallesAlPasarProvider({ children, inicial }: { children: ReactNode; inicial?: boolean }) {
  // La preferencia llega en la SSR de la agenda (page.tsx): sin pedido al abrir y sin parpadeo. Sin ella
  // (arneses), se pide; hasta que llega, encendida, que es el valor por defecto.
  const [encendida, setEncendida] = useState(inicial ?? true);
  const [guardado, setGuardado] = useState<"si" | "sinSql" | "error">("si");
  const [conMouse, setConMouse] = useState(false);
  const [visible, setVisible] = useState<Visible | null>(null);
  const [pesado, setPesado] = useState<Pesado | null>(null);

  const cache = useRef(new CacheDeDetalles());
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peticion = useRef<AbortController | null>(null);
  const puntero = useRef({ x: 0, y: 0 });

  const conInicial = typeof inicial === "boolean";
  useEffect(() => {
    if (conInicial) return;
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
  }, [conInicial]);

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

  // El id de la tarjeta va en `aria-describedby` de la cita SOLO mientras la tarjeta existe (apuntar a un id
  // que no está no describe nada). Se suma a mano a lo que ya tenía (el texto del `title`) y se devuelve tal
  // cual al esconderla; no por props: así pasar el mouse no vuelve a pintar ninguna tarjeta de la rejilla.
  const anclada = useRef<{ el: HTMLElement; antes: string | null } | null>(null);
  const soltarAncla = useCallback(() => {
    const a = anclada.current;
    anclada.current = null;
    if (!a) return;
    if (a.antes === null) a.el.removeAttribute("aria-describedby");
    else a.el.setAttribute("aria-describedby", a.antes);
  }, []);

  const mostrar = useCallback(
    (v: Visible) => {
      soltarAncla();
      const antes = v.el.getAttribute("aria-describedby");
      v.el.setAttribute("aria-describedby", [antes, `detalles-cita-${v.cita.id}`].filter(Boolean).join(" "));
      anclada.current = { el: v.el, antes };
      setVisible(v);
    },
    [soltarAncla],
  );

  const salir = useCallback(() => {
    cancelar();
    soltarAncla();
    setVisible(null);
  }, [cancelar, soltarAncla]);

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
        mostrar({ cita, el, rect: el.getBoundingClientRect(), puntero: { ...puntero.current } });
        pedir(cita);
      }, RETARDO_DETALLES_MS);
    },
    [encendida, cancelar, pedir, mostrar],
  );

  const enfocar = useCallback(
    (cita: CitaVista, el: HTMLElement) => {
      if (!encendida) return;
      let teclado = false;
      try {
        teclado = el.matches(":focus-visible");
      } catch {
        teclado = false;
      }
      if (!teclado) return;
      cancelar();
      // Lo ligero sale en el acto; lo pesado, tras el MISMO retardo que con el mouse (v3, n1): con Tab
      // apretado sobre una columna no sale un GET por cada cita que se cruza. `cancelar()` (el blur) lo limpia.
      mostrar({ cita, el, rect: el.getBoundingClientRect(), puntero: null });
      const clave = claveDeDetalles(cita);
      if (cache.current.leer(clave) || !cita.pacienteId) {
        pedir(cita);
        return;
      }
      setPesado({ clave, estado: "cargando", datos: null });
      temporizador.current = setTimeout(() => {
        temporizador.current = null;
        if (el.isConnected) pedir(cita);
      }, RETARDO_DETALLES_MS);
    },
    [encendida, cancelar, pedir, mostrar],
  );

  // Solo se apunta mientras espera: ya pintada, la tarjeta no persigue al cursor.
  const mover = useCallback((e: { pointerType: string; clientX: number; clientY: number }) => {
    if (e.pointerType === "mouse" && temporizador.current) puntero.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Un scroll mueve la cita debajo de la tarjeta. Con el MOUSE, se esconde. Con el TECLADO (sin puntero) se
  // RECOLOCA junto a la cita (v4, o1): enfocar con Tab una cita fuera de la vista hace que el navegador
  // desplace la rejilla, y ese mismo scroll la cerraba nada más abrirse. Si la cita sale de la vista, se va.
  // «Fuera de la vista» se mide contra el CONTENEDOR que se desplaza (guardado al abrir), no contra la
  // ventana: la cita que sube con la rueda bajo la fila de doctores ya no se ve aunque siga dentro de la
  // ventana (v5, p1). Esc la cierra (WCAG 1.4.13). Y al desmontar, nada colgando.
  const abierta = visible !== null;
  const deTeclado = visible !== null && visible.puntero === null;
  const elVisible = visible?.el ?? null;
  useEffect(() => {
    if (!abierta) return;
    let cuadro = 0;
    const contenedor = deTeclado && elVisible ? contenedorQueSeDesplaza(elVisible) : null;
    const pegadas = contenedor ? cabecerasPegadas(contenedor) : { arriba: 0, izquierda: 0 };
    const alMoverse = () => {
      if (!deTeclado || !elVisible) {
        salir();
        return;
      }
      if (cuadro) return;
      cuadro = requestAnimationFrame(() => {
        cuadro = 0;
        if (!elVisible.isConnected) return salir();
        const r = elVisible.getBoundingClientRect();
        const area = areaVisible(
          contenedor ? cajaInterior(contenedor) : null,
          { ancho: window.innerWidth, alto: window.innerHeight },
          pegadas,
        );
        if (citaFueraDeLaVista(r, area)) return salir();
        setVisible((v) => (v && v.el === elVisible ? { ...v, rect: r } : v));
      });
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") salir();
    };
    window.addEventListener("scroll", alMoverse, true);
    window.addEventListener("resize", alMoverse);
    document.addEventListener("keydown", tecla);
    return () => {
      if (cuadro) cancelAnimationFrame(cuadro);
      window.removeEventListener("scroll", alMoverse, true);
      window.removeEventListener("resize", alMoverse);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierta, deTeclado, elVisible, salir]);
  useEffect(() => () => {
    cancelar();
    soltarAncla();
  }, [cancelar, soltarAncla]);

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
      // Solo un 2xx es «guardado»: 503 = falta el SQL; cualquier otro fallo (o la red) = no se guardó. En los
      // dos casos el cambio vale en esta pestaña y el interruptor lo dice.
      .then((r) => setGuardado(r.ok ? "si" : r.status === 503 ? "sinSql" : "error"))
      .catch(() => setGuardado("error"));
  }, [encendida, salir]);

  const valor = useMemo<ValorDetallesAlPasar>(
    () => ({ encendida, guardado, conMouse, alternar, entrar, mover, enfocar, salir }),
    [encendida, guardado, conMouse, alternar, entrar, mover, enfocar, salir],
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

/** El ancestro más cercano que se desplaza (overflow auto/scroll), o `null` si es la ventana. */
function contenedorQueSeDesplaza(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const c = getComputedStyle(p);
    if (/(auto|scroll)/.test(`${c.overflowY} ${c.overflowX}`)) return p;
  }
  return null;
}

/** El área de contenido del contenedor (sin sus barras de desplazamiento), en coordenadas de la ventana. */
function cajaInterior(c: HTMLElement) {
  const r = c.getBoundingClientRect();
  const top = r.top + c.clientTop;
  const left = r.left + c.clientLeft;
  return { top, left, bottom: top + c.clientHeight, right: left + c.clientWidth };
}

/**
 * Cuánto tapan arriba y a la izquierda las cabeceras pegadas (`position: sticky`) que el contenedor tenga
 * dentro (hasta dos niveles: así están hechas las rejillas). Se mide una vez, al abrir. Hoy la agenda nueva
 * no tiene ninguna (su cabecera va fuera del contenedor); esto la cubre si alguna vista la añade.
 */
function cabecerasPegadas(c: HTMLElement): { arriba: number; izquierda: number } {
  const caja = c.getBoundingClientRect();
  let arriba = 0;
  let izquierda = 0;
  c.querySelectorAll<HTMLElement>(":scope > *, :scope > * > *").forEach((h) => {
    const est = getComputedStyle(h);
    if (est.position !== "sticky") return;
    const r = h.getBoundingClientRect();
    if (est.top !== "auto" && r.width >= caja.width / 2) arriba = Math.max(arriba, r.bottom - caja.top - c.clientTop);
    if (est.left !== "auto" && r.height >= caja.height / 2) izquierda = Math.max(izquierda, r.right - caja.left - c.clientLeft);
  });
  return { arriba, izquierda };
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
          <span
            className={s.estado}
            style={{ background: cita.pinta.chipFondo, color: cita.pinta.chipTinta }}
            data-estado={cita.estado}
          >
            {estado.extra === "porWhatsapp" ? (
              <MessageCircle size={12} strokeWidth={2.4} aria-hidden />
            ) : (
              <span className={s.punto} aria-hidden />
            )}
            {estado.chip}
            {estado.extra ? ` · ${EXTRA_DEL_CHIP[estado.extra]}` : ""}
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
