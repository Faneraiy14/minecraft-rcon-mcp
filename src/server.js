#!/usr/bin/env node
// server.js — реєструє MCP-інструменти й піднімає stdio-транспорт.
// Той самий каркас, що й у NyxilumMcp (та сама версія SDK, той самий
// стиль реєстрації) - авторський усталений паттерн для власних MCP-серверів.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
    mcCommand, mcListPlayers, mcSay, mcTeleport, mcGive,
    mcSetWeather, mcSetTime, mcKick,
} from './tools.js';

const server = new McpServer({ name: 'minecraft-rcon-mcp', version: '0.1.0' });

const timeoutSchema = z.number().int().min(500).max(30_000).optional()
    .describe('Таймаут RCON-запиту в мілісекундах (500–30000, типово 10000)');

function reply(result) {
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

server.registerTool(
    'mc_command',
    {
        title: 'Виконати довільну команду Minecraft-сервера',
        description:
            'Виконує БУДЬ-яку vanilla- чи plugin-команду через RCON (без провідного "/" — додається сам, якщо AI його все ж напише). ' +
            'Найзагальніший інструмент тут - усе, чого не покривають структуровані mc_* нижче (наприклад /gamemode, /effect, /fill, ' +
            'команди плагінів). Повертає сирий текстовий вивід сервера як є.',
        inputSchema: { command: z.string().min(1), timeout_ms: timeoutSchema },
    },
    async (args) => reply(await mcCommand(args))
);

server.registerTool(
    'mc_list_players',
    {
        title: 'Список гравців онлайн',
        description: 'Повертає кількість і ніки гравців, підключених зараз до сервера (/list).',
        inputSchema: { timeout_ms: timeoutSchema },
    },
    async (args) => reply(await mcListPlayers(args))
);

server.registerTool(
    'mc_say',
    {
        title: 'Оголошення в чат сервера',
        description: 'Транслює повідомлення в чат усім гравцям від імені сервера (/say).',
        inputSchema: { message: z.string().min(1), timeout_ms: timeoutSchema },
    },
    async (args) => reply(await mcSay(args))
);

server.registerTool(
    'mc_teleport',
    {
        title: 'Телепортувати гравця',
        description:
            'Телепортує target (нік гравця або vanilla-селектор на кшталт @a/@p/@e[type=...]) у destination — ' +
            'координати "x y z" АБО нік/селектор іншого гравця/сутності (/tp).',
        inputSchema: {
            target: z.string().min(1).describe('Нік гравця або селектор (@a, @p, @e[...])'),
            destination: z.string().min(1).describe('"x y z" або нік/селектор цілі телепортації'),
            timeout_ms: timeoutSchema,
        },
    },
    async (args) => reply(await mcTeleport(args))
);

server.registerTool(
    'mc_give',
    {
        title: 'Видати предмет гравцю',
        description: 'Видає item (напр. "diamond", "minecraft:diamond_sword") гравцю player у кількості count (типово 1) (/give).',
        inputSchema: {
            player: z.string().min(1),
            item: z.string().min(1).describe('Ідентифікатор предмета, напр. "diamond" або "minecraft:diamond_sword"'),
            count: z.number().int().positive().optional(),
            timeout_ms: timeoutSchema,
        },
    },
    async (args) => reply(await mcGive(args))
);

server.registerTool(
    'mc_set_weather',
    {
        title: 'Змінити погоду',
        description: 'Встановлює погоду на сервері: "clear", "rain" чи "thunder", опційно на duration_seconds секунд (/weather).',
        inputSchema: {
            weather: z.enum(['clear', 'rain', 'thunder']),
            duration_seconds: z.number().int().positive().optional(),
            timeout_ms: timeoutSchema,
        },
    },
    async (args) => reply(await mcSetWeather(args))
);

server.registerTool(
    'mc_set_time',
    {
        title: 'Змінити ігровий час',
        description: 'Встановлює ігровий час: число тіків АБО ключове слово ("day", "night", "noon", "midnight") (/time set).',
        inputSchema: {
            value: z.union([z.number().int().min(0), z.enum(['day', 'night', 'noon', 'midnight'])]),
            timeout_ms: timeoutSchema,
        },
    },
    async (args) => reply(await mcSetTime(args))
);

server.registerTool(
    'mc_kick',
    {
        title: 'Кікнути гравця',
        description: 'Відключає гравця player від сервера, опційно з причиною reason, показаною йому (/kick).',
        inputSchema: {
            player: z.string().min(1),
            reason: z.string().optional(),
            timeout_ms: timeoutSchema,
        },
    },
    async (args) => reply(await mcKick(args))
);

const transport = new StdioServerTransport();
await server.connect(transport);
