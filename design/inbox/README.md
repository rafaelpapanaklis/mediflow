# Handoff: Rediseño del Inbox unificado — DaleControl

## Overview
Rediseño de la pantalla **Inbox** de DaleControl (SaaS de gestión para clínicas dentales/médicas en México). Inbox unificado multicanal (WhatsApp como canal principal, Email, Formulario web, Validación, Recordatorios, Portal del paciente) con bot de IA que responde solo y se pausa cuando un humano toma la conversación. Usuarios: recepcionistas y doctores, todo el día.

## About the Design Files
Los archivos de este paquete son **referencias de diseño hechas en HTML** (prototipo de look & feel), NO código de producción para copiar tal cual. La tarea es **recrear estas pantallas dentro del entorno existente del codebase de DaleControl** (su framework, librería de componentes y convenciones actuales). No introduzcas navegación nueva del panel: solo se rediseña esta pantalla.

Para ver la referencia: abre `Inbox DaleControl.dc.html` en un navegador (mantén `support.js` en la misma carpeta). Contiene 4 vistas en un lienzo:
- **1a** Desktop 1440 px — 3 columnas con conversación de WhatsApp abierta
- **1b** Panel derecho — estado vacío útil (resumen del día)
- **1c** Móvil 390 px — lista
- **1d** Móvil 390 px — conversación abierta

## Fidelity
**High-fidelity (hifi).** Colores, tipografía, espaciados, radios y copys son finales. Recrear pixel-perfect usando los componentes/patrones existentes del codebase.

## Design Tokens
Tipografía: stack del sistema `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`. Si el panel ya usa una web font (p. ej. Inter), úsala — el diseño está pensado para una sans neutra; equivalente recomendado: **Inter**.

Colores:
- Violeta primario `#7c3aed` · hover `#6d28d9` · suave `#f3eefe` / `#ede9fe` · texto sobre suave `#6d28d9`
- Texto: primario `#18181b`, secundario `#3f3f46`/`#52525b`, muted `#71717a`, placeholder `#a1a1aa`
- Bordes: `#ebebf0` / `#e7e6ec` / hairline filas `#f2f1f5` · Fondos: app `#fafafa`, chat `#f5f4f8`, inputs `#f4f4f5`
- SLA/urgente: rojo `#dc2626`/`#b91c1c`, bg `#fef2f2`, borde `#fecaca`
- Bot activo (teal): `#0d9488`/`#0f766e`, bg `#ccfbf1`
- Nota interna / bot pausado (ámbar): `#b45309`/`#92400e`, bg `#fffbeb`/`#fef3c7`, borde `#fde68a`
- Ventana 24h abierta (verde): `#15803d`, bg `#f0fdf4`, borde `#dcfce7`
- Canales: WhatsApp `#22c55e` · Email `#ef4444` · Formulario `#3b82f6` · Validación `#f59e0b` · Recordatorio `#8b5cf6` · Portal `#06b6d4`

Radios: cards/frames 16–20 px, filas/botones 10–12 px, pills 999. Iconos: outline estilo Lucide, stroke 2. Sombra botón primario: `0 2px 8px rgba(124,58,237,.3)`. Composer: `0 8px 24px rgba(24,24,27,.08)`.

## Screens / Views

### 1a · Desktop (1440, grid 264px | 384px | 1fr)
**Top bar (56px, blanca, borde inferior):** hamburguesa, breadcrumb "Rafael Clínica › Inbox", buscar, campana con dot rojo, avatar. El chip SLA ya NO vive aquí (se integró a la lista).

**Col 1 — Sidebar (264px, blanca):** logo Inbox; botón primario "Componer" (violeta, kbd C); CARPETAS: Bandeja de entrada (activa, badge violeta 6), Pospuestos ("2 hoy"), Enviados, Archivados; CANALES con dot de color y contador; ASIGNADO A: Mis mensajes (2), Sin asignar (badge ámbar 2); footer con usuario.

**Col 2 — Lista (384px):**
- Título "Bandeja de entrada" + "8 conversaciones · 6 sin leer" + botón filtro.
- **Banner SLA accionable** (bg rojo suave, radio 12): reloj + "2 esperando respuesta / más de 20 min sin contestar" + botón "Filtrar" → al hacer clic filtra la lista a esos hilos.
- Search; **segmented control** Todos·8 / Míos·2 / Sin asignar·2; chips de canal con dot.
- **Fila de conversación** (padding 11×16, hairline): avatar 44 con iniciales sobre gradiente + badge de canal 18px (esquina inf. der., borde blanco 2px); fila 1: nombre (700 si no leído, si no 600) + hora relativa (o chip rojo "32 min" con reloj si espera >20m); fila 2: preview 12.5px truncado + chips de estado: "Sin atender" (ámbar, icono pausa) / "Bot activo" (teal, icono bot) / humano ("Dra. Sofía", violeta, icono persona) + contador no leídos (pill violeta 18px).
- Fila seleccionada: bg `#f5f1fe` + inset 3px violeta a la izquierda.
- Footer fijo: "2 pospuestos vuelven hoy · Ver".

