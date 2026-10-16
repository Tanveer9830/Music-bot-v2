/**
 * ============================================================================
 *  TANVEER MUSIC BOT V3 — Configuration
 *  Made by Tanveer  ·  Discord: tanveer5637
 * ============================================================================
 *
 *  NO SECRETS ARE STORED IN THIS FILE. Every credential comes from the
 *  environment (`.env`, systemd `EnvironmentFile=`, Docker, or shell exports).
 *
 *  Precedence (highest first):
 *      1. Real environment variables       (systemd / docker / shell export)
 *      2. `.env` file in the project root
 *      3. `config.local.js`  (optional, git-ignored, legacy/local overrides)
 *      4. Safe built-in defaults
 *
 *  Run `npm run doctor` to validate your configuration without starting
 *  the bot, and `npm run doctor -- --live` to also test the Lavalink node.
 * ============================================================================
 */

"use strict";

const env = require("./utils/env.js");

// ── Load .env early; real environment variables always take precedence ───────
env.load();

// ── Optional, git-ignored local overrides (kept for backwards compatibility) ─
let local = {};
let localConfigUsed = false;
try {
    // eslint-disable-next-line global-require
    local = require("./config.local.js") || {};
    localConfigUsed = true;
} catch (_err) {
    local = {};
}

const warnings = [];
if (localConfigUsed) {
    warnings.push(
        "config.local.js detected. It is git-ignored and is no longer the " +
            "recommended way to store secrets — migrate those values into .env " +
            "and delete config.local.js."
    );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** First defined, non-empty environment value from a list of aliases. */
function envFirst(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return undefined;
}

/** Coerce to a boolean, accepting 1/true/yes/on (case-insensitive). */
function toBool(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string" || value.trim() === "") return fallback;
    return ["1", "true", "yes", "on", "y"].includes(value.trim().toLowerCase());
}

/** Coerce to an integer, falling back when the value is not numeric. */
function toInt(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || value.trim() === "") return fallback;
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/** Prefer env → .env → config.local.js → default. */
function pick(envValue, localValue, fallback) {
    if (typeof envValue === "string" && envValue.trim() !== "") return envValue.trim();
    if (typeof localValue === "string" && localValue.trim() !== "") return localValue.trim();
    if (typeof localValue === "number" || typeof localValue === "boolean") return localValue;
    return fallback;
}

// ── Discord ─────────────────────────────────────────────────────────────────

const botToken = pick(
    envFirst("DISCORD_TOKEN", "BOT_TOKEN", "TOKEN"),
    local.botToken,
    ""
);

/**
 * A Discord bot token's first segment is base64(application_id), so the
 * application ID can always be recovered from a valid token. This means the
 * installer only strictly needs the token; DISCORD_CLIENT_ID stays optional.
 * @param {string} token
 * @returns {string} application id, or "" when it cannot be derived
 */
function deriveClientIdFromToken(token) {
    if (typeof token !== "string") return "";
    const segment = token.split(".")[0];
    if (!segment) return "";
    try {
        const decoded = Buffer.from(segment, "base64").toString("utf8").trim();
        return /^\d{17,20}$/.test(decoded) ? decoded : "";
    } catch (_err) {
        return "";
    }
}

const clientId = pick(
    envFirst("DISCORD_CLIENT_ID", "CLIENT_ID", "APPLICATION_ID"),
    local.clientId,
    ""
) || deriveClientIdFromToken(botToken);

/** Optional: registering commands in one guild is instant (development). */
const guildId = pick(
    envFirst("DISCORD_GUILD_ID", "GUILD_ID", "DEV_GUILD_ID"),
    local.guildId,
    ""
);

// ── Lavalink ────────────────────────────────────────────────────────────────

const legacyNode = Array.isArray(local.nodes) && local.nodes.length ? local.nodes[0] : {};

const nodes = [
    {
        host: pick(envFirst("LAVALINK_HOST"), legacyNode.host, "127.0.0.1"),
        port: toInt(envFirst("LAVALINK_PORT"), toInt(legacyNode.port, 2333)),
        password: pick(envFirst("LAVALINK_PASSWORD"), legacyNode.password, "youshallnotpass"),
        secure: toBool(envFirst("LAVALINK_SECURE"), toBool(legacyNode.secure, false)),
        name: pick(envFirst("LAVALINK_NAME"), legacyNode.name, "Main Node"),
        // Riffy / Lavalink resilience options (kept identical to upstream defaults)
        retryAmount: toInt(envFirst("LAVALINK_RETRY_AMOUNT"), 20),
        retryDelay: toInt(envFirst("LAVALINK_RETRY_DELAY"), 5000),
    },
];

const lavalinkConfigured = Boolean(
    envFirst("LAVALINK_HOST", "LAVALINK_PASSWORD") ||
        (Array.isArray(local.nodes) && local.nodes.length)
);

// ── Spotify (optional — enables Spotify link resolution via riffy-spotify) ──

const spotifyClientId = pick(
    envFirst("SPOTIFY_CLIENT_ID"),
    local.spotify?.clientId,
    ""
);
const spotifyClientSecret = pick(
    envFirst("SPOTIFY_CLIENT_SECRET"),
    local.spotify?.clientSecret,
    ""
);

// ── Appearance ──────────────────────────────────────────────────────────────

const embedColor = pick(envFirst("EMBED_COLOR"), local.embedColor, "#7B2FBE");

const footerText = pick(
    envFirst("FOOTER_TEXT"),
    local.footerText,
    require("./utils/branding.js").IDENTITY.footer
);

// ── Runtime ─────────────────────────────────────────────────────────────────

const isDevelopment = pick(envFirst("NODE_ENV"), local.nodeEnv, "production") !== "production";

// ── Exports (shape preserved for backwards compatibility) ────────────────────

module.exports = {
    // Discord
    botToken,
    clientId,
    guildId,
    // Lavalink
    nodes,
    lavalink: {
        host: nodes[0].host,
        port: nodes[0].port,
        password: nodes[0].password,
        secure: nodes[0].secure,
        name: nodes[0].name,
        // "configured" only means the values are present and syntactically
        // plausible. It is NOT proof of a live connection — use
        // `npm run doctor -- --live` for that.
        configured: lavalinkConfigured,
    },
    // Spotify (optional)
    spotify: {
        clientId: spotifyClientId,
        clientSecret: spotifyClientSecret,
        enabled: Boolean(spotifyClientId && spotifyClientSecret),
    },
    // Appearance
    embedColor,
    footerText,
    // Runtime
    isDevelopment,
    warnings,
    /** True when the minimum required settings are present (not validated). */
    isConfigured: () => Boolean(botToken && clientId),
};
