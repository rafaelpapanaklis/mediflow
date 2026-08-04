"use client";

/**
 * Avisos flotantes de la landing pública de afiliados (/afiliados).
 *
 * Una tarjeta chica abajo a la izquierda: entra deslizándose, se queda unos
 * segundos, se va. Pausa irregular y otra. El ciclo no se acaba mientras la
 * persona siga en la página.
 *
 * QUÉ DICE NO SE DECIDE AQUÍ. Este componente sólo pinta y cronometra: los
 * textos llegan ya redactados desde `@/lib/affiliates/public-activity`, que es
 * quien elige entre los eventos reales de `affiliate_commissions` y los
 * mensajes informativos del programa, y quien aplica las reglas de privacidad.
 * Al navegador no baja ni un id ni una fecha exacta, sólo la frase.
 *
 * ORDEN: la lista se baraja, pero NO a ciegas. Cada tarjeta trae su `tipo` y el
 * ciclo los alterna (ver `intercala`), así que dos reglas del programa —o dos
 * sueldos— nunca salen seguidas.
 *
 * RITMO IRREGULAR A PROPÓSITO: un intervalo fijo delata al widget en tres
 * apariciones. La primera tarjeta tarda 6-8 s, cada una dura 5-6 s y entre una
 * y otra pasan 9-18 s, todo sorteado tarjeta por tarjeta.
 *
 * HIDRATACIÓN: ni un `Math.random()` en el render. El primer render —servidor y
 * cliente— es el contenedor vacío; el sorteo, el `sessionStorage` y el
 * `matchMedia` viven todos dentro de `useEffect`, después del montaje.
 *
 * RELOJ: un solo `setInterval` que descuenta. Sale más simple que una cadena de
 * `setTimeout` y hace gratis las dos pausas que pide el diseño —pestaña oculta
 * y puntero encima—: basta con no descontar. Se limpia al desmontar.
 *
 * CLS 0: el contenedor es `position: fixed`, o sea que está fuera del flujo y no
 * puede empujar nada. Se animan sólo `transform` y `opacity`.
 *
 * MOVIMIENTO REDUCIDO: el estado base de la tarjeta es el VISIBLE y la entrada
 * es un keyframe que la trae desde fuera. Así, cuando el reset de afiliados.css
 * apaga toda animación bajo `.dcaf-root`, la tarjeta simplemente aparece en su
 * sitio —sin deslizamiento— en vez de quedarse congelada en opacidad 0.
 *
 * MÓVIL: por debajo de 480px no se muestra (lo esconde el CSS y aquí ni se
 * programa el reloj). Entre 480 y 767px ocupa casi todo el ancho, y ahí vigila
 * los botones "Registrarme gratis": si uno cae en la franja de abajo, la
 * tarjeta se va o no sale hasta que deje de estorbar.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Los seis iconos del diseño. El tipo de mensaje elige cuál sale. */
export type AvisoIcono = "moneda" | "regalo" | "calendario" | "escudo" | "personas" | "grafica";

/**
 * De qué habla la tarjeta. No cambia cómo se pinta: es lo que usa `intercala`
 * para que el ciclo vaya alternando y no encadene tres reglas seguidas.
 *
 *  · "real"   — un evento de `affiliate_commissions` (modo real, tipo único).
 *  · "regla"  — cómo funciona el programa.
 *  · "sueldo" — cuánto cobra al mes quien tiene tantas clínicas activas.
 */
export type AvisoTipo = "real" | "regla" | "sueldo";

/**
 * Espejo local del DTO, igual que hace `PlanRow` en la calculadora: el server
 * importa ESTE tipo, y no al revés. Aunque un `import type` se borre al
 * compilar, basta un refactor que lo vuelva import de valor para arrastrar
 * Prisma al navegador.
 *
 * `k` es una clave de React —"r0", "s-pago"—, jamás un id de base de datos.
 */
export interface AvisoAfiliado {
  k: string;
  /** Frase ya redactada y ya revisada por las reglas de privacidad. */
  texto: string;
  /** Segunda línea: la fecha relativa. Sólo la traen los eventos reales. */
  pie?: string;
  icono: AvisoIcono;
  tipo: AvisoTipo;
}

