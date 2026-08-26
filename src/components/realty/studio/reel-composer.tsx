"use client";
// ═══════════════════════════════════════════════════════════════════════
// EL REEL SE ARMA EN EL NAVEGADOR.
//
// Un <canvas> de 1080×1920 pinta las fotos con zoom lento y texto encima, y
// MediaRecorder graba ese canvas mientras se pinta. Cero dependencias,
// cero servicios: el video se produce en la máquina del asesor.
//
// Por qué así y no en el servidor: el repo no tiene ffmpeg ni ninguna
// librería de video, y meterla en Vercel significa un binario enorme en la
// función o pagar un servicio de render. La consigna era empezar por lo que
// se puede hacer sin servicios caros.
//
// 🔴 LÍMITE HONESTO: MediaRecorder graba en TIEMPO REAL. Un reel de 15
// segundos tarda 15 segundos en generarse, y la pestaña tiene que quedarse
// al frente — el navegador congela requestAnimationFrame en una pestaña
// oculta y el video saldría con saltos. La pantalla lo dice antes de
// empezar en vez de dejar que salga mal.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtyReelPlan } from "@/lib/realty/studio/types";

type Estado = "idle" | "cargando" | "grabando" | "listo" | "error";

/** El primer formato que el navegador sepa grabar, MP4 primero. */
function mejorFormato(): { mimeType: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidatos = [
    // MP4 es lo que TikTok e Instagram tragan sin recodificar. Chrome 126+
    // y Safari lo soportan; los demás caen a WebM.
    { mimeType: "video/mp4;codecs=avc1.42E01E", ext: "mp4" },
    { mimeType: "video/mp4", ext: "mp4" },
    { mimeType: "video/webm;codecs=vp9", ext: "webm" },
    { mimeType: "video/webm;codecs=vp8", ext: "webm" },
    { mimeType: "video/webm", ext: "webm" },
  ];
  for (const c of candidatos) {
    try {
      if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
    } catch {
      /* isTypeSupported puede lanzar en navegadores viejos */
    }
  }
  return null;
}

