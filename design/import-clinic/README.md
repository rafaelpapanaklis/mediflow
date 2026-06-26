# DaleControl — Módulo "Importar mi clínica"

Prototipo navegable de alta fidelidad (HTML + CSS + JS vanilla, **sin frameworks**).
Diseño puro listo para traducir a componentes de Next.js 14.

---

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | **Prototipo navegable.** Lanzador + wizard completo paso a paso + toggle de tema light/dark. |
| `estados.html` | **Galería de estados.** Cada pantalla y estado alterno, mostrado en light **y** dark lado a lado, más vistas móviles. |
| `styles.css` | Todos los tokens (CSS variables, ambos temas) y componentes reutilizables. |
| `app.js` | Lógica del prototipo navegable (máquina de pasos, validaciones de UI, simulaciones). |
| `estados.js` | Render de la galería de estados (reutiliza los mismos componentes). |

> Abre `index.html` en cualquier navegador. No requiere servidor ni dependencias.

---

## Mapa pantalla → paso del flujo

El flujo del wizard es: **1 Origen → 2 Exportar → 3 Qué importar → 4 Subir → 5 Mapear → 6 Revisar → (Importando) → Resultado**, con un desvío opcional a **Migración asistida**.

| ID | Pantalla | Paso | Dónde se ve | Notas |
|---|---|---|---|---|
| **A** | Lanzador / estado vacío de "Pacientes" | — | `index.html` (inicio) · `estados.html` §A | Cabecera con botón "Importar mi clínica" + estado vacío (0 pacientes) con CTA grande. |
| **B** | Origen | Paso 1 | wizard · §B | Grid de 11 tarjetas seleccionables + banner de migración asistida. |
| **C.1** | Cómo exportar — Dentalink | Paso 2 | wizard · §C | Instrucciones numeradas específicas del sistema. |
| **C.2** | Cómo exportar — Mi Excel | Paso 2 | wizard · §C | Botón "Descargar plantilla" en lugar de instrucciones. |
| **D** | Qué importar | Paso 3 | wizard · §D | Checkboxes con badges Recomendado / Fácil / Avanzado. |
| **E** | Subir | Paso 4 | wizard · §E | Dropzone en 4 estados: vacío, arrastrando, cargado, error. |
| **F.1** | Mapear (automático) | Paso 5 | wizard · §F | Columnas pre-resueltas por el perfil del sistema. |
| **F.2** | Mapear (manual) | Paso 5 | §F | Sin perfil ("Mi Excel" / "Otro"): mapeo a mano, marca columnas sin mapear. |
| **G** | Revisar | Paso 6 | wizard · §G | 3 stat-cards (Válidos / Errores / Duplicados) + tabla con badges y motivo de error en hover + toggle "Omitir duplicados". |
| **H** | Importando | — | wizard · §H | Barra de progreso animada. |
| **I** | Resultado | — | wizard · §I | Resumen de éxito + descarga de reporte de errores + CTAs. |
| **J.1 / J.2** | Migración asistida | — | wizard · §J | Subir archivo + nota de privacidad → estado "En revisión, 48 h". |
| **K** | Responsive móvil | 1, 5, 6 | `estados.html` §K | Los pasos más densos a ~360px. |
| **L** | Light **y** dark | todas | toggle en `index.html` · pares en `estados.html` | Todo vía CSS variables; ningún color hardcodeado por tema. |

---

## Cómo el Paso 1 reconfigura el resto

El sistema de origen elegido en el Paso 1 cambia dos pasos posteriores:

- **Paso 2 (Exportar):** sistemas con perfil (Dentalink, Open Dental, etc.) muestran **instrucciones numeradas**. "Mi Excel" / "Otro" muestran un botón **"Descargar plantilla"**.
- **Paso 5 (Mapear):** con perfil, las columnas llegan **auto-mapeadas** (estado "Automático"); sin perfil, el mapeo es **manual** y las columnas sin asignar se marcan en ámbar.

---

## Notas de interacción

- **Navegación:** botones *Atrás / Continuar* en el pie. La barra de pasos arriba siempre marca el progreso (✓ completados, número actual resaltado).
- **Validaciones de avance (solo UI):**
  - Paso 1 no avanza sin un origen elegido.
  - Paso 4 no avanza sin un archivo válido cargado.
- **Dropzone:** acepta clic, teclado (Enter/Espacio) y drag & drop. Rechaza formatos ≠ `.xlsx`/`.csv` y archivos > 5 MB mostrando el estado de error.
- **Mapeo:** cambiar un select actualiza el estado de la fila (Automático → Manual → Sin mapear).
- **Revisar:** el badge de cada fila con error/duplicado muestra el **motivo al pasar el cursor** (o con foco de teclado). El toggle "Omitir duplicados" es funcional a nivel de estado.
- **Importando:** progreso simulado (~3–4 s) que desemboca en el Resultado.
- **Migración asistida:** accesible desde el estado vacío, el banner del Paso 1 y el callout; al enviar muestra el acuse "En revisión por el equipo, te avisamos en 48 h".
- **Tema:** el toggle light/dark persiste en `localStorage`. Todo el color se resuelve por CSS variables, así que ambos temas funcionan solos.

---

## Accesibilidad

- Foco visible (`:focus-visible`) en todos los controles.
- `aria-pressed` en las tarjetas de origen; `aria-modal` / `role="dialog"` en el wizard; `aria-label` en inputs e íconos de acción.
- Cierre del modal con `Esc` y clic en el backdrop.
- Contraste AA en texto sobre fondos en ambos temas.
- Navegación por teclado en dropzone y selects nativos.

---

## Para el equipo de Next.js

Las clases siguen una convención portable a componentes: `.btn` / `.btn--brand` / `.btn--soft`, `.badge` (+ `--ok` / `--err` / `--warn` / `--brand`), `.modal`, `.table`, `.stat-card`, `.dropzone`, `.src-card`, `.opt`, `.stepbar` / `.step`, `.select`, `.switch`.

Todos los colores, radios y elevaciones están en CSS variables al inicio de `styles.css` (`:root` para light, `.dark` para dark). La marca violeta `#7c3aed` es fija en ambos temas. El semáforo (éxito / error / advertencia) tiene tonos calibrados para cada tema.

**Fuera de alcance:** este es diseño de UI; no hay backend, parsing real de archivos ni persistencia de datos. Las cifras, filas y validaciones son de muestra.
