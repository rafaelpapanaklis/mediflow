"use client";
// Barra superior del menú de dos niveles: migas + buscador global (Ctrl+K).
// Hace lo mismo que <Topbar> (paleta de comandos, atajos, avisos de sala de
// espera, insights, notificaciones) con el aspecto del diseño nuevo. El
// cableado de atajos está copiado de topbar.tsx a propósito: cuando Rafael
// apruebe el menú nuevo, la barra vieja se borra y este queda como el único.

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { KeyboardShortcutsPanel } from "@/components/dashboard/keyboard-shortcuts-panel";
import { NotificationsPopover } from "@/components/dashboard/notifications-popover";
import { InsightsPopover } from "@/components/dashboard/insights-popover";
import { WaitingRoomAlert } from "@/components/dashboard/waiting-room-alert";
import { ROUTE_LABELS } from "@/components/dashboard/topbar";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useNewPatientDialog } from "@/components/dashboard/new-patient/new-patient-provider";
import { useGoToShortcuts, useCreateShortcuts } from "@/lib/command-palette/shortcuts";
import { RUTA_AGENDA } from "@/components/dashboard/topbar-rediseno/apariencia";
import { useT } from "@/i18n/i18n-provider";
import { etiquetaDeRuta } from "./estructura";
import { CLASES_MENU } from "./clases";
import { Icono } from "./icono";
import { TipografiaPanel } from "./tipografia-panel";
import s from "./menu-dos-niveles.module.css";

type UserRole = "SUPER_ADMIN" | "ADMIN" | "DOCTOR" | "RECEPTIONIST" | "READONLY" | "ACCOUNTANT";

export function TopbarDosNiveles({ clinicName, userRole }: { clinicName: string; userRole?: UserRole }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { consult } = useActiveConsult();
  const { open: openAppt } = useNewAppointmentDialog();
  const { open: openPatient } = useNewPatientDialog();
  const modalsClosed = !paletteOpen && !shortcutsOpen;
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsMac(/mac|iphone|ipad|ipod/i.test(navigator.platform));
  }, []);

  // ── Igual que topbar.tsx, salvo «G A»: aquí manda a la agenda nueva ──
  useGoToShortcuts({ enabled: modalsClosed, rutaAgenda: RUTA_AGENDA.nueva });
  useCreateShortcuts({
    enabled: modalsClosed,
    onCreateAppointment: () => openAppt({ openAgendaAfter: true }),
    onCreatePatient:     () => openPatient(),
    onCreateInvoice:     () => router.push("/dashboard/caja?tab=facturas"),
    onCreateSoap: () => {
      if (consult) {
        router.push(`/dashboard/patients/${consult.patientId}?tab=soap&new=1`);
      } else {
        toast(t("shell.topbar.startConsultFirst"), { icon: "ℹ️" });
      }
    },
    onToggleTheme: () => {
      const html = document.documentElement;
      const isDark = html.classList.contains("dark");
      html.classList.toggle("dark");
      try { localStorage.setItem("theme", isDark ? "light" : "dark"); } catch {}
    },
  });

  const actual = useMemo(() => {
    const e = etiquetaDeRuta(pathname, ROUTE_LABELS);
    if (!e) return null;
    return e.tipo === "opcion" ? t(`menuDosNiveles.nav.${e.id}`) : t(e.clave);
  }, [pathname, t]);
  const migas = actual ? [clinicName, actual] : [clinicName];
  const tecla = isMac ? "⌘" : "Ctrl";

  return (
    <>
      {/* La tipografía del diseño nuevo para TODO el panel (WS1-T3). Se monta
          aquí, y no en el layout, por dos razones que se pisaban entre sí:
          1) El layout tiene que quedar EXACTAMENTE como está. Un hijo más entre
             los suyos —aunque sea una condición que casi siempre da falso— le
             cambia a React el número de ranuras de ese nivel, y con él los
             `useId` de todo lo que cuelga: las clínicas SIN el interruptor
             dejarían de recibir el HTML de hoy. Medido, no supuesto.
          2) De las dos piezas del diseño nuevo, esta barra es la única que se
             pinta SIEMPRE que el interruptor está encendido: en el teléfono el
             menú vive en un cajón y no se monta hasta que se abre, así que
             colgar de él la tipografía la dejaría fuera de media pantalla.
          Da igual que la barra se oculte por CSS en algún ancho: una regla de
          estilo vale en todo el documento, no solo donde está escrita. */}
      <TipografiaPanel />
      <div className={`${CLASES_MENU} ${s.barra}`}>
        <button
          type="button"
          className={s.hamburguesa}
          aria-label={t("shell.topbar.openNav")}
          onClick={() => window.dispatchEvent(new CustomEvent("mf:open-mobile-sidebar"))}
        >
          <Icono nombre="menu" />
        </button>

        <nav aria-label={t("menuDosNiveles.migasAria")} className={s.migas}>
          {migas.map((m, i) => (
            <Fragment key={`${i}-${m}`}>
              {i > 0 && <Icono nombre="chevron_right" />}
              <span className={i === migas.length - 1 ? s.migaActual : undefined} aria-current={i === migas.length - 1 ? "page" : undefined}>
                {m}
              </span>
            </Fragment>
          ))}
        </nav>

        <button
          type="button"
          className={s.buscar}
          onClick={() => setPaletteOpen(true)}
          aria-label={t("shell.cmdHint.ariaOpen", { key: tecla })}
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Icono nombre="search" />
          <span className={s.buscarTexto}>{t("shell.cmdHint.searchOrRun")}</span>
          <kbd className={s.kbd}>{tecla} K</kbd>
        </button>

        <div className={s.derecha}>
          {/* Las mismas piezas que topbar.tsx, con la ropa del diseño nuevo
              (`apariencia="nueva"`, ver topbar-rediseno/apariencia.ts). La
              barra de siempre no pasa nada y las pinta como hasta hoy. */}
          {(userRole === "RECEPTIONIST" || userRole === "ADMIN" || userRole === "SUPER_ADMIN") && <WaitingRoomAlert apariencia="nueva" />}
          {(userRole === "ADMIN" || userRole === "SUPER_ADMIN") && <InsightsPopover apariencia="nueva" />}
          <NotificationsPopover apariencia="nueva" />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} apariencia="nueva" />
      <KeyboardShortcutsPanel open={shortcutsOpen} onOpenChange={setShortcutsOpen} apariencia="nueva" />
    </>
  );
}
