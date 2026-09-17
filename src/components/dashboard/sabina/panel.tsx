"use client";

/**
 * EL CAJÓN DE SABINA — Sabina en todas partes (ws1-t1).
 *
 * Hasta hoy, preguntarle algo a Sabina era irse de donde estabas: salir de la
 * ficha de Ana Ruiz, entrar a `/dashboard/sabina` y volver a escribir su
 * nombre. Esto lo cambia: un botón fijo abajo a la derecha (y `Alt + S`) abre a
 * Sabina EN UN CAJÓN sobre la pantalla en la que ya estabas, sabiendo dónde
 * estás.
 *
 * ── EL GESTO: LOS DOS ───────────────────────────────────────────────────
 * Botón fijo Y atajo de teclado, porque son dos manos distintas:
 *   · el DOCTOR está de pie, con guantes y un ratón — para él es un botón
 *     grande, siempre en el mismo sitio, sin menús que recorrer;
 *   · la RECEPCIONISTA está escribiendo — para ella es `Alt + S` sin soltar el
 *     teclado. No se usó `Ctrl/Cmd + K` porque ya abre el buscador de
 *     pacientes (`quick-actions.tsx`), ni `?` porque abre la ayuda de atajos.
 *     Se mira `e.code === "KeyS"` y no `e.key` para que funcione también en
 *     teclados donde `Alt+S` produce otro carácter.
 * `Escape` cierra, como el resto de los cajones del panel.
 *
 * 🔴 ABRIRLO NO CUESTA NADA. Montar esto no llama a ningún endpoint y abrirlo
 * tampoco llama al modelo: lo único que cobra al monedero es preguntar. Lo
 * único que se hace al abrir es `hidratar()`, un GET que recupera la
 * conversación abierta si la hubiera.
 *
 * La conversación es LA MISMA que la de `/dashboard/sabina`: las dos leen el
 * almacén de `@/components/sabina/almacen`. Por eso en su propia pantalla el
 * cajón no se pinta — sería Sabina encima de Sabina.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, X, Plus, Maximize2, MapPin } from "lucide-react";
import { SabinaConversacion } from "@/components/sabina/sabina-conversacion";
import { hidratar, nuevaConversacion, usarClinica } from "@/components/sabina/almacen";
import { ETIQUETA_PANTALLA, esPantallaConocida } from "@/components/sabina/contexto-pantalla";
import { useContextoSabina, useSabinaEstado } from "@/components/sabina/use-sabina-chat";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { HIDE_SUPPLY_MODULES } from "@/lib/hidden-modules";
import styles from "./panel.module.css";
import { CLASES_CAJON } from "@/components/dashboard/layout-rediseno/sabina";
import { CLASES_REDISENO } from "@/app/dashboard/sabina/sabina-client";

/**
 * REDISEÑO (interruptor `menu-dos-niveles`, ws1-t2 hallazgo 10) — «dos pieles,
 * un esqueleto», como la pantalla de Sabina. El JSX es UNO. Con la bandera
 * apagada pinta las clases de siempre (`panel.module.css`, sin tocar);
 * encendida, cada clase vieja se traduce a su pieza de
 * `layout-rediseno/cajon-sabina.module.css` (`CLASES_CAJON`), y el hilo
 * recibe el MISMO juego de clases que la pantalla (`CLASES_REDISENO`, de
 * `sabina-client.tsx`): la conversación se ve igual en las dos puertas. La
 * elección se hace UNA vez, en `c`, así que el camino viejo no cambia ni un
 * byte. El test de `layout-rediseno` comprueba que ninguna clase usada aquí
 * se queda sin traducir.
 */

/** Su propia pantalla: ahí el cajón sobra. */
const RUTA_SABINA = "/dashboard/sabina";

/**
 * Abajo a la derecha hay sitio para uno. Mientras los módulos de proveedores y
 * laboratorios estén ocultos, el FAB de chat no se pinta y esta esquina es de
 * Sabina; el día que vuelvan, ella se sube para no taparlo.
 */
const ALTURA_FAB = HIDE_SUPPLY_MODULES ? 24 : 92;

/** Pantallas cuyo nombre YA dice que hay un paciente: no hace falta repetirlo. */
const YA_NOMBRAN_PACIENTE = new Set(["ficha-paciente", "radiografias"]);

