/**
 * ============================================================================
 *  TANVEER MUSIC BOT V3 — Permanent Branding Module
 * ============================================================================
 *
 *  SINGLE SOURCE OF TRUTH for the project's terminal banner and creator
 *  identity. Every place that shows branding (installer, bot startup,
 *  README generation, /help, /about, embed footers, service logs) MUST use
 *  this module. Do not paste the banner into other files.
 *
 *  Permanent identity (do not edit):
 *      Creator          : Tanveer
 *      Discord username : tanveer5637
 *      Product name     : TANVEER MUSIC BOT V3
 *
 *  Design rules:
 *    - Never throws. If the art file is missing or unreadable, a plain-text
 *      fallback banner is used so startup can never be broken by decoration.
 *    - Always degrades to readable plain text when ANSI colour is
 *      unavailable (pipes, CI logs, dumb terminals, NO_COLOR, CI=true).
 *    - Pure Node.js standard library. No runtime dependencies.
 * ============================================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");

/* ────────────────────────────── Identity ────────────────────────────── */

const IDENTITY = Object.freeze({
    product: "TANVEER MUSIC BOT V3",
    creator: "Tanveer",
    discord: "tanveer5637",
    tagline: "Premium Music Experience",
    madeBy: "MADE BY TANVEER",
    footer: "Made by Tanveer • Discord: tanveer5637",
});

/** Exact strings that must always remain visible. Asserted by tests. */
const REQUIRED_STRINGS = Object.freeze([
    "TANVEER MUSIC BOT V3",
    "MADE BY TANVEER",
    "Discord: tanveer5637",
]);

const BANNER_FILE = path.join(__dirname, "..", "branding", "banner.txt");

/* ──────────────────────────────── Palette ───────────────────────────── */

const ANSI = Object.freeze({
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    purple: "\x1b[38;5;135m",   // bright violet — matches embedColour #7B2FBE
    violet: "\x1b[38;5;99m",
    cyan: "\x1b[38;5;51m",
    white: "\x1b[97m",
    grey: "\x1b[38;5;245m",
});

/* ─────────────────────────── Colour support ─────────────────────────── */

/**
 * Detect whether the current stream supports ANSI colour.
 * @param {NodeJS.WriteStream} [stream]
 * @returns {boolean}
 */
function supportsColor(stream) {
    const out = stream || process.stdout;
    if (!out || typeof out.isTTY === "undefined" || !out.isTTY) return false;
    if (process.env.NO_COLOR) return false;
    if (process.env.FORCE_COLOR === "0") return false;
    if (process.env.FORCE_COLOR) return true;
    if (process.env.CI === "true") return false;
    if (process.env.TERM === "dumb") return false;
    return true;
}

/* ─────────────────────── Banner art (with fallback) ──────────────────── */

/**
 * Raw, uncoloured banner art. Reads branding/banner.txt once and caches it.
 * Falls back to an ASCII-safe composition if the asset is unavailable.
 * @returns {string}
 */
function getBannerArt() {
    if (getBannerArt._cache) return getBannerArt._cache;

    let art = "";
    try {
        const raw = fs.readFileSync(BANNER_FILE, "utf8");
        // Strip a UTF-8 BOM, normalise newlines, drop trailing blank lines.
        art = raw
            .replace(/^\uFEFF/, "")
            .replace(/\r\n?/g, "\n")
            .replace(/\s+$/, "");
    } catch (_err) {
        art = "";
    }

    if (!art) art = buildFallbackBanner();

    getBannerArt._cache = art;
    return art;
}

/** Plain, dependency-free banner used when branding/banner.txt is missing. */
function buildFallbackBanner() {
    const line = "+" + "=".repeat(70) + "+";
    const blank = "|" + " ".repeat(70) + "|";
    const centre = (text) =>
        "|" + text.padStart(Math.floor((70 + text.length) / 2)).padEnd(70) + "|";
    return [
        line,
        blank,
        centre(IDENTITY.product),
        centre(IDENTITY.madeBy),
        centre("Discord: " + IDENTITY.discord),
        centre(IDENTITY.tagline),
        blank,
        line,
    ].join("\n");
}

/* ─────────────────────────── Colourisation ──────────────────────────── */

/**
 * Apply ANSI colours to the banner art. Safe on any string.
 * @param {string} art
 * @returns {string}
 */
function colorise(art) {
    if (typeof art !== "string" || !art) return "";
    const { reset, bold, purple, violet, cyan, white, grey } = ANSI;

    return art
        .split("\n")
        .map((line, index, all) => {
            // Border rows: purple rule lines.
            if (/^[+|][=+]/.test(line) || /^[+|]\s*[=]{5,}/.test(line)) {
                return purple + bold + line + reset;
            }
            // Blank inner rows stay blank.
            if (/^\|\s+\|$/.test(line)) return violet + line + reset;
            // The big "TANVEER" glyph block: rows 2..7 of the box.
            if (/^\|.*[TVE]{3,}.*\|$/.test(line) && index < all.length - 4) {
                return cyan + bold + line + reset;
            }
            // "MADE BY TANVEER" / signature rows.
            if (/M A D E|T A N V E E R|tanveer5637|Premium Music/i.test(line)) {
                return white + bold + line + reset;
            }
            return grey + line + reset;
        })
        .join("\n");
}

