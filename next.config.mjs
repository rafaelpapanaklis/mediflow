import { readFileSync } from "node:fs";

// ── frame-src del vertical INMUEBLES (recorridos 3D / 360 / video) ──────
// La allowlist de proveedores vive en UN SOLO archivo,
// src/lib/realty/tour-hosts.json, y desde ahí sirve para tres cosas:
//   (a) validar la URL que pega el asesor  (src/lib/realty/tours.ts)
//   (b) armar este frame-src               (aquí)
//   (c) detectar el proveedor y su tipo    (src/lib/realty/tours.ts)
// Es un .json y no un .ts porque este archivo es Node puro y no puede
// importar TypeScript; con los dominios copiados a mano, la CSP y el
// validador se desincronizan a la primera y nadie se entera.
//
// 🔴 Un iframe cuyo dominio no esté aquí sale EN BLANCO, sin un solo error
// en la consola. Se diagnostica mal siempre ("Matterport está caído").
//
// 🔴 try/catch OBLIGATORIO, por el mismo motivo que el lookup de auth.ts: este
// archivo lo evalúa `next build` Y `next start`. Si el .json se borra, se
// renombra o se malforma, un throw aquí NO rompe solo el vertical de
// inmuebles: tumba el arranque de TODA la aplicación, dental y barbería
// incluidos. Peor el remedio que la enfermedad. Si falla, se degrada a
// "sin proveedores de recorrido" (los tours salen en blanco, que es un
// problema de una pantalla) y se avisa en el log del build.
let REALTY_TOUR_FRAME_SRC = "";
try {
  const realtyTourHosts = JSON.parse(
    readFileSync(new URL("./src/lib/realty/tour-hosts.json", import.meta.url), "utf8"),
  );
  REALTY_TOUR_FRAME_SRC = (realtyTourHosts?.providers ?? [])
    .flatMap((p) => p?.domains ?? [])
    .filter((d) => typeof d === "string" && d.length > 0)
    .flatMap((d) => [`https://${d}`, `https://*.${d}`])
    .join(" ");
} catch (err) {
  console.warn(
    "[next.config] no se pudo leer src/lib/realty/tour-hosts.json; los recorridos 3D del vertical de inmuebles quedarán bloqueados por la CSP",
    err instanceof Error ? err.message : err,
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 ya no lee `eslint` de este archivo ni corre el lint en `next build`:
  // el lint es un gate manual (`npm run lint` = eslint directo).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  // Los .wasm de @cornerstonejs/dicom-codec (descompresion DICOM) se cargan en el
  // SERVIDOR con fs.readFileSync(__dirname + "/*.wasm"). Al no haber import estatico,
  // Next no los detecta como dependencia y los deja fuera del bundle de la funcion en
  // Vercel -> el endpoint /lite no puede decodificar CBCT comprimido (0 cortes, 500).
  // Los incluimos explicitamente en el trazado de archivos de ESA funcion. Desde
  // Next 15 es una opcion de primer nivel (en 14 vivia bajo `experimental`).
  outputFileTracingIncludes: {
    "/api/patients/[id]/dicom-set/[fileId]/lite": [
      "./node_modules/@cornerstonejs/**/*.wasm",
    ],
  },
  experimental: {
    // Las fotos clínicas (uploadClinicalPhotoAction, ficha v3) viajan como
    // server action con MAX_PHOTO_BYTES = 25MB; el default de Next (1MB)
    // rechazaba cualquier foto real de cámara (afectaba también a las
    // galerías de especialidades que ya usaban esta action). 30mb = 25MB
    // + margen de serialización. Solo sube el TOPE aceptado: cada action
    // sigue validando su propio tamaño.
    serverActions: {
      bodySizeLimit: "30mb",
    },
    // Caché del router en el cliente. Next 15 bajó `dynamic` de 30 s a 0: cada clic
    // en un <Link> a una página dinámica del panel volvería a pedir la página (y sus
    // consultas a la base) aunque se abriera hace 5 s. El pooler ya va justo
    // (medir-conexiones-base), así que se conservan los valores de Next 14: 30 s
    // para páginas dinámicas, 180 s para las estáticas. Atrás/adelante y layouts
    // compartidos no cambian.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    // (src/instrumentation.ts —apaga los cargadores HEIF y .vips de sharp— ya
    // no necesita `instrumentationHook`: desde Next 15 corre siempre.)
  },
  // Los codecs DICOM comprimidos (@cornerstonejs/dicom-codec -> glue Emscripten de
  // OpenJPEG/CharLS/libjpeg-turbo, que descomprime JPEG2000/JPEG-LS/HTJ2K/RLE en el
  // Web Worker del visor CBCT) llevan require("fs")/require("path") detras de un
  // guard ENVIRONMENT_IS_NODE que JAMAS corre en el navegador. En el bundle de
  // cliente esos builtins no existen -> los resolvemos a `false` (modulo vacio) para
  // que webpack no falle al compilar el chunk. Solo cliente: el build de servidor
  // conserva fs/path reales (no se tocan).
  webpack: (config, { isServer, dev }) => {
    // MEMORIA DEL BUILD (ws1-t5, encargo 8): sin la caché persistente de webpack en el
    // build de producción. Esa caché (.next/cache/webpack) pesaba ~7 GB solo la del
    // servidor y se serializa en memoria al final de compilar: medido el 5-oct-2026 con
    // 8 CPU, el pico del build pasaba de 21.3 GB (proceso + hijos) a 11.4 GB, y además
    // compila MÁS rápido (972 s → 806 s en frío), porque ya no escribe esos 7 GB. El
    // resultado (.next/server, .next/static) es el mismo. En `next dev` no cambia nada.
    // Vercel guarda .next/cache entre builds: sin esta caché, cada build compila como
    // si fuera en frío (es lo que ya pasaba al cambiar de máquina o invalidarse).
    if (!dev) config.cache = false;
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
      };
    }
    return config;
  },
  // Turbopack (opcional, hoy NO se usa: `npm run build` fija --webpack, ver
  // scripts/build-con-memoria.cjs). Es el equivalente del `resolve.fallback` de la
  // función `webpack` de arriba, para poder cambiar de empaquetador quitando solo el
  // `--webpack` del lanzador. Medido el 12-oct-2026: build en frío 435 s con
  // Turbopack contra 890 s con webpack (misma máquina de 56 CPU).
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/lib/modulo-vacio.ts" },
      path: { browser: "./src/lib/modulo-vacio.ts" },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // SAMEORIGIN (antes DENY): permite el self-framing que necesita el visor del
          // heatmap (/admin/analytics embebe páginas PROPIAS en un <iframe> para dibujar
          // los clicks encima del layout real). Sigue bloqueando el enmarcado por terceros
          // (clickjacking): sólo nuestro propio origen puede enmarcarnos.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          {
            key: "Permissions-Policy",
            value: 'camera=(self "https://*.daily.co"), microphone=(self "https://*.daily.co"), geolocation=()',
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // cdn.livechatinc.com / *.livechatinc.com / *.livechat-static.com = chat de LiveChat de la
              // portada y el blog (tracking.js + iframe del widget en secure.livechatinc.com). Sus llamadas
              // (https + wss a api.livechatinc.com) e imágenes ya caben en connect-src / img-src.
              // googleadservices/googleads.g.doubleclick = tag de conversiones de Google Ads (gtag ya permitido vía googletagmanager).
              // connect.facebook.net = SDK JS de Meta (WhatsApp Embedded Signup: botón "Conectar WhatsApp").
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://www.paypal.com https://www.paypalobjects.com https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://cdn.livechatinc.com https://*.livechatinc.com https://*.livechat-static.com https://connect.facebook.net",
              // LiveChat también en style-src / font-src: hojas y fuentes del widget.
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.livechatinc.com https://*.livechat-static.com",
              "font-src 'self' https://fonts.gstatic.com data: https://*.livechatinc.com https://*.livechat-static.com",
              "img-src 'self' data: blob: https: http:",
              "media-src 'self' blob: https:",
              // blob: = el runtime de Spline (robot 3D del /login) arranca sus
              // Web Workers con new Worker(URL.createObjectURL(new Blob(...))):
              // decodificador Draco/meshopt, navmesh y ordenador de splats.
              // Sin worker-src caen en default-src 'self' y el navegador los
              // bloquea EN SILENCIO -> escena negra sin error de JS.
              "worker-src 'self' blob:",
              "connect-src 'self' https: wss:",
              // td.doubleclick / googleads.g.doubleclick = iframes del tag de conversiones de Google Ads.
              // www.facebook.com / staticxx.facebook.com = iframe de comunicación del SDK de Meta (xd_arbiter); sin esto el popup del Embedded Signup no puede devolver el resultado.
              // REALTY_TOUR_FRAME_SRC = recorridos 3D/360/video del vertical de
              // inmuebles (Matterport, Kuula, CloudPano, EyeSpy360, GoIGuide, Luma,
              // Scaniverse, YouTube, Vimeo). Se arma arriba desde
              // src/lib/realty/tour-hosts.json: para dar de alta un proveedor nuevo
              // se edita ESE archivo y nada más — aquí no se escribe ningún dominio.
              `frame-src 'self' https://js.stripe.com https://www.paypal.com https://www.google.com https://td.doubleclick.net https://googleads.g.doubleclick.net https://daily.co https://*.daily.co https://*.livechatinc.com https://*.livechat.com https://www.facebook.com https://staticxx.facebook.com ${REALTY_TOUR_FRAME_SRC}`,
              // 'self' (antes 'none'): equivalente moderno de X-Frame-Options SAMEORIGIN.
              // Habilita el iframe same-origin del visor de heatmap; terceros siguen sin poder enmarcar.
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      // Dientes 3D del odontograma y su decodificador Draco: caché de un año, inmutable.
      // Sin esto Vercel sirve `public/` con `max-age=0, must-revalidate` y el navegador
      // revalida cada .glb (un viaje por diente). Es seguro porque el contenido va versionado:
      //   · los .glb se piden con `?v=MODEL_VERSION` (tooth3d-model.ts): al cambiarlos se sube la versión;
      //   · el decodificador no admite query: si cambia, se renombra la carpeta public/odontograma/draco/.
      // Dos entradas exactas (no `/odontograma/:path*`): solo estas dos carpetas son inmutables.
      // Se suman a la de `/:path*` de arriba (CSP y demás), no la sustituyen: aquí solo va Cache-Control.
      {
        source: "/odontograma/dientes-3d/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/odontograma/draco/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};
export default nextConfig;
