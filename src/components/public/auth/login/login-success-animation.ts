import { animate } from "framer-motion";

/**
 * Animación de éxito del login: los dos campos convergen al centro y se
 * funden en un recuadro que pasa a borde verde con palomita; después un velo
 * oscuro cubre la página para que la navegación al dashboard sea limpia.
 *
 * - Duración total ≈ 1.15 s (dentro del rango 800 ms – 1.2 s).
 * - prefers-reduced-motion: solo el velo (fundido rápido ~200 ms).
 * - Nunca lanza NI SE CUELGA: cualquier error se traga y hay un watchdog que
 *   resuelve pase lo que pase, así el caller siempre acaba navegando.
 * - El velo y la capa de clones se quedan montados a propósito: los limpia
 *   la navegación dura (window.location.href).
 *
 * Técnica: no se toca el layout real del form. Se clonan los rects de los
 * inputs en una capa fixed, se ocultan los originales y se anima el clon.
 */

const EASE: [number, number, number, number] = [0.7, 0, 0.3, 1];
const GREEN = "#34d399"; // --ld-success

/**
 * Tope duro de espera. framer-motion avanza con requestAnimationFrame: si la
 * pestaña se va a segundo plano a mitad de la secuencia el rAF se congela y la
 * promesa NUNCA resolvería, dejando al usuario atrapado en el login. Con esto
 * lo peor que pasa es que la animación se corte y se navegue igual.
 */
const WATCHDOG_MS = 2500;

const px = (n: number) => `${n}px`;
const wait = (s: number) => new Promise<void>((res) => setTimeout(res, s * 1000));

function makeLayer(): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed", inset: "0", zIndex: "9999", pointerEvents: "none",
  });
  return el;
}

function makeBox(r: DOMRect): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed",
    left: px(r.left), top: px(r.top), width: px(r.width), height: px(r.height),
    background: "#ffffff",
    border: "1.5px solid rgba(124,58,237,0.75)",
    borderRadius: "12px",
    boxSizing: "border-box",
    boxShadow: "0 6px 24px -10px rgba(124,58,237,0.3)",
  });
  return el;
}

function makeCheck(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "26");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M5 12.5 L10 17.5 L19 8");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", GREEN);
  path.setAttribute("stroke-width", "2.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.style.strokeDasharray = "24";
  path.style.strokeDashoffset = "24";
  svg.appendChild(path);
  Object.assign(svg.style, { position: "absolute", inset: "0", margin: "auto", opacity: "0" });
  return svg;
}

function makeVeil(): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed", inset: "0", zIndex: "10000",
    background: "#0a0a0f", opacity: "0", pointerEvents: "auto",
  });
  return el;
}

export interface LoginSuccessTargets {
  /** Raíz del contenido del form (se atenúa durante la animación). */
  form: HTMLElement;
  /** [input de email, input de contraseña] — los recuadros que convergen. */
  inputs: [HTMLElement, HTMLElement];
}

async function runSequence({ form, inputs }: LoginSuccessTargets): Promise<void> {
  const veil = makeVeil();

  // Reduced motion: solo un fundido rápido.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.body.appendChild(veil);
    await animate(veil, { opacity: 1 }, { duration: 0.2, ease: "easeIn" });
    return;
  }

  const [a, b] = inputs;
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();

  const layer = makeLayer();
  const boxA = makeBox(ra);
  const boxB = makeBox(rb);
  const check = makeCheck();
  boxB.appendChild(check);
  layer.append(boxA, boxB);
  document.body.appendChild(layer);
  a.style.visibility = "hidden";
  b.style.visibility = "hidden";

  // 1) El resto del form se atenúa.
  await animate(form, { opacity: 0.25 }, { duration: 0.12, ease: "easeOut" });

  // 2) Convergencia hacia el punto medio entre ambos campos.
  const cx = (ra.left + ra.right + rb.left + rb.right) / 4;
  const cy = (ra.top + rb.bottom) / 2;
  const target = { left: cx - 32, top: cy - 28, width: 64, height: 56, borderRadius: 16 };
  await Promise.all([
    animate(boxA, target, { duration: 0.3, ease: EASE }),
    animate(boxB, target, { duration: 0.3, ease: EASE }),
  ]);

  // 3) Fusión: un clon desaparece, el otro pasa a verde.
  await Promise.all([
    animate(boxA, { opacity: 0 }, { duration: 0.1 }),
    animate(
      boxB,
      { borderColor: GREEN, boxShadow: "0 0 0 5px rgba(52,211,153,0.14), 0 10px 32px -8px rgba(52,211,153,0.35)" },
      { duration: 0.14 },
    ),
  ]);

  // 4) Palomita (trazo) + pop.
  check.style.opacity = "1";
  const path = check.querySelector("path");
  await Promise.all([
    path ? animate(path, { strokeDashoffset: 0 }, { duration: 0.22, ease: "easeOut" }) : Promise.resolve(),
    animate(boxB, { scale: [1, 1.06, 1] }, { duration: 0.24 }),
  ]);
  await wait(0.15);

  // 5) Velo de salida hacia el dashboard.
  document.body.appendChild(veil);
  await animate(veil, { opacity: 1 }, { duration: 0.22, ease: "easeIn" });
}

export async function playLoginSuccessAnimation(targets: LoginSuccessTargets): Promise<void> {
  if (typeof window === "undefined") return;
  // La animación NUNCA bloquea el login: ni por excepción (catch) ni por
  // quedarse colgada (watchdog). Lo que gane la carrera, se navega.
  await Promise.race([
    runSequence(targets).catch(() => {}),
    wait(WATCHDOG_MS / 1000),
  ]);
}
