// config.js — читає підключення до сервера з env-змінних, той самий
// підхід, що й NyxilumMcp (NX_NODE_PATH тощо): секрет (пароль RCON)
// НІКОЛИ не приймається як параметр MCP-інструмента — інакше він осів
// би в історії розмови з AI-асистентом як звичайний текст. Єдине
// джерело — середовище процесу, яке задає людина при підключенні
// сервера (claude mcp add ... -e MC_RCON_PASSWORD=...), не сам AI.

export function readRconConfig() {
    const host = process.env.MC_RCON_HOST || '127.0.0.1';
    const port = Number(process.env.MC_RCON_PORT || '25575');
    const password = process.env.MC_RCON_PASSWORD;
    if (!password) {
        throw new Error(
            'MC_RCON_PASSWORD не задано. Встанови enable-rcon=true і rcon.password=... ' +
            'у server.properties Minecraft-сервера, тоді передай той самий пароль через MC_RCON_PASSWORD.'
        );
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`MC_RCON_PORT має бути коректним номером порту (1-65535), отримано: "${process.env.MC_RCON_PORT}"`);
    }
    return { host, port, password };
}
