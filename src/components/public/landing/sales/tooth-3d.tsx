/**
 * Diente 3D dimensional — acento del hero.
 *
 * Por ahora es un SVG con gradientes violeta + brillo especular que da
 * sensación 3D, con flotación suave (respeta prefers-reduced-motion via CSS).
 * Ligero: sin three.js, sin dependencias.
 *
 * SLOT: para sustituirlo luego por un render 3D real, pon la URL del PNG en
 * TOOTH_IMG (idealmente con fondo transparente, ~600px). Si es null, se usa
 * el SVG dimensional.
 */
export const TOOTH_IMG: string | null = null;

export function Tooth3D({ float = true }: { float?: boolean }) {
  return (
    <div className={`mfh-tooth${float ? " mfh-tooth--float" : ""}`} aria-hidden="true">
      {TOOTH_IMG ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={TOOTH_IMG} alt="" width={600} height={720} />
      ) : (
        <ToothSVG />
      )}
    </div>
  );
}

function ToothSVG() {
  return (
    <svg viewBox="0 0 200 244" fill="none" xmlns="http://www.w3.org/2000/svg" role="presentation">
      <defs>
        <linearGradient id="mfhToothBody" x1="56" y1="30" x2="150" y2="214" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.42" stopColor="#efe9fe" />
          <stop offset="0.78" stopColor="#d3c4f7" />
          <stop offset="1" stopColor="#b39bef" />
        </linearGradient>
        <linearGradient id="mfhToothRoot" x1="100" y1="120" x2="100" y2="214" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d8ccf6" />
          <stop offset="1" stopColor="#a888ea" />
        </linearGradient>
        <radialGradient id="mfhToothSpec" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse"
          gradientTransform="translate(74 62) rotate(60) scale(40 26)">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="mfhToothGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse"
          gradientTransform="translate(100 150) rotate(90) scale(96 92)">
          <stop offset="0" stopColor="#a78bfa" stopOpacity="0.5" />
          <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mfhToothShade" x1="150" y1="70" x2="92" y2="200" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5b21b6" stopOpacity="0" />
          <stop offset="1" stopColor="#5b21b6" stopOpacity="0.34" />
        </linearGradient>
      </defs>

      {/* halo violeta de base */}
      <ellipse cx="100" cy="150" rx="96" ry="92" fill="url(#mfhToothGlow)" />

      {/* cuerpo del diente (molar con dos raíces) */}
      <path
        d="M50 118 C44 92 40 84 44 66 C48 44 64 34 84 40 C92 43 96 46 100 46 C104 46 108 43 116 40 C136 34 152 44 156 66 C160 84 156 92 150 118 C148 150 140 180 130 202 C127 208 120 208 117 201 C112 182 108 158 100 158 C92 158 88 182 83 201 C80 208 73 208 70 202 C60 180 52 150 50 118 Z"
        fill="url(#mfhToothBody)"
        stroke="#c9b8f4"
        strokeWidth="1.5"
      />

      {/* raíces con tono levemente más profundo para volumen */}
      <path
        d="M70 202 C60 180 52 150 50 122 C66 128 78 140 84 160 C86 176 84 192 83 201 C80 208 73 208 70 202 Z"
        fill="url(#mfhToothRoot)"
        opacity="0.45"
      />
      <path
        d="M130 202 C140 180 148 150 150 122 C134 128 122 140 116 160 C114 176 116 192 117 201 C120 208 127 208 130 202 Z"
        fill="url(#mfhToothRoot)"
        opacity="0.45"
      />

      {/* sombra lateral derecha → roundness */}
      <path
        d="M50 118 C44 92 40 84 44 66 C48 44 64 34 84 40 C92 43 96 46 100 46 C104 46 108 43 116 40 C136 34 152 44 156 66 C160 84 156 92 150 118 C148 150 140 180 130 202 C127 208 120 208 117 201 C112 182 108 158 100 158 C92 158 88 182 83 201 C80 208 73 208 70 202 C60 180 52 150 50 118 Z"
        fill="url(#mfhToothShade)"
      />

      {/* surcos oclusales sutiles */}
      <path d="M72 64 C84 58 116 58 128 64" stroke="#7c3aed" strokeOpacity="0.16" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M100 52 C100 66 100 78 100 92" stroke="#7c3aed" strokeOpacity="0.12" strokeWidth="2.2" strokeLinecap="round" />

      {/* brillo especular */}
      <path d="M70 54 C60 64 57 84 64 98 C74 88 82 70 84 56 C80 51 74 50 70 54 Z" fill="url(#mfhToothSpec)" />

      {/* destellos decorativos */}
      <g fill="#a78bfa">
        <path d="M171 56 l2.4 6.4 6.4 2.4 -6.4 2.4 -2.4 6.4 -2.4 -6.4 -6.4 -2.4 6.4 -2.4 Z" opacity="0.85" />
        <path d="M30 150 l1.7 4.6 4.6 1.7 -4.6 1.7 -1.7 4.6 -1.7 -4.6 -4.6 -1.7 4.6 -1.7 Z" opacity="0.6" />
      </g>
    </svg>
  );
}
