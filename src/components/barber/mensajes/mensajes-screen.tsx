"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Dictionary } from "@/i18n/t";
import type { BarberWaMessageDTO, BarberWaThreadDTO } from "@/lib/barber/whatsapp-core";
import { BarberIcon, type BarberIconName } from "../barber-icons";
import { apiCall } from "../team/admin-ui";
import { avisarSinLeer, chatsSinLeer } from "./sin-leer";
import { MsjI18n, useMsjT, type MsjT } from "./ui";
import {
  cuandoLista,
  desarmarCuerpo,
  diaClave,
  esAutomatico,
  etiquetaDia,
  fechaCita,
  filtrarChats,
  horaCorta,
  iniciales,
  proximaCita,
  quienAtiende,
  telefonoClave,
  telefonoLegible,
  trozosConEnlaces,
  ventanaRestante,
  vistaPrevia,
  type Atiende,
  type CitaMin,
  type EstadoBot,
  type Filtro,
  type PausaBot,
} from "./formato";
import s from "./mensajes.module.css";

// ═══════════════════════════════════════════════════════════════════════
// /barber/mensajes — la bandeja de WhatsApp (rediseño 15-nov).
//
// Lo que ya decidía la bandeja vieja (inbox-panel.tsx) se queda IGUAL:
//  1. El estado que se pinta es el REAL: «No se entregó» y su motivo.
//  2. Archivar NUNCA borra; si el cliente escribe, el chat regresa solo.
//  3. La multimedia sale del proxy por id de MENSAJE, acotado por barbería.
//
// Todo lo que se pinta sale de APIs que ya existían: hilos y mensajes de
// WhatsApp, pausas del bot y la agenda (para la próxima cita). Nada nuevo
// en el servidor.
//
// Escritorio: lista a la izquierda y chat a la derecha, dentro de una sola
// tarjeta. Celular (≤ 760 px de ancho útil): dos pantallas, lista → chat →
// volver; el botón Atrás del teléfono también vuelve a la lista.
// ═══════════════════════════════════════════════════════════════════════

interface Detalle {
  messages: BarberWaMessageDTO[];
  windowOpen: boolean;
  clientId: string | null;
  clientName: string | null;
}

type Cita = CitaMin & { id: string };

export interface MensajesInicial {
  threads: BarberWaThreadDTO[];
  pauses: PausaBot[];
  bot: EstadoBot;
  connected: boolean;
  quotaExhausted: boolean;
}

export interface MensajesPermisos {
  /** whatsapp.send — contestar y archivar. */
  send: boolean;
  /** whatsapp.send + plan con bot — pausar y devolver al bot. */
  attend: boolean;
  /** clients.view — enlace a la ficha. */
  clients: boolean;
  /** agenda.view + plan con agenda — próxima cita. */
  agenda: boolean;
}

interface Props {
  dict: Dictionary;
  locale: string;
  timezone: string;
  nowISO: string;
  initial: MensajesInicial;
  can: MensajesPermisos;
  initialPhone: string | null;
}

export function MensajesScreen(props: Props) {
  return (
    <MsjI18n dict={props.dict}>
      <Bandeja {...props} />
    </MsjI18n>
  );
}

const ANGOSTO = 760;
const CADA_LISTA_MS = 30_000;
const CADA_CHAT_MS = 15_000;
const LIMITE = 4000;

/** El chat que está abierto se recuerda en la dirección: ?tel=9992602093 */
function telDeLaDireccion(): string | null {
  try {
    return new URL(window.location.href).searchParams.get("tel");
  } catch {
    return null;
  }
}

