/**
 * ============================================================================
 *  TANVEER MUSIC BOT V3 — Zero-dependency .env loader
 * ============================================================================
 *
 *  The project intentionally ships no extra runtime dependencies, so this
 *  module provides a small, defensive `.env` parser instead of pulling in
 *  `dotenv`.
 *
 *  Features
 *    - Parses KEY=VALUE pairs, `export KEY=VALUE`, comments, blank lines.
 *    - Supports single quotes, double quotes (with \n \r \t \\ \" escapes)
 *      and inline `#` comments on unquoted values.
 *    - Real environment variables ALWAYS win — values already present in
 *      process.env are never overwritten. This keeps systemd, Docker and
 *      shell-exported secrets authoritative.
 *    - Never logs or returns values to callers in an unsafe way.
 *    - Never throws: a malformed line is skipped, not fatal.
 * ============================================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Parse `.env` text into an object of key/value strings.
 * @param {string} text
 * @returns {Record<string,string>}
 */
function parse(text) {
    const out = {};
    if (typeof text !== "string" || !text) return out;

    const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");

    for (let raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;

        const withoutExport = line.replace(/^export\s+/, "");
        const eq = withoutExport.indexOf("=");
        if (eq === -1) continue;

        const key = withoutExport.slice(0, eq).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

        let value = withoutExport.slice(eq + 1).trim();

        if (value.startsWith('"')) {
            // Double-quoted: honour simple escape sequences, allow trailing comment.
            const end = findClosingQuote(value, '"');
            const body = end === -1 ? value.slice(1) : value.slice(1, end);
            value = body.replace(/\\([nrt"\\])/g, (_m, c) => {
                switch (c) {
                    case "n": return "\n";
                    case "r": return "\r";
                    case "t": return "\t";
                    case '"': return '"';
                    case "\\": return "\\";
                    default: return c;
                }
            });
        } else if (value.startsWith("'")) {
            // Single-quoted: literal, no escapes.
            const end = findClosingQuote(value, "'");
            value = end === -1 ? value.slice(1) : value.slice(1, end);
        } else {
            // Unquoted: strip an inline comment introduced by " #".
            const hash = value.search(/\s#/);
            if (hash !== -1) value = value.slice(0, hash);
            value = value.trim();
        }

        out[key] = value;
    }

    return out;
}

/**
 * Find the closing quote index, skipping escaped quote characters.
 * @param {string} value
 * @param {string} quote
 * @returns {number} index of the closing quote, or -1
 */
function findClosingQuote(value, quote) {
    for (let i = 1; i < value.length; i++) {
        if (quote === '"' && value[i] === "\\") { i++; continue; }
        if (value[i] === quote) return i;
    }
    return -1;
}

/**
 * Load a `.env` file into `process.env` without overwriting existing keys.
 * @param {string} [envPath]
 * @param {{ override?: boolean, quiet?: boolean }} [options]
 * @returns {{ loaded: boolean, path: string, keys: string[] }}
 */
function load(envPath, options = {}) {
    const file = envPath || path.join(__dirname, "..", ".env");
    const result = { loaded: false, path: file, keys: [] };

    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (_err) {
        return result; // No .env — perfectly valid when using real env vars.
    }

    let parsed;
    try {
        parsed = parse(text);
    } catch (_err) {
        return result;
    }

    const override = Boolean(options.override);
    for (const [key, value] of Object.entries(parsed)) {
        if (override || typeof process.env[key] === "undefined") {
            process.env[key] = value;
            result.keys.push(key);
        }
    }

    result.loaded = true;
    return result;
}

module.exports = { parse, load };
