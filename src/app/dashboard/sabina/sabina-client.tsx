"use client";

/**
 * LA PANTALLA DE SABINA — una de sus dos puertas.
 *
 * Desde ws1-t1 («Sabina en todas partes») esta pantalla ya NO es la dueña de la
 * conversación: la conversación vive en `@/components/sabina/almacen`, fuera de
 * React, y la comparten esta pantalla y el cajón lateral que se abre sobre
 * cualquier otra pantalla del panel. Por eso aquí solo queda el MARCO de la
 * pantalla —el cajón de historial, la cabecera— y el hilo lo pinta
 * `<SabinaConversacion>`, que es el mismo componente que usa el cajón.
 *
 * Si preguntas algo en el cajón y luego entras aquí, encuentras lo que
 * preguntaste. Es literalmente el mismo objeto en memoria.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Sparkles, Plus, History, X, Loader2, CloudOff } from "lucide-react";
import { SabinaConversacion } from "@/components/sabina/sabina-conversacion";
import {
  abrirConversacion,
  apagar,
  cargarHistorialUnaVez,
  hidratar,
  nuevaConversacion,
  usarClinica,
  type HistoryRow,
} from "@/components/sabina/almacen";
import { useSabinaEstado } from "@/components/sabina/use-sabina-chat";
import styles from "./sabina.module.css";
import piel from "@/components/dashboard/sabina-rx-ia-rediseno/rediseno.module.css";
import { CLASES_REDISENO_LOTE } from "@/components/dashboard/sabina-rx-ia-rediseno/raiz";
import { SaldoIaChip } from "./saldo-ia-chip";

/**
 * REDISEÑO (interruptor `menu-dos-niveles`) — «dos pieles, un esqueleto».
 *
 * El JSX de esta pantalla es UNO. Con la bandera apagada pinta las clases de
 * siempre (`sabina.module.css`, sin tocar); encendida, cada clase vieja se
 * traduce a su pieza del rediseño (`sabina-rx-ia-rediseno/rediseno.module.css`,
 * la misma hoja que visten Radiografías y el Asistente IA). La elección se
 * hace UNA vez, en `c`, así que el camino viejo no cambia ni un byte.
 *
 * El mapa trae también las clases del hilo y del composer, que ya no se pintan
 * aquí sino en `<SabinaConversacion>`: esta pantalla le baja `c` por `clases`.
 * El cajón lateral no se lo baja, así que allí se sigue viendo lo de siempre.
 * El test de la carpeta del rediseño comprueba que ninguna clase usada aquí ni
 * en `sabina-conversacion.tsx` se queda sin traducir.
 *
 * Se exporta para el cajón lateral (`dashboard/sabina/panel.tsx`, ws1-t2): con
 * la bandera le baja este MISMO mapa al hilo, y la conversación se ve igual
 * en las dos puertas.
 */
