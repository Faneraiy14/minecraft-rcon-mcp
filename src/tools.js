// tools.js — чисті обробники інструментів, без залежності від MCP SDK
// (той самий поділ, що й у NyxilumMcp — дає викликати їх напряму в
// тестах без піднімання реального MCP-транспорту). Кожен виклик
// відкриває ОКРЕМЕ RCON-з'єднання й закриває його по завершенню —
// сервер Minecraft розрахований саме на короткі підключення для
// адмін-команд, не на довготривалу сесію.

import { readRconConfig } from './config.js';
import { runRconCommand, RconError, RconAuthError } from './rcon.js';

async function exec(cmd, timeoutMs) {
    const { host, port, password } = readRconConfig();
    try {
        const output = await runRconCommand(host, port, password, cmd, { timeoutMs });
        return { success: true, command: cmd, output: output.trim() };
    } catch (err) {
        // instanceof, не err.name - надійніше проти класів-нащадків Error
        // (які без явного this.name у конструкторі всі звітують "Error").
        return { success: false, command: cmd, error: err.message, isAuthError: err instanceof RconAuthError };
    }
}

// Довільна vanilla/plugin-команда без жодного посередницького шару -
// найпотужніший і найзагальніший інструмент тут, для всього, чого не
// покривають структуровані нижче. НЕ додається "/" на початку - RCON
// (на відміну від чату в грі) очікує команду БЕЗ провідного слеша,
// сервер сам відкидає зайвий, якщо AI його все ж додасть.
export async function mcCommand({ command, timeout_ms }) {
    const cleaned = command.replace(/^\//, '');
    return exec(cleaned, timeout_ms);
}

export async function mcListPlayers({ timeout_ms }) {
    return exec('list', timeout_ms);
}

// say — і не tellraw: простіше, гарантовано підтримується будь-якою
// vanilla/Paper-збіркою без потреби у валідному JSON-компоненті тексту.
export async function mcSay({ message, timeout_ms }) {
    return exec(`say ${message}`, timeout_ms);
}

// target приймає і нік гравця, і vanilla-селектор (@a, @p, @e[type=...])
// - команда tp однаково валідна для обох, нічого додатково розрізняти не треба.
export async function mcTeleport({ target, destination, timeout_ms }) {
    return exec(`tp ${target} ${destination}`, timeout_ms);
}

export async function mcGive({ player, item, count, timeout_ms }) {
    const amount = count ?? 1;
    return exec(`give ${player} ${item} ${amount}`, timeout_ms);
}

export async function mcSetWeather({ weather, duration_seconds, timeout_ms }) {
    const cmd = duration_seconds ? `weather ${weather} ${duration_seconds}` : `weather ${weather}`;
    return exec(cmd, timeout_ms);
}

export async function mcSetTime({ value, timeout_ms }) {
    return exec(`time set ${value}`, timeout_ms);
}

export async function mcKick({ player, reason, timeout_ms }) {
    const cmd = reason ? `kick ${player} ${reason}` : `kick ${player}`;
    return exec(cmd, timeout_ms);
}

export { RconError };