/* ───────────────────────────── Public API ───────────────────────────── */

/**
 * Return the banner, optionally colourised.
 * @param {{ color?: boolean, stream?: NodeJS.WriteStream }} [options]
 * @returns {string}
 */
function getBanner(options = {}) {
    const useColor =
        options.color === undefined ? supportsColor(options.stream) : Boolean(options.color);
    const art = getBannerArt();
    try {
        return useColor ? colorise(art) : art;
    } catch (_err) {
        return art; // decoration must never crash the bot
    }
}

/**
 * Compact single-line signature for log lines and service logs.
 * @param {string} [extra]
 * @returns {string}
 */
function getSignature(extra) {
    const base = `${IDENTITY.product} | ${IDENTITY.madeBy} | Discord: ${IDENTITY.discord}`;
    return extra ? `${base} | ${extra}` : base;
}

/**
 * Short footer text for embeds. Deliberately ASCII-safe and length-limited
 * so Discord's 2048-character footer cap can never be hit.
 * @param {string} [extra]
 * @returns {string}
 */
function getFooter(extra) {
    const base = IDENTITY.footer;
    if (!extra) return base;
    return `${extra}  ·  ${base}`.slice(0, 2000);
}

/**
 * The signature block that always accompanies the artwork.
 *
 * This is what guarantees the three permanent strings appear VERBATIM in every
 * place branding is shown — the ASCII art itself draws "TANVEER" as glyphs and
 * "MUSIC BOT V3" as text, so the exact product name is stated here.
 *
 * @param {string} [subtitle]
 * @param {boolean} [color]
 * @returns {string}
 */
function getBannerText(subtitle, color = false) {
    const lines = [];
    const sig =
        `${IDENTITY.product}  |  ${IDENTITY.madeBy}  |  Discord: ${IDENTITY.discord}`;

    if (color) {
        lines.push(
            `   ${ANSI.purple}${ANSI.bold}${IDENTITY.product}${ANSI.reset}` +
            `${ANSI.grey}  |  ${ANSI.reset}` +
            `${ANSI.white}${ANSI.bold}${IDENTITY.madeBy}${ANSI.reset}` +
            `${ANSI.grey}  |  ${ANSI.reset}` +
            `${ANSI.cyan}Discord: ${IDENTITY.discord}${ANSI.reset}`
        );
        lines.push(`   ${ANSI.grey}${IDENTITY.tagline}${ANSI.reset}`);
    } else {
        lines.push(`   ${sig}`);
        lines.push(`   ${IDENTITY.tagline}`);
    }

    if (subtitle) lines.push(`   ${subtitle}`);
    return lines.join("\n");
}

/**
 * Artwork followed by the signature block — the complete, always-safe banner.
 * Used by `npm run branding`, install.sh-adjacent tooling and tests.
 * @param {{ color?: boolean, subtitle?: string, stream?: NodeJS.WriteStream }} [options]
 * @returns {string}
 */
function getFullBanner(options = {}) {
    const useColor =
        options.color === undefined ? supportsColor(options.stream) : Boolean(options.color);
    return getBanner({ color: useColor }) + "\n" + getBannerText(options.subtitle, useColor);
}

/**
 * Print the banner to a stream (default stdout). Never throws.
 * @param {{ stream?: NodeJS.WriteStream, color?: boolean, subtitle?: string }} [options]
 */
function printBanner(options = {}) {
    const stream = options.stream || process.stdout;
    try {
        const useColor =
            options.color === undefined ? supportsColor(stream) : Boolean(options.color);
        stream.write(
            "\n" + getFullBanner({ color: useColor, subtitle: options.subtitle }) + "\n\n"
        );
    } catch (_err) {
        // Swallow — branding is cosmetic and must never break startup.
    }
}

/** One-time log line proving branding is live (used in startup logs). */
function printSignature(options = {}) {
    const stream = options.stream || process.stdout;
    try {
        const useColor =
            options.color === undefined ? supportsColor(stream) : Boolean(options.color);
        const text = options.extra
            ? getSignature(options.extra)
            : getSignature(options.version ? `v${options.version}` : undefined);
        stream.write(
            useColor
                ? `${ANSI.purple}${ANSI.bold}${text}${ANSI.reset}\n`
                : `${text}\n`
        );
    } catch (_err) {
        /* no-op */
    }
}

/**
 * Verify the three permanent strings survived any future edit.
 *
 * Checks the ACTUAL rendered banner (art + signature, plain and coloured),
 * the embed footer and the identity object — so a regression in any of them
 * is caught, not just a change to the identity constants.
 */
function verifyBranding() {
    const haystack = [
        getBannerArt(),
        getBannerText(),
        getBannerText(undefined, true),
        getFooter(),
        getSignature(),
        JSON.stringify(IDENTITY),
    ].join("\n");
    const missing = REQUIRED_STRINGS.filter((needle) => !haystack.includes(needle));
    return { ok: missing.length === 0, missing, identity: IDENTITY };
}

module.exports = {
    IDENTITY,
    REQUIRED_STRINGS,
    ANSI,
    supportsColor,
    getBannerArt,
    getBanner,
    getBannerText,
    getFullBanner,
    getSignature,
    getFooter,
    printBanner,
    printSignature,
    verifyBranding,
};
