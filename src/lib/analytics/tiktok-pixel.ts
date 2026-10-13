// Píxel de TikTok — medición del SITIO PÚBLICO (ws1-t5, tanda ws7).
//
// «DaleControl Pixel», modo Pixel + Events API. El ID es público (viaja en claro
// al navegador), va como constante igual que META_PIXEL_ID y GA4_MEASUREMENT_ID.
// La regla de privacidad vive en isPrivatePath (@/lib/analytics/ga4): aquí no se
// duplica, solo se llama.
export const TIKTOK_PIXEL_ID = "DB6NHKJC77UDJT303SAG";

/** URL del SDK del píxel (con el código del píxel como parámetro, como el snippet oficial). */
export const TIKTOK_SDK_URL = "https://analytics.tiktok.com/i18n/pixel/events.js";
