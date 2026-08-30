// rcon.js — клієнт протоколу Source RCON (те саме, що Minecraft-сервер
// вмикає через enable-rcon=true у server.properties). Написано з нуля,
// без зовнішньої rcon-бібліотеки — сам протокол достатньо простий
// (один бінарний пакет туди, один назад), і власна реалізація дає повний
// контроль над таймаутами/фрагментацією без чужих несподіванок.
//
// Формат пакета (усі числа — little-endian int32):
//   [length][requestId][type][payload...][0x00][0x00]
// length НЕ включає сам себе — рахує requestId+type+payload+2 нульових байти.
//
// Три типи пакетів:
//   SERVERDATA_AUTH (3)          — клієнт -> сервер, пароль у payload
//   SERVERDATA_AUTH_RESPONSE (2) — сервер -> клієнт, requestId=-1 при провалі логіну
//   SERVERDATA_EXECCOMMAND (2)   — клієнт -> сервер, той самий числовий тип,
//                                   що й AUTH_RESPONSE, але напрямок інший —
//                                   плутанини нема, бо клієнт сам знає, що щойно послав
//   SERVERDATA_RESPONSE_VALUE (0)— сервер -> клієнт, вивід команди
//
// Фрагментація довгих відповідей (Minecraft, RCON-специфіка): офіційний
// протокол не гарантує, що вся відповідь прийде в ОДНОМУ пакеті
// SERVERDATA_RESPONSE_VALUE. Стандартний трюк - одразу після команди
// послати ДРУГИЙ, порожній EXECCOMMAND-пакет з requestId+1; сервер не
// розпізнає його як команду і відповідає порожнім SERVERDATA_RESPONSE_VALUE
// з ТИМ САМИМ requestId+1 — це і є маркер "усе, що було з requestId
// оригінальної команди до цього моменту, це вся відповідь".

import { Socket } from 'node:net';

const TYPE_AUTH = 3;
const TYPE_EXEC_OR_AUTH_RESPONSE = 2;
const TYPE_RESPONSE_VALUE = 0;

function buildPacket(requestId, type, payload) {
    const payloadBuf = Buffer.from(payload, 'utf8');
    const bodyLen = 4 + 4 + payloadBuf.length + 2; // requestId + type + payload + 2 нульових байти
    const buf = Buffer.alloc(4 + bodyLen);
    buf.writeInt32LE(bodyLen, 0);
    buf.writeInt32LE(requestId, 4);
    buf.writeInt32LE(type, 8);
    payloadBuf.copy(buf, 12);
    buf.writeUInt8(0, 12 + payloadBuf.length);
    buf.writeUInt8(0, 12 + payloadBuf.length + 1);
    return buf;
}

/**
 * Розбирає ПОВНІ пакети з накопиченого буфера. Повертає розібрані пакети
 * й залишок буфера (неповний хвіст пакета, що чекає на дочитування) —
 * TCP не гарантує, що один socket 'data'-чанк = один пакет протоколу.
 */
function parsePackets(buffer) {
    const packets = [];
    let offset = 0;
    while (buffer.length - offset >= 4) {
        const bodyLen = buffer.readInt32LE(offset);
        const fullLen = 4 + bodyLen;
        if (buffer.length - offset < fullLen) break; // пакет ще не дочитаний повністю
        const requestId = buffer.readInt32LE(offset + 4);
        const type = buffer.readInt32LE(offset + 8);
        const payload = buffer.toString('utf8', offset + 12, offset + fullLen - 2);
        packets.push({ requestId, type, payload });
        offset += fullLen;
    }
    return { packets, rest: buffer.subarray(offset) };
}

// Класи-нащадки Error у JS НЕ виставляють .name автоматично (new
// RconAuthError().name дав би "Error", не "RconAuthError", без цього
// явного присвоєння) - виявлено живцем: tools.js спершу звірявся саме
// на err.name === 'RconAuthError' для isAuthError, і це мовчки завжди
// давало false, навіть коли автентифікація реально провалювалась
// правильним RconAuthError. this.constructor.name підхоплює ім'я
// РЕАЛЬНОГО підкласу автоматично, без дублювання в кожному class.
export class RconError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}
export class RconAuthError extends RconError {}
export class RconTimeoutError extends RconError {}

/**
 * Одне RCON-з'єднання: підключення + автентифікація + виконання команд.
 * НЕ пул з'єднань і не переперепідключення — виклик сам вирішує, коли
 * відкрити й закрити (mcCommand() у tools.js відкриває на КОЖЕН виклик,
 * бо MCP-інструмент тут працює як одноразовий запит-відповідь, а не
 * довготривала сесія — на відміну від NyxilumMcp's REPL, тут немає
 * потреби в персистентному стані між викликами, лише в сервері, до
   якого підключаємось).
 */
export class RconConnection {
    constructor(host, port, password, { timeoutMs = 10_000 } = {}) {
        this.host = host;
        this.port = port;
        this.password = password;
        this.timeoutMs = timeoutMs;
        this.socket = null;
        this.buffer = Buffer.alloc(0);
        this.nextRequestId = 1;
        /** @type {Array<{requestId:number, resolve:Function, reject:Function, collected:string[], type:'auth'|'exec'}>} */
        this.pending = [];
    }

