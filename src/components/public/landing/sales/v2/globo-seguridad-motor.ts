/**
 * Motor del globo de la franja de seguridad (4-oct-2026, ws1-t10).
 *
 * Un globo 3D de puntos dibujado en un <canvas> 2D: sin WebGL, sin three.js y
 * sin dependencias. Este módulo SOLO se descarga con `import()` cuando la
 * franja se acerca a la pantalla (globo-seguridad-vivo.tsx), así que no pesa
 * en la carga de la portada; quien lo llama lo pausa fuera de pantalla.
 *
 * Qué pinta, en cada cuadro: la tierra firme como ~2 400 puntos (proyección
 * ortográfica, más tenues hacia el borde), arcos entre ciudades con un pulso de
 * luz que los recorre y un latido en cada extremo. El mar, el halo y el brillo
 * NO se pintan aquí: son el SVG que hay debajo (franja-seguridad.tsx), que
 * además es lo que se ve si este módulo no llega a cargar.
 *
 * Los arcos son un adorno (luz que viaja entre puntos), no un mapa de nada.
 */

/**
 * Tierra firme a 1 bit por celda de 2° (180 × 90, de 90°N a 90°S y de 180°O a
 * 180°E), en base64. Sale de Natural Earth 1:110m (dominio público).
 */
const TIERRA =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAfAP8DAAAAAAAAAAAAAAAAAAAAAAD4//3//wcAAAAAAAACAAAAAAAAAAAAhv/x//8PAPABAAAAwAMAAAAAAAAAwADkh////wEABAAAAABgAAAAAAAAAADgUT8A/v8PAAAAAAwA/j8AOAAAAAAA8JHtDcD/fwAAAAAwAPz//wMDABCAAQD5w/4D+P8FAAAMAIL7/////y8AAH8AgP9HHv8A8P//A+Bv2AAAAAAAAMAPAAAAAODBB+D//x8AKAAEAAAAAAAAMQAAAADAH//Af/j/YDgAAAAAAAAAAADw/////wE84AEAAHz+////////////gP////8HeAAcAADg5///////////9ADgAf7/f4AvAAAAAH78////////H0QAAAiA//8f8AcAAIBB4////////38ADwAQAPD//5//AQAAHAT/////////A3AAAAAA/v//+T8AAGDz//////////8DAQAAAMD/////AwAAsP//////////LwAAAAAA+P///2MAAAD+//////////8CAAAAAAD///8/CAAA4P//////////JwAAAAAA8P///wYAAAD+/unz/////z8AAAAAAAD///8HAAAA/pgPPP//////MQAAAAAA8P//PwAAAMBH9v7n/////wcBAAAAAAD///8BAAAAPkD7f/7///8hEAAAAAAA4P//DwAAAIDhAv/n////f8YAAAAAAAD8//8AAAAA+AcA//////8jDwAAAAAAgP//AwAAAMD/APD/////PxgAAAAAAADw/x8AAAAA/n/v//////8HAAAAAAAAAPwDAgAAAOD////7////fwAAAAAAAACgHyAAAACA//9/f/7///8DAAAAAAAAAPQBAAAAAPj//+cv+P//PwAAAAAAAAAAHjAAAADA/////g/+//8EAAAAAAAAAOBhCAAAAP7//99/4D//AAAAAAAAAAAAPAMGAADA////+Qf84BcAAAAAAAAAAAA/AAAAAPz//58fgAf+QAAAAAAAAAAAAA8AAADg////ewA4gA8EAAAAAAAAAADAAAAAAPz//38BgAP4AQAAAAAAAAAAAAgPAADA////zwAwgAwQAAAAAAAAAAAA9Q8AAPj///8HAAVIAAAAAAAAAAAAAID/AQAA////fwBAAAAQAAAAAAAAAAAA+P8AAGDh//8DAAA0GAAAAAAAAAAAAID/HwAAAPj/HwAAgMIBAAAAAAAAAAAA/P8BAACA//8AAAAYXgAAAAAAAAAAAMD/fwAAAPz/BwAAAOOBAQAAAAAAAAAA/P8/AACA/z8AAABgbtABAAAAAAAAAOD//w8AAPD/AwAAAAQIeAAAAAAAAAAA/P//AQAA/z8AAACAA4APAAAAAAAAAID//w8AAPD/AwAAAAARsEAAAAAAAAAA+P//AAAA/j8AAAAAAAAAAAAAAAAAAAD//wcAAPD/QwAAAACAIwAAAAAAAAAA8P9/AAAA/z8EAAAAAD8GAAAAAAAAAAD8/wMAAPD/cQAAAAD4bwAAAAAAAAAAgP8/AAAA/w8HAAAAgP8HAAAAAAAAAAD4/wMAAOD/MAAAAAD//wEBAAAAAAAAgP8PAAAA/g8DAAAA+P8fAAAAAAAAAAD4PwAAAOB/EAAAAID//wMAAAAAAAAAgP8DAAAA/AMAAAAA+P9/AAAAAAAAAAD8HwAAAMA/AAAAAID//wcAAAAAAAAAwP8BAAAA+AEAAAAA8P9/AAAAAAAAAAD8DwAAAIAPAAAAAAAP/gMAAAAAAAAAwB8AAAAAAAAAAAAAEIAfAAEAAAAAAAD+AwAAAAAAAAAAAAAA8AEgAAAAAAAA4AcAAAAAAAAAAAAAAAAAAAYAAAAAAAB+AAAAAAAAAAAAAAAAwAAwAAAAAAAA4AMAAAAAAAAAAAAAAAAIgAEAAAAAAAAeAAAAAAAAAAAAAAAAAAAMAAAAAAAA4AEAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAAAAAAAAAAABAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAB4AEDwn/8HAAAAAAAAAAAwAAAAAACA/P/h/////w8AAAAAAAAAwAcAAAD4////z///////PwAAAAAAHALwAACA//////////////8HAADw/6///wMAAP7/////////////HwAA+P////8BAID///////////////8AAPL/////BwAO////////////////DwAA8P////8nEPD//////////////z8AAOD/////////////////////////HwAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const COLS = 180;
const FILAS = 90;

