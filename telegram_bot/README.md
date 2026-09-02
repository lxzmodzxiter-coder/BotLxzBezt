# Curador multimedia para Telegram

Bot de Telegram construido con **Python 3.11+** y **aiogram 3.x**. Permite buscar videos públicos de YouTube y enlaces públicos de TikTok por tema o palabra clave, registrar las búsquedas en SQLite y consultar estadísticas mediante `/stats`.

## Funcionalidades

El comando `/start` muestra tres opciones: **YouTube**, **TikTok** y **Ambos**. Cada opción usa una máquina de estados finitos para solicitar la consulta y devolver hasta diez resultados. El modo mixto intenta equilibrar cinco resultados de cada plataforma y completa la lista con los resultados disponibles.

YouTube se consulta mediante `yt-dlp` en modo búsqueda, sin descargar contenido. TikTok se consulta mediante resultados públicos indexados por DuckDuckGo, porque no existe una API pública general de búsqueda que garantice resultados para cualquier consulta. Por esa razón, la disponibilidad y los metadatos de TikTok pueden variar.

Todas las búsquedas se registran en `bot_database.db` con el identificador de usuario, nombre de usuario, plataforma, consulta y fecha UTC. El cooldown predeterminado es de 15 segundos por usuario. Las peticiones están limitadas por un semáforo de concurrencia para evitar saturar el proceso.

## Instalación

Desde la raíz del repositorio:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r telegram_bot/requirements.txt
cp telegram_bot/.env.example telegram_bot/.env
```

Edita `.env` y configura el token obtenido mediante [@BotFather](https://t.me/BotFather):

```dotenv
BOT_TOKEN=123456789:REEMPLAZA_ESTE_VALOR
SQLITE_PATH=bot_database.db
COOLDOWN_SECONDS=15
MAX_CONCURRENT_SEARCHES=4
SEARCH_TIMEOUT_SECONDS=30
LOG_LEVEL=INFO
# Opcional. Vacío = /stats disponible para todos.
ADMIN_USER_IDS=123456789,987654321
```

No compartas el token ni subas `.env` al repositorio. Para iniciar el bot:

```bash
python -m telegram_bot.main
```

## Comandos y flujo

| Comando o acción | Resultado |
| --- | --- |
| `/start` | Muestra el menú principal y limpia el estado actual. |
| Botón YouTube | Solicita una consulta y devuelve hasta diez videos. |
| Botón TikTok | Solicita una consulta y devuelve hasta diez enlaces públicos indexados. |
| Botón Ambos | Combina resultados de las dos plataformas. |
| `/stats` | Devuelve el total histórico y el desglose por plataforma. |
| `/cancel` | Cancela la consulta pendiente. |

## Despliegue en un VPS o Railway

El proceso usa long polling, por lo que el servidor debe permanecer encendido mientras el bot esté operativo. Puede ejecutarse bajo `systemd`, Supervisor, Docker o Railway. Conserva `bot_database.db` en un volumen persistente si necesitas mantener el historial después de reinicios. En Railway, configura `BOT_TOKEN` y las demás variables desde el panel de Variables; no las guardes en Git.

## Consideraciones de producción

El bot solo trabaja con resultados y enlaces públicos. No inicia sesión, no descarga videos y no intenta evadir CAPTCHA, límites de servicio ni controles de acceso. Los resultados pueden cambiar según disponibilidad de red, indexación y modificaciones de las plataformas.

Si un proveedor bloquea temporalmente la consulta o cambia su respuesta, el bot captura la excepción, registra el detalle en los logs y devuelve un mensaje controlado al usuario. Conviene actualizar periódicamente `yt-dlp` y revisar los términos de uso de cada plataforma antes de operar a escala.
