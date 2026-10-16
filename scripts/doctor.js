#!/usr/bin/env node
/**
 * ============================================================================
 *  TANVEER MUSIC BOT V3 — Configuration Doctor
 *  Made by Tanveer  ·  Discord: tanveer5637
 * ============================================================================
 *
 *  Validates the installation WITHOUT starting the bot and WITHOUT ever
 *  printing a secret value.
 *
 *  Usage
 *      npm run doctor              static checks only (works offline)
 *      npm run doctor -- --live    also performs a real Lavalink handshake
 *
 *  Exit codes
 *      0  no problems found
 *      1  errors found (the bot will not start correctly)
 *      2  doctor itself crashed
 *
 *  IMPORTANT: a successful *static* check means the configuration is
 *  well-formed. It is NOT proof that Lavalink is reachable or that audio
 *  playback works. Only `--live` can prove a live connection.
 * ============================================================================
 */

"use strict";

const fs = require("fs");
const net = require("net");
const path = require("path");

const branding = require("../utils/branding.js");
const config = require("../config.js");

const ROOT = path.join(__dirname, "..");
const LIVE = process.argv.includes("--live");

const problems = [];
const checks = [];

/** Record a check result. level: "ok" | "warn" | "fail" | "info" */
function record(level, label, detail) {
    checks.push({ level, label, detail });
    if (level === "fail") problems.push(label);
}

const MARK = { ok: "[ OK ]", warn: "[WARN]", fail: "[FAIL]", info: "[INFO]" };

/**
 * Never reveal a secret. Reports only presence and length — deliberately no
 * prefix, suffix, or hash, so a log or screenshot can never leak a fragment.
 */
function describeSecret(value) {
    if (!value) return "not set";
    return `set (${String(value).length} characters, value hidden)`;
}

/* ────────────────────────────── Static checks ───────────────────────────── */

function checkEnvironment() {
    const major = Number.parseInt(process.versions.node.split(".")[0], 10);
    if (major >= 18) {
        record("ok", "Node.js version", `${process.versions.node} (>= 18 required)`);
    } else {
        record("fail", "Node.js version", `${process.versions.node} — Node.js 18+ required`);
    }
}

function checkDependencies() {
    const modules = ["discord.js", "riffy", "riffy-spotify"];
    const missing = modules.filter((m) => {
        try {
            require.resolve(path.join(ROOT, "node_modules", m));
            return false;
        } catch (_e) {
            return true;
        }
    });

    if (missing.length === 0) {
        const pkg = require(path.join(ROOT, "package.json"));
        record("ok", "Dependencies", `installed (${modules.join(", ")}) — bot v${pkg.version}`);
    } else {
        record(
            "fail",
            "Dependencies",
            `missing: ${missing.join(", ")} — run: npm install --omit=dev`
        );
    }
}

function checkEnvFile() {
    const envPath = path.join(ROOT, ".env");
    if (!fs.existsSync(envPath)) {
        record(
            "warn",
            ".env file",
            "not found — relying on real environment variables (fine for systemd/Docker)"
        );
        return;
    }
    record("ok", ".env file", "found");

    // Secret hygiene — a world-readable .env should be tightened.
    try {
        const mode = fs.statSync(envPath).mode & 0o777;
        if (mode & 0o077) {
            record(
                "warn",
                ".env permissions",
                `mode ${mode.toString(8)} — other users can read your secrets. Fix: chmod 600 .env`
            );
        } else {
            record("ok", ".env permissions", `mode ${mode.toString(8)} (owner only)`);
        }
    } catch (_e) {
        /* non-fatal */
    }
}

function checkDiscord() {
    const token = config.botToken;
    if (!token) {
        record("fail", "DISCORD_TOKEN", "not set — see .env.example");
    } else if (token.split(".").length !== 3) {
        record(
            "fail",
            "DISCORD_TOKEN",
            `malformed (${describeSecret(token)}) — a bot token has 3 dot-separated parts`
        );
    } else {
        record("ok", "DISCORD_TOKEN", describeSecret(token));
    }

    if (!config.clientId) {
        record("fail", "DISCORD_CLIENT_ID", "not set and could not be derived from the token");
    } else {
        record("ok", "DISCORD_CLIENT_ID", config.clientId);
    }

    if (config.guildId) {
        const instant = /^\d{17,20}$/.test(config.guildId);
        record(
            instant ? "ok" : "warn",
            "DISCORD_GUILD_ID",
            instant
                ? `${config.guildId} — slash commands will register instantly`
                : `"${config.guildId}" does not look like a snowflake — falling back to global registration`
        );
    } else {
        record("info", "DISCORD_GUILD_ID", "not set — commands register globally (up to 1h first time)");
    }
}

