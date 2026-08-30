import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    mcCommand, mcListPlayers, mcSay, mcTeleport, mcGive,
    mcSetWeather, mcSetTime, mcKick,
} from '../src/tools.js';

const available = Boolean(process.env.MC_RCON_HOST && process.env.MC_RCON_PORT && process.env.MC_RCON_PASSWORD);

function maybeTest(name, fn) {
    if (available) {
        test(name, fn);
    } else {
        test(name, { skip: 'MC_RCON_HOST/MC_RCON_PORT/MC_RCON_PASSWORD не задано - немає живого Minecraft-сервера для тесту' }, () => {});
    }
}

maybeTest('mc_command знімає провідний "/" перед відправкою', async () => {
    const r = await mcCommand({ command: '/list' });
    assert.equal(r.success, true);
    assert.equal(r.command, 'list');
    assert.match(r.output, /players online/);
});

maybeTest('mc_list_players', async () => {
    const r = await mcListPlayers({});
    assert.equal(r.success, true);
    assert.match(r.output, /players online/);
});

maybeTest('mc_say', async () => {
    const r = await mcSay({ message: 'привіт від tools.mjs' });
    assert.equal(r.success, true);
});

maybeTest('mc_set_time приймає ключове слово', async () => {
    const r = await mcSetTime({ value: 'noon' });
    assert.equal(r.success, true);
    assert.match(r.output, /Set the time/);
});

maybeTest('mc_set_weather', async () => {
    const r = await mcSetWeather({ weather: 'rain' });
    assert.equal(r.success, true);
});

maybeTest('mc_teleport без гравця онлайн - success:true з текстом помилки сервера в output, не throw', async () => {
    // Дизайн-рішення: success тут означає "RCON-запит дійшов і сервер
    // відповів", а НЕ "команда семантично вдалась" - AI-асистент читає
    // output, щоб дізнатись, чи гравець реально існує/онлайн.
    //
    // Ім'я АСКІ-латиницею навмисно (перша версія цього тесту брала
    // кириличне ім'я, і сервер відповідав "Incorrect argument for
    // command" - кирилиця там навіть не проходить структурний парсинг
    // цільового селектора, тож то було зовсім інше повідомлення, ніж
    // "гравця не знайдено"; реальні ніки Minecraft - лише [a-zA-Z0-9_]).
    const r = await mcTeleport({ target: 'NoSuchPlayer', destination: '0 100 0' });
    assert.equal(r.success, true);
    assert.match(r.output, /No entity was found/);
});

// Ім'я АСКІ-латиницею навмисно, як і в mc_teleport нижче - справжні ніки
// Minecraft це лише [a-zA-Z0-9_], кирилиця в ролі імені гравця не
// проходить структурний парсинг команди й дає зовсім інше повідомлення
// ("Invalid name or UUID"/"Incorrect argument for command"), не те, що
// перевіряється тут. Перевірено живцем обома варіантами перед тим, як
// зафіксувати очікування.
maybeTest('mc_give без гравця онлайн - success:true з текстом помилки сервера в output', async () => {
    const r = await mcGive({ player: 'NoSuchPlayer', item: 'diamond', count: 3 });
    assert.equal(r.success, true);
    assert.match(r.output, /No player was found/);
});

maybeTest('mc_kick без гравця онлайн - success:true з текстом помилки сервера в output', async () => {
    const r = await mcKick({ player: 'NoSuchPlayer' });
    assert.equal(r.success, true);
    assert.match(r.output, /No player was found/);
});

maybeTest('невірний пароль повертає success:false з isAuthError:true, не throw', async () => {
    const original = process.env.MC_RCON_PASSWORD;
    process.env.MC_RCON_PASSWORD = 'явно-невірний-пароль';
    try {
        const r = await mcListPlayers({});
        assert.equal(r.success, false);
        assert.equal(r.isAuthError, true);
    } finally {
        process.env.MC_RCON_PASSWORD = original;
    }
});
