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
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://www.paypal.com https://www.paypalobjects.com https://www.googletagmanager.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: blob: https: http:",
              "media-src 'self' blob: https:",
              "connect-src 'self' https: wss:",
              "frame-src 'self' https://js.stripe.com https://www.paypal.com https://www.google.com https://daily.co https://*.daily.co",
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
