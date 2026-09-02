# Sistema interno de tickets Telegram

Este módulo añade un bot construido con **Python y aiogram 3** para un entorno interno de pruebas. Incluye dos módulos: **Suspender cuenta** y **Reactivar cuenta**, ambos orientados a generar paquetes administrativos locales.

El bot está deliberadamente limitado a la generación de borradores revisables. No envía correos, no llama a una API de WhatsApp, no genera reportes duplicados o masivos y no convierte acusaciones no verificadas en hechos. El titular debe completar la evidencia, revisar el texto y utilizar un canal oficial.

## Instalación

Desde la raíz del repositorio:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r telegram_bot/requirements.txt
cp telegram_bot/.env.example telegram_bot/.env
```

Edita `.env` y establece `BOT_TOKEN` con un token nuevo creado en `@BotFather`. No introduzcas el token en el código ni lo subas a Git. Para iniciar el polling:

```bash
python -m telegram_bot.main
```

Desde la raíz del repositorio, inicia el bot con:

```bash
python -m telegram_bot.main
```

## Despliegue en Railway

Crea un proyecto nuevo en Railway y selecciona **Deploy from GitHub Repo**. El repositorio ya incluye `Dockerfile` y `railway.toml`, por lo que Railway podrá construir el servicio y ejecutar el bot automáticamente. En la sección **Variables**, añade `BOT_TOKEN` con el token nuevo generado en `@BotFather`; no lo coloques en el repositorio. Puedes añadir opcionalmente `COOLDOWN_SECONDS`, `SQLITE_PATH` y `LOG_LEVEL`. `COOLDOWN_SECONDS` controla el tiempo mínimo entre operaciones por usuario; `SQLITE_PATH` puede apuntar a un volumen persistente de Railway para conservar el historial después de reinicios. Después pulsa **Deploy** y revisa los logs: el proceso debe permanecer activo sin mostrar el token.

Si Railway no detecta el archivo automáticamente, establece el comando de inicio manual como `python -m telegram_bot.main`. No necesitas configurar un puerto HTTP para este bot, porque utiliza polling de Telegram.

## Flujo

`/start` muestra los botones **Suspender cuenta** y **Reactivar cuenta**. Cada opción solicita obligatoriamente un número internacional en formato E.164 o un ID alfanumérico de prueba. Tras validarlo, el bot crea un paquete local y vuelve al menú. `/cancel` cancela cualquier captura pendiente.

Cada operación se registra en SQLite en la tabla `operations`, con usuario, nombre de usuario, acción, identificador y fecha UTC. El comando `/stats` muestra totales agregados de suspensiones y reactivaciones. El cooldown por defecto es de 60 segundos (`COOLDOWN_SECONDS=60`). Las instalaciones previas con acciones BAN/UNBAN se migran automáticamente. Para conservar la base de datos en Railway, monta un volumen persistente y establece `SQLITE_PATH` dentro de ese volumen, por ejemplo `/data/telegram_bot.sqlite3`.

## Seguridad operativa

El token compartido en una conversación debe considerarse comprometido. Revócalo en `@BotFather`, genera uno nuevo y solo después inicia el bot. También conviene restringir los logs para que nunca incluyan números de teléfono completos ni el contenido de conversaciones.

La plantilla BAN admite categorías únicamente como campos que el usuario debe confirmar con hechos y pruebas. La plantilla UNBAN evita afirmar de forma absoluta que nunca existió una infracción; solicita una revisión manual y deja constancia de que el titular debe completar la información real.