export interface AvisosFlotantesProps {
  avisos: AvisoAfiliado[];
}

/** Cada cuánto late el reloj. 500 ms basta: la pausa más corta son 9 s. */
const RITMO_MS = 500;
/** La primera tarjeta no sale de golpe al entrar. */
const PRIMERA_MIN = 6000;
const PRIMERA_MAX = 8000;
/** Cuánto se queda cada tarjeta. */
const VISIBLE_MIN = 5000;
const VISIBLE_MAX = 6000;
/** Hueco entre una tarjeta y la siguiente. */
const PAUSA_MIN = 9000;
const PAUSA_MAX = 18000;
/** Un tick de gracia para que termine la animación de salida (420 ms). */
const SALIDA_MS = 500;
/** Reintento corto cuando la tarjeta taparía un CTA en móvil. */
const REINTENTO_MS = 2000;
/** Franja inferior que ocupa la tarjeta en móvil, en px. */
const FRANJA_CTA = 132;
/** Apagado por el visitante. Dura lo que dure la pestaña. */
const CLAVE_APAGADO = "dcaf-avisos-off";

type Fase = "espera" | "visible" | "saliendo";

/** Entero entre `min` y `max`. Sólo se llama después del montaje. */
function entre(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Fisher-Yates sobre una copia. */
function baraja<T>(xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * Baraja la lista y la reordena para que NO salgan dos tarjetas del mismo tipo
 * seguidas: una regla del programa, un sueldo, una regla…
 *
 * Es el voraz de "reorganizar sin adyacentes iguales": en cada paso se toma del
 * montón más grande que no sea el del tipo recién usado. Sirve porque el montón
 * grande es justo el que se queda sin pareja al final, y sostiene la alternancia
 * siempre que sea posible —o sea, mientras ningún tipo pase de la mitad de la
 * lista—. Cuando no lo es (el modo real, que es de un solo tipo) degrada a la
 * baraja de siempre en vez de tirar tarjetas.
 *
 * `previo` es el tipo de la ÚLTIMA tarjeta mostrada: sin él, la vuelta nueva
 * podría arrancar con el mismo tipo con el que terminó la anterior, que es
 * exactamente la costura que nadie mira.
 *
 * Nada de `for...of` sobre un Map: sin `target` en tsconfig, TypeScript no baja
 * iteradores y el type-check truena.
 */
function intercala(xs: AvisoAfiliado[], previo: AvisoTipo | null): AvisoAfiliado[] {
  const tipos: AvisoTipo[] = [];
  const montones: AvisoAfiliado[][] = [];
  for (const x of baraja(xs)) {
    let i = tipos.indexOf(x.tipo);
    if (i < 0) {
      i = tipos.length;
      tipos.push(x.tipo);
      montones.push([]);
    }
    montones[i].push(x);
  }

  const salida: AvisoAfiliado[] = [];
  let ultimoTipo = previo;
  while (salida.length < xs.length) {
    let elegido = -1;
    for (let i = 0; i < montones.length; i++) {
      if (montones[i].length === 0 || tipos[i] === ultimoTipo) continue;
      if (elegido < 0 || montones[i].length > montones[elegido].length) elegido = i;
    }
    // Sólo queda el tipo que se acaba de usar: se repite antes que perder
    // tarjetas.
    if (elegido < 0) {
      for (let i = 0; i < montones.length; i++) {
        if (montones[i].length > 0) {
          elegido = i;
          break;
        }
      }
    }
    if (elegido < 0) break;
    const x = montones[elegido].shift();
    if (!x) break;
    salida.push(x);
    ultimoTipo = tipos[elegido];
  }
  return salida;
}

/** Trazos de los iconos, al estilo del resto de la página: SVG inline. */
const TRAZOS: Record<AvisoIcono, React.ReactNode> = {
  moneda: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.6 9.2a2.7 2.7 0 0 0-2.6-1.7c-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2a2.7 2.7 0 0 1-2.6-1.7" />
      <path d="M12 6v1.5" />
      <path d="M12 16.5V18" />
    </>
  ),
  regalo: (
    <>
      <rect x="3" y="9" width="18" height="12" rx="2" />
      <path d="M3 13h18" />
      <path d="M12 9v12" />
      <path d="M12 9C10.5 6 9.3 4.5 7.8 4.5A2.3 2.3 0 0 0 7.8 9z" />
      <path d="M12 9c1.5-3 2.7-4.5 4.2-4.5A2.3 2.3 0 0 1 16.2 9z" />
    </>
  ),
  calendario: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M8.5 14.5l2 2 4-4" />
    </>
  ),
  escudo: (
    <>
      <path d="M12 3l7.5 3v5.4c0 4.3-3 7.7-7.5 9.6-4.5-1.9-7.5-5.3-7.5-9.6V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  personas: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 19a6.4 6.4 0 0 1 12.4 0" />
      <path d="M16 5.2a3.4 3.4 0 0 1 0 6.6" />
      <path d="M17.6 13.4A6.4 6.4 0 0 1 21.4 19" />
    </>
  ),
  // Barras que suben — el de los sueldos. A 19px hay que leerlo de un vistazo,
  // así que sin flecha ni ejes: tres trazos y la base bastan para que no se
  // confunda con la moneda de las reglas.
  grafica: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M7 20.5v-4.5" />
      <path d="M12 20.5V11" />
      <path d="M17 20.5V5.5" />
    </>
  ),
};