**Col 3 — Conversación abierta:**
- Header 64px: avatar, nombre + tag ORTODONCIA (pill violeta suave), sub "WhatsApp · +52 55 4821 7736 · Última visita: 24 jun"; acciones: posponer (reloj), asignar (user-plus), **Resolver** (primario violeta con check), ⋯.
- **Strip de estado** (blanca, borde inf.): izquierda pill ámbar "Bot en pausa — atiende Dra. Sofía" + botón "Reactivar bot"; derecha pill verde "Ventana de 24 h abierta" (dot con pulso). Estados alternos: bot activo → pill teal "DaleBot responde en automático" + "Pausar bot"; ventana cerrada → pill roja.
- **Mensajes** (bg `#f5f4f8`): separadores de día (pill gris); paciente = burbuja blanca izquierda (radio 4/14/14/14); bot = burbuja violeta suave `#ede9fe` derecha con label "DaleBot · respuesta automática"; evento de sistema centrado (pill ámbar "Dra. Sofía tomó la conversación — el bot se pausó · 9:31 a.m."); **nota interna** = card ámbar centrada (82%, borde punteado, icono candado, autor/hora, pie "Solo visible para el equipo"); humano desde panel = burbuja violeta sólida `#7c3aed` blanca con label "Dra. Sofía Navarro · desde el panel"; humano desde celular = burbuja `#f5f3ff` con borde `#ddd6fe` y label con icono teléfono "Ana Reyes · desde el celular de la clínica". Checks dobles estilo WhatsApp (azul `#60a5fa` = leído).
- **Composer** (card flotante, radio 16): strip superior de ventana 24h (verde "cierra mañana a las 10:02 a.m." / roja "solo plantillas aprobadas" + "Ver plantillas"); tabs **Respuesta** (violeta) / **Nota interna** (ámbar, candado); fila de plantillas rápidas (⚡ Plantillas: Confirmación de cita, Ubicación del consultorio, Indicaciones post-ajuste); textarea; iconos adjuntar/emoji/audio/agendar; hint "⏎ para enviar"; botón **Enviar**. Modo nota: fondo `#fffbeb`, "@ Mencionar a alguien del equipo", botón ámbar "Guardar nota". Fuera de ventana: aviso rojo y texto libre deshabilitado.

### 1b · Estado vacío del panel derecho
Saludo "Buenos días, Ana" + fecha/clínica; 3 stat-cards: **2 esperando respuesta** (rojo, CTA "Abrir la más antigua →"), **14 resueltas hoy** ("ayer a esta hora: 9"), **5 con el bot en automático** (CTA "Supervisar →"); card "Necesitan atención ahora" con las 2 conversaciones en espera y botón "Abrir"; pie "o selecciona una conversación de la lista".

### 1c/1d · Móvil 390 (patrón lista → detalle, una columna)
Lista: app bar (menú, Inbox, buscar, avatar), banner SLA compacto, segmented, mismas filas condensadas, footer pospuestos, FAB violeta componer. Detalle: back + avatar + nombre + sub "WhatsApp · Bot en pausa · Dra. Sofía", strip ámbar de bot con "Reactivar", mensajes (mismos estilos), strip verde de ventana, tabs Respuesta/Nota, chips de plantillas, input pill + botón enviar circular 42px.

## Interactions & Behavior
- Banner SLA "Filtrar" → filtra la lista a hilos esperando >20 min (toggle; mostrar estado activo y forma de limpiar).
- Segmented Todos/Míos/Sin asignar y chips de canal → filtran la lista.
- Seleccionar fila → abre conversación (móvil: navega a detalle, back regresa).
- "Reactivar bot"/"Pausar bot" → alterna estado del bot en el hilo; al enviar una respuesta humana con bot activo, el bot se pausa y se inserta el evento de sistema.
- Tabs del composer alternan respuesta/nota interna (la nota se guarda en el hilo, visible solo para el equipo, estilo ámbar).
- Ventana 24h: si cerrada, deshabilitar texto libre y solo permitir plantillas.
- Chips de plantilla → insertan el texto de la plantilla en el textarea.
- Hovers: filas bg `#f8f7fb`; botones violeta → `#6d28d9`; iconos → bg `#f4f4f5`.
- Dot de "en línea"/pulso: animación opacity 1→.35, 2s infinite.

## State Management
- Lista: colección de conversaciones {canal, paciente, preview, hora, noLeidos, estadoBot: activo|pausado|sinAtender, asignadoA, esperaMin, tags, pospuestoHasta}.
- Filtros activos: carpeta, canal[], asignación (todos|míos|sinAsignar), slaFilter:boolean, búsqueda.
- Conversación abierta: mensajes {autor: paciente|bot|staffPanel|staffCelular, texto, hora, leído} + eventos de sistema + notas internas; botPausado:boolean; ventana24h {abierta:boolean, cierraEn}.
- Composer: modo respuesta|nota, texto.

## Assets
Sin imágenes. Iconos: Lucide outline (inbox, clock, send, archive, message-circle, mail, file-text, shield-check, bell, user, user-plus, user-x, bot, pause, play, check, check-check, lock, zap, paperclip, smile, mic, calendar-plus, more-horizontal, filter, search, phone, chevron-right, arrow-left, plus, menu). Avatares = iniciales sobre gradientes.

## Files
- `Inbox DaleControl.dc.html` — referencia de diseño (abrir en navegador junto a `support.js`)
- `support.js` — runtime necesario solo para visualizar la referencia (no portar al codebase)
- `PROMPT_CLAUDE_CODE.md` — prompt listo para pegar en Claude Code