const RAD = Math.PI / 180;
/** Inclinación del eje hacia quien mira: enseña un poco más el hemisferio norte. */
const INCLINACION = 0.3;
/** Una vuelta cada 50 s. */
const VELOCIDAD = (2 * Math.PI) / 50;
/** Arranca con México casi de frente (longitud −100° → centro con 100°). */
const ANGULO_INICIAL = 84 * RAD;
const TRAMOS = 44;

/** Ciudades entre las que viaja la luz: [latitud, longitud]. La 0 es Ciudad de México. */
const NODOS: [number, number][] = [
  [19.43, -99.13], // Ciudad de México
  [38.9, -77.4], // Virginia
  [34.05, -118.24], // Los Ángeles
  [4.71, -74.07], // Bogotá
  [-23.55, -46.63], // São Paulo
  [40.42, -3.7], // Madrid
  [50.11, 8.68], // Fráncfort
  [19.08, 72.88], // Bombay
  [1.35, 103.82], // Singapur
  [35.68, 139.69], // Tokio
  [-33.87, 151.21], // Sídney
  [-26.2, 28.05], // Johannesburgo
];
const ARCOS: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [3, 4], [1, 5], [4, 11], [5, 6], [6, 7], [7, 8], [8, 9], [8, 10], [9, 2], [11, 7],
];

export type GloboSeguridad = {
  /** Empieza (o reanuda) la animación. Con `quieto` no hace nada: ya hay un cuadro fijo. */
  arrancar(): void;
  /** Detiene la animación (fuera de pantalla o pestaña oculta). */
  parar(): void;
  destruir(): void;
};

function vector(lat: number, lon: number): [number, number, number] {
  const c = Math.cos(lat * RAD);
  return [c * Math.sin(lon * RAD), Math.sin(lat * RAD), c * Math.cos(lon * RAD)];
}

