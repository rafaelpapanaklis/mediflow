/** @type {import('next').NextConfig} */
const nextConfig = {
  // El lint corre como gate manual (`npm run lint`); no se acopla a `next build`
  // para no romper la build de produccion con deuda de lint preexistente.
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  // Los .wasm de @cornerstonejs/dicom-codec (descompresion DICOM) se cargan en el
  // SERVIDOR con fs.readFileSync(__dirname + "/*.wasm"). Al no haber import estatico,
  // Next no los detecta como dependencia y los deja fuera del bundle de la funcion en
  // Vercel -> el endpoint /lite no puede decodificar CBCT comprimido (0 cortes, 500).
  // Los incluimos explicitamente en el trazado de archivos de ESA funcion (Next 14).
  experimental: {
    outputFileTracingIncludes: {
      "/api/patients/[id]/dicom-set/[fileId]/lite": [
        "./node_modules/@cornerstonejs/**/*.wasm",
      ],
    },
  },
  // Los codecs DICOM comprimidos (@cornerstonejs/dicom-codec -> glue Emscripten de
  // OpenJPEG/CharLS/libjpeg-turbo, que descomprime JPEG2000/JPEG-LS/HTJ2K/RLE en el
  // Web Worker del visor CBCT) llevan require("fs")/require("path") detras de un
  // guard ENVIRONMENT_IS_NODE que JAMAS corre en el navegador. En el bundle de
  // cliente esos builtins no existen -> los resolvemos a `false` (modulo vacio) para
  // que webpack no falle al compilar el chunk. Solo cliente: el build de servidor
  // conserva fs/path reales (no se tocan).
  webpack: (config, { isServer }) => {
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
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
              // embed.tawk.to / *.tawk.to = livechat Tawk.to de la landing (script + iframe + fuentes).
              // googleadservices/googleads.g.doubleclick = tag de conversiones de Google Ads (gtag ya permitido vía googletagmanager).
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://www.paypal.com https://www.paypalobjects.com https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://embed.tawk.to https://*.tawk.to",
              // *.tawk.to también en style-src: el widget carga sus CSS desde embed.tawk.to (sin esto no monta).
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://embed.tawk.to https://*.tawk.to",
              "font-src 'self' https://fonts.gstatic.com data: https://*.tawk.to",
              "img-src 'self' data: blob: https: http:",
              "media-src 'self' blob: https:",
              "connect-src 'self' https: wss:",
              // td.doubleclick / googleads.g.doubleclick = iframes del tag de conversiones de Google Ads.
              "frame-src 'self' https://js.stripe.com https://www.paypal.com https://www.google.com https://td.doubleclick.net https://googleads.g.doubleclick.net https://daily.co https://*.daily.co https://*.tawk.to",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};
export default nextConfig;
