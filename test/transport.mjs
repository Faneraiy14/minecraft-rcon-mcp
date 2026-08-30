// transport.mjs — перевіряє РЕАЛЬНИЙ MCP-транспорт (StdioServerTransport
// + Client), не лише прямі виклики функцій з tools.js. Той самий підхід,
// що й у NyxilumMcp.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'src', 'server.js');
const available = Boolean(process.env.MC_RCON_HOST && process.env.MC_RCON_PORT && process.env.MC_RCON_PASSWORD);

async function withClient(fn) {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        env: {
            MC_RCON_HOST: process.env.MC_RCON_HOST ?? '',
            MC_RCON_PORT: process.env.MC_RCON_PORT ?? '',
            MC_RCON_PASSWORD: process.env.MC_RCON_PASSWORD ?? '',
            PATH: process.env.PATH ?? '',
        },
    });
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    await client.connect(transport);
    try {
        await fn(client);
    } finally {
        await client.close();
    }
}

test('tools/list повертає всі 8 зареєстрованих інструментів', async () => {
    await withClient(async (client) => {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name).sort();
        assert.deepEqual(names, [
            'mc_command',
            'mc_give',
            'mc_kick',
            'mc_list_players',
            'mc_say',
            'mc_set_time',
            'mc_set_weather',
            'mc_teleport',
        ]);
    });
});

function maybeTest(name, fn) {
    if (available) {
        test(name, fn);
    } else {
        test(name, { skip: 'MC_RCON_HOST/MC_RCON_PORT/MC_RCON_PASSWORD не задано - немає живого Minecraft-сервера для тесту' }, () => {});
    }
}

maybeTest('tools/call mc_list_players через реальний MCP-протокол', async () => {
    await withClient(async (client) => {
        const result = await client.callTool({ name: 'mc_list_players', arguments: {} });
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.success, true);
        assert.match(payload.output, /players online/);
    });
});

maybeTest('tools/call з невалідними аргументами повертає isError, не викидає', async () => {
    await withClient(async (client) => {
        const result = await client.callTool({ name: 'mc_command', arguments: { command: 123 } });
        assert.equal(result.isError, true);
    });
});
