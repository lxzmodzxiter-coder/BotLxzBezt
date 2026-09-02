# Bot Telegram BAN / UNBAN

Este módulo añade un bot construido con **Python y aiogram 3**. Reproduce la navegación general de la herramienta de referencia mediante dos funciones principales: **BAN** para preparar un reporte factual y **UNBAN** para preparar una apelación de suspensión.

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

## Flujo

`/start` muestra los botones **BAN** y **UNBAN**. Cada opción solicita obligatoriamente un número internacional en formato E.164, por ejemplo `+14155552671`. Tras validarlo, el bot crea un borrador HTML y vuelve al menú. `/cancel` cancela cualquier captura pendiente.

El límite por defecto es de diez borradores diarios por usuario (`MAX_DAILY_DRAFTS=10`). Es un límite en memoria, por lo que para producción conviene sustituirlo por Redis o una tabla persistente y desplegar el proceso detrás de un supervisor de servicios.

## Seguridad operativa

El token compartido en una conversación debe considerarse comprometido. Revócalo en `@BotFather`, genera uno nuevo y solo después inicia el bot. También conviene restringir los logs para que nunca incluyan números de teléfono completos ni el contenido de conversaciones.

La plantilla BAN admite categorías únicamente como campos que el usuario debe confirmar con hechos y pruebas. La plantilla UNBAN evita afirmar de forma absoluta que nunca existió una infracción; solicita una revisión manual y deja constancia de que el titular debe completar la información real.