function checkLavalinkConfig() {
    const node = config.nodes[0];
    const port = Number(node.port);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        record("fail", "LAVALINK_PORT", `"${node.port}" is not a valid TCP port`);
    } else {
        record("ok", "LAVALINK_PORT", String(port));
    }

    record(
        "ok",
        "LAVALINK_HOST",
        `${node.host}  (${node.secure ? "secure / wss" : "plain / ws"})`
    );
    record("ok", "LAVALINK_NAME", node.name);

    if (!node.password) {
        record("fail", "LAVALINK_PASSWORD", "not set — Lavalink will reject the connection");
    } else if (node.password === "youshallnotpass") {
        record(
            "warn",
            "LAVALINK_PASSWORD",
            "still the Lavalink default — change it in application.yml, and keep port 2333 firewalled"
        );
    } else {
        record("ok", "LAVALINK_PASSWORD", describeSecret(node.password));
    }

    if (!config.lavalink.configured) {
        record(
            "info",
            "Lavalink setup",
            "still using built-in defaults — set LAVALINK_* in .env when your server is ready"
        );
    }
    record(
        "info",
        "Playback proof",
        "static check only — run `npm run doctor -- --live` to actually verify the node"
    );
}

function checkSpotify() {
    const hasId = Boolean(config.spotify.clientId);
    const hasSecret = Boolean(config.spotify.clientSecret);
    if (hasId && hasSecret) {
        record("ok", "Spotify", "enabled — Spotify links will resolve");
    } else if (!hasId && !hasSecret) {
        record("info", "Spotify", "disabled — YouTube/SoundCloud still work");
    } else {
        record(
            "warn",
            "Spotify",
            "incomplete — set BOTH SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET, or neither"
        );
    }
}

function checkSecretHygiene() {
    // gitignore coverage
    const gitignore = path.join(ROOT, ".gitignore");
    if (!fs.existsSync(gitignore)) {
        record("warn", "Git secret safety", ".gitignore missing — .env could be committed");
        return;
    }
    const ignored = fs.readFileSync(gitignore, "utf8");
    const needed = [".env", "config.local.js"];
    const missing = needed.filter((entry) => !ignored.includes(entry));
    if (missing.length === 0) {
        record("ok", "Git secret safety", ".env and config.local.js are ignored");
    } else {
        record("fail", "Git secret safety", `.gitignore does not exclude: ${missing.join(", ")}`);
    }
}

/* ──────────────────────── Live Lavalink connection ──────────────────────── */

/**
 * TCP reachability probe. Proves the port answers — NOT that credentials work.
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
function probeTcp(host, port, timeoutMs = 6000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        const finish = (ok, detail) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve({ ok, detail });
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true, `TCP connect to ${host}:${port} succeeded`));
        socket.once("timeout", () => finish(false, `TCP connect to ${host}:${port} timed out after ${timeoutMs}ms`));
        socket.once("error", (err) => finish(false, `TCP connect to ${host}:${port} failed: ${err.code || err.message}`));
        try {
            socket.connect(port, host);
        } catch (err) {
            finish(false, `could not start connection: ${err.message}`);
        }
    });
}

/**
 * Perform a real Lavalink v4 WebSocket handshake and wait for the "ready"
 * opcode. This is the only check that proves the node is genuinely usable.
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
async function probeLavalinkWs(node) {
    let WebSocket;
    try {
        WebSocket = require("ws");
    } catch (_err) {
        return {
            ok: false,
            detail:
                "the `ws` module is unavailable, so a full handshake could not be performed " +
                "(TCP reachability was still tested)",
        };
    }

    const { host, port, password, secure, name } = node;
    const url = `${secure ? "wss" : "ws"}://${host}:${port}/v4/websocket`;
    const userId = config.clientId || "0";

    return new Promise((resolve) => {
        let settled = false;
        const done = (ok, detail) => {
            if (settled) return;
            settled = true;
            try { ws.close(); } catch (_e) { /* ignore */ }
            resolve({ ok, detail });
        };

        let ws;
        try {
            ws = new WebSocket(url, {
                headers: {
                    Authorization: password,
                    "User-Id": String(userId),
                    "Client-Name": "TANVEER-MUSIC-BOT-V3/doctor",
                },
                handshakeTimeout: 10000,
            });
        } catch (err) {
            return done(false, `could not open ${url}: ${err.message}`);
        }

        const timer = setTimeout(() => done(false, `handshake to ${url} timed out after 12s`), 12000);

        ws.on("open", () => {
            // Lavalink expects an op:0 identify frame after the socket opens.
            try {
                ws.send(JSON.stringify({
                    op: 0,
                    d: {
                        userId: String(userId),
                        clientName: "TANVEER-MUSIC-BOT-V3/doctor",
                    },
                }));
            } catch (_e) { /* fall through to the ready frame */ }
        });

        ws.on("message", (raw) => {
            let payload;
            try { payload = JSON.parse(raw.toString()); } catch (_e) { return; }
            if (payload.op === "ready") {
                clearTimeout(timer);
                const v = payload.d?.version ?? "unknown";
                const session = payload.d?.sessionId ? "session established" : "session pending";
                done(true, `node "${name}" handshake succeeded — Lavalink ${v}, ${session}`);
            }
            if (payload.op === "event" && payload.type === "error") {
                clearTimeout(timer);
                done(false, `Lavalink reported an error: ${payload.message || "unknown"}`);
            }
        });

        ws.on("unexpected-response", (_req, res) => {
            clearTimeout(timer);
            done(
                false,
                res.statusCode === 401
                    ? "Lavalink rejected the password (HTTP 401) — check LAVALINK_PASSWORD"
                    : `Lavalink returned HTTP ${res.statusCode}`
            );
        });

        ws.on("error", (err) => {
            clearTimeout(timer);
            done(false, `WebSocket error against ${url}: ${err.message}`);
        });

        ws.on("close", () => {
            clearTimeout(timer);
            done(false, "connection closed before the node reported ready");
        });
    });
}

