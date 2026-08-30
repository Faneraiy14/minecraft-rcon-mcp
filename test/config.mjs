import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRconConfig } from '../src/config.js';

test('readRconConfig: кидає чітку помилку, якщо MC_RCON_PASSWORD не задано', () => {
    const saved = { host: process.env.MC_RCON_HOST, port: process.env.MC_RCON_PORT, pass: process.env.MC_RCON_PASSWORD };
    delete process.env.MC_RCON_PASSWORD;
    try {
        assert.throws(() => readRconConfig(), /MC_RCON_PASSWORD/);
    } finally {
        if (saved.pass !== undefined) process.env.MC_RCON_PASSWORD = saved.pass;
    }
});

test('readRconConfig: типовий host 127.0.0.1, типовий port 25575', () => {
    const saved = { host: process.env.MC_RCON_HOST, port: process.env.MC_RCON_PORT, pass: process.env.MC_RCON_PASSWORD };
    delete process.env.MC_RCON_HOST;
    delete process.env.MC_RCON_PORT;
    process.env.MC_RCON_PASSWORD = 'x';
    try {
        const cfg = readRconConfig();
        assert.equal(cfg.host, '127.0.0.1');
        assert.equal(cfg.port, 25575);
    } finally {
        if (saved.host !== undefined) process.env.MC_RCON_HOST = saved.host; else delete process.env.MC_RCON_HOST;
        if (saved.port !== undefined) process.env.MC_RCON_PORT = saved.port; else delete process.env.MC_RCON_PORT;
        if (saved.pass !== undefined) process.env.MC_RCON_PASSWORD = saved.pass; else delete process.env.MC_RCON_PASSWORD;
    }
});

test('readRconConfig: невалідний порт кидає чітку помилку', () => {
    const saved = { port: process.env.MC_RCON_PORT, pass: process.env.MC_RCON_PASSWORD };
    process.env.MC_RCON_PORT = 'не-число';
    process.env.MC_RCON_PASSWORD = 'x';
    try {
        assert.throws(() => readRconConfig(), /MC_RCON_PORT/);
    } finally {
        if (saved.port !== undefined) process.env.MC_RCON_PORT = saved.port; else delete process.env.MC_RCON_PORT;
        if (saved.pass !== undefined) process.env.MC_RCON_PASSWORD = saved.pass; else delete process.env.MC_RCON_PASSWORD;
    }
});