    async connect() {
        await new Promise((resolve, reject) => {
            const socket = new Socket();
            const onError = (err) => { cleanup(); reject(new RconError(`Не вдалось підключитись до ${this.host}:${this.port}: ${err.message}`)); };
            const onTimeout = () => { cleanup(); socket.destroy(); reject(new RconTimeoutError(`Таймаут підключення до ${this.host}:${this.port}`)); };
            const onConnect = () => { cleanup(); resolve(); };
            const cleanup = () => {
                socket.removeListener('error', onError);
                socket.removeListener('timeout', onTimeout);
                socket.removeListener('connect', onConnect);
            };
            socket.setTimeout(this.timeoutMs);
            socket.once('error', onError);
            socket.once('timeout', onTimeout);
            socket.once('connect', onConnect);
            socket.connect(this.port, this.host);
            this.socket = socket;
        });

        this.socket.setTimeout(0);
        this.socket.on('data', (chunk) => this._onData(chunk));
        this.socket.on('error', () => { /* пакетні reject'и через _failAllPending() у close() */ });
        this.socket.on('close', () => this._failAllPending(new RconError('З\'єднання закрито')));

        await this._authenticate();
    }

    _onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const { packets, rest } = parsePackets(this.buffer);
        this.buffer = rest;
        for (const packet of packets) this._handlePacket(packet);
    }

    _handlePacket(packet) {
        // exec-очікувачі мають ДВА requestId, на які треба реагувати
        // по-різному: сам packet.requestId (накопичити фрагмент відповіді)
        // і terminatorId (сигнал "усе, відповідь повна") — перевірка
        // лише за p.requestId (як було раніше) НІКОЛИ не бачила
        // термінатор-пакет і команда висіла до таймауту, навіть коли
        // сервер відповів миттєво (реальний баг, спійманий живим тестом
        // проти запущеного Paper-сервера, не здогадкою).
        const terminatorIdx = this.pending.findIndex((p) => p.type === 'exec' && p.terminatorId === packet.requestId);
        if (terminatorIdx !== -1) {
            const p = this.pending.splice(terminatorIdx, 1)[0];
            p.resolve(p.collected.join(''));
            return;
        }

        const idx = this.pending.findIndex((p) => p.requestId === packet.requestId);
        if (idx === -1) {
            // AUTH_RESPONSE неуспішного логіну приходить із requestId=-1,
            // не з requestId запиту — окремо шукаємо очікувача автентифікації.
            const authIdx = this.pending.findIndex((p) => p.type === 'auth');
            if (packet.type === TYPE_EXEC_OR_AUTH_RESPONSE && packet.requestId === -1 && authIdx !== -1) {
                const p = this.pending.splice(authIdx, 1)[0];
                p.reject(new RconAuthError('Автентифікація RCON провалилась — невірний пароль.'));
            }
            return;
        }
        const p = this.pending[idx];
        if (p.type === 'auth') {
            this.pending.splice(idx, 1);
            p.resolve();
            return;
        }
        // exec: фрагмент реальної відповіді (packet.requestId === p.requestId,
        // ще не термінатор) — накопичуємо, чекаємо термінатор-пакет вище.
        p.collected.push(packet.payload);
    }

    _failAllPending(err) {
        const toFail = this.pending.splice(0, this.pending.length);
        for (const p of toFail) p.reject(err);
    }

    async _authenticate() {
        const requestId = this.nextRequestId++;
        const packet = buildPacket(requestId, TYPE_AUTH, this.password);
        const promise = new Promise((resolve, reject) => {
            this.pending.push({ requestId, resolve, reject, type: 'auth', collected: [] });
            setTimeout(() => {
                const idx = this.pending.findIndex((p) => p.requestId === requestId && p.type === 'auth');
                if (idx !== -1) {
                    this.pending.splice(idx, 1);
                    reject(new RconTimeoutError('Таймаут очікування відповіді на автентифікацію.'));
                }
            }, this.timeoutMs).unref?.();
        });
        this.socket.write(packet);
        await promise;
    }

    async command(cmd) {
        if (!this.socket) throw new RconError('З\'єднання не відкрите — виклич connect().');
        const requestId = this.nextRequestId++;
        const terminatorId = this.nextRequestId++;
        const execPacket = buildPacket(requestId, TYPE_EXEC_OR_AUTH_RESPONSE, cmd);
        const terminatorPacket = buildPacket(terminatorId, TYPE_EXEC_OR_AUTH_RESPONSE, '');

        const promise = new Promise((resolve, reject) => {
            this.pending.push({ requestId, terminatorId, resolve, reject, type: 'exec', collected: [] });
            setTimeout(() => {
                const idx = this.pending.findIndex((p) => p.requestId === requestId && p.type === 'exec');
                if (idx !== -1) {
                    this.pending.splice(idx, 1);
                    reject(new RconTimeoutError(`Таймаут очікування відповіді на команду "${cmd}".`));
                }
            }, this.timeoutMs).unref?.();
        });

        this.socket.write(execPacket);
        this.socket.write(terminatorPacket);
        return promise;
    }

    close() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }
}

/**
 * Одноразовий виклик "підключись, виконай команду, відключись" —
 * саме те, що потрібно MCP-інструментам тут (кожен виклик tools.js
 * незалежний, без спільного стану між ними).
 */
export async function runRconCommand(host, port, password, cmd, options) {
    const conn = new RconConnection(host, port, password, options);
    try {
        await conn.connect();
        return await conn.command(cmd);
    } finally {
        conn.close();
    }
}
