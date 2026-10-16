/**
 * Configuration + .env parser tests.
 * TANVEER MUSIC BOT V3 · Made by Tanveer · Discord: tanveer5637
 *
 * These run OFFLINE. They never contact Discord or Lavalink.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const envParser = require("../utils/env.js");
const branding = require("../utils/branding.js");

const ROOT = path.join(__dirname, "..");

module.exports = {
    name: "Configuration and environment parsing",
    tests: [
        {
            name: "parses simple KEY=VALUE pairs",
            fn(assert) {
                const parsed = envParser.parse("FOO=bar\nBAZ=qux\n");
                assert.deepStrictEqual(parsed, { FOO: "bar", BAZ: "qux" });
            },
        },
        {
            name: "ignores comments and blank lines",
            fn(assert) {
                const parsed = envParser.parse(
                    "# a comment\n\n   \nKEY=value\n# another\n"
                );
                assert.deepStrictEqual(parsed, { KEY: "value" });
            },
        },
        {
            name: "supports `export KEY=value`",
            fn(assert) {
                assert.deepStrictEqual(envParser.parse("export KEY=value\n"), { KEY: "value" });
            },
        },
        {
            name: "strips surrounding double quotes",
            fn(assert) {
                assert.deepStrictEqual(envParser.parse('KEY="a b c"\n'), { KEY: "a b c" });
            },
        },
        {
            name: "strips surrounding single quotes literally",
            fn(assert) {
                assert.deepStrictEqual(envParser.parse("KEY='a b c'\n"), { KEY: "a b c" });
                assert.deepStrictEqual(envParser.parse("KEY='a\\nb'\n"), { KEY: "a\\nb" });
            },
        },
        {
            name: "expands escape sequences inside double quotes",
            fn(assert) {
                assert.deepStrictEqual(envParser.parse('KEY="line1\\nline2"\n'), {
                    KEY: "line1\nline2",
                });
            },
        },
        {
            name: "removes inline comments from unquoted values",
            fn(assert) {
                assert.deepStrictEqual(envParser.parse("PORT=2333 # lavalink\n"), {
                    PORT: "2333",
                });
            },
        },
        {
            name: "keeps `#` that is part of a quoted value",
            fn(assert) {
                assert.deepStrictEqual(envParser.parse('COLOR="#7B2FBE"\n'), {
                    COLOR: "#7B2FBE",
                });
            },
        },
        {
            name: "tolerates malformed lines instead of throwing",
            fn(assert) {
                assert.doesNotThrow(() => envParser.parse("this is not valid\n=empty\n1BAD=x\n"));
                assert.deepStrictEqual(envParser.parse("this is not valid\n"), {});
            },
        },
        {
            name: "handles CRLF line endings and a UTF-8 BOM",
            fn(assert) {
                assert.deepStrictEqual(envParser.parse("\uFEFFKEY=value\r\nOTHER=2\r\n"), {
                    KEY: "value",
                    OTHER: "2",
                });
            },
        },
        {
            name: "supports empty values",
            fn(assert) {
                assert.deepStrictEqual(envParser.parse("EMPTY=\n"), { EMPTY: "" });
            },
        },
        {
            name: ".env.example documents every variable the code reads",
            fn(assert) {
                const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
                const required = [
                    "DISCORD_TOKEN",
                    "DISCORD_CLIENT_ID",
                    "DISCORD_GUILD_ID",
                    "LAVALINK_HOST",
                    "LAVALINK_PORT",
                    "LAVALINK_PASSWORD",
                    "LAVALINK_SECURE",
                    "LAVALINK_NAME",
                    "SPOTIFY_CLIENT_ID",
                    "SPOTIFY_CLIENT_SECRET",
                    "EMBED_COLOR",
                ];
                for (const key of required) {
                    assert.ok(
                        new RegExp(`^${key}=`, "m").test(example),
                        `.env.example does not define ${key}`
                    );
                }
            },
        },
        {
            name: ".env.example contains no real credentials",
            fn(assert) {
                const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
                // A real Discord token is 3 dot-separated segments, 50+ chars.
                assert.ok(
                    !/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}/.test(example),
                    ".env.example appears to contain a real bot token"
                );
                assert.ok(
                    !/clientSecret['"]?\s*[:=]\s*['"][a-f0-9]{32}/i.test(example),
                    ".env.example appears to contain a real Spotify secret"
                );
                assert.ok(
                    !/^\s*[A-Z_]*(PASSWORD|TOKEN|SECRET)\s*=\s*["']?[A-Za-z0-9]{16,}/m.test(
                        example.replace(/^(LAVALINK_PASSWORD=)youshallnotpass$/m, "$1")
                    ),
                    ".env.example appears to contain a real secret value"
                );
            },
        },
        {
            name: "config.js exports the shape the bot depends on",
            fn(assert) {
                const config = require("../config.js");
                assert.strictEqual(typeof config.botToken, "string");
                assert.strictEqual(typeof config.embedColor, "string");
                assert.strictEqual(typeof config.footerText, "string");
                assert.ok(Array.isArray(config.nodes), "config.nodes must be an array");
                assert.ok(config.nodes.length >= 1, "at least one Lavalink node is required");
                assert.strictEqual(typeof config.spotify, "object");
                assert.strictEqual(typeof config.lavalink.configured, "boolean");
                assert.strictEqual(typeof config.isConfigured, "function");
            },
        },
        {
            name: "config.js never hardcodes a secret",
            fn(assert) {
                const source = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
                assert.ok(
                    !/["'][A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}["']/.test(source),
                    "config.js contains what looks like a hardcoded Discord token"
                );
                assert.ok(
                    !/clientSecret["']?\s*[:=]\s*["'][a-f0-9]{32}/i.test(source),
                    "config.js contains what looks like a hardcoded Spotify secret"
                );
            },
        },
        {
            name: "Lavalink node has all the fields Riffy requires",
            fn(assert) {
                const node = require("../config.js").nodes[0];
                for (const field of ["host", "port", "password", "secure", "name"]) {
                    assert.ok(
                        Object.prototype.hasOwnProperty.call(node, field),
                        `Lavalink node is missing "${field}"`
                    );
                }
                assert.strictEqual(typeof node.host, "string");
                assert.strictEqual(typeof node.port, "number");
                assert.strictEqual(typeof node.secure, "boolean");
            },
        },
        {
            name: "Lavalink port default is a valid TCP port when unset",
            fn(assert) {
                const saved = process.env.LAVALINK_PORT;
                process.env.LAVALINK_PORT = "not-a-number";
                delete require.cache[require.resolve("../config.js")];
                try {
                    const config = require("../config.js");
                    assert.ok(
                        Number.isInteger(config.nodes[0].port) &&
                            config.nodes[0].port > 0 &&
                            config.nodes[0].port < 65536,
                        `invalid port produced: ${config.nodes[0].port}`
                    );
                } finally {
                    if (saved === undefined) delete process.env.LAVALINK_PORT;
                    else process.env.LAVALINK_PORT = saved;
                    delete require.cache[require.resolve("../config.js")];
                }
            },
        },
        {
            name: "the default embed footer carries the permanent creator credit",
            fn(assert) {
                const saved = process.env.FOOTER_TEXT;
                delete process.env.FOOTER_TEXT;
                delete require.cache[require.resolve("../config.js")];
                try {
                    const config = require("../config.js");
                    assert.ok(
                        config.footerText.includes("Tanveer") ||
                            config.footerText.includes(branding.IDENTITY.footer),
                        `footer lost the creator credit: ${config.footerText}`
                    );
                } finally {
                    if (saved !== undefined) process.env.FOOTER_TEXT = saved;
                    delete require.cache[require.resolve("../config.js")];
                }
            },
        },
        {
            name: "environment variables take precedence over config.local.js",
            fn(assert) {
                const saved = process.env.EMBED_COLOR;
                process.env.EMBED_COLOR = "#123456";
                delete require.cache[require.resolve("../config.js")];
                try {
                    assert.strictEqual(require("../config.js").embedColor, "#123456");
                } finally {
                    if (saved === undefined) delete process.env.EMBED_COLOR;
                    else process.env.EMBED_COLOR = saved;
                    delete require.cache[require.resolve("../config.js")];
                }
            },
        },
    ],
};
