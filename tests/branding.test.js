/**
 * Branding tests — the permanent creator identity must never regress.
 * TANVEER MUSIC BOT V3 · Made by Tanveer · Discord: tanveer5637
 */

"use strict";

const fs = require("fs");
const path = require("path");

const branding = require("../utils/branding.js");

const ROOT = path.join(__dirname, "..");

module.exports = {
    name: "Branding (permanent identity)",
    tests: [
        {
            name: "the three mandatory strings are present in the branding module",
            fn(assert) {
                const result = branding.verifyBranding();
                assert.ok(
                    result.ok,
                    `missing branding strings: ${result.missing.join(", ")}`
                );
                for (const needle of [
                    "TANVEER MUSIC BOT V3",
                    "MADE BY TANVEER",
                    "Discord: tanveer5637",
                ]) {
                    assert.ok(
                        branding.REQUIRED_STRINGS.includes(needle),
                        `REQUIRED_STRINGS is missing "${needle}"`
                    );
                }
            },
        },
        {
            name: "the rendered banner (art + signature) contains all three mandatory strings",
            fn(assert) {
                for (const colour of [false, true]) {
                    const rendered = branding.getFullBanner({ color: colour });
                    for (const needle of [
                        "TANVEER MUSIC BOT V3",
                        "MADE BY TANVEER",
                        "Discord: tanveer5637",
                    ]) {
                        assert.ok(
                            rendered.includes(needle),
                            `rendered banner (color=${colour}) is missing "${needle}"`
                        );
                    }
                }
            },
        },
        {
            name: "the raw art file still names the product and the creator",
            fn(assert) {
                const banner = fs.readFileSync(
                    path.join(ROOT, "branding", "banner.txt"),
                    "utf8"
                );
                assert.ok(banner.includes("MUSIC BOT V3"), "product name missing from the art");
                assert.ok(
                    /M A D E\s+B Y\s+T A N V E E R/.test(banner),
                    "creator line missing from the art"
                );
                assert.ok(banner.includes("Discord: tanveer5637"), "discord handle missing from the art");
            },
        },
        {
            name: "banner box is perfectly aligned (every line is the same width)",
            fn(assert) {
                const lines = branding.getBannerArt().split("\n");
                const widths = [...new Set(lines.map((l) => l.length))];
                assert.strictEqual(
                    widths.length,
                    1,
                    `banner lines have differing widths: ${widths.join(", ")}`
                );
            },
        },
        {
            name: "every banner row is properly framed by | or +",
            fn(assert) {
                for (const line of branding.getBannerArt().split("\n")) {
                    const framed =
                        (line.startsWith("|") && line.endsWith("|")) ||
                        (line.startsWith("+") && line.endsWith("+"));
                    assert.ok(framed, `row is not framed: ${JSON.stringify(line)}`);
                }
            },
        },
        {
            name: "banner is pure ASCII so it renders in any terminal locale",
            fn(assert) {
                // eslint-disable-next-line no-control-regex
                assert.ok(
                    !/[^\x00-\x7F]/.test(branding.getBannerArt()),
                    "banner contains non-ASCII characters"
                );
            },
        },
        {
            name: "creator is spelled \"Tanveer\" — never \"Tanvir\"",
            fn(assert) {
                const haystack = [
                    branding.getBannerArt(),
                    JSON.stringify(branding.IDENTITY),
                    branding.getFooter(),
                    branding.getSignature(),
                ].join("\n");
                assert.ok(haystack.includes("Tanveer"), "correct spelling missing");
                assert.ok(
                    !/Tanvir\b/i.test(haystack),
                    'found the misspelling "Tanvir" in branding output'
                );
            },
        },
        {
            name: "Discord username is exactly tanveer5637",
            fn(assert) {
                assert.strictEqual(branding.IDENTITY.discord, "tanveer5637");
            },
        },
        {
            name: "coloured output adds ANSI codes without losing any mandatory string",
            fn(assert) {
                const coloured = branding.getFullBanner({ color: true });
                assert.ok(/\x1b\[/.test(coloured), "coloured output contains no ANSI codes");
                assert.ok(coloured.includes("TANVEER MUSIC BOT V3"));
                assert.ok(coloured.includes("MADE BY TANVEER"));
                assert.ok(coloured.includes("tanveer5637"));
                // The escape codes must not split the mandatory strings.
                const stripped = coloured.replace(/\x1b\[[0-9;]*m/g, "");
                for (const needle of branding.REQUIRED_STRINGS) {
                    assert.ok(stripped.includes(needle), `ANSI codes broke "${needle}"`);
                }
            },
        },
        {
            name: "plain output has no ANSI escape codes",
            fn(assert) {
                // eslint-disable-next-line no-control-regex
                assert.ok(
                    !/\x1b\[/.test(branding.getFullBanner({ color: false })),
                    "plain banner contains ANSI escapes"
                );
            },
        },
        {
            name: "colouring throws nothing on hostile input",
            fn(assert) {
                assert.doesNotThrow(() => branding.getBanner({ color: true }));
                assert.doesNotThrow(() => branding.getBanner({ color: false }));
                assert.doesNotThrow(() => branding.getBannerText("subtitle"));
                assert.doesNotThrow(() => branding.getFullBanner({ color: true, subtitle: "s" }));
                assert.doesNotThrow(() => branding.getFooter(undefined));
                assert.doesNotThrow(() => branding.getFooter("x".repeat(5000)));
            },
        },
        {
            name: "footer never exceeds Discord's 2048-character limit",
            fn(assert) {
                assert.ok(branding.getFooter().length <= 2048);
                assert.ok(branding.getFooter("y".repeat(10000)).length <= 2048);
            },
        },
        {
            name: "printBanner never throws, even on a broken stream",
            fn(assert) {
                const broken = {
                    write() { throw new Error("EPIPE"); },
                };
                assert.doesNotThrow(() => branding.printBanner({ stream: broken }));
                assert.doesNotThrow(() => branding.printSignature({ stream: broken }));
            },
        },
        {
            name: "colour is disabled for non-TTY streams, dumb terminals and NO_COLOR",
            fn(assert) {
                const nonTty = { isTTY: false };
                assert.strictEqual(branding.supportsColor(nonTty), false);

                const saved = {
                    NO_COLOR: process.env.NO_COLOR,
                    TERM: process.env.TERM,
                    FORCE_COLOR: process.env.FORCE_COLOR,
                    CI: process.env.CI,
                };
                const tty = { isTTY: true };
                delete process.env.FORCE_COLOR;
                delete process.env.CI;

                process.env.TERM = "dumb";
                assert.strictEqual(branding.supportsColor(tty), false, "TERM=dumb must disable colour");

                process.env.TERM = "xterm-256color";
                process.env.NO_COLOR = "1";
                assert.strictEqual(branding.supportsColor(tty), false, "NO_COLOR must disable colour");

                delete process.env.NO_COLOR;
                assert.strictEqual(branding.supportsColor(tty), true, "a colour TTY should enable colour");

                // Restore the environment.
                for (const [key, value] of Object.entries(saved)) {
                    if (value === undefined) delete process.env[key];
                    else process.env[key] = value;
                }
            },
        },
        {
            name: "signature line carries product, creator and handle",
            fn(assert) {
                const sig = branding.getSignature();
                assert.ok(sig.includes("TANVEER MUSIC BOT V3"));
                assert.ok(sig.includes("MADE BY TANVEER"));
                assert.ok(sig.includes("Discord: tanveer5637"));
            },
        },
    ],
};