export function SabinaPanel({
  clinicId,
  firstName,
  puedeProponer,
  oculto = false,
  rediseno = false,
}: {
  clinicId: string;
  firstName: string;
  /** ¿El catálogo trae acciones? Solo cambia la línea de ayuda del composer. */
  puedeProponer: boolean;
  /** Clínica suspendida: ni botón ni atajo. Lo decide el layout. */
  oculto?: boolean;
  /** Interruptor `menu-dos-niveles` de la clínica: viste el cajón con el rediseño. */
  rediseno?: boolean;
}) {
  // Un solo juego de clases por render: el de siempre o el del rediseño.
  const c: Record<string, string> = rediseno ? CLASES_CAJON : styles;
  const pathname = usePathname();
  const estado = useSabinaEstado();
  const contextoDe = useContextoSabina();
  // Solo para el cartel: el nombre de quien está en el sillón. NO viaja con la
  // pregunta (lo que viaja es el id, y el nombre lo saca el servidor de la base).
  const { consult } = useActiveConsult();
  const [abierto, setAbierto] = useState(false);
  // Una vez abierto, el hilo se queda montado: cerrar y volver a abrir no puede
  // perder lo que estabas leyendo.
  const [yaAbierto, setYaAbierto] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  /**
   * Dónde estaba el cursor antes de abrir el cajón.
   *
   * Importa de verdad: `Alt + S` funciona también mientras se escribe —es para
   * eso— y al abrirse el cajón el foco se va a su caja de texto. Si al cerrar
   * no volviera, el doctor que preguntó algo en mitad de una nota clínica
   * tendría que buscar el renglón donde iba. Si ese campo ya no está en la
   * página (navegó), el foco cae en el botón.
   */
  const focoPrevio = useRef<HTMLElement | null>(null);

  const cerrar = useCallback(() => {
    setAbierto(false);
    const previo = focoPrevio.current;
    focoPrevio.current = null;
    if (previo && document.contains(previo)) previo.focus();
    else fabRef.current?.focus();
  }, []);

  /** Guarda dónde estaba el cursor. Se llama justo antes de abrir. */
  const recordarFoco = useCallback(() => {
    const activo = document.activeElement;
    focoPrevio.current = activo instanceof HTMLElement && activo !== fabRef.current ? activo : null;
  }, []);

  const enSuPantalla = (pathname ?? "").startsWith(RUTA_SABINA);
  const apagado = oculto || enSuPantalla;

  // La clínica de la sesión manda: si cambia (switcher de sedes), el almacén se
  // reinicia y no se arrastra la conversación de la sede anterior.
  useEffect(() => {
    usarClinica(clinicId);
  }, [clinicId]);

  // Si el cajón está abierto y el usuario navega a la pantalla de Sabina, se
  // cierra solo: la conversación sigue, ahora a pantalla completa.
  useEffect(() => {
    if (apagado && abierto) setAbierto(false);
  }, [apagado, abierto]);

  const abrir = useCallback(() => {
    recordarFoco();
    setAbierto(true);
    setYaAbierto(true);
    // Un GET, y solo la primera vez. Abrir NO llama al modelo.
    void hidratar();
  }, [recordarFoco]);

  // Alt + S abre y cierra; Escape cierra. Un solo listener para los dos. El
  // `ref` evita volver a registrar el listener en cada apertura y cierre.
  const abiertoRef = useRef(false);
  abiertoRef.current = abierto;
  useEffect(() => {
    if (apagado) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyS") {
        e.preventDefault();
        if (abiertoRef.current) cerrar();
        else abrir();
        return;
      }
      if (e.key === "Escape" && abiertoRef.current) cerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apagado, abrir, cerrar]);

  /**
   * Lo que Sabina va a saber de dónde estás, dicho en voz alta. No es adorno:
   * si va a contestar sobre «este paciente», el doctor tiene derecho a ver de
   * cuál está hablando antes de preguntar.
   */
  const dondeEstoy = useMemo(() => {
    if (!abierto) return null;
    const c = contextoDe();
    const partes: string[] = [];
    if (esPantallaConocida(c.pantalla)) {
      partes.push(c.fecha ? `${ETIQUETA_PANTALLA[c.pantalla]} (${c.fecha})` : ETIQUETA_PANTALLA[c.pantalla]);
    }
    // 🔴 El paciente viaja en CUALQUIER pantalla (el del sillón), también en las
    // que no están en la lista. El cartel tiene que decir exactamente lo que se
    // manda, o no decir nada: por eso el nombre solo se pinta si el paciente que
    // viaja ES el de la consulta abierta. Con una ficha abierta de OTRO paciente
    // manda la ficha (`contexto-pantalla.ts`), y poner ahí el nombre del sillón
    // sería mentir sobre de quién va a hablar Sabina.
    if (c.pacienteId) {
      const esElDelSillon = c.pacienteId === consult?.patientId && Boolean(consult?.patientName);
      if (esElDelSillon) partes.push(`atendiendo a ${consult!.patientName}`);
      else if (!esPantallaConocida(c.pantalla) || !YA_NOMBRAN_PACIENTE.has(c.pantalla)) {
        partes.push("un paciente");
      }
    }
    return partes.length > 0 ? partes.join(" · ") : null;
    // `pathname` entra en las dependencias a propósito: al navegar con el cajón
    // abierto, el cartel tiene que cambiar con la pantalla.
  }, [abierto, contextoDe, pathname, consult?.patientId, consult?.patientName]);

  if (apagado) return null;

  return (
    <>
      <button
        type="button"
        ref={fabRef}
        className={`${c.fab} ${abierto ? c.fabOculto : ""}`}
        style={{ bottom: ALTURA_FAB }}
        onClick={abrir}
        aria-label="Pregúntale a Sabina (Alt + S)"
        title="Pregúntale a Sabina — Alt + S"
        aria-expanded={abierto}
        aria-haspopup="dialog"
      >
        <Sparkles size={22} aria-hidden />
      </button>

      {abierto && (
        <button type="button" className={c.velo} aria-label="Cerrar Sabina" onClick={cerrar} />
      )}

      <aside
        className={`${c.panel} ${abierto ? c.panelAbierto : ""}`}
        role="dialog"
        aria-label="Sabina"
        // Sin `aria-modal`: en escritorio el cajón NO bloquea la pantalla, y
        // anunciarlo como modal cuando no lo es le miente al lector de pantalla.
        // Con el cajón cerrado sigue en el DOM para que la transición se vea;
        // quien lo saca del orden de tabulación y de los lectores de pantalla
        // es el `visibility: hidden` de `.panel` (ver panel.module.css).
        aria-hidden={!abierto}
      >
        <header className={c.cabecera}>
          <span className={c.marca}><Sparkles size={13} aria-hidden /></span>
          <div className={c.titulos}>
            <div className={c.titulo}>Sabina</div>
            <div className={c.subtitulo}>
              {estado.conversationTitle ?? `Hola, ${firstName || "doctor"}`}
            </div>
          </div>
          <button
            type="button"
            className={c.boton}
            onClick={nuevaConversacion}
            // Con una pregunta en vuelo, cambiar de hilo tiraría la respuesta
            // que ya se está pagando (ver `cambiandoDeHilo` en ./almacen).
            disabled={estado.sending || estado.openingConv}
            aria-label="Nueva conversación"
            title={estado.sending ? "Espera a que Sabina conteste" : "Nueva conversación"}
          >
            <Plus size={16} aria-hidden />
          </button>
          <Link
            href={RUTA_SABINA}
            className={c.boton}
            aria-label="Abrir Sabina a pantalla completa"
            title="Abrir a pantalla completa"
            onClick={() => setAbierto(false)}
          >
            <Maximize2 size={15} aria-hidden />
          </Link>
          <button type="button" className={c.boton} onClick={cerrar} aria-label="Cerrar Sabina" title="Cerrar (Esc)">
            <X size={16} aria-hidden />
          </button>
        </header>

        {dondeEstoy && (
          <div className={c.contexto}>
            <MapPin size={12} aria-hidden />
            <span>
              Sabe que estás en <strong>{dondeEstoy}</strong>
            </span>
          </div>
        )}

        {(abierto || yaAbierto) && (
          <SabinaConversacion
            firstName={firstName}
            puedeProponer={puedeProponer}
            compacto
            autoFocus={abierto}
            clases={rediseno ? CLASES_REDISENO : undefined}
            rediseno={rediseno}
          />
        )}
      </aside>
    </>
  );
}
