# Paquete de diseño — MediFlow

Este folder contiene el contexto completo del sistema de diseño para pasárselo a
Claude (claude.ai con artifacts) cuando quieras iterar diseño sin perder consistencia.

## Archivos

- **01-design-system.md** — tokens de color, tipografía, espaciado, radios, componentes base
- **02-sitemap.md** — todas las páginas del producto, jerarquía, props, features por rol
- **03-components-spec.md** — inventario detallado de componentes reutilizables
- **04-patterns.md** — patrones recurrentes (modales, tablas, forms, estados vacíos, loading)
- **globals.css** — copia del CSS real (tokens y utilities live aquí)

## Screenshots (tú los agregas)

MediFlow soporta **light mode y dark mode** como ciudadanos de primera clase.
Captura **cada página en AMBOS modos** para que Claude Design entienda cómo
se ve el producto en cada uno.

Crea una subcarpeta `screenshots/` y nombra los archivos así:

```
screenshots/
  01-dashboard-home-light.png
  01-dashboard-home-dark.png
  02-patients-list-light.png
  02-patients-list-dark.png
  03-patient-detail-light.png
  03-patient-detail-dark.png
  04-appointments-light.png
  04-appointments-dark.png
  05-billing-light.png
  05-billing-dark.png
  06-xrays-light.png
  06-xrays-dark.png
  07-ai-assistant-light.png
  07-ai-assistant-dark.png
  08-settings-light.png
  08-settings-dark.png
  09-admin-home-light.png
  09-admin-home-dark.png
  10-admin-clinics-light.png
  10-admin-clinics-dark.png
  11-mobile-sidebar-light.png    (opcional, viewport 390px)
  11-mobile-sidebar-dark.png     (opcional, viewport 390px)
```

**Para cambiar de modo rápido:** en el sidebar del dashboard hay un toggle
"Modo claro" / "Modo oscuro" abajo. Click, tomas captura, click, tomas
captura. Son 20 screenshots pero rápidos.

**Resolución:** cualquiera ≥1280px de ancho está bien. Retina/4K (~3000px)
funciona perfecto también.

## Cómo usarlo con Claude.ai (Project Knowledge)

1. Ve a https://claude.ai → **New Project** → nómbralo "MediFlow Design".
2. En **Project Knowledge**, sube los 5 archivos de esta carpeta + todos tus PNG.
3. En **Custom Instructions del proyecto**, pega:

    ```
    Trabajas en el diseño de MediFlow, SaaS para clínicas médicas en México.

    Antes de proponer cambios, lee 01-design-system.md para tokens exactos.
    Usa siempre las variables CSS (--bg, --brand, --text-1, etc) y las clases
    utility de globals.css (.card, .kpi, .btn-new--primary, etc). No inventes
    colores hex nuevos — todos vienen de tokens.

    Tipografía: Sora para UI, JetBrains Mono (.mono) para números/IDs/folios.

    IMPORTANTE — MediFlow soporta LIGHT MODE y DARK MODE como ciudadanos de
    primera clase. Ningún modo es "el default". Todo rediseño debe funcionar
    idéntico en ambos modos. En los screenshots verás sufijos -light y -dark
    para cada pantalla; usa ambas referencias. Si el usuario pide un rediseño
    sin especificar modo, entrega ambas variantes (light + dark) o describe
    cómo se verá cada uno.

    Cuando generes código usa Next.js 14 App Router + TypeScript + TailwindCSS.
    Lucide React para iconos. Los patrones de página, tabla, modal, wizard y
    empty state están en 04-patterns.md — síguelos.
    ```

4. En una conversación nueva dentro del proyecto, pide lo que quieras:
   *"Rediseña la página de /dashboard/billing respetando el sistema"* o
   *"Genera una pantalla nueva de /dashboard/prescripciones"*.
   El contexto ya está pre-cargado, **no** vuelves a subir nada.

## Actualización del paquete

Cuando hagas cambios grandes al design system (tokens, componentes nuevos),
regenera los .md correspondientes y re-súbelos al Project Knowledge (reemplaza
los viejos). Mantén `globals.css` sincronizado con el real.
