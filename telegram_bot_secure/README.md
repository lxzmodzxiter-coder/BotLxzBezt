# Bot modular seguro para servicios autorizados en Perú

Este paquete contiene una plantilla de Telegram basada en Python 3.11 y aiogram 3.22. La aplicación está diseñada como un catálogo modular de servicios con navegación por teclados inline, paginación de categorías, control de frecuencia, validación de entrada y cliente HTTP asíncrono. El modo predeterminado es `DEMO_MODE=true`, por lo que no consulta bases de datos reales ni procesa datos personales.

La arquitectura separa el arranque en `main.py`, la configuración en `config.py`, las protecciones de entrada y allowlist en `security.py`, la interfaz en `keyboards.py`, los manejadores en `handlers.py` y los proveedores en `services.py`. Esta separación evita que la lógica de Telegram tenga acceso directo a credenciales o a consultas arbitrarias. Los proveedores se consumen solamente a través de una URL HTTPS allowlisted y un endpoint de sandbox definido por el operador autorizado.

Para instalarlo, crea un entorno virtual desde la raíz del repositorio, ejecuta `python3 -m venv .venv`, activa el entorno con `source .venv/bin/activate` y ejecuta `pip install -r telegram_bot_secure/requirements.txt`. Copia `telegram_bot_secure/.env.example` a `telegram_bot_secure/.env`, coloca el token en `BOT_TOKEN` y conserva `DEMO_MODE=true` hasta que exista autorización contractual y técnica para un proveedor. Inicia el paquete con `python -m telegram_bot_secure.main`.

El flujo comienza con `/start`. El usuario abre las categorías, navega entre páginas y selecciona un módulo. La acción de demostración solicita una cadena sintética como `DEMO-001`, aplica límites por usuario y devuelve una respuesta local. La plantilla rechaza entradas con caracteres de control y limita su longitud. No debe modificarse para aceptar DNI reales, huellas, firmas, domicilios, placas, antecedentes o documentos de terceros sin base legal, finalidad, autorización y controles de minimización.

El cliente HTTP utiliza `aiohttp`, `ClientTimeout`, HTTPS, una cabecera `Authorization: Bearer` cuando el operador la configura, límite de bytes de respuesta, validación de host y mensajes de error controlados. El token nunca debe registrarse. `ALLOWED_PROVIDER_HOSTS` debe contener solo dominios sobre los que exista autorización. No se deben introducir en esa variable dominios tomados de un menú, una publicación o una documentación no verificada. El endpoint de ejemplo `/v1/sandbox/consult` es deliberadamente un contrato de prueba; debe reemplazarse por una integración documentada por el proveedor autorizado, con esquema de respuesta validado y campos mínimos.

La producción requiere agregar persistencia para usuarios, créditos y auditoría mediante un almacén seguro. El saldo debe actualizarse con transacciones idempotentes y no mediante valores enviados por el cliente. Cada solicitud debe tener un identificador de correlación, política de finalidad, usuario, módulo, proveedor, decisión de autorización, costo y resultado. Los logs deben evitar datos personales y secretos. Los documentos deben utilizar enlaces temporales, control de acceso, cifrado y retención mínima.

Las categorías mostradas son ilustrativas y no implican disponibilidad de consultas reales. La habilitación de un módulo sensible requiere una revisión legal y de privacidad, una matriz de roles, autorización por objeto y propiedad, rate limiting, protección contra enumeración, pruebas con datos sintéticos, auditoría del proveedor y un procedimiento de revocación. No se incluye código para scraping, bypass de CAPTCHA, enumeración de personas, extracción masiva, uso de APIs no autorizadas ni acceso a datos biométricos.

Para desplegarlo en un VPS o servicio administrado, configura las variables como secretos del proveedor de hosting, no subas `.env`, limita el acceso de red al servicio autorizado, utiliza un gestor de secretos, activa rotación de tokens, fija versiones de dependencias y monitoriza errores, consumo, latencia, tasas de rechazo y patrones anómalos. El bot debe ejecutarse con una cuenta de sistema sin privilegios y con almacenamiento persistente solo para los datos estrictamente necesarios.

La base técnica de la integración sigue el modelo HTTPS y JSON de Telegram Bot API. La seguridad de las APIs debe revisarse contra autorización a nivel de objeto, autenticación, autorización a nivel de propiedad, consumo irrestricto de recursos, autorización por función, flujos sensibles, SSRF, configuración, inventario y consumo seguro de APIs. En Perú, el tratamiento de datos personales debe analizarse conforme a la Ley N.° 29733 y su Reglamento vigente, además de las obligaciones contractuales y sectoriales aplicables.

## Estructura

```text
telegram_bot_secure/
├── __init__.py
├── .env.example
├── requirements.txt
├── README.md
├── config.py
├── security.py
├── services.py
├── keyboards.py
├── handlers.py
└── main.py
```

## Variables esenciales

`BOT_TOKEN` es obligatorio y debe mantenerse como secreto. `DEMO_MODE` debe permanecer en `true` para desarrollo. `ALLOWED_PROVIDER_HOSTS` es una allowlist exacta de hosts HTTPS autorizados. `PROVIDER_BASE_URL` es opcional y solo se utiliza cuando el modo demo está desactivado. `PROVIDER_TOKEN` es un secreto de proveedor. `MAX_REQUEST_BYTES`, `REQUEST_TIMEOUT_SECONDS` y `PER_USER_COOLDOWN_SECONDS` controlan límites básicos de disponibilidad.