function cargarImagen(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // Las URLs firmadas de Supabase permiten CORS; sin esto el canvas
    // quedaría "manchado" y captureStream fallaría.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Dibuja la foto llenando el cuadro 9:16 sin deformarla (cover + zoom). */
function dibujarFoto(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number,
  H: number,
  escala: number,
) {
  const rImg = img.width / img.height;
  const rBox = W / H;
  let w = rImg > rBox ? H * rImg : W;
  let h = rImg > rBox ? H : W / rImg;
  w *= escala;
  h *= escala;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

/** Texto con sombra para que se lea sobre cualquier foto. */
function dibujarTexto(
  ctx: CanvasRenderingContext2D,
  texto: string,
  x: number,
  y: number,
  size: number,
  peso: string,
  alpha: number,
) {
  if (!texto) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${peso} ${size}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.shadowColor = "rgba(0,0,0,0.75)";
  ctx.shadowBlur = size * 0.35;
  ctx.shadowOffsetY = size * 0.06;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(texto, x, y);
  ctx.restore();
}

export function RealtyReelComposer({
  plan,
  t,
}: {
  plan: RealtyReelPlan;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [estado, setEstado] = useState<Estado>("idle");
  const [progreso, setProgreso] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [ext, setExt] = useState("mp4");
  const [aviso, setAviso] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  // El Blob se guarda además de la URL: compartir por WhatsApp necesita el
  // archivo, no un enlace. Un blob: URL no le sirve a otra aplicación.
  const blobRef = useRef<Blob | null>(null);
  const [puedeCompartir, setPuedeCompartir] = useState(false);

  // Un blob URL que no se revoca es memoria que no vuelve.
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const grabar = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const formato = mejorFormato();
    if (!formato) {
      setEstado("error");
      setAviso(t("reel.sinSoporte"));
      return;
    }

    setEstado("cargando");
    setAviso(null);
    setProgreso(0);
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setVideoUrl(null);

    // Las fotos se cargan TODAS antes de empezar: si una tarda a media
    // grabación, el video se queda congelado en ese cuadro. El logo va en la
    // misma tanda; si no carga, `cargarImagen` devuelve null y el reel se
    // graba sin él en vez de quedarse sin grabar.
    const [imgs, logo] = await Promise.all([
      Promise.all(plan.scenes.map((s) => cargarImagen(s.photoUrl))),
      plan.logoUrl ? cargarImagen(plan.logoUrl) : Promise.resolve(null),
    ]);
    const escenas = plan.scenes
      .map((s, i) => ({ ...s, img: imgs[i] }))
      .filter((s) => s.img !== null) as Array<(typeof plan.scenes)[number] & { img: HTMLImageElement }>;

    if (escenas.length === 0) {
      setEstado("error");
      setAviso(t("reel.sinFotos"));
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setEstado("error");
      setAviso(t("reel.sinSoporte"));
      return;
    }

    const W = plan.width;
    const H = plan.height;
    const stream = canvas.captureStream(plan.fps);
    const chunks: BlobPart[] = [];
    const rec = new MediaRecorder(stream, {
      mimeType: formato.mimeType,
      videoBitsPerSecond: 8_000_000,
    });
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const terminado = new Promise<void>((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: formato.mimeType });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        blobRef.current = blob;
        setVideoUrl(url);
        setExt(formato.ext);

        // ¿Este aparato puede pasarle el archivo a WhatsApp? Se pregunta con
        // el archivo YA hecho porque `canShare` mira el tipo real: contestar
        // que sí y luego fallar es peor que no ofrecerlo. En escritorio casi
        // siempre es que no, y entonces el botón no aparece — queda la
        // descarga, que ahí es lo que la gente hace de todos modos.
        try {
          const f = new File([blob], `reel-${plan.template}.${formato.ext}`, {
            type: formato.mimeType,
          });
          setPuedeCompartir(
            typeof navigator !== "undefined" &&
              typeof navigator.canShare === "function" &&
              navigator.canShare({ files: [f] }),
          );
        } catch {
          setPuedeCompartir(false);
        }

        setEstado("listo");
        resolve();
      };
    });

    setEstado("grabando");
    rec.start();

    const t0 = performance.now();
    const totales = escenas.reduce((a, s) => a + s.durationMs, 0);

    const pintar = () => {
      const ahora = performance.now() - t0;
      if (ahora >= totales) {
        try {
          rec.stop();
        } catch {
          /* ya estaba parado */
        }
        return;
      }
      setProgreso(Math.min(100, Math.round((ahora / totales) * 100)));

      // Qué escena toca y cuánto lleva dentro de ella.
      let acc = 0;
      let idx = 0;
      for (let i = 0; i < escenas.length; i++) {
        if (ahora < acc + escenas[i].durationMs) {
          idx = i;
          break;
        }
        acc += escenas[i].durationMs;
        idx = i;
      }
      const esc = escenas[idx];
      const dentro = Math.max(0, ahora - acc);
      const p = Math.min(1, dentro / esc.durationMs);

      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, W, H);

      // Zoom lento.
      const escala = esc.zoomFrom + (esc.zoomTo - esc.zoomFrom) * p;
      ctx.save();
      dibujarFoto(ctx, esc.img, W, H, escala);
      ctx.restore();

      // Cruce con la siguiente: se pinta encima con opacidad creciente.
      const restante = esc.durationMs - dentro;
      const sig = escenas[idx + 1];
      if (sig && restante < plan.crossfadeMs) {
        const a = 1 - restante / plan.crossfadeMs;
        ctx.save();
        ctx.globalAlpha = a;
        dibujarFoto(ctx, sig.img, W, H, sig.zoomFrom);
        ctx.restore();
      }

      // Degradado de abajo: sin esto el texto blanco desaparece sobre una
      // foto clara.
      const grad = ctx.createLinearGradient(0, H * 0.55, 0, H);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.72)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.55, W, H * 0.45);

      // El texto entra con un fundido corto para que no aparezca de golpe.
      const alpha = Math.min(1, p / 0.12);
      const margen = Math.round(W * 0.075);
      if (esc.title) dibujarTexto(ctx, esc.title, margen, H - Math.round(H * 0.16), 74, "bold", alpha);
      if (esc.subtitle)
        dibujarTexto(ctx, esc.subtitle, margen, H - Math.round(H * 0.115), 46, "normal", alpha);

      // La firma de la cuenta, siempre.
      dibujarTexto(ctx, plan.accountName, margen, H - Math.round(H * 0.055), 34, "normal", 0.85);

      // El logo, arriba a la derecha y CHICO: un logo grande tapa el
      // inmueble, que es lo único que la gente vino a ver. Se dibuja con su
      // proporción real (nada de estirarlo a un cuadrado) y con un tope de
      // alto, porque un logo apaisado con ancho fijo se sale del cuadro.
      if (logo && logo.width > 0 && logo.height > 0) {
        const maxW = W * 0.22;
        const maxH = H * 0.055;
        const k = Math.min(maxW / logo.width, maxH / logo.height);
        const lw = logo.width * k;
        const lh = logo.height * k;
        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.drawImage(logo, W - margen - lw, margen, lw, lh);
        ctx.restore();
      }

      requestAnimationFrame(pintar);
    };

    requestAnimationFrame(pintar);
    await terminado;
  }, [plan, t]);

  const nombre = `reel-${plan.template}.${ext}`;

  /**
   * Enviar por WhatsApp — con la hoja de compartir del propio aparato.
   *
   * 🔴 NO se manda por la API de WhatsApp de la cuenta, y es una decisión,
   * no una omisión: ese camino cobra por conversación, exige subir el video
   * a Meta y solo alcanza a un número que ya escribió. El reel no se manda a
   * un cliente: se PUBLICA, y quien lo publica es la persona desde su
   * teléfono. La hoja nativa le entrega el archivo a WhatsApp, a TikTok o a
   * donde quiera, sin costo y sin ventana de 24 horas.
   */
  async function compartir() {
    const blob = blobRef.current;
    if (!blob) return;
    try {
      const file = new File([blob], nombre, { type: blob.type });
      await navigator.share({ files: [file], title: plan.accountName });
    } catch (e) {
      // Cancelar la hoja lanza AbortError: eso NO es un error que mostrar.
      if ((e as { name?: string })?.name !== "AbortError") {
        setAviso(t("reel.sinCompartir"));
      }
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* El canvas se pinta a 1080×1920 pero se ve chico: lo que importa es
          el archivo, no la vista previa. */}
      <canvas
        ref={canvasRef}
        width={plan.width}
        height={plan.height}
        style={{
          width: "100%",
          maxWidth: 220,
          aspectRatio: "9 / 16",
          borderRadius: 12,
          background: "#000",
          border: "1px solid var(--border-soft)",
          justifySelf: "center",
        }}
      />

      <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0, textAlign: "center" }}>
        {t("reel.aviso")}
      </p>

      {estado === "grabando" && (
        <div style={{ display: "grid", gap: 6 }}>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              background: "var(--bg-elev-2)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progreso}%`,
                background: "var(--brand)",
                transition: "width 120ms linear",
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
            {t("reel.grabando", { pct: progreso })}
          </span>
        </div>
      )}

      {aviso && (
        <p style={{ fontSize: 13, color: "var(--danger)", margin: 0, textAlign: "center" }}>
          {aviso}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={grabar}
          disabled={estado === "cargando" || estado === "grabando"}
          style={{
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: "var(--brand)",
            border: "none",
            borderRadius: 10,
            cursor: estado === "grabando" ? "wait" : "pointer",
            opacity: estado === "cargando" || estado === "grabando" ? 0.6 : 1,
          }}
        >
          {estado === "listo" ? t("reel.otraVez") : t("reel.generar")}
        </button>

        {videoUrl && (
          <a
            href={videoUrl}
            download={nombre}
            style={{
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-1)",
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              borderRadius: 10,
              textDecoration: "none",
            }}
          >
            {t("reel.descargar", { ext: ext.toUpperCase() })}
          </a>
        )}

        {videoUrl && puedeCompartir && (
          <button
            type="button"
            onClick={compartir}
            style={{
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-1)",
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            {t("reel.compartir")}
          </button>
        )}
      </div>

      {videoUrl && (
        <video
          src={videoUrl}
          controls
          playsInline
          style={{
            width: "100%",
            maxWidth: 220,
            aspectRatio: "9 / 16",
            borderRadius: 12,
            justifySelf: "center",
            background: "#000",
          }}
        />
      )}
    </div>
  );
}
