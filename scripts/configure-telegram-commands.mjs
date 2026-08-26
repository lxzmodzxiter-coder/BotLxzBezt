import { parseTelegramRuntimeSecrets } from "../server/telegram/config.ts";

const { telegramBotToken } = parseTelegramRuntimeSecrets();
const commands = [
  { command: "start", description: "Abrir el Command Center autorizado" },
  { command: "dni", description: "Consultar DNI autorizado de 8 dígitos" },
  { command: "ruc", description: "Consultar RUC autorizado de 11 dígitos" },
  { command: "me", description: "Ver mi acceso autorizado" },
  { command: "menu", description: "Abrir menú y ayuda" },
  { command: "estado", description: "Ver estado operativo del servicio" },
  { command: "actividad", description: "Ver mi actividad reciente" },
  { command: "terminos", description: "Ver condiciones de uso interno" },
  { command: "soporte", description: "Solicitar soporte interno" },
];

const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ commands }),
});
const payload = await response.json().catch(() => ({}));

if (!response.ok || payload.ok !== true) {
  throw new Error(`Telegram rejected command configuration: ${payload.description || response.status}`);
}

console.log(JSON.stringify({ configured: true, commandCount: commands.length }));
