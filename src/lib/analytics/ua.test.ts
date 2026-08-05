import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUserAgent } from "./ua";

// Detector ÚNICO de bots del repo: lo consumen /api/track y el conteo de clics
// de afiliados. Esta prueba fija el contrato de los dos lados peligrosos:
// el bot que NO debe contar y la persona que NO se puede perder.

const isBot = (ua: string) => parseUserAgent(ua).device === "bot";

test("bots de vista previa de enlaces", () => {
  const previewBots = [
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "WhatsApp/2.23.20.0 A",
    "WhatsApp/2.2148.7 N",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Slack-ImgProxy (+https://api.slack.com/robots)",
    "Twitterbot/1.0",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "Mozilla/5.0 (compatible; SkypeUriPreview Preview/0.5)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  ];
  for (const ua of previewBots) {
    assert.equal(isBot(ua), true, `debería ser bot: ${ua}`);
  }
});

test("crawlers, monitores y clientes HTTP de servidor", () => {
  const robots = [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "curl/8.4.0",
    "python-requests/2.31.0",
    "okhttp/4.12.0",
    "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
    "PostmanRuntime/7.36.0",
    "Java/1.8.0_292",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) HeadlessChrome/120.0.0.0 Safari/537.36",
  ];
  for (const ua of robots) {
    assert.equal(isBot(ua), true, `debería ser bot: ${ua}`);
  }
});

test("navegadores reales NO son bots", () => {
  const humans = [
    // Chrome de escritorio
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    // Safari en iPhone
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1",
    // Chrome en Android
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
    // Firefox
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    // Edge
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
  ];
  for (const ua of humans) {
    assert.equal(isBot(ua), false, `NO debería ser bot: ${ua}`);
  }
});

test("el navegador integrado de WhatsApp es una PERSONA, no el crawler", () => {
  // El fetcher de vista previa manda un UA que EMPIEZA por "WhatsApp/".
  // El navegador integrado lleva "WhatsApp/2.x" al final de un UA normal:
  // es alguien tocando el link desde el chat — en México, el camino más común.
  const inAppBrowser =
    "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.6.78 A";
  assert.equal(isBot(inAppBrowser), false);
  assert.equal(parseUserAgent(inAppBrowser).device, "mobile");

  assert.equal(isBot("WhatsApp/2.24.6.78 A"), true);
});

test("sin user-agent NO se asume bot", () => {
  // Un UA vacío no es señal suficiente: se cuenta (mejor un falso positivo
  // que perder un clic real).
  assert.equal(parseUserAgent("").device, "desktop");
  assert.equal(parseUserAgent(null).device, "desktop");
  assert.equal(parseUserAgent(undefined).device, "desktop");
});
