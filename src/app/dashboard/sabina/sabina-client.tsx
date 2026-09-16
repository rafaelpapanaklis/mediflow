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

import { useCallback, useEffect, useState } from "react";
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
}: {
  /** La clínica de la sesión: si cambia (switcher de sedes), la conversación se reinicia. */
  clinicId: string;
  firstName: string;
  puedeProponer?: boolean;
  /** El Super Admin apagó a Sabina para este usuario. Solo avisa; el endpoint impide. */
  apagada?: boolean;
}) {
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
    <div className={styles.page} data-history-open={historyOpen || undefined}>
      {historyOpen && (
        <button type="button" className={styles.backdrop} aria-label="Cerrar historial" onClick={() => setHistoryOpen(false)} />
      )}

      {/* ── Historial (drawer, off-canvas siempre) ── */}
      <aside className={styles.drawer} role={historyOpen ? "dialog" : undefined} aria-modal={historyOpen || undefined} aria-label="Historial de Sabina">
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>Historial</span>
          <button type="button" className={styles.iconBtn} onClick={() => setHistoryOpen(false)} aria-label="Cerrar historial">
            <X size={15} aria-hidden />
          </button>
        </div>
        <button type="button" className={styles.newConvBtn} onClick={startNew} disabled={ocupado}>
          <Plus size={13} aria-hidden /> Nueva conversación
        </button>
        <div className={styles.drawerList}>
          {estado.historyLoading ? (
            <div className={styles.drawerLoading}>
              <Loader2 size={14} aria-hidden className={styles.spin} /> Cargando…
            </div>
          ) : estado.historyNotice ? (
            <div className={styles.drawerNotice}>
              <CloudOff size={13} aria-hidden /> {estado.historyNotice}
            </div>
          ) : estado.historyList.length === 0 ? (
            <div className={styles.drawerEmpty}>Aquí van a aparecer tus conversaciones con Sabina.</div>
          ) : (
            estado.historyList.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`${styles.drawerItem} ${row.id === estado.conversationId ? styles.drawerItemActive : ""}`}
                onClick={() => openConversation(row)}
                disabled={ocupado}
              >
                <span className={styles.drawerItemTitle}>{row.title}</span>
                <span className={styles.drawerItemTime}>{formatRelative(row.updatedAt)}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ── Chat ── */}
      <div className={styles.main}>
        <header className={styles.header}>
          <button type="button" className={styles.iconBtn} onClick={openHistory} aria-label="Ver historial">
            <History size={17} aria-hidden />
          </button>
          <div className={styles.headerInfo}>
            <div className={styles.headerTitle}>
              <span className={styles.brandDot}><Sparkles size={12} aria-hidden /></span>
              Sabina
            </div>
            <div className={styles.headerSubtitle}>{estado.conversationTitle ?? `Hola, ${firstName || "doctor"}`}</div>
          </div>
          <button
            type="button"
            className={styles.iconBtn}
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
        />
      </div>
    </div>
  );
}
