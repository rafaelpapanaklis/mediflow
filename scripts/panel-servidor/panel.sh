#!/usr/bin/env bash
# Panel dental TEMPORAL en el servidor de Rafael (WS1-T1, 15-sep-2026).
#
# Sirve una carpeta del repo con `next dev` en 127.0.0.1:$PANEL_PUERTO; Caddy la
# publica en https://panel.108-181-149-130.sslip.io. Lo arranca systemd de
# usuario (panel-dental.service) y lo vigila panel-dental-vigia.timer.
#
#   panel.sh instalar   copia este script y las unidades a ~/.config y enciende
#   panel.sh preparar   node_modules propio (enlaces al del clon + Prisma propio)
#   panel.sh arrancar   lo que ejecuta systemd; no lo corras a mano con él vivo
#   panel.sh vigia      si no contesta en 90 s, reinicia el servicio
#
# Credenciales: copia del .env de Rafael en ~/.config/panel-dental/.env (fuera del
# repo). Logs: ~/.local/state/panel-dental/panel.log. Qué carpeta se sirve:
# ~/.config/panel-dental/panel.conf. Con el servicio vivo NO corras `next build`
# en esa carpeta: comparten `.next` y se rompen los dos.
#
# ⛔ Nada de esto toca la base: ni migraciones, ni `db push`, ni SQL.
#    `prisma generate` solo escribe código en node_modules/.prisma de la carpeta.
set -euo pipefail

CONF="$HOME/.config/panel-dental/panel.conf"
[ -f "$CONF" ] && . "$CONF"
PANEL_DIR="${PANEL_DIR:-$HOME/work/mediflow-worktrees/infra/panel-en-servidor}"
PANEL_PUERTO="${PANEL_PUERTO:-3300}"
CLON="${CLON:-$HOME/work/mediflow}"
LOGS="$HOME/.local/state/panel-dental"
ENV_PANEL="$HOME/.config/panel-dental/.env"

log() { echo "[panel $(date '+%F %T')] $*"; }

