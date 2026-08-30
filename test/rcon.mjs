// rcon.mjs — тести проти РЕАЛЬНОГО живого Minecraft-сервера з увімкненим
// RCON, не проти мока. Той самий принцип, що й у NyxilumMcp
// (nyxilum_dev_build/nyxilum_dev_test) і в anylint (NyxilumProvider-тест
// пропускається, якщо nx недоступний) — довіряти протоколу, лише
// підтвердивши його на реальному сервері, який реально відповідає.
//
// Потребує запущеного Minecraft-сервера з enable-rcon=true й тими самими
// MC_RCON_HOST/MC_RCON_PORT/MC_RCON_PASSWORD, що й сам MCP-сервер читає
// (config.js) — якщо їх нема, тести пропускаються, а не провалюються
// (як CI не мав би падати через брак Java-сервера в оточенні).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRconCommand, RconAuthError, RconError } from '../src/rcon.js';

const host = process.env.MC_RCON_HOST;
const port = Number(process.env.MC_RCON_PORT);
const password = process.env.MC_RCON_PASSWORD;
const available = Boolean(host && port && password);

function maybeTest(name, fn) {
    if (available) {
        test(name, fn);
    } else {
        test(name, { skip: 'MC_RCON_HOST/MC_RCON_PORT/MC_RCON_PASSWORD не задано - немає живого Minecraft-сервера для тесту' }, () => {});
    }
}

maybeTest('list повертає реальну відповідь сервера', async () => {
    const out = await runRconCommand(host, port, password, 'list');
    assert.match(out, /players online/);
});

maybeTest('say реально доходить (порожня відповідь від сервера - очікувано)', async () => {
    const out = await runRconCommand(host, port, password, 'say тестове повідомлення від rcon.mjs');
    assert.equal(out, '');
});

maybeTest('невідома команда повертає текст помилки сервера, не кидає', async () => {
    const out = await runRconCommand(host, port, password, 'цезовсімнекомандаminecraft');
    assert.match(out, /Unknown or incomplete command/);
});

maybeTest('невірний пароль дає RconAuthError, не таймаут і не мовчазний провал', async () => {
    await assert.rejects(
        () => runRconCommand(host, port, 'явно-невірний-пароль-xyz', 'list'),
        (err) => err instanceof RconAuthError
    );
});

maybeTest('невірний порт дає RconError підключення, не зависає', { timeout: 5000 }, async () => {
    await assert.rejects(
        () => runRconCommand(host, 1, password, 'list', { timeoutMs: 2000 }),
        (err) => err instanceof RconError
    );
});

maybeTest('послідовні команди в одному підключенні не плутають відповіді (немає id-колізій)', async () => {
    // Реальна регресія, спіймана під час розробки: _handlePacket() шукав
    // pending-запис лише за p.requestId, ніколи за p.terminatorId - термінатор-
    // пакет мовчки губився, і команда висіла до таймауту, навіть коли
    // сервер відповідав миттєво. Три команди поспіль в ОДНОМУ з'єднанні -
    // саме той сценарій, де застарілий/неправильний matching дав би збій.
    const { RconConnection } = await import('../src/rcon.js');
    const conn = new RconConnection(host, port, password);
    try {
        await conn.connect();
        const a = await conn.command('time set day');
        const b = await conn.command('list');
        const c = await conn.command('weather clear');
        assert.match(a, /Set the time/);
        assert.match(b, /players online/);
        assert.match(c, /weather/i);
    } finally {
        conn.close();
    }
});
