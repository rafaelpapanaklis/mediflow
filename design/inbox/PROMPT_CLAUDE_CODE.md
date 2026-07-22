Implementa el rediseño de la pantalla **Inbox** de DaleControl reemplazando la actual.

En la carpeta `design_handoff_inbox/` tienes:
- `README.md` — especificación completa (tokens, layout, componentes, estados, interacciones). Es la fuente de verdad.
- `Inbox DaleControl.dc.html` + `support.js` — referencia visual hifi; ábrela en un navegador para compararte contra ella (no es código para copiar).

Instrucciones:
1. Explora primero el codebase: framework, librería de componentes, sistema de estilos y cómo está montada la pantalla actual del Inbox. Reutiliza los componentes y convenciones existentes (botones, inputs, badges, iconos Lucide, tema violeta #7c3aed).
2. Reemplaza SOLO esta pantalla. No cambies la navegación general del panel, rutas ajenas, ni el resto del producto.
3. Recrea pixel-perfect las 4 vistas del README: desktop 3 columnas (264/384/flex), estado vacío útil del panel derecho, y móvil lista→detalle (breakpoint ~768px).
4. Implementa los comportamientos: filtro SLA accionable (banner "2 esperando >20 min"), segmented Todos/Míos/Sin asignar, chips de canal, indicador bot activo/pausado por hilo con Reactivar/Pausar, notas internas (tab ámbar del composer, solo visibles para el equipo), plantillas rápidas, y bloqueo del texto libre cuando la ventana de 24h de WhatsApp está cerrada (solo plantillas).
5. Conecta con los datos/estados reales existentes del Inbox actual (conversaciones, canales, asignación, no leídos). Donde falte un dato (esperaMin, ventana24h, estadoBot), modela el estado según la sección "State Management" del README y déjalo listo para el backend real.
6. Textos en español neutro tal como aparecen en el README/referencia.
7. Criterio de aceptación: lado a lado con la referencia HTML abierta en el navegador, la implementación debe ser visualmente indistinguible en desktop 1440 y en 390px.