export const CLASES_REDISENO: Record<string, string> = {
  page: `${piel.pantalla} ${piel.chatSolo}`,
  backdrop: piel.velo,
  drawer: piel.cajon,
  drawerHeader: piel.cajonCabecera,
  drawerTitle: piel.lateralTitulo,
  iconBtn: piel.botonIcono,
  newConvBtn: `${piel.boton} ${piel.botonPrincipal} ${piel.cajonNueva}`,
  drawerList: piel.lateralLista,
  drawerLoading: piel.lateralNota,
  spin: piel.girar,
  drawerNotice: piel.lateralAviso,
  drawerEmpty: piel.lateralNota,
  drawerItem: piel.conversacion,
  drawerItemActive: piel.conversacionActiva,
  drawerItemTitle: piel.conversacionTitulo,
  drawerItemTime: piel.conversacionHora,
  main: piel.principal,
  header: piel.cabecera,
  headerInfo: piel.cabeceraTextos,
  headerTitle: piel.cabeceraTitulo,
  brandDot: `${piel.marcaIcono} ${piel.marcaIconoChica}`,
  headerSubtitle: piel.cabeceraSub,
  scroll: piel.hilo,
  scrollInner: piel.hiloInterior,
  centerNotice: piel.notaCentro,
  retryLink: `${piel.boton} ${piel.botonPrincipal} ${piel.botonChico}`,
  systemRow: piel.filaSistema,
  welcome: piel.bienvenida,
  welcomeIcon: piel.bienvenidaIcono,
  welcomeTitle: piel.bienvenidaTitulo,
  welcomeText: piel.bienvenidaTexto,
  suggestions: piel.sugerencias,
  suggestion: piel.sugerencia,
  suggestionText: piel.sugerenciaTitulo,
  suggestionHint: piel.sugerenciaTexto,
  message: piel.mensaje,
  messageUser: piel.mensajeUsuario,
  avatarUser: piel.avatarUsuario,
  avatarSabina: piel.avatarAsistente,
  bubbleCol: piel.mensajeColumna,
  bubbleColWide: piel.mensajeColumnaAncha,
  bubble: piel.burbuja,
  userText: piel.textoUsuario,
  timestamp: piel.hora,
  thinking: piel.pensando,
  thinkingDots: piel.pensandoPuntos,
  thinkingSlow: piel.pensandoLento,
  composerWrap: piel.redactor,
  composerInner: piel.redactorInterior,
  composerBox: piel.redactorCaja,
  textarea: piel.redactorTexto,
  sendBtn: piel.enviar,
  composerHint: piel.redactorPista,
};

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d} d`;
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(new Date(ts));
}

export function SabinaClient({
  clinicId,
  firstName,
  puedeProponer = false,
  apagada: apagadaAlEntrar = false,
  rediseno = false,
  puedeVerSaldo = false,
  saldoIa = null,
}: {
  /** La clínica de la sesión: si cambia (switcher de sedes), la conversación se reinicia. */
  clinicId: string;
  firstName: string;
  puedeProponer?: boolean;
  /** El Super Admin apagó a Sabina para este usuario. Solo avisa; el endpoint impide. */
  apagada?: boolean;
  /** Interruptor `menu-dos-niveles` de la clínica: viste la pantalla con el rediseño. */
  rediseno?: boolean;
  /** Puede abrir /dashboard/whatsapp/bot/saldo (lo decide el servidor con el permiso de esa pantalla). */
  puedeVerSaldo?: boolean;
  /** El importe del saldo, pintado en el servidor dentro de un Suspense (ver `saldo-ia-importe.tsx`). */
  saldoIa?: ReactNode;
}) {
  // Un solo juego de clases por render: el de siempre o el del rediseño.
  const c: Record<string, string> = rediseno ? CLASES_REDISENO : styles;
  const estado = useSabinaEstado();
  const [historyOpen, setHistoryOpen] = useState(false);
  // Con una pregunta en vuelo no se cambia de hilo: la respuesta ya se está
  // pagando y llegaría a un mensaje que ya no existe (ver `cambiandoDeHilo`).
  const ocupado = estado.sending || estado.openingConv;

  // La clínica manda: el almacén se reinicia solo si cambió. Y lo que leyó el
  // servidor sobre «Sabina apagada» se baja al almacén, que es lo que mira el
  // cajón (él no tiene forma de saberlo hasta que el endpoint conteste 403).
  useEffect(() => {
    usarClinica(clinicId, apagadaAlEntrar);
    if (apagadaAlEntrar) apagar(true);
  }, [clinicId, apagadaAlEntrar]);

  // Recupera la conversación de esta clínica tras una recarga dura. Es un GET
  // de solo lectura: entrar a la pantalla NO llama al modelo ni cobra nada.
  useEffect(() => {
    void hidratar();
  }, []);

  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHistoryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyOpen]);

  const openHistory = useCallback(() => {
    setHistoryOpen(true);
    cargarHistorialUnaVez();
  }, []);

  const startNew = useCallback(() => {
    nuevaConversacion();
    setHistoryOpen(false);
  }, []);

  const openConversation = useCallback((row: HistoryRow) => {
    setHistoryOpen(false);
    void abrirConversacion(row);
  }, []);

  return (
    <div
      className={rediseno ? `${CLASES_REDISENO_LOTE} ${c.page}` : c.page}
      data-history-open={historyOpen || undefined}
    >
      {historyOpen && (
        <button type="button" className={c.backdrop} aria-label="Cerrar historial" onClick={() => setHistoryOpen(false)} />
      )}

      {/* ── Historial (drawer, off-canvas siempre) ── */}
      <aside
        className={rediseno && historyOpen ? `${c.drawer} ${piel.cajonAbierto}` : c.drawer}
        role={historyOpen ? "dialog" : undefined} aria-modal={historyOpen || undefined} aria-label="Historial de Sabina">
        <div className={c.drawerHeader}>
          <span className={c.drawerTitle}>Historial</span>
          <button type="button" className={c.iconBtn} onClick={() => setHistoryOpen(false)} aria-label="Cerrar historial">
            <X size={15} aria-hidden />
          </button>
        </div>
        <button type="button" className={c.newConvBtn} onClick={startNew} disabled={ocupado}>
          <Plus size={13} aria-hidden /> Nueva conversación
        </button>
        <div className={c.drawerList}>
          {estado.historyLoading ? (
            <div className={c.drawerLoading}>
              <Loader2 size={14} aria-hidden className={c.spin} /> Cargando…
            </div>
          ) : estado.historyNotice ? (
            <div className={c.drawerNotice}>
              <CloudOff size={13} aria-hidden /> {estado.historyNotice}
            </div>
          ) : estado.historyList.length === 0 ? (
            <div className={c.drawerEmpty}>Aquí van a aparecer tus conversaciones con Sabina.</div>
          ) : (
            estado.historyList.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`${c.drawerItem} ${row.id === estado.conversationId ? c.drawerItemActive : ""}`}
                onClick={() => openConversation(row)}
                disabled={ocupado}
              >
                <span className={c.drawerItemTitle}>{row.title}</span>
                <span className={c.drawerItemTime}>{formatRelative(row.updatedAt)}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ── Chat ── */}
      <div className={c.main}>
        <header className={c.header}>
          <button type="button" className={c.iconBtn} onClick={openHistory} aria-label="Ver historial">
            <History size={17} aria-hidden />
          </button>
          <div className={c.headerInfo}>
            <div className={c.headerTitle}>
              <span className={c.brandDot}><Sparkles size={12} aria-hidden /></span>
              Sabina
            </div>
            <div className={c.headerSubtitle}>{estado.conversationTitle ?? `Hola, ${firstName || "doctor"}`}</div>
          </div>
          {/* Saldo IA (ws1-t5): el acceso al monedero que Sabina gasta, con la
              cifra cuando llega. Discreto y en la cabecera: la conversación
              no se toca. Con su propia hoja, igual en las dos pieles. */}
          {puedeVerSaldo && <SaldoIaChip importe={saldoIa} />}
          <button
            type="button"
            className={c.iconBtn}
            onClick={startNew}
            disabled={ocupado}
            aria-label="Nueva conversación"
            title={ocupado ? "Espera a que Sabina conteste" : "Nueva conversación"}
          >
            <Plus size={17} aria-hidden />
          </button>
        </header>

        <SabinaConversacion
          firstName={firstName}
          apagada={apagadaAlEntrar}
          puedeProponer={puedeProponer}
          rediseno={rediseno}
          clases={c}
        />
      </div>
    </div>
  );
}
