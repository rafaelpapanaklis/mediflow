"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Serpentina de la tarjeta grande del BONO POR CLÍNICAS ACTIVAS (/afiliados).
 *
 * Estalla UNA sola vez por carga de página: la primera vez que la tarjeta entra
 * en pantalla. El `IntersectionObserver` se desconecta en el mismo callback, así
 * que subir y bajar no la vuelve a disparar.
 *
 * CSS puro: 38 tiras que animan SÓLO `transform` y `opacity` (cero librerías,
 * cero canvas, cero imágenes). El contenedor es `position: absolute` +
 * `pointer-events: none` + `aria-hidden`, o sea que no ocupa sitio en el flujo y
 * no puede mover nada: el CLS de la página sigue en 0.
 *
 * Es CLIENTE porque necesita `IntersectionObserver`; el resto del bloque de
 * bonos sigue siendo server component. Antes de disparar sólo renderiza el
 * contenedor vacío —idéntico en servidor y cliente—, así que no hay riesgo de
 * error de hidratación.
 *
 * `prefers-reduced-motion: reduce` la cancela ENTERA: ni atenuada. El reset de
 * `afiliados.css` ya apaga toda animación dentro de `.dcaf-root`, pero eso
 * dejaría 38 nodos congelados a media pantalla; aquí ni se llega a observar.
 */

/** Cuántas tiras salen. 38 llena la tarjeta sin que se note el patrón. */
const TIRAS_N = 38;

/**
 * Los cuatro colores de marca. El blanco necesita el aro violeta: sobre el
 * fondo casi blanco de la tarjeta grande, sin él es invisible. El `boxShadow`
 * es estático (no se anima), así que no cuesta nada por frame.
 */
const PALETA = [
  { fondo: "#2563eb", aro: "none" },
  { fondo: "#6d28d9", aro: "none" },
  { fondo: "#ffffff", aro: "0 0 0 1px rgba(109,40,217,.45)" },
  { fondo: "#e9b949", aro: "none" },
];

/**
 * Tabla FIJA de tiras. Los valores salen de tres secuencias deterministas
 * —pasos 17, 29 y 7, todos coprimos con 38, así que cada una recorre los 38
 * valores en desorden— y NO de `Math.random()`: el render tiene que dar lo
 * mismo siempre. Visualmente no se distingue del azar.
 *
 * Todo sale del mismo punto (el centro de la tarjeta, a la altura del trofeo) en
 * un abanico de ±82°, sube y luego cae. El desplazamiento máximo es ~131 px:
 * a 375 px de viewport la tarjeta mide ~331 px de ancho útil (165 px a cada lado
 * del centro), o sea que NINGUNA tira se sale por los costados y no puede
 * aparecer scroll horizontal.
 *
 * Las TRES paradas del vuelo (arranque, punto más alto y caída) se calculan
 * AQUÍ y viajan ya resueltas a las custom properties: así el keyframe es un
 * `translate3d(var(--x), var(--y), 0)` pelado, sin un solo `calc()`. El centrado
 * lo hacen los `margin` negativos, que son estáticos y no se animan.
 */
const TIRAS = Array.from({ length: TIRAS_N }, (_, i) => {
  const a = ((i * 17) % TIRAS_N) / TIRAS_N;
  const b = ((i * 29) % TIRAS_N) / TIRAS_N;
  const c = ((i * 7) % TIRAS_N) / TIRAS_N;

  const ang = ((-76 + (152 * i) / (TIRAS_N - 1) + (a - 0.5) * 13) * Math.PI) / 180;
  const impulso = 42 + b * 58;
  // Punto más alto del vuelo.
  const xb = Math.round(Math.sin(ang) * impulso);
  const yb = Math.round(-Math.abs(Math.cos(ang)) * impulso - 14);
  const giro = Math.round(-430 + a * 860);
  // Una de cada nueve es un confeti redondo, para que no sean 38 rectángulos.
  const redonda = i % 9 === 0;
  const ancho = 5 + Math.round(b * 3);

  return {
    // Arranque: un tercio del recorrido, ya a tamaño real.
    xa: Math.round(xb * 0.38),
    ya: Math.round(yb * 0.4),
    ra: Math.round(giro * 0.18),
    xb,
    yb,
    rb: Math.round(giro * 0.5),
    // Al caer sigue derivando hacia su lado y baja bastante más abajo del origen.
    xc: Math.round(xb * 1.28),
    yc: Math.round(yb + 168 + c * 96),
    rc: giro,
    ancho,
    alto: redonda ? ancho : 10 + Math.round(c * 7),
    radio: redonda ? "50%" : "1.5px",
    dur: Math.round((1.45 + b * 0.75) * 100) / 100,
    retraso: Math.round(c * 24) / 100,
    tono: PALETA[(i * 3) % PALETA.length],
  };
});

/** La más lenta dura 2.2 s y la última arranca a los 0.24 s: 2.44 s en total. */
const FIN_MS = 2600;

/** Cuánto de la tarjeta tiene que verse para disparar (mismo valor que el `threshold`). */
const VISIBLE = 0.4;

export function SerpentinaHito() {
  const caja = useRef<HTMLDivElement | null>(null);
  const [fase, setFase] = useState<"espera" | "vuela" | "fin">("espera");

  useEffect(() => {
    const nodo = caja.current;
    if (!nodo || typeof IntersectionObserver === "undefined") return;
    // Movimiento reducido: no se observa nada, así que no se dispara nunca.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let reloj: ReturnType<typeof setTimeout> | undefined;
    const obs = new IntersectionObserver(
      (entradas) => {
        // `isIntersecting` se pone en true con un solo píxel visible: sin
        // mirar el ratio, la serpentina saldría al asomar el borde superior.
        if (!entradas.some((e) => e.isIntersecting && e.intersectionRatio >= VISIBLE - 0.02)) return;
        obs.disconnect(); // UNA vez por carga: ni subiendo ni bajando se repite.
        setFase("vuela");
        reloj = setTimeout(() => setFase("fin"), FIN_MS);
      },
      { threshold: VISIBLE },
    );
    obs.observe(nodo);

    return () => {
      obs.disconnect();
      if (reloj) clearTimeout(reloj);
    };
  }, []);

  return (
    <div ref={caja} className="dcaf-serpentina" aria-hidden="true">
      {/* Al terminar se vacía: nada queda animando de fondo. */}
      {fase === "vuela" &&
        TIRAS.map((t, i) => (
          <span
            key={i}
            className="dcaf-tira"
            style={
              {
                width: t.ancho,
                height: t.alto,
                // Centran la tira sobre el punto de origen sin meter `calc()`
                // en el keyframe. Son estáticos: no se animan.
                marginLeft: -t.ancho / 2,
                marginTop: -t.alto / 2,
                borderRadius: t.radio,
                background: t.tono.fondo,
                boxShadow: t.tono.aro,
                animationDuration: `${t.dur}s`,
                animationDelay: `${t.retraso}s`,
                "--dcaf-xa": `${t.xa}px`,
                "--dcaf-ya": `${t.ya}px`,
                "--dcaf-ra": `${t.ra}deg`,
                "--dcaf-xb": `${t.xb}px`,
                "--dcaf-yb": `${t.yb}px`,
                "--dcaf-rb": `${t.rb}deg`,
                "--dcaf-xc": `${t.xc}px`,
                "--dcaf-yc": `${t.yc}px`,
                "--dcaf-rc": `${t.rc}deg`,
              } as React.CSSProperties
            }
          />
        ))}
    </div>
  );
}