/** Puntos de tierra repartidos con densidad pareja (menos por fila hacia los polos). */
function puntosDeTierra(): Float32Array {
  const bin = atob(TIERRA);
  const esTierra = (lat: number, lon: number) => {
    const f = Math.min(FILAS - 1, Math.max(0, Math.floor((90 - lat) / 2)));
    const c = Math.min(COLS - 1, Math.max(0, Math.floor((lon + 180) / 2)));
    const i = f * COLS + c;
    return (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
  };
  const out: number[] = [];
  let fila = 0;
  // De 58°S hacia arriba: la Antártida no aporta y ensucia el pie del globo.
  for (let lat = -58; lat <= 84; lat += 2.25, fila++) {
    const n = Math.max(1, Math.round(160 * Math.cos(lat * RAD)));
    for (let k = 0; k < n; k++) {
      const lon = -180 + ((k + (fila % 2) * 0.5) * 360) / n;
      if (esTierra(lat, lon)) out.push(...vector(lat, lon));
    }
  }
  return new Float32Array(out);
}

/** Arco de círculo máximo entre dos nodos, levantado sobre la superficie. */
function arco(a: [number, number, number], b: [number, number, number]): Float32Array {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const ang = Math.acos(dot);
  const sen = Math.sin(ang) || 1;
  const alto = 0.05 + 0.24 * (ang / Math.PI);
  const out = new Float32Array((TRAMOS + 1) * 3);
  for (let i = 0; i <= TRAMOS; i++) {
    const t = i / TRAMOS;
    const ka = Math.sin((1 - t) * ang) / sen;
    const kb = Math.sin(t * ang) / sen;
    const h = 1 + alto * Math.sin(Math.PI * t);
    out[i * 3] = (a[0] * ka + b[0] * kb) * h;
    out[i * 3 + 1] = (a[1] * ka + b[1] * kb) * h;
    out[i * 3 + 2] = (a[2] * ka + b[2] * kb) * h;
  }
  return out;
}

export function crearGlobo(
  canvas: HTMLCanvasElement,
  opts: { quieto: boolean; suave?: boolean; alListo?: () => void },
): GloboSeguridad | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const tierra = puntosDeTierra();
  const total = tierra.length / 3;
  const nodos = NODOS.map(([lat, lon]) => vector(lat, lon));
  const arcos = ARCOS.map(([a, b]) => arco(nodos[a], nodos[b]));
  // Pantalla de cada punto (x, y) y su profundidad, reutilizados en cada cuadro.
  const px = new Float32Array(total);
  const py = new Float32Array(total);
  const pz = new Float32Array(total);
  const ax = new Float32Array(TRAMOS + 1);
  const ay = new Float32Array(TRAMOS + 1);
  const av = new Uint8Array(TRAMOS + 1);

  let lado = 0; // lado del lienzo en px de dispositivo
  let dpr = 1;
  let tinta: CanvasGradient | string = "#bfdbfe";
  let angulo = ANGULO_INICIAL;
  let reloj = 0; // segundos de animación acumulados (no corre en pausa)
  let rafId = 0;
  let ultimo = 0;
  let corriendo = false;
  let listo = false;

  const medir = () => {
    const css = canvas.clientWidth;
    if (!css) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nuevo = Math.round(css * dpr);
    if (nuevo !== lado) {
      lado = nuevo;
      canvas.width = lado;
      canvas.height = lado;
      const g = ctx.createLinearGradient(lado * 0.1, lado * 0.1, lado * 0.9, lado * 0.9);
      g.addColorStop(0, "#a5d0ff");
      g.addColorStop(0.55, "#bfc8ff");
      g.addColorStop(1, "#cdb8ff");
      tinta = g;
    }
    return true;
  };

  const pintar = () => {
    if (!lado && !medir()) return;
    const c = lado / 2;
    // El disco del SVG de debajo mide 100 de 240: el mismo radio aquí.
    const R = (lado * 100) / 240;
    const giro = angulo;
    const cg = Math.cos(giro);
    const sg = Math.sin(giro);
    const ct = Math.cos(INCLINACION);
    const st = Math.sin(INCLINACION);
    const entrada = opts.quieto ? 1 : Math.min(1, reloj / 0.9);

    ctx.clearRect(0, 0, lado, lado);

    // ── Tierra firme ──
    for (let i = 0; i < total; i++) {
      const x = tierra[i * 3];
      const y = tierra[i * 3 + 1];
      const z = tierra[i * 3 + 2];
      const x1 = x * cg + z * sg;
      const z1 = -x * sg + z * cg;
      px[i] = c + x1 * R;
      py[i] = c - (y * ct - z1 * st) * R;
      pz[i] = y * st + z1 * ct;
    }
    ctx.fillStyle = tinta;
    const radio = Math.max(0.8, R * 0.0125);
    for (let capa = 0; capa < 5; capa++) {
      const desde = capa / 5;
      const hasta = desde + 0.2;
      ctx.globalAlpha = (0.3 + 0.7 * (desde + 0.1)) * entrada;
      const r = radio * (0.72 + 0.28 * (desde + 0.1));
      ctx.beginPath();
      for (let i = 0; i < total; i++) {
        const z = pz[i];
        if (z <= desde || z > hasta) continue;
        ctx.moveTo(px[i] + r, py[i]);
        ctx.arc(px[i], py[i], r, 0, 6.2832);
      }
      ctx.fill();
    }

    // ── Arcos y pulsos ──
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let k = 0; k < arcos.length; k++) {
      const p = arcos[k];
      for (let i = 0; i <= TRAMOS; i++) {
        const x = p[i * 3];
        const y = p[i * 3 + 1];
        const z = p[i * 3 + 2];
        const x1 = x * cg + z * sg;
        const z1 = -x * sg + z * cg;
        const y2 = y * ct - z1 * st;
        const z2 = y * st + z1 * ct;
        ax[i] = c + x1 * R;
        ay[i] = c - y2 * R;
        // Visible si mira hacia nosotros o si asoma por fuera del disco.
        av[i] = z2 > 0 || x1 * x1 + y2 * y2 > 1 ? 1 : 0;
      }
      ctx.globalAlpha = 0.42 * entrada;
      ctx.strokeStyle = "#93c5fd";
      ctx.lineWidth = dpr;
      ctx.beginPath();
      let abierto = false;
      for (let i = 0; i <= TRAMOS; i++) {
        if (!av[i]) { abierto = false; continue; }
        if (abierto) ctx.lineTo(ax[i], ay[i]);
        else { ctx.moveTo(ax[i], ay[i]); abierto = true; }
      }
      ctx.stroke();

      if (opts.quieto) continue;
      // Pulso: la cabeza recorre el arco y arrastra una cola que se apaga.
      const fase = (reloj / 3.4 + k * 0.381) % 1;
      const cabeza = fase * 1.7; // de 0 a 1 viaja; de 1 a 1.7 descansa
      const COLA = 0.3;
      ctx.strokeStyle = "#eef2ff";
      ctx.lineWidth = 1.9 * dpr;
      for (let i = 0; i < TRAMOS; i++) {
        if (!av[i] || !av[i + 1]) continue;
        const d = cabeza - (i + 0.5) / TRAMOS;
        if (d < 0 || d > COLA) continue;
        ctx.globalAlpha = (1 - d / COLA) * 0.95 * entrada;
        ctx.beginPath();
        ctx.moveTo(ax[i], ay[i]);
        ctx.lineTo(ax[i + 1], ay[i + 1]);
        ctx.stroke();
      }
      if (cabeza <= 1) {
        const i = Math.min(TRAMOS, Math.round(cabeza * TRAMOS));
        if (av[i]) {
          ctx.fillStyle = "#93c5fd";
          ctx.globalAlpha = 0.3 * entrada;
          ctx.beginPath();
          ctx.arc(ax[i], ay[i], 5.5 * dpr, 0, 6.2832);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.globalAlpha = entrada;
          ctx.beginPath();
          ctx.arc(ax[i], ay[i], 2 * dpr, 0, 6.2832);
          ctx.fill();
        }
      }
    }

    // ── Nodos: punto fijo + latido ──
    for (let n = 0; n < nodos.length; n++) {
      const [x, y, z] = nodos[n];
      const x1 = x * cg + z * sg;
      const z1 = -x * sg + z * cg;
      const z2 = y * st + z1 * ct;
      if (z2 <= 0.05) continue;
      const sx = c + x1 * R;
      const sy = c - (y * ct - z1 * st) * R;
      const casa = n === 0;
      const visible = Math.min(1, z2 * 3) * entrada;
      if (!opts.quieto) {
        const t = (reloj / (casa ? 2.2 : 3) + n * 0.27) % 1;
        ctx.globalAlpha = (1 - t) * 0.75 * visible;
        ctx.strokeStyle = casa ? "#c4b5fd" : "#93c5fd";
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        ctx.arc(sx, sy, (2.5 + t * (casa ? 13 : 8)) * dpr, 0, 6.2832);
        ctx.stroke();
      }
      ctx.globalAlpha = visible;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sx, sy, (casa ? 2.8 : 1.9) * dpr, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (!listo) {
      listo = true;
      opts.alListo?.();
    }
  };

  const cuadro = (ahora: number) => {
    if (!corriendo) return;
    // `suave` (pantallas táctiles): un cuadro de cada dos, ~30 por segundo. El
    // giro es lento y no se nota; la batería sí.
    if (opts.suave && ahora - ultimo < 30) {
      rafId = requestAnimationFrame(cuadro);
      return;
    }
    const dt = Math.min(0.05, (ahora - ultimo) / 1000);
    ultimo = ahora;
    reloj += dt;
    angulo += VELOCIDAD * dt;
    pintar();
    rafId = requestAnimationFrame(cuadro);
  };

  const observador =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          // Cambiar `canvas.width` lo deja en blanco (transparente): se repinta
          // en el acto, también en marcha, para que el globo no desaparezca
          // ni un cuadro al cambiar el tamaño (giro de la tableta, Split View).
          if (medir()) pintar();
        });
  observador?.observe(canvas);

  // Cuadro fijo de entrada: es todo lo que se ve con «reducir movimiento».
  if (opts.quieto) {
    angulo = 100 * RAD;
    pintar();
  }

  return {
    arrancar() {
      if (opts.quieto || corriendo) return;
      corriendo = true;
      ultimo = performance.now();
      rafId = requestAnimationFrame(cuadro);
    },
    parar() {
      corriendo = false;
      cancelAnimationFrame(rafId);
    },
    destruir() {
      corriendo = false;
      cancelAnimationFrame(rafId);
      observador?.disconnect();
    },
  };
}
