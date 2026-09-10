"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EduPacienteTabsMas } from "@/components/edu/expediente/paciente-tabs-mas";

/**
 * Las pestañas de la ficha de un paciente.
 *
 * MÓVIL PRIMERO: en el teléfono es una tira que se arrastra con el pulgar
 * (ver `.edu-tabs` en edu-theme.css) y no tres renglones de píldoras, que
 * se leen como cualquier cosa menos como pestañas.
 *
 * 🔴 CADA PESTAÑA ES UNA RUTA, no un `useState`. Tres razones concretas:
 *   · se puede compartir el enlace ("mira el odontograma de P-0042");
 *   · sobrevive a un refresh, que es lo que hace un teléfono cuando la
 *     pantalla se apaga y el sistema recicla la pestaña;
 *   · cada pestaña carga SOLO sus datos. Con una sola página, abrir la
 *     ficha se traería las notas, el odontograma y las radiografías de
 *     golpe — y las radiografías pesan.
 *
 * 🔴 LO QUE ESTE COMPONENTE **NO** HACE: decidir quién ve qué. Los items
 * llegan ya filtrados por permiso desde el layout (servidor) y CADA página
 * vuelve a exigir el suyo. Esconder una pestaña no cierra ninguna puerta:
 * basta con teclear la URL.
 *
 * ── LAS DOCE PESTAÑAS NO CABEN ──────────────────────────────────────────
 * Medido: la tira de la ficha de un paciente pide 1118 px y `.edu-page` la
 * topa en 1100. Sobraban 18 px a 1440 de ventana, 68 a 1366 y 154 a 1280:
 * la última salía cortada como «R». La tira SÍ se desplazaba, pero
 * `scrollbar-width: none` escondía la barra y no había ni degradado ni
 * flecha — con un ratón, ninguna pista de que hubiera más (regla 5 de la
 * cabecera de edu-theme.css).
 *
 * Se resuelve MIDIENDO, no adivinando:
 *   · con RATÓN (`hover: hover` + `pointer: fine`) se calcula cuántas
 *     caben contra el ancho REAL de la barra —con un ResizeObserver sobre
 *     la fila, no sobre `window`, que es el error que empezó todo esto— y
 *     el resto se guarda en un «Más ▾»;
 *   · con el PULGAR se deja la tira como estaba, que es donde ya
 *     funcionaba, y solo se marca el desvanecido del borde;
 *   · la pestaña ACTIVA nunca se esconde: si cae en el sobrante, el botón
 *     se rotula «Más · Recetas» y se enciende.
 *
 * La medida sale de una CAPA ESPEJO (`.edu-tabs__medida`): invisible no es
 * lo mismo que sin ancho, así que se pinta una copia con
 * `visibility: hidden` —que sí ocupa— dentro de una caja que la recorta.
 * Con `display: none` no se podría medir nada.
 */
export interface EduPacienteTab {
  key: string;
  href: string;
  label: string;
  /**
   * `true` = esta pestaña solo se enciende con la ruta EXACTA, nunca por
   * prefijo. Es la portada de la ficha (`Resumen`), cuyo href es la base
   * de todas las demás: sin esto, una ruta hija sin pestaña propia —como
   * `/pacientes/[id]/pagos` cuando «Pagos» no estaba en la lista— encendía
   * «Resumen», y el usuario leía que estaba en una pantalla que no era.
   */
  exact?: boolean;
}

/**
 * Lo que se reserva para el botón «Más ▾» antes de saber si hará falta.
 *
 * 120 y no 96 porque el botón se rotula «Más · Consentimientos» cuando la
 * pestaña activa cae dentro, y ahí mide más. Si aun así se queda corto no
 * se rompe nada: `.edu-tabs__mas` es `flex: 0 0 auto` (no se encoge) y la
 * tira lleva `overflow-x: auto` con su desvanecido, así que lo que sobra
 * se desplaza — nunca se recorta (regla 4).
 */
const ANCHO_MAS = 120;

/**
 * `useLayoutEffect` en el navegador y `useEffect` en el servidor.
 *
 * Se mide y se decide ANTES de pintar, para que nadie vea la tira entera y
 * medio fotograma después el salto al «Más». Pero `useLayoutEffect` no
 * existe en el render de servidor y React avisa por consola en cada
 * petición; se elige aquí arriba —una vez, no dentro del componente— para
 * que el orden de los hooks no dependa de nada.
 */