# node_modules de la carpeta servida: un enlace por paquete al del clon, salvo
# @prisma/client y .prisma, que son copias propias. Motivo: el cliente de Prisma
# del clon lo regenera cualquier terminal que haga build en su rama, y un
# `next dev` que vive horas no puede cambiar de esquema por debajo.
preparar() {
  local nm="$PANEL_DIR/node_modules" src="$CLON/node_modules"
  [ -d "$src/next" ] || { log "no hay $src/next: falta npm install en el clon"; exit 1; }
  # Si es el enlace de siempre (worktree), se quita SOLO el enlace, nunca el destino.
  [ -L "$nm" ] && rm "$nm"
  mkdir -p "$nm/@prisma" "$nm/.cache"
  local e
  for e in "$src"/* "$src"/.bin "$src"/.package-lock.json; do
    case "$(basename "$e")" in @prisma|.prisma|.cache) continue ;; esac
    ln -sfn "$e" "$nm/$(basename "$e")"
  done
  for e in "$src"/@prisma/*; do
    [ "$(basename "$e")" = client ] && continue
    ln -sfn "$e" "$nm/@prisma/$(basename "$e")"
  done
  # Paquetes que desaparecieron del clon dejan enlaces rotos: fuera.
  find "$nm" "$nm/@prisma" -maxdepth 1 -xtype l -delete
  [ -d "$nm/@prisma/client" ] && [ ! -L "$nm/@prisma/client" ] || {
    rm -f "$nm/@prisma/client"
    cp -a "$src/@prisma/client" "$nm/@prisma/client"
  }
  # Prisma reformatea el esquema al copiarlo, así que no sirve compararlo con el
  # generado: se guarda la huella del de origen tras cada generate.
  local huella; huella="$(sha256sum "$PANEL_DIR/prisma/schema.prisma" | cut -d' ' -f1)"
  if [ "$(cat "$nm/.prisma/.huella-esquema" 2>/dev/null)" != "$huella" ]; then
    log "esquema cambiado: prisma generate (solo código, no toca la base)"
    (cd "$PANEL_DIR" && "$nm/.bin/prisma" generate)
    echo "$huella" >"$nm/.prisma/.huella-esquema"
  fi
}

arrancar() {
  mkdir -p "$LOGS"
  local archivo="$LOGS/panel.log"
  # Rotación mínima: al arrancar, si pasa de 50 MB se guarda como .1.
  if [ -f "$archivo" ] && [ "$(stat -c %s "$archivo")" -gt 52428800 ]; then
    mv -f "$archivo" "$archivo.1"
  fi
  exec >>"$archivo" 2>&1
  log "arrancando: carpeta=$PANEL_DIR puerto=$PANEL_PUERTO rama=$(git -C "$PANEL_DIR" branch --show-current 2>/dev/null || echo '?')"
  cd "$PANEL_DIR"
  preparar
  # El .env (copia del de Rafael) vive SOLO en ~/.config/panel-dental/.env y se
  # enlaza aquí. No va en el clon principal: ahí lo leería cualquier terminal
  # que trabaje en main y se conectaría a producción sin saberlo.
  if [ ! -e .env ] && [ ! -L .env ]; then ln -s "$ENV_PANEL" .env; fi
  if [ ! -e .env ]; then
    log "⚠️  SIN .env: la página abre, pero entrar al panel falla hasta que exista $ENV_PANEL"
  fi
  export NODE_OPTIONS="--max-old-space-size=8192"
  export NEXT_TELEMETRY_DISABLED=1
  exec "$PANEL_DIR/node_modules/.bin/next" dev -H 127.0.0.1 -p "$PANEL_PUERTO"
}

# Cualquier respuesta HTTP (aunque sea 404) cuenta como vivo; 000 = colgado o caído.
vigia() {
  systemctl --user is-active --quiet panel-dental.service || exit 0
  # Recién arrancado puede estar aún generando Prisma: se le dan 3 minutos.
  local desde
  desde="$(systemctl --user show -p ActiveEnterTimestampMonotonic --value panel-dental.service)"
  [ $(( $(awk '{print int($1*1000000)}' /proc/uptime) - desde )) -lt 180000000 ] && exit 0
  local codigo
  codigo="$(curl -s -o /dev/null -w '%{http_code}' -m 90 "http://127.0.0.1:$PANEL_PUERTO/b3f7a1c25e8d4a069c14f2d873be560a.txt" || true)"
  if [ "$codigo" = "000" ]; then
    mkdir -p "$LOGS"
    log "vigía: sin respuesta en 90 s, reinicio" >>"$LOGS/panel.log"
    systemctl --user restart panel-dental.service
  fi
}

instalar() {
  local aqui; aqui="$(cd "$(dirname "$0")" && pwd)"
  mkdir -p "$HOME/.config/panel-dental" "$HOME/.config/systemd/user" "$LOGS"
  install -m 755 "$aqui/panel.sh" "$HOME/.config/panel-dental/panel.sh"
  [ -f "$CONF" ] || cat >"$CONF" <<EOF
# Qué carpeta del repo enseña https://panel.108-181-149-130.sslip.io
# Cambias la ruta y luego: systemctl --user restart panel-dental
PANEL_DIR=$PANEL_DIR
PANEL_PUERTO=$PANEL_PUERTO
EOF
  cp "$aqui"/panel-dental.service "$aqui"/panel-dental-vigia.service "$aqui"/panel-dental-vigia.timer \
    "$HOME/.config/systemd/user/"
  systemctl --user daemon-reload
  systemctl --user enable --now panel-dental.service panel-dental-vigia.timer
}

case "${1:-}" in
  preparar) preparar ;;
  arrancar) arrancar ;;
  vigia) vigia ;;
  instalar) instalar ;;
  *) echo "uso: $0 instalar|preparar|arrancar|vigia" >&2; exit 2 ;;
esac
