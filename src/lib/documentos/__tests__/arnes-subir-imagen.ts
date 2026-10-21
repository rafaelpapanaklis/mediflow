// Arnés para Chromium (subir-imagen-chromium.test.ts): deja el ayudante REAL
// del navegador en `window` para que la prueba lo llame con archivos de verdad.
import { ErrorImagenDocumento, SubidaImagenCancelada, subirImagenDocumento } from "../subir-imagen.client";

Object.assign(window as unknown as Record<string, unknown>, { subirImagenDocumento, ErrorImagenDocumento, SubidaImagenCancelada });