const useEfectoDeMedida = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function EduPacienteTabs({
  tabs,
  ariaLabel = "Secciones del paciente",
}: {
  tabs: EduPacienteTab[];
  /**
   * El rótulo del <nav> para el lector de pantalla. Por omisión el de
   * siempre; la ficha de un estudiante o la de un docente pasan el suyo.
   *
   * ⛔ El componente NO se renombra ni se mueve de archivo aunque ya sirva a
   * tres fichas: hay olas en paralelo tocando esta carpeta y un `git mv`
   * aquí les cuesta el merge. El nombre se corrige cuando no haya nadie más
   * dentro.
   */
  ariaLabel?: string;
}) {
  const pathname = usePathname() ?? "";

  // Activo = el href que COINCIDE MÁS (el más largo), igual que el sidebar
  // del vertical. Con un `startsWith` suelto, /pacientes/[id] encendería
  // también su propia pestaña estando en /pacientes/[id]/estudios.
  //
  // 🔴 Y la pestaña marcada `exact` NO cuenta por prefijo: su href es la
  // base de todas las demás, así que ganaría siempre que la ruta actual no
  // tuviera pestaña propia.
  let activo = "";
  for (const t of tabs) {
    const coincide = t.exact
      ? pathname === t.href
      : pathname === t.href || pathname.startsWith(`${t.href}/`);
    if (coincide && t.href.length > activo.length) activo = t.href;
  }

  const barra = useRef<HTMLDivElement | null>(null);
  const espejo = useRef<HTMLDivElement | null>(null);
  const tira = useRef<HTMLElement | null>(null);
  // `tabs.length` = todas caben. Se empieza así a propósito: si el JS no
  // llega a correr, la tira queda entera y desplazable, como antes.
  const [caben, setCaben] = useState(tabs.length);
  const [colapsa, setColapsa] = useState(false);
  const [desborda, setDesborda] = useState(false);

  // ¿Hay ratón? El colapso es para quien no puede arrastrar con el dedo.
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const aplicar = () => setColapsa(mq.matches);
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);

  const medir = useCallback(() => {
    const fila = barra.current;
    const copia = espejo.current;
    if (!fila || !copia) return;

    const anchos = Array.from(copia.children).map((el) => (el as HTMLElement).offsetWidth);
    const hueco = fila.clientWidth;
    const GAP = 6;

    // ¿Cabe la tira entera? Entonces no hay ni «Más» ni desvanecido.
    const total = anchos.reduce((a, w) => a + w, 0) + Math.max(0, anchos.length - 1) * GAP;
    if (total <= hueco || !colapsa) {
      setCaben(anchos.length);
      return;
    }

    // No cabe: se reserva el botón «Más ▾» y se cuenta cuántas entran en lo
    // que queda. Mínimo una, para no dejar la barra sin ninguna pestaña.
    const disponible = hueco - ANCHO_MAS - GAP;
    let usado = 0;
    let n = 0;
    for (const w of anchos) {
      const siguiente = usado + (n > 0 ? GAP : 0) + w;
      if (siguiente > disponible) break;
      usado = siguiente;
      n++;
    }
    setCaben(Math.max(1, n));
  }, [colapsa]);

  // Se mide y se decide ANTES de pintar (ver `useEfectoDeMedida`).
  useEfectoDeMedida(() => {
    medir();
  }, [medir, tabs, pathname]);

  // El desvanecido se decide MIDIENDO la tira ya pintada, no deduciéndolo:
  // vale igual con el pulgar (la tira entera se arrastra) que con ratón
  // (si el botón «Más ▾» salió más ancho de lo reservado, lo que quedó
  // visible también se desplaza). Va en su propio efecto porque depende de
  // lo que React acaba de pintar, no de lo que `medir()` calculó.
  //
  // Y se apaga al llegar al final: un degradado permanente sobre la última
  // pestaña ya vista deja de ser una pista y pasa a ser una mancha.
  useEfectoDeMedida(() => {
    const nav = tira.current;
    if (!nav) return;
    const revisar = () => setDesborda(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
    revisar();
    nav.addEventListener("scroll", revisar, { passive: true });
    return () => nav.removeEventListener("scroll", revisar);
  }, [caben, colapsa, tabs, pathname]);

  // 🔴 El ResizeObserver va sobre la FILA REAL, no sobre `window`. Es la
  // lección de toda esta ola: entre 1024 y 1440 px de ventana el ancho útil
  // depende del cajón, del padding y del zoom del sistema, y la ventana no
  // sabe nada de eso.
  useEffect(() => {
    const fila = barra.current;
    if (!fila || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => medir());
    ro.observe(fila);
    return () => ro.disconnect();
  }, [medir]);

  const visibles = colapsa ? tabs.slice(0, caben) : tabs;
  const guardadas = colapsa ? tabs.slice(caben) : [];

  // La activa NUNCA se esconde sin avisar: si cayó en el sobrante, se
  // intercambia por la última visible, y el botón «Más ▾» lo dice igual.
  const activaEscondida = guardadas.some((t) => t.href === activo);

  const pintar = (t: EduPacienteTab) => {
    const on = t.href === activo;
    return (
      <Link
        key={t.key}
        href={t.href}
        className={`edu-tab ${on ? "edu-tab--on" : ""}`}
        aria-current={on ? "page" : undefined}
      >
        {t.label}
      </Link>
    );
  };

  return (
    <div className="edu-tabsbar" ref={barra}>
      {/* La capa espejo: los items a su ancho natural, recortados y sin
          tocar el layout. Es de lo que salen los anchos de `medir()`. */}
      <div className="edu-tabs__medidaclip" aria-hidden="true">
        <div className="edu-tabs__medida" ref={espejo}>
          {tabs.map((t) => (
            <span key={t.key} className="edu-tab">
              {t.label}
            </span>
          ))}
        </div>
      </div>

      <nav
        className="edu-tabs"
        aria-label={ariaLabel}
        ref={tira}
        data-desborda={desborda ? "1" : undefined}
      >
        {visibles.map(pintar)}
      </nav>

      <EduPacienteTabsMas
        items={guardadas}
        activoHref={activaEscondida ? activo : ""}
      />
    </div>
  );
}