export function AvisosFlotantes({ avisos }: AvisosFlotantesProps) {
  const [aviso, setAviso] = useState<AvisoAfiliado | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const [apagado, setApagado] = useState(false);
  /** Pantalla angosta: el widget ni se programa. */
  const [estrecho, setEstrecho] = useState(false);

  const fase = useRef<Fase>("espera");
  const restante = useRef(0);
  /** Puntero o foco encima: el temporizador de salida se congela. */
  const retenido = useRef(false);
  const cola = useRef<AvisoAfiliado[]>([]);
  const ultimo = useRef<string | null>(null);
  /** Tipo de la última mostrada: sostiene la alternancia entre vueltas. */
  const ultimoTipo = useRef<AvisoTipo | null>(null);
  const lista = useRef<AvisoAfiliado[]>(avisos);
  lista.current = avisos;

  // Quien lo cerró no quiere volver a verlo en esta pestaña. Se lee después del
  // montaje: en el render rompería la hidratación.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(CLAVE_APAGADO) === "1") setApagado(true);
    } catch {
      // sessionStorage bloqueado (modo privado de Safari): el widget sigue vivo.
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 479px)");
    const sincroniza = () => setEstrecho(mq.matches);
    sincroniza();
    mq.addEventListener("change", sincroniza);
    return () => mq.removeEventListener("change", sincroniza);
  }, []);

  const cerrar = useCallback(() => {
    setApagado(true);
    setAviso(null);
    setSaliendo(false);
    try {
      window.sessionStorage.setItem(CLAVE_APAGADO, "1");
    } catch {
      // Sin persistencia queda apagado sólo hasta recargar. Mejor eso que nada.
    }
  }, []);

  useEffect(() => {
    if (apagado || estrecho || avisos.length === 0) return;

    /**
     * ¿La tarjeta taparía un "Registrarme gratis"? Sólo puede pasar en móvil,
     * donde ocupa el ancho; en escritorio vive en el margen izquierdo, lejos de
     * los CTA centrados. Se busca por `href` para no depender de que alguien
     * recuerde marcar cada botón nuevo.
     */
    const tapaCta = (): boolean => {
      if (window.innerWidth >= 768) return false;
      const alto = window.innerHeight;
      const ctas = document.querySelectorAll<HTMLElement>('a[href^="/afiliados/registro"]');
      for (let i = 0; i < ctas.length; i++) {
        const r = ctas[i].getBoundingClientRect();
        if (r.bottom > alto - FRANJA_CTA && r.top < alto) return true;
      }
      return false;
    };

    const siguiente = (): AvisoAfiliado | null => {
      if (cola.current.length === 0) {
        const nueva = intercala(lista.current, ultimoTipo.current);
        // Al reordenar, que la primera no sea la que se acaba de ver. Con dos
        // tipos esto ya lo garantiza `intercala` —la de arriba es del otro
        // tipo—; queda para el modo real, que es de un tipo solo.
        if (nueva.length > 1 && ultimo.current && nueva[0].k === ultimo.current) {
          const t = nueva[0];
          nueva[0] = nueva[1];
          nueva[1] = t;
        }
        cola.current = nueva;
      }
      const x = cola.current.shift() ?? null;
      if (x) {
        ultimo.current = x.k;
        ultimoTipo.current = x.tipo;
      }
      return x;
    };

    const irse = () => {
      // Se suelta la retención al salir. React NO dispara `mouseleave` cuando
      // el nodo se desmonta, así que una tarjeta que se va CON el puntero (o el
      // foco) encima —sólo pasa por la regla del CTA, que va antes que la
      // pausa— dejaría `retenido` en true para siempre y la SIGUIENTE tarjeta
      // se quedaría clavada en pantalla.
      retenido.current = false;
      setSaliendo(true);
      fase.current = "saliendo";
      restante.current = SALIDA_MS;
    };

    fase.current = "espera";
    restante.current = entre(PRIMERA_MIN, PRIMERA_MAX);

    const reloj = setInterval(() => {
      // Pestaña de fondo: el ciclo se congela entero y sigue al volver.
      if (document.hidden) return;

      // Antes que nada: la tarjeta no puede quedarse encima de un CTA.
      if (fase.current === "visible" && tapaCta()) {
        irse();
        return;
      }

      // Leyéndola: el temporizador de salida no corre.
      if (fase.current === "visible" && retenido.current) return;

      restante.current -= RITMO_MS;
      if (restante.current > 0) return;

      if (fase.current === "espera") {
        if (tapaCta()) {
          restante.current = REINTENTO_MS;
          return;
        }
        const x = siguiente();
        if (!x) return;
        setAviso(x);
        setSaliendo(false);
        fase.current = "visible";
        restante.current = entre(VISIBLE_MIN, VISIBLE_MAX);
      } else if (fase.current === "visible") {
        irse();
      } else {
        setAviso(null);
        setSaliendo(false);
        fase.current = "espera";
        restante.current = entre(PAUSA_MIN, PAUSA_MAX);
      }
    }, RITMO_MS);

    return () => clearInterval(reloj);
  }, [apagado, estrecho, avisos]);

  if (apagado || avisos.length === 0) return null;

  return (
    // El contenedor vive siempre en el DOM aunque esté vacío: un `aria-live`
    // que se inserta junto con su contenido no se anuncia.
    <div className="dcaf-avisos" role="status" aria-live="polite" aria-atomic="true">
      {aviso && (
        <div
          className={saliendo ? "dcaf-aviso dcaf-aviso--out" : "dcaf-aviso"}
          onMouseEnter={() => {
            retenido.current = true;
          }}
          onMouseLeave={() => {
            retenido.current = false;
          }}
          // Con el foco dentro pasa lo mismo que con el puntero: además evita
          // que la tarjeta se desmonte con el botón de cerrar enfocado y el
          // foco se caiga al `body`.
          onFocus={() => {
            retenido.current = true;
          }}
          onBlur={() => {
            retenido.current = false;
          }}
        >
          <span className="dcaf-aviso-ico" aria-hidden="true">
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#2563eb"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {TRAZOS[aviso.icono]}
            </svg>
          </span>

          <div className="dcaf-aviso-txt">
            <p className="dcaf-aviso-linea">{aviso.texto}</p>
            {aviso.pie && <span className="dcaf-aviso-pie">{aviso.pie}</span>}
          </div>

          <button
            type="button"
            className="dcaf-aviso-x"
            onClick={cerrar}
            aria-label="No mostrar más estos avisos"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
