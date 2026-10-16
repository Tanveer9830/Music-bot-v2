#!/usr/bin/env node
/**
 * ============================================================================
 *  TANVEER MUSIC BOT V3 — Test runner
 *  Made by Tanveer  ·  Discord: tanveer5637
 * ============================================================================
 *
 *  A deliberately tiny, dependency-free test runner so `./install.sh` can run
 *  the suite on a fresh VPS without installing any dev tooling.
 *
 *      npm test
 *      node tests/run-tests.js
 *
 *  Each `tests/*.test.js` file exports:
 *      { name: "Group name", tests: [ { name, fn } ] }
 *
 *  `fn` may be synchronous, or return a Promise for async tests. Throwing (or
 *  returning a rejected promise) fails the test.
 *
 *  Exit code 0 = all passed, 1 = at least one failure.
 * ============================================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const branding = require("../utils/branding.js");

const COLOUR = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const c = {
    reset: COLOUR ? "\x1b[0m" : "",
    bold: COLOUR ? "\x1b[1m" : "",
    green: COLOUR ? "\x1b[38;5;41m" : "",
    red: COLOUR ? "\x1b[38;5;203m" : "",
    yellow: COLOUR ? "\x1b[38;5;220m" : "",
    grey: COLOUR ? "\x1b[38;5;245m" : "",
    purple: COLOUR ? "\x1b[38;5;135m" : "",
};

/** Simple deep-freeze helper so tests cannot mutate shared fixtures. */
function deepFreeze(obj) {
    Object.getOwnPropertyNames(obj).forEach((key) => {
        const value = obj[key];
        if (value && typeof value === "object") deepFreeze(value);
    });
    return Object.freeze(obj);
}

async function main() {
    branding.printBanner({ subtitle: "Test suite" });

    const dir = __dirname;
    const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".test.js"))
        .sort();

    if (files.length === 0) {
        console.log("  No test files found.");
        return 0;
    }

    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const file of files) {
        let group;
        try {
            // eslint-disable-next-line global-require
            group = require(path.join(dir, file));
        } catch (err) {
            failed++;
            failures.push(`${file} — failed to load: ${err.message}`);
            console.log(`  ${c.red}FAIL${c.reset}  ${file} (module error)`);
            continue;
        }

        const tests = Array.isArray(group?.tests) ? group.tests : [];
        console.log(`\n  ${c.purple}${c.bold}${group.name || file}${c.reset}`);

        for (const test of tests) {
            const label = test.name || "(unnamed test)";
            try {
                await test.fn(assert, deepFreeze);
                passed++;
                console.log(`    ${c.green}pass${c.reset}  ${label}`);
            } catch (err) {
                failed++;
                failures.push(`${group.name || file} › ${label}: ${err.message}`);
                console.log(`    ${c.red}FAIL${c.reset}  ${label}`);
                console.log(`          ${c.grey}${err.message}${c.reset}`);
            }
        }
    }

    console.log("\n  " + "─".repeat(68));
    console.log(
        `  ${c.bold}${passed} passed${c.reset}, ` +
            `${failed === 0 ? c.green : c.red}${failed} failed${c.reset}`
    );

    if (failures.length) {
        console.log(`\n  ${c.red}${c.bold}Failures${c.reset}`);
        failures.forEach((f) => console.log(`    • ${f}`));
    }
    console.log("");

    branding.printSignature({ extra: failed === 0 ? "tests passed" : "tests FAILED" });
    return failed === 0 ? 0 : 1;
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error("Test runner crashed:", err);
        process.exit(1);
    });