function Bandeja({ locale, timezone, nowISO, initial, can, initialPhone }: Props) {
  const t = useMsjT();
  const raiz = useRef<HTMLDivElement | null>(null);

  const [ahora, setAhora] = useState(() => new Date(nowISO));
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [threads, setThreads] = useState<BarberWaThreadDTO[]>(initial.threads);
  const [archivados, setArchivados] = useState<BarberWaThreadDTO[] | null>(null);
  const [listaEstado, setListaEstado] = useState<"ok" | "cargando" | "error">("ok");
  const [pausas, setPausas] = useState<PausaBot[]>(initial.pauses);
  const [activo, setActivo] = useState<string | null>(initialPhone);
  const [detalle, setDetalle] = useState<{ phone: string; data: Detalle } | null>(null);
  const [chatEstado, setChatEstado] = useState<"ok" | "cargando" | "error">("ok");
  const [citas, setCitas] = useState<Cita[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; deshacer?: () => void } | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const bot = initial.bot;
  const atiende = useCallback((phone: string) => quienAtiende(phone, bot, pausas), [bot, pausas]);

  // ── La hora «de ahora» avanza sola (para «hace 5 min»). ────────────────
  useEffect(() => {
    setAhora(new Date());
    const id = window.setInterval(() => setAhora(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // ── Lista ──────────────────────────────────────────────────────────────
  const cargarLista = useCallback(
    async (silencioso = false) => {
      if (!silencioso) setListaEstado("cargando");
      try {
        const data = await apiCall<{ threads: BarberWaThreadDTO[] }>(
          "/api/barber/whatsapp/threads?archived=0",
        );
        setThreads(data.threads);
        setListaEstado("ok");
        avisarSinLeer(chatsSinLeer(data.threads));
      } catch {
        if (!silencioso) setListaEstado("error");
      }
    },
    [],
  );

  const cargarArchivados = useCallback(async (silencioso = false) => {
    if (!silencioso) setListaEstado("cargando");
    try {
      const data = await apiCall<{ threads: BarberWaThreadDTO[] }>(
        "/api/barber/whatsapp/threads?archived=1",
      );
      setArchivados(data.threads);
      setListaEstado("ok");
    } catch {
      if (!silencioso) setListaEstado("error");
    }
  }, []);

  useEffect(() => {
    avisarSinLeer(chatsSinLeer(initial.threads));
  }, [initial.threads]);

  useEffect(() => {
    if (filtro === "archivados" && archivados === null) void cargarArchivados();
  }, [filtro, archivados, cargarArchivados]);

  // ── Chat abierto ───────────────────────────────────────────────────────
  const cargarChat = useCallback(async (phone: string, silencioso = false) => {
    if (!silencioso) setChatEstado("cargando");
    try {
      const data = await apiCall<Detalle>(
        `/api/barber/whatsapp/messages?phone=${encodeURIComponent(phone)}`,
      );
      setDetalle({ phone, data });
      setChatEstado("ok");
    } catch {
      if (!silencioso) setChatEstado("error");
    }
  }, []);

  useEffect(() => {
    setErrorAccion(null);
    if (activo) void cargarChat(activo);
    else setDetalle(null);
  }, [activo, cargarChat]);

  // ── Se relee solo, con la pestaña a la vista ───────────────────────────
  useEffect(() => {
    const lista = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void cargarLista(true);
      if (filtro === "archivados") void cargarArchivados(true);
    }, CADA_LISTA_MS);
    const chat = window.setInterval(() => {
      if (document.visibilityState === "visible" && activo) void cargarChat(activo, true);
    }, CADA_CHAT_MS);
    return () => {
      window.clearInterval(lista);
      window.clearInterval(chat);
    };
  }, [activo, filtro, cargarLista, cargarArchivados, cargarChat]);

  // ── Próxima cita: la agenda de los próximos 14 días (API de la agenda) ─
  useEffect(() => {
    if (!can.agenda) return;
    let vivo = true;
    apiCall<{ appointments: Cita[] }>("/api/barber/appointments?days=14")
      .then((d) => {
        if (vivo) setCitas(Array.isArray(d.appointments) ? d.appointments : []);
      })
      .catch(() => {
        // Sin agenda no hay próxima cita que enseñar; el chat sigue igual.
      });
    return () => {
      vivo = false;
    };
  }, [can.agenda]);

  // ── Dirección, botón Atrás y teclado del celular ───────────────────────
  const esAngosto = useCallback(() => (raiz.current?.clientWidth ?? 1024) <= ANGOSTO, []);

  useEffect(() => {
    function onPop() {
      setActivo(telDeLaDireccion());
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    const el = raiz.current;
    if (!vv || !el) return;
    const medir = () => el.style.setProperty("--msj-vv-h", `${Math.round(vv.height)}px`);
    medir();
    vv.addEventListener("resize", medir);
    return () => vv.removeEventListener("resize", medir);
  }, []);

  const abrir = useCallback(
    (phone: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set("tel", phone);
      if (esAngosto()) {
        // En celular el chat es OTRA pantalla: Atrás tiene que volver a la lista.
        window.history.pushState({ msjChat: true }, "", url);
        window.scrollTo({ top: 0 });
      } else {
        window.history.replaceState(window.history.state, "", url);
      }
      setActivo(phone);
    },
    [esAngosto],
  );

  const volver = useCallback(() => {
    const phone = activo;
    if (window.history.state?.msjChat) {
      window.history.back();
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("tel");
      window.history.replaceState(window.history.state, "", url);
      setActivo(null);
    }
    // El foco vuelve al renglón del chat que se dejó.
    window.setTimeout(() => {
      const fila = phone
        ? raiz.current?.querySelector<HTMLElement>(`[data-phone="${CSS.escape(phone)}"]`)
        : null;
      fila?.focus();
    }, 0);
  }, [activo]);

  // ── Acciones ───────────────────────────────────────────────────────────
  const recargarTodo = useCallback(async () => {
    await cargarLista(true);
    if (archivados !== null || filtro === "archivados") await cargarArchivados(true);
  }, [archivados, filtro, cargarLista, cargarArchivados]);

  const archivar = useCallback(
    async (phone: string, archivar: boolean, conDeshacer = true) => {
      setOcupado(true);
      setErrorAccion(null);
      try {
        await apiCall("/api/barber/whatsapp/archive", {
          method: "POST",
          json: { phone, archived: archivar },
        });
        await recargarTodo();
        setAviso({
          texto: archivar ? t("chat.archived") : t("chat.unarchived"),
          deshacer: conDeshacer ? () => void archivarRef.current(phone, !archivar, false) : undefined,
        });
      } catch (e) {
        setErrorAccion(e instanceof Error ? e.message : t("errors.generic"));
      } finally {
        setOcupado(false);
      }
    },
    [recargarTodo, t],
  );
  // Deshacer llama a la versión más nueva de archivar (sin cerrar sobre una vieja).
  const archivarRef = useRef(archivar);
  archivarRef.current = archivar;

  const cambiarAtiende = useCallback(
    async (phone: string, a: "bot" | "persona") => {
      setOcupado(true);
      setErrorAccion(null);
      try {
        const res = await apiCall<{ pauses: PausaBot[] }>("/api/barber/bot/pause", {
          method: "POST",
          json: { phone, action: a === "persona" ? "pause" : "resume" },
        });
        setPausas(res.pauses);
        setAviso({ texto: a === "persona" ? t("who.taken") : t("who.givenBack") });
      } catch (e) {
        setErrorAccion(e instanceof Error ? e.message : t("errors.generic"));
      } finally {
        setOcupado(false);
      }
    },
    [t],
  );

  // El aviso se va solo a los 6 s.
  useEffect(() => {
    if (!aviso) return;
    const id = window.setTimeout(() => setAviso(null), 6000);
    return () => window.clearTimeout(id);
  }, [aviso]);

  // ── Lo que se pinta ────────────────────────────────────────────────────
  const base = filtro === "archivados" ? (archivados ?? []) : threads;
  const visibles = useMemo(
    () => filtrarChats(base, filtro === "archivados" ? "todos" : filtro, busqueda, atiende),
    [base, filtro, busqueda, atiende],
  );
  const hiloActivo =
    (activo && (threads.find((th) => th.phone === activo) ?? archivados?.find((th) => th.phone === activo))) ||
    null;
  const det = detalle && detalle.phone === activo ? detalle.data : null;

  const sinNada = !initial.connected && threads.length === 0 && filtro !== "archivados";

  if (sinNada) {
    return (
      <div ref={raiz} className={s.msj}>
        <div className={s.marco} data-vista="lista">
          <Cabeza t={t} />
          <div className={s.conectar}>
            <span className={s.vacioIcono} aria-hidden="true">
              <BarberIcon name="charla" size={26} />
            </span>
            <h2 className={s.vacioTitulo}>{t("connect.title")}</h2>
            <p className={s.vacioTexto}>{t("connect.body")}</p>
            <Link href="/barber/whatsapp" className={s.botonPrimario}>
              {t("connect.cta")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={raiz} className={s.msj}>
      <div className={s.marco} data-vista={activo ? "chat" : "lista"}>
        <Cabeza t={t} />

        {!initial.connected ? (
          <p className={s.banner} role="note">
            <BarberIcon name="alerta" size={14} />
            <span>{t("connect.banner")}</span>
            <Link href="/barber/whatsapp">{t("connect.bannerCta")}</Link>
          </p>
        ) : null}

        <div className={s.bandeja}>
          {/* ── Lista de chats ─────────────────────────────────────────── */}
          <section className={s.lista} aria-label={t("list.label")}>
            <div className={s.listaCabeza}>
              <div className={s.buscador} role="search">
                <BarberIcon name="lupa" size={15} className={s.buscadorIcono} />
                <input
                  type="search"
                  className={s.buscadorCampo}
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder={t("search.placeholder")}
                  aria-label={t("search.label")}
                  autoComplete="off"
                  enterKeyHint="search"
                />
                {busqueda ? (
                  <button
                    type="button"
                    className={s.buscadorBorrar}
                    onClick={() => setBusqueda("")}
                    aria-label={t("search.clear")}
                  >
                    <BarberIcon name="equis" size={13} />
                  </button>
                ) : null}
              </div>
              <Filtros
                t={t}
                filtro={filtro}
                onFiltro={setFiltro}
                conBot={bot.disponible}
                sinLeer={chatsSinLeer(threads)}
              />
            </div>

            <ListaChats
              t={t}
              estado={listaEstado}
              visibles={visibles}
              filtro={filtro}
              busqueda={busqueda}
              activo={activo}
              ahora={ahora}
              tz={timezone}
              locale={locale}
              atiende={atiende}
              onAbrir={abrir}
              onReintentar={() => void (filtro === "archivados" ? cargarArchivados() : cargarLista())}
              onLimpiar={() => {
                setBusqueda("");
                setFiltro("todos");
              }}
            />
          </section>

          {/* ── Chat ───────────────────────────────────────────────────── */}
          <section
            className={s.chat}
            aria-label={
              activo
                ? t("chat.messages", { name: det?.clientName ?? hiloActivo?.clientName ?? telefonoLegible(activo) })
                : t("chat.pick")
            }
          >
            {!activo ? (
              <div className={s.elige}>
                <span className={s.vacioIcono} aria-hidden="true">
                  <BarberIcon name="charla" size={26} />
                </span>
                <h2 className={s.vacioTitulo}>{t("chat.pick")}</h2>
                <p className={s.vacioTexto}>{t("chat.pickHint")}</p>
              </div>
            ) : (
              <Chat
                key={activo}
                t={t}
                phone={activo}
                hilo={hiloActivo}
                det={det}
                estado={chatEstado}
                ahora={ahora}
                tz={timezone}
                locale={locale}
                can={can}
                bot={bot}
                atiende={atiende(activo)}
                pausa={pausas.find((p) => telefonoClave(p.phone) === telefonoClave(activo)) ?? null}
                cita={citas ? proximaCita(citas, activo, det?.clientId ?? hiloActivo?.clientId ?? null, ahora) : null}
                citasListas={citas !== null}
                conectado={initial.connected}
                cuotaAgotada={initial.quotaExhausted}
                ocupado={ocupado}
                errorAccion={errorAccion}
                onVolver={volver}
                onReintentar={() => void cargarChat(activo)}
                onArchivar={(v) => void archivar(activo, v)}
                onAtiende={(a) => void cambiarAtiende(activo, a)}
                onEnviado={async () => {
                  await cargarChat(activo, true);
                  await cargarLista(true);
                }}
              />
            )}
          </section>

          <div className={s.aviso} role="status" aria-live="polite">
            {aviso ? (
              <span className={s.avisoCaja}>
                {aviso.texto}
                {aviso.deshacer ? (
                  <button
                    type="button"
                    onClick={() => {
                      const d = aviso.deshacer;
                      setAviso(null);
                      d?.();
                    }}
                  >
                    {t("chat.undo")}
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Cabeza({ t }: { t: MsjT }) {
  return (
    <header className={s.cabeza}>
      <h1 className={s.titulo}>{t("title")}</h1>
      <p className={s.subtitulo}>{t("subtitle")}</p>
    </header>
  );
}

// ── Filtros ──────────────────────────────────────────────────────────────

function Filtros({
  t,
  filtro,
  onFiltro,
  conBot,
  sinLeer,
}: {
  t: MsjT;
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
  conBot: boolean;
  sinLeer: number;
}) {
  // «Los atiende el bot» y «Pausados» solo tienen sentido con bot en el plan.
  const opciones: Filtro[] = conBot
    ? ["todos", "sinLeer", "bot", "pausados", "archivados"]
    : ["todos", "sinLeer", "archivados"];
  return (
    <div className={s.filtros} role="group" aria-label={t("filters.label")}>
      {opciones.map((f) => (
        <button
          key={f}
          type="button"
          className={s.filtro}
          aria-pressed={filtro === f}
          onClick={() => onFiltro(f)}
        >
          {t(`filters.${f}`)}
          {f === "sinLeer" && sinLeer > 0 ? <span className={s.filtroCuenta}>{sinLeer}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ── Lista ────────────────────────────────────────────────────────────────

function ListaChats({
  t,
  estado,
  visibles,
  filtro,
  busqueda,
  activo,
  ahora,
  tz,
  locale,
  atiende,
  onAbrir,
  onReintentar,
  onLimpiar,
}: {
  t: MsjT;
  estado: "ok" | "cargando" | "error";
  visibles: BarberWaThreadDTO[];
  filtro: Filtro;
  busqueda: string;
  activo: string | null;
  ahora: Date;
  tz: string;
  locale: string;
  atiende: (phone: string) => Atiende;
  onAbrir: (phone: string) => void;
  onReintentar: () => void;
  onLimpiar: () => void;
}) {
  if (estado === "error") {
    return (
      <div className={s.listaVacia} role="alert">
        <p>{t("list.error")}</p>
        <button type="button" className={s.botonSecundario} onClick={onReintentar}>
          {t("list.retry")}
        </button>
      </div>
    );
  }
  if (estado === "cargando" && visibles.length === 0) {
    return (
      <ul className={s.filas} aria-busy="true" aria-label={t("list.loading")}>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className={s.filaFantasma} aria-hidden="true">
            <span className={s.fantasmaCirculo} />
            <span className={s.fantasmaLineas}>
              <span />
              <span />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (visibles.length === 0) {
    const q = busqueda.trim();
    const texto = q
      ? t("list.noMatch", { q })
      : filtro === "todos"
        ? t("list.empty")
        : t(`list.empty${filtro.charAt(0).toUpperCase()}${filtro.slice(1)}`);
    return (
      <div className={s.listaVacia}>
        <p>{texto}</p>
        {q || filtro !== "todos" ? (
          <button type="button" className={s.botonSecundario} onClick={onLimpiar}>
            {q ? t("search.clear") : t("list.showAll")}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <ul className={s.filas}>
      {visibles.map((th) => (
        <FilaChat
          key={th.phone}
          t={t}
          th={th}
          activo={th.phone === activo}
          atiende={atiende(th.phone)}
          ahora={ahora}
          tz={tz}
          locale={locale}
          onAbrir={onAbrir}
        />
      ))}
    </ul>
  );
}

function Avatar({ nombre, grande = false }: { nombre: string | null; grande?: boolean }) {
  const ini = iniciales(nombre);
  return (
    <span
      className={[s.avatar, ini ? "" : s.avatarSinNombre, grande ? s.avatarGrande : ""].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      {ini ?? <BarberIcon name="persona" size={grande ? 18 : 17} />}
    </span>
  );
}

const ICONO_ESTADO: Record<string, BarberIconName> = {
  PENDING: "reloj",
  SENT: "palomita",
  DELIVERED: "dobles",
  READ: "dobles",
  FAILED: "alerta",
};

function Marca({ t, atiende, ultimoEntrante }: { t: MsjT; atiende: Atiende; ultimoEntrante: boolean }) {
  if (atiende === "bot") {
    return (
      <span className={`${s.marca} ${s.marcaBot}`}>
        <BarberIcon name="robot" size={12} />
        {t("who.bot")}
      </span>
    );
  }
  if (atiende === "persona") {
    return (
      <span className={`${s.marca} ${s.marcaPersona}`}>
        <BarberIcon name="persona" size={12} />
        {t("who.persona")}
      </span>
    );
  }
  // Nadie lo contesta solo: se marca cuando lo último fue del cliente.
  return ultimoEntrante ? <span className={`${s.marca} ${s.marcaNadie}`}>{t("who.nadie")}</span> : null;
}

function FilaChat({
  t,
  th,
  activo,
  atiende,
  ahora,
  tz,
  locale,
  onAbrir,
}: {
  t: MsjT;
  th: BarberWaThreadDTO;
  activo: boolean;
  atiende: Atiende;
  ahora: Date;
  tz: string;
  locale: string;
  onAbrir: (phone: string) => void;
}) {
  const nombre = th.clientName ?? telefonoLegible(th.phone);
  const out = th.lastDirection === "OUTBOUND";
  const sinLeer = th.unread > 0;
  return (
    <li>
      <button
        type="button"
        className={[s.fila, sinLeer ? s.filaSinLeer : ""].filter(Boolean).join(" ")}
        aria-current={activo ? "true" : undefined}
        data-phone={th.phone}
        onClick={() => onAbrir(th.phone)}
      >
        <Avatar nombre={th.clientName} />
        <span className={s.filaCuerpo}>
          <span className={s.filaArriba}>
            <span className={s.filaNombre}>{nombre}</span>
            <span className={s.filaHora}>
              {cuandoLista(th.lastAt, ahora, tz, locale, { ahora: t("chat.now"), ayer: t("chat.yesterday") })}
            </span>
          </span>
          <span className={s.filaAbajo}>
            <span className={s.filaPrevia}>
              {out ? (
                <BarberIcon
                  name={ICONO_ESTADO[th.lastStatus] ?? "palomita"}
                  size={14}
                  className={[s.estadoIcono, s[`est_${th.lastStatus}`]].filter(Boolean).join(" ")}
                />
              ) : null}
              {out ? `${t("list.you")}: ` : ""}
              {vistaPrevia(th.lastBody) || "—"}
            </span>
            <Marca t={t} atiende={atiende} ultimoEntrante={!out} />
            {sinLeer ? (
              <span className={s.cuenta}>
                <span aria-hidden="true">{th.unread > 99 ? "99+" : th.unread}</span>
                <span className="sr-only">
                  {th.unread === 1 ? t("list.unreadOne") : t("list.unread", { count: th.unread })}
                </span>
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

// ── Chat ─────────────────────────────────────────────────────────────────

interface ChatProps {
  t: MsjT;
  phone: string;
  hilo: BarberWaThreadDTO | null;
  det: Detalle | null;
  estado: "ok" | "cargando" | "error";
  ahora: Date;
  tz: string;
  locale: string;
  can: MensajesPermisos;
  bot: EstadoBot;
  atiende: Atiende;
  pausa: PausaBot | null;
  cita: Cita | null;
  citasListas: boolean;
  conectado: boolean;
  cuotaAgotada: boolean;
  ocupado: boolean;
  errorAccion: string | null;
  onVolver: () => void;
  onReintentar: () => void;
  onArchivar: (archivar: boolean) => void;
  onAtiende: (a: "bot" | "persona") => void;
  onEnviado: () => Promise<void>;
}

function Chat(p: ChatProps) {
  const { t, phone, det, hilo } = p;
  const titulo = useRef<HTMLHeadingElement | null>(null);
  const nombre = det?.clientName ?? hilo?.clientName ?? null;
  const clientId = det?.clientId ?? hilo?.clientId ?? null;
  const archivado = hilo?.archived ?? false;
  const [pendientes, setPendientes] = useState<BarberWaMessageDTO[]>([]);

  // Al abrir un chat, el foco va a su título (lectores de pantalla y celular).
  useEffect(() => {
    titulo.current?.focus({ preventScroll: true });
  }, []);

  const mensajes = useMemo(() => [...(det?.messages ?? []), ...pendientes], [det, pendientes]);

  // Próxima cita (si el rol ve la agenda). En escritorio va en la cabecera;
  // en celular, en su propio renglón debajo (el CSS enseña uno u otro).
  const cita =
    p.can.agenda && p.citasListas ? (
      p.cita ? (
        <span>
          <strong>{t("chat.nextAppt")}:</strong> {fechaCita(p.cita.startAt, p.tz, p.locale)}
          {p.cita.services.length > 0 ? ` · ${p.cita.services.map((x) => x.serviceName).join(", ")}` : ""}
          {p.cita.barberName ? ` · ${t("chat.with", { barber: p.cita.barberName })}` : ""}
        </span>
      ) : (
        <span>{t("chat.noAppt")}</span>
      )
    ) : null;

  return (
    <>
      <div className={s.chatCabeza}>
        <button type="button" className={s.volver} onClick={p.onVolver} aria-label={t("chat.back")}>
          <BarberIcon name="atras" size={18} />
        </button>
        <Avatar nombre={nombre} grande />
        <div className={s.chatQuien}>
          <h2 className={s.chatNombre} ref={titulo} tabIndex={-1}>
            {nombre ?? telefonoLegible(phone)}
          </h2>
          <p className={s.chatSub}>
            {nombre ? <span>{telefonoLegible(phone)}</span> : <span>{t("chat.noClient")}</span>}
            {clientId && p.can.clients ? (
              <Link href={`/barber/clientes/${encodeURIComponent(clientId)}`} className={s.enlace}>
                {t("chat.viewClient")}
              </Link>
            ) : null}
          </p>
          {cita ? (
            <p className={s.chatCita}>
              <BarberIcon name="agenda" size={13} />
              {cita}
            </p>
          ) : null}
        </div>
        {p.can.send && hilo ? (
          <div className={s.chatAcciones}>
            <button
              type="button"
              className={s.botonIcono}
              disabled={p.ocupado}
              onClick={() => p.onArchivar(!archivado)}
              title={archivado ? t("chat.unarchive") : t("chat.archive")}
            >
              <BarberIcon name="archivo" size={16} />
              <span className={s.botonIconoTexto}>{archivado ? t("chat.unarchive") : t("chat.archive")}</span>
            </button>
          </div>
        ) : null}
      </div>

      {cita ? (
        <p className={s.citaCelular}>
          <BarberIcon name="agenda" size={13} />
          {cita}
        </p>
      ) : null}

      <QuienAtiende t={t} {...p} />

      <Hilo
        t={t}
        nombre={nombre ?? telefonoLegible(phone)}
        mensajes={mensajes}
        estado={p.estado}
        cargado={det !== null}
        ahora={p.ahora}
        tz={p.tz}
        locale={p.locale}
        onReintentar={p.onReintentar}
      />

      {p.errorAccion ? (
        <p className={s.errorAccion} role="alert">
          {p.errorAccion}
        </p>
      ) : null}

      <Redactor
        t={t}
        locale={p.locale}
        phone={phone}
        det={det}
        ahora={p.ahora}
        can={p.can}
        conectado={p.conectado}
        cuotaAgotada={p.cuotaAgotada}
        onPendiente={(m) => setPendientes((xs) => [...xs, m])}
        onListo={async () => {
          await p.onEnviado();
          setPendientes([]);
        }}
        onFallo={() => setPendientes([])}
      />
    </>
  );
}

function QuienAtiende({
  t,
  bot,
  atiende,
  pausa,
  can,
  ocupado,
  onAtiende,
  tz,
  locale,
}: ChatProps) {
  // Sin bot en el plan, o apagado, o sin conexión: lo atiende el equipo.
  if (atiende === "nadie") {
    return (
      <div className={s.atiende}>
        <BarberIcon name="persona" size={14} className={s.atiendeIcono} />
        <p className={s.atiendeTexto}>{bot.disponible ? t("who.botOff") : t("who.noBot")}</p>
      </div>
    );
  }
  const enPausa = atiende === "persona";
  const desde = pausa ? `${fechaCita(pausa.pausedAt, tz, locale)}` : null;
  return (
    <div className={s.atiende}>
      <span className={s.atiendeEtiqueta} id="msj-atiende">
        {t("who.label")}
      </span>
      <div className={s.segmento} role="group" aria-labelledby="msj-atiende">
        <button
          type="button"
          aria-pressed={!enPausa}
          disabled={!can.attend || ocupado}
          onClick={() => {
            if (enPausa) onAtiende("bot");
          }}
        >
          <BarberIcon name="robot" size={14} />
          {t("who.optionBot")}
        </button>
        <button
          type="button"
          aria-pressed={enPausa}
          disabled={!can.attend || ocupado}
          onClick={() => {
            if (!enPausa) onAtiende("persona");
          }}
        >
          <BarberIcon name="persona" size={14} />
          {t("who.optionPersona")}
        </button>
      </div>
      <p className={s.atiendeTexto}>
        {enPausa
          ? [desde ? t("who.pausedSince", { when: desde }) : t("who.personaHint"), pausa?.reason ?? null]
              .filter(Boolean)
              .join(" · ")
          : t("who.botHint")}
      </p>
    </div>
  );
}

// ── Mensajes ─────────────────────────────────────────────────────────────

const SEGUIDO_MS = 5 * 60 * 1000;

function Hilo({
  t,
  nombre,
  mensajes,
  estado,
  cargado,
  ahora,
  tz,
  locale,
  onReintentar,
}: {
  t: MsjT;
  nombre: string;
  mensajes: BarberWaMessageDTO[];
  estado: "ok" | "cargando" | "error";
  cargado: boolean;
  ahora: Date;
  tz: string;
  locale: string;
  onReintentar: () => void;
}) {
  const caja = useRef<HTMLDivElement | null>(null);
  const cuantos = useRef(0);

  // Abre por abajo, como cualquier chat. Al llegar mensajes nuevos baja
  // solo si ya se estaba leyendo el final (no le roba el lugar a quien
  // subió a leer algo viejo).
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const primera = cuantos.current === 0;
    const cerca = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (mensajes.length !== cuantos.current && (primera || cerca)) {
      el.scrollTop = el.scrollHeight;
    }
    cuantos.current = mensajes.length;
  }, [mensajes]);

  if (!cargado && estado === "error") {
    return (
      <div className={s.hilo}>
        <div className={s.hiloVacio} role="alert">
          <p>{t("chat.error")}</p>
          <button type="button" className={s.botonSecundario} onClick={onReintentar}>
            {t("list.retry")}
          </button>
        </div>
      </div>
    );
  }
  if (!cargado) {
    return (
      <div className={s.hilo} aria-busy="true" aria-label={t("chat.loading")}>
        <span className={`${s.burbujaFantasma} ${s.fantasmaIzq}`} />
        <span className={`${s.burbujaFantasma} ${s.fantasmaDer}`} />
        <span className={`${s.burbujaFantasma} ${s.fantasmaIzq} ${s.fantasmaCorta}`} />
      </div>
    );
  }
  if (mensajes.length === 0) {
    return (
      <div className={s.hilo}>
        <p className={s.hiloVacio}>{t("chat.empty")}</p>
      </div>
    );
  }

  const piezas: ReactNode[] = [];
  let diaAnterior = "";
  mensajes.forEach((m, i) => {
    const dia = diaClave(m.createdAt, tz);
    if (dia !== diaAnterior) {
      piezas.push(
        <li key={`dia-${dia}`} className={s.dia}>
          <span>{etiquetaDia(m.createdAt, ahora, tz, locale, { hoy: t("chat.today"), ayer: t("chat.yesterday") })}</span>
        </li>,
      );
    }
    const prev = i > 0 ? mensajes[i - 1] : null;
    const seguido = Boolean(
      prev &&
        dia === diaAnterior &&
        prev.direction === m.direction &&
        esDeSistema(prev) === esDeSistema(m) &&
        Date.parse(m.createdAt) - Date.parse(prev.createdAt) < SEGUIDO_MS,
    );
    diaAnterior = dia;
    piezas.push(<Burbuja key={m.id} t={t} m={m} seguido={seguido} tz={tz} locale={locale} />);
  });

  return (
    <div className={s.hilo} ref={caja} tabIndex={0} aria-label={t("chat.messages", { name: nombre })}>
      <ol className={s.hiloLista}>{piezas}</ol>
    </div>
  );
}

function esDeSistema(m: BarberWaMessageDTO): boolean {
  return m.direction === "OUTBOUND" && (Boolean(m.templateName) || esAutomatico(m.body));
}

function Burbuja({
  t,
  m,
  seguido,
  tz,
  locale,
}: {
  t: MsjT;
  m: BarberWaMessageDTO;
  seguido: boolean;
  tz: string;
  locale: string;
}) {
  const out = m.direction === "OUTBOUND";
  const fallo = m.status === "FAILED";
  const enviando = m.id.startsWith("local-");
  const sistema = esDeSistema(m);
  const partes = desarmarCuerpo(m.body, m.attachment?.kind ?? null);

  return (
    <li
      className={[
        s.msg,
        out ? s.saliente : s.entrante,
        seguido ? s.seguido : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={[
          s.burbuja,
          out ? (sistema ? s.burbujaSistema : s.burbujaSaliente) : s.burbujaEntrante,
          fallo ? s.burbujaFallida : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {sistema ? (
          <span className={s.burbujaEtiqueta}>
            <BarberIcon name="robot" size={12} />
            {m.templateName ? t("msg.template") : t("msg.automatic")}
          </span>
        ) : null}

        {m.attachment ? <Adjunto t={t} m={m} transcripcion={partes.transcripcion} /> : null}
        {!m.attachment && partes.transcripcion ? (
          <Transcripcion t={t} texto={partes.transcripcion} />
        ) : null}

        {partes.texto ? (
          <p className={s.texto}>
            {trozosConEnlaces(partes.texto).map((x, i) =>
              x.enlace ? (
                <a key={i} href={x.valor} target="_blank" rel="noreferrer" className={s.enlace}>
                  {x.valor}
                </a>
              ) : (
                <span key={i}>{x.valor}</span>
              ),
            )}
          </p>
        ) : null}

        {partes.opciones.length > 0 ? (
          <ul className={s.opciones} aria-label={t("msg.options")}>
            {partes.opciones.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        ) : null}

        <span className={s.meta}>
          <time dateTime={m.createdAt}>{horaCorta(m.createdAt, tz, locale)}</time>
          {out ? (
            <span className={[s.metaEstado, s[`est_${enviando ? "PENDING" : m.status}`]].filter(Boolean).join(" ")}>
              <BarberIcon name={enviando ? "reloj" : (ICONO_ESTADO[m.status] ?? "palomita")} size={13} />
              {enviando ? t("msg.sending") : t(`status.${m.status}`)}
            </span>
          ) : null}
        </span>
      </div>
      {fallo ? (
        <p className={s.fallo}>
          <BarberIcon name="alerta" size={13} />
          <span>
            <strong>{t("msg.failed")}</strong>
            {m.error ? `: ${m.error}` : ""}
          </span>
        </p>
      ) : null}
    </li>
  );
}

function Transcripcion({ t, texto }: { t: MsjT; texto: string }) {
  return (
    <p className={s.transcripcion}>
      <span className={s.transcripcionEtiqueta}>{t("msg.transcript")}</span>
      {texto}
    </p>
  );
}

function Adjunto({ t, m, transcripcion }: { t: MsjT; m: BarberWaMessageDTO; transcripcion: string | null }) {
  const [caduco, setCaduco] = useState(false);
  const att = m.attachment!;
  const src = `/api/barber/whatsapp/media/${encodeURIComponent(m.id)}`;

  if (caduco) {
    return (
      <p className={s.caduco}>
        <BarberIcon name="alerta" size={13} />
        {t("msg.expired")}
      </p>
    );
  }
  if (att.kind === "image" || att.kind === "sticker") {
    return (
      // <img> normal y no next/image: la fuente es nuestro proxy.
      <a href={src} target="_blank" rel="noreferrer" className={s.foto} aria-label={t("msg.openImage")}>
        <img
          src={src}
          alt={att.kind === "sticker" ? t("msg.sticker") : t("msg.image")}
          loading="lazy"
          className={att.kind === "sticker" ? s.fotoSticker : undefined}
          onError={() => setCaduco(true)}
        />
      </a>
    );
  }
  if (att.kind === "audio") {
    return (
      <div className={s.voz}>
        <span className={s.vozEtiqueta}>
          <BarberIcon name="micro" size={13} />
          {t("msg.voice")}
        </span>
        <audio controls preload="none" src={src} onError={() => setCaduco(true)} className={s.vozAudio}>
          <a href={src}>{t("msg.open")}</a>
        </audio>
        {transcripcion ? <Transcripcion t={t} texto={transcripcion} /> : null}
      </div>
    );
  }
  const etiqueta = att.kind === "video" ? t("msg.video") : (att.filename ?? t("msg.document"));
  return (
    <a href={src} target="_blank" rel="noreferrer" className={s.archivoCard}>
      <BarberIcon name={att.kind === "video" ? "foto" : "clip"} size={16} />
      <span className={s.archivoNombre}>{etiqueta}</span>
      <span className={s.archivoAbrir}>{t("msg.open")}</span>
    </a>
  );
}

// ── Caja para responder ─────────────────────────────────────────────────

function duracion(ms: number, locale: string): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  const unidad: Intl.RelativeTimeFormatUnit = min >= 60 ? "hour" : "minute";
  const valor = unidad === "hour" ? Math.round(min / 60) : min;
  try {
    return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
      style: "unit",
      unit: unidad,
      unitDisplay: "long",
    }).format(valor);
  } catch {
    return `${valor} ${unidad === "hour" ? "h" : "min"}`;
  }
}

function Redactor({
  t,
  locale,
  phone,
  det,
  ahora,
  can,
  conectado,
  cuotaAgotada,
  onPendiente,
  onListo,
  onFallo,
}: {
  t: MsjT;
  locale: string;
  phone: string;
  det: Detalle | null;
  ahora: Date;
  can: MensajesPermisos;
  conectado: boolean;
  cuotaAgotada: boolean;
  onPendiente: (m: BarberWaMessageDTO) => void;
  onListo: () => Promise<void>;
  onFallo: () => void;
}) {
  const [borrador, setBorrador] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campo = useRef<HTMLTextAreaElement | null>(null);

  // La caja crece con el texto hasta 6 renglones; luego hace scroll dentro.
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [borrador]);

  if (!conectado) {
    return (
      <div className={s.nota}>
        <p>{t("composer.disconnected")}</p>
        <Link href="/barber/whatsapp" className={s.enlace}>
          {t("connect.bannerCta")}
        </Link>
      </div>
    );
  }
  if (!can.send) {
    return (
      <div className={s.nota}>
        <p>{t("composer.noSend")}</p>
      </div>
    );
  }
  if (!det) return <div className={s.redactorReserva} aria-hidden="true" />;
  if (!det.windowOpen) {
    return (
      <div className={`${s.nota} ${s.notaVentana}`}>
        <BarberIcon name="reloj" size={16} />
        <div>
          <p className={s.notaTitulo}>{t("composer.windowClosedTitle")}</p>
          <p>{t("composer.windowClosed")}</p>
          <Link href="/barber/whatsapp" className={s.enlace}>
            {t("composer.windowClosedLink")}
          </Link>
        </div>
      </div>
    );
  }
  if (cuotaAgotada) {
    return (
      <div className={s.nota}>
        <p>{t("composer.quota")}</p>
      </div>
    );
  }

  const restante = ventanaRestante(det.messages, ahora);
  const largo = borrador.length > LIMITE;
  const texto = borrador.trim();

  async function enviar() {
    if (!texto || enviando || largo) return;
    setEnviando(true);
    setError(null);
    const guardado = borrador;
    setBorrador("");
    onPendiente({
      id: `local-${Date.now()}`,
      direction: "OUTBOUND",
      status: "PENDING",
      body: texto,
      error: null,
      templateName: null,
      attachment: null,
      createdAt: new Date().toISOString(),
      appointmentId: null,
    });
    try {
      await apiCall("/api/barber/whatsapp/messages", { method: "POST", json: { phone, body: texto } });
      await onListo();
    } catch (e) {
      onFallo();
      setBorrador(guardado);
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setEnviando(false);
      campo.current?.focus();
    }
  }

  return (
    <form
      className={s.redactor}
      onSubmit={(e) => {
        e.preventDefault();
        void enviar();
      }}
    >
      {restante > 0 && restante < 4 * 60 * 60 * 1000 ? (
        <p className={s.ventana}>
          <BarberIcon name="reloj" size={13} />
          {t("composer.windowLeft", { time: duracion(restante, locale) })}
        </p>
      ) : null}
      {error ? (
        <p className={s.redactorError} role="alert">
          {error}
        </p>
      ) : null}
      {largo ? (
        <p className={s.redactorError} role="alert">
          {t("composer.tooLong", { count: borrador.length.toLocaleString(locale === "en" ? "en-US" : "es-MX") })}
        </p>
      ) : null}
      <div className={s.redactorFila}>
        <textarea
          ref={campo}
          className={s.redactorCampo}
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          placeholder={t("composer.placeholder")}
          aria-label={t("composer.label")}
          rows={1}
          enterKeyHint="send"
          onKeyDown={(e) => {
            // Enter manda y Mayús+Enter hace salto de línea, como en WhatsApp
            // Web. En pantalla táctil Enter es salto de línea (se manda con el botón).
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            if (window.matchMedia("(pointer: coarse)").matches) return;
            e.preventDefault();
            void enviar();
          }}
        />
        <button
          type="submit"
          className={s.enviar}
          disabled={!texto || enviando || largo}
          aria-label={enviando ? t("composer.sending") : t("composer.send")}
        >
          <BarberIcon name="enviar" size={18} />
        </button>
      </div>
    </form>
  );
}