## Licencia y uso

Este código debe emplearse únicamente con servicios propios o con proveedores que hayan concedido autorización documentada. La plantilla no concede permiso para consultar registros públicos o privados, ni garantiza que un proveedor comercial esté autorizado por una entidad estatal. Antes de activar una integración real, completa una revisión de privacidad, seguridad y cumplimiento.

## Pruebas y operación segura

Para instalar las dependencias de desarrollo ejecuta `pip install -r telegram_bot_secure/requirements-dev.txt` y después `pytest -q`. Las pruebas cubren validación de consultas, rechazo de hosts no allowlisted, cooldown por usuario, cobertura de páginas del teclado y transacciones idempotentes de créditos. Las pruebas no conectan con Telegram ni con proveedores externos.

`db.py` utiliza SQLite en modo WAL y una tabla `credit_transactions` con `idempotency_key` única. La inserción y actualización de saldo se ejecutan dentro de una transacción. Un reintento con la misma clave no vuelve a aplicar la operación. Para una escala mayor, sustituye esta implementación por PostgreSQL con aislamiento transaccional y conserva la misma garantía de idempotencia.

`middleware.py` crea o recupera una cuenta por evento y expone el contexto de cuenta al handler. Los roles permitidos son `FREE`, `VIP` y `ADMIN`. Los módulos sensibles deben añadir una política explícita de autorización antes de permitir cualquier operación real; la plantilla no habilita esas consultas.

`logging_json.py` emite eventos JSON con fecha, nivel, logger y mensaje truncado. Los handlers y clientes no deben incluir DNI, nombres, placas, tokens, firmas, fotografías, huellas, domicilios ni respuestas completas en el mensaje de log.

Para ejecutar con Docker, copia `.env.example` a `.env`, conserva `DEMO_MODE=true`, y ejecuta `docker compose up --build`. El contenedor usa un usuario sin privilegios, filesystem de solo lectura, volumen separado para SQLite, `no-new-privileges` y eliminación de capacidades Linux. Para una operación webhook con TLS, coloca un reverse proxy administrado delante del contenedor, termina TLS allí, reenvía solo al puerto interno y configura un secreto de webhook. No guardes certificados ni secretos en Git. El modo incluido usa long polling para mantener la plantilla autocontenida; el cambio a webhook debe hacerse solo en un entorno con URL pública HTTPS y controles de red.

El entrypoint `webhook_main.py` implementa una recepción webhook con `SimpleRequestHandler`, `WEBHOOK_PUBLIC_URL`, `WEBHOOK_SECRET` y `WEBHOOK_PORT`. El reverse proxy debe publicar únicamente HTTPS, reenviar `/telegram/webhook` al puerto interno y conservar el encabezado de secreto que valida aiogram. La terminación TLS no debe implementarse con certificados incrustados en la imagen. Para iniciar este modo en un entorno autorizado se utiliza `python -m telegram_bot_secure.webhook_main` después de configurar una URL pública HTTPS y un secreto largo, aleatorio y rotado fuera del repositorio.

## Integración continua

El workflow `.github/workflows/secure-bot-ci.yml` se ejecuta en cada `push` a `main` y en cada pull request que modifique el bot, las pruebas o el propio workflow. Ejecuta la suite en Python 3.11 y 3.12, compila los módulos, utiliza la caché de pip y construye la imagen Docker con Buildx. La imagen se construye con `push: false`, por lo que el pipeline no publica artefactos ni requiere credenciales de registro.

El workflow aplica permisos mínimos de solo lectura sobre el contenido del repositorio, cancela ejecuciones obsoletas de la misma rama y no carga `BOT_TOKEN`, `PROVIDER_TOKEN`, `WEBHOOK_SECRET` ni ningún otro secreto. Las pruebas funcionan con datos sintéticos y modo demo. Si posteriormente se añade publicación controlada a un registry, debe crearse un job separado protegido por un entorno de GitHub con aprobación manual, permisos explícitos y secretos de Actions limitados a ese job.

## Administración de roles

El comando `/setrole <user_id> <ROL>` está restringido a cuentas con rol `DUEÑO`. Los roles operativos permitidos son `FREE`, `VIP`, `PREMIUM`, `RESELLER` y `DUEÑO`. El usuario objetivo debe existir previamente, el ID debe ser positivo y el sistema impide retirar el último rol `DUEÑO` de la base de datos. El rol interno `ADMIN` se conserva únicamente para compatibilidad histórica y no puede asignarse mediante el comando.

Los propietarios iniciales se configuran mediante `ADMIN_USER_IDS`, con IDs separados por comas. Al arrancar en polling o webhook, esas cuentas se crean si es necesario y se elevan a `DUEÑO`. El token del bot no concede por sí mismo permisos administrativos; la autorización se resuelve contra la base de datos en cada evento.

Ejemplo seguro de uso en un entorno de pruebas con un usuario previamente registrado:

```text
/setrole 123456789 VIP
```

No se incluyó una ruta administrativa que cree usuarios arbitrarios a partir de un ID, porque permitiría preparar cuentas privilegiadas sin una interacción previa del usuario. Tampoco se permiten roles mediante parámetros ocultos, nombres de usuario no verificados o valores enviados desde el cliente sin validación del servidor.
