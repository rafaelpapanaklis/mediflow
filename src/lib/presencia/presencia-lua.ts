/**
 * El script de Lua de la señal de «Clínicas en línea»: lo que antes eran ~11
 * comandos de Upstash (leer identidad, contar el límite, 5 escrituras de
 * presencia…) se hace con UNA llamada EVALSHA.
 *
 * Por qué una sola llamada y pocas operaciones DENTRO del script: la doc
 * oficial de Upstash cobra «por comando ejecutado» y la regla de si EVAL cuenta
 * una vez o una por cada redis.call de dentro no está fijada en la doc fusionada
 * (hay un PR abierto que dice «una»; la página de costos de su ratelimit cuenta
 * EVAL + INCR + PEXPIRE). Así que el script está hecho para ser barato en los
 * DOS casos: una señal en régimen normal hace GET + SET + ZADD dentro (3), no 8.
 *
 *   KEYS[1]  registro de la sesión  pres:s:<sesión>:<clínica de la cookie>
 *   KEYS[2]  índice                 pres:z   (zset: «clínica|usuario|<sesión>:<cookie>» → última señal)
 *   ARGV     1 ahora(ms) · 2 ttl(s) · 3 límite/min · 4 pantalla · 5 ventana(ms) · 6 sufijo del miembro
 *            7..10 clínica · usuario · cuenta("1"/"0") · nombre — SOLO si el servidor ya resolvió la identidad
 *   Devuelve {código, segundos}: 0 guardado · 1 falta la identidad · 2 no cuenta · 3 límite (segundos que faltan)
 *
 * La regla es la de `aplicarLatido` (presencia-core.ts), línea por línea: las
 * pruebas contra un Redis real comparan las dos. Sin cjson a propósito: el
 * registro es texto con «|».
 */
import { createHash } from "node:crypto";

export const SCRIPT_LATIDO = `
local ahora = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local limite = tonumber(ARGV[3])
local pantalla = ARGV[4]
local ventana = tonumber(ARGV[5])
local sufijo = ARGV[6]

local function partir(s)
  local f = {}
  local pos = 1
  for i = 1, 8 do
    local a = string.find(s, '|', pos, true)
    if not a then return nil end
    f[i] = string.sub(s, pos, a - 1)
    pos = a + 1
  end
  f[9] = string.sub(s, pos)
  return f
end

local clinica, usuario, cuenta, desde, ts, minuto, n, nombre
local crudo = redis.call('GET', KEYS[1])
local f = nil
if crudo then
  f = partir(crudo)
  if f then
    clinica = f[1]; usuario = f[2]; cuenta = f[3]
    desde = tonumber(f[4]); ts = tonumber(f[5]); minuto = tonumber(f[6]); n = tonumber(f[7]); nombre = f[9]
    if f[1] == '' or f[2] == '' or not (desde and ts and minuto and n) then f = nil end
  end
end

local m = math.floor(ahora / 60000)

if f then
  if cuenta ~= '1' then return {2, 0} end
else
  if ARGV[7] == nil or ARGV[7] == '' then return {1, 0} end
  clinica = ARGV[7]; usuario = ARGV[8]; cuenta = ARGV[9]; nombre = ARGV[10]
  desde = ahora; ts = 0; minuto = -1; n = 0
  if cuenta ~= '1' then
    redis.call('SET', KEYS[1], string.format('%s|%s|%s|%.0f|%.0f|%.0f|%d|%s|%s', clinica, usuario, cuenta, ahora, ahora, m, 1, pantalla, nombre), 'EX', ttl)
    return {2, 0}
  end
end

if minuto == m then
  if n >= limite then return {3, 60 - math.floor((ahora % 60000) / 1000)} end
  n = n + 1
else
  minuto = m
  n = 1
end
if ts == 0 or ahora - ts > ventana then desde = ahora end

redis.call('SET', KEYS[1], string.format('%s|%s|%s|%.0f|%.0f|%.0f|%d|%s|%s', clinica, usuario, cuenta, desde, ahora, minuto, n, pantalla, nombre), 'EX', ttl)
redis.call('ZADD', KEYS[2], ahora, clinica .. '|' .. usuario .. '|' .. sufijo)
return {0, 0}
`;

export const SHA_SCRIPT_LATIDO = createHash("sha1").update(SCRIPT_LATIDO).digest("hex");