async function runLiveChecks() {
    const node = config.nodes[0];
    const port = Number(node.port);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        record("fail", "Lavalink (live)", "skipped — LAVALINK_PORT is invalid");
        return;
    }

    const tcp = await probeTcp(node.host, port);
    if (!tcp.ok) {
        record(
            "fail",
            "Lavalink (live)",
            `${tcp.detail}. The bot will start but playback will not work until the node is reachable.`
        );
        return;
    }
    record("ok", "Lavalink (live/TCP)", tcp.detail);

    const wsResult = await probeLavalinkWs(node);
    if (wsResult.ok) {
        record("ok", "Lavalink (live/handshake)", wsResult.detail);
        record(
            "ok",
            "Playback",
            "a live Lavalink node accepted this bot's credentials — playback is very likely to work"
        );
    } else {
        record("fail", "Lavalink (live/handshake)", wsResult.detail);
        record(
            "warn",
            "Playback",
            "NOT verified. Fix the handshake failure above, then re-run this check."
        );
    }
}

/* ─────────────────────────────────── Main ───────────────────────────────── */

(async () => {
    console.log("");
    branding.printBanner({ subtitle: LIVE ? "Configuration doctor — LIVE mode" : "Configuration doctor — static mode" });

    checkEnvironment();
    checkDependencies();
    checkEnvFile();
    checkDiscord();
    checkLavalinkConfig();
    checkSpotify();
    checkSecretHygiene();

    if (config.warnings.length) {
        for (const w of config.warnings) record("warn", "Configuration note", w);
    }

    if (LIVE) {
        await runLiveChecks();
    }

    console.log("  Results");
    console.log("  " + "─".repeat(68));
    for (const c of checks) {
        console.log(`  ${MARK[c.level]} ${c.label.padEnd(28)} ${c.detail}`);
    }
    console.log("  " + "─".repeat(68));

    const failures = checks.filter((c) => c.level === "fail");
    const warns = checks.filter((c) => c.level === "warn");

    if (failures.length === 0) {
        console.log(`\n  ✅ No blocking problems found (${warns.length} warning(s)).`);
        if (!LIVE) {
            console.log("  ℹ️  This was a STATIC check. Lavalink/playback was not verified.");
            console.log("     Run:  npm run doctor -- --live\n");
        }
    } else {
        console.log(`\n  ❌ ${failures.length} problem(s) must be fixed before starting:\n`);
        for (const f of failures) console.log(`     • ${f.label}: ${f.detail}`);
        console.log("");
    }

    branding.printSignature({ extra: "doctor finished" });
    process.exit(failures.length === 0 ? 0 : 1);
})().catch((err) => {
    console.error("Doctor crashed:", err);
    process.exit(2);
});
