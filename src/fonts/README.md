# `src/fonts` — la tipografía vive en el repo

Antes, cada página declaraba su familia con `next/font/google`. Eso hace que
**`next build` salga a la red**: descarga el CSS de `fonts.googleapis.com` y los
`.woff2` de `fonts.gstatic.com` en tiempo de compilación. Medido el 5-sep-2026 en
el servidor de trabajo: un build en solitario hizo 18 reintentos, seis builds a la
vez llegaron a 36, y uno murió con `ETIMEDOUT` (`next/font` solo reintenta 3 veces).
No es la red: es Google estrangulando peticiones simultáneas. Vercel corre el mismo
riesgo en cada build de producción.

Aquí están esos mismos `.woff2`, versionados. Las declaraciones usan
`next/font/local`, así que el build ya no depende de Google.

## De dónde salen los archivos

Son **exactamente** los que `next/font/google` descargaba: se pidió a la API CSS2 de
Google la misma URL que arma `getGoogleFontsUrl()` de Next para los pesos que el repo
usa, y se guardó el `.woff2` del subconjunto **`latin`** de cada `@font-face`.

Para Inter, IBM Plex Sans, Hanken Grotesk y Plus Jakarta Sans, Google sirve **un solo
archivo variable** y repite el `@font-face` con un `font-weight` distinto apuntando al
mismo `.woff2`; por eso hay un único `*-latin-var.woff2` por familia y varias entradas
en `src`. IBM Plex Mono, Bebas Neue y Source Serif 4 sí vienen con un archivo por peso
o estilo.

| Archivo | Familia | Pesos que sirve |
|---|---|---|
| `inter-latin-var.woff2` | Inter | variable, 400–800 según la declaración |
| `ibm-plex-sans-latin-var.woff2` | IBM Plex Sans | variable, 300–700 |
| `ibm-plex-mono-{400,500,600,700}.woff2` | IBM Plex Mono | uno por peso |
| `hanken-grotesk-latin-var.woff2` | Hanken Grotesk | variable, 600 y 700 |
| `bebas-neue-400.woff2` | Bebas Neue | 400 |
| `source-serif-4-600.woff2`, `source-serif-4-600-italic.woff2` | Source Serif 4 | 600 normal e itálica |
| `plus-jakarta-sans-latin-var.woff2` | Plus Jakarta Sans | variable, 400–800 |

## Un módulo por configuración, y no un solo `fonts.ts`

Cada llamada a `localFont()` emite su propio CSS, y ese CSS **no se sacude con
tree-shaking**: si todas las configuraciones vivieran en un mismo archivo, cualquier
página que importara una se llevaría el `@font-face` y el `<link rel=preload>` de
todas. Por eso hay un módulo por configuración, y las que comparten página
(`root.ts`, `barber.ts`, `edu.ts`) van juntas.

## Diferencia con lo de antes

`next/font/google` bajaba **todos** los subconjuntos (cyrillic, greek, vietnamese,
latin-ext…) y solo precargaba el declarado en `subsets: ["latin"]`. Aquí solo está el
latino. El contenido del sitio es español, que cabe entero en `latin`; un carácter
fuera de ese rango cae al tipo de respaldo en vez de renderizarse con la familia.
