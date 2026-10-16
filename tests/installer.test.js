/**
 * Installer & repository hygiene tests (offline, static analysis).
 * TANVEER MUSIC BOT V3 · Made by Tanveer · Discord: tanveer5637
 *
 * These do NOT execute install.sh against a real system. They verify the
 * script's structure and its safety guarantees by reading it, plus they check
 * that the repository cannot leak secrets.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/**
 * List the files that could ever be committed, relative to the project root.
 *
 * Uses Git when a repository is present so the answer exactly matches what
 * `git add .` would stage. Falls back to a directory walk (applying the same
 * important exclusions) when the project was shipped without a .git directory,
 * for example as a tarball or inside a Docker build context.
 *
 * @returns {string[]} sorted, POSIX-style relative paths
 */
function listCommittableFiles() {
    try {
        return execFileSync(
            "git",
            ["ls-files", "--cached", "--others", "--exclude-standard"],
            { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        )
            .split("\n")
            .filter(Boolean)
            .sort();
    } catch (_err) {
        // No git, or not a repository — fall back.
    }

    const SKIP_DIRS = new Set([
        ".git",
        "node_modules",
        "coverage",
        "dist",
        "build",
        "out",
        "logs",
        "data",
        "__pycache__",
        ".cache",
    ]);
    const SKIP_FILES = [
        /^\.env$/,
        /^\.env\.backup\./,
        /^config\.local\.js$/,
        /\.log$/,
        /\.zip$/,
        /\.tar\.gz$/,
        /\.pem$/,
        /\.key$/,
    ];

    const out = [];
    const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(path.join(dir, entry.name), rel);
                continue;
            }
            if (SKIP_FILES.some((re) => re.test(rel))) continue;
            out.push(rel);
        }
    };
    walk(ROOT, "");
    return out.sort();
}

module.exports = {
    name: "Installer and repository hygiene",
    tests: [
        {
            name: "install.sh exists and is executable",
            fn(assert) {
                const file = path.join(ROOT, "install.sh");
                assert.ok(fs.existsSync(file), "install.sh is missing");
                const mode = fs.statSync(file).mode & 0o777;
                assert.ok(mode & 0o111, `install.sh is not executable (mode ${mode.toString(8)})`);
            },
        },
        {
            name: "install.sh is syntactically valid bash",
            fn(assert) {
                assert.doesNotThrow(
                    () => execFileSync("bash", ["-n", path.join(ROOT, "install.sh")], { stdio: "pipe" }),
                    "bash -n reported a syntax error in install.sh"
                );
            },
        },
        {
            name: "install.sh starts with a bash shebang and strict mode",
            fn(assert) {
                const src = read("install.sh");
                assert.ok(src.startsWith("#!/usr/bin/env bash"), "wrong or missing shebang");
                assert.ok(/set -Eeuo pipefail/.test(src), "missing `set -Eeuo pipefail` strict mode");
            },
        },
        {
            name: "install.sh never pipes a download straight into a shell",
            fn(assert) {
                const src = read("install.sh");
                // Anchored to the start of a real command line, so prose in
                // help text (e.g. "we never use curl|bash") cannot false-positive.
                const dangerous = [
                    /^\s*(sudo\s+)?(curl|wget)\b[^\n]*\|[^\n]*\b(bash|sh|zsh|dash)\b/m,
                    /\bbash\s+-c\s+["']?\$\(\s*(curl|wget)\b/m,
                ];
                for (const pattern of dangerous) {
                    assert.ok(!pattern.test(src), `found a curl|bash style pattern: ${pattern}`);
                }
            },
        },
        {
            name: "install.sh verifies the Node.js download checksum",
            fn(assert) {
                const src = read("install.sh");
                assert.ok(/SHASUMS256\.txt/.test(src), "does not fetch SHASUMS256.txt");
                assert.ok(/sha256sum/.test(src), "does not verify a sha256 checksum");
            },
        },
        {
            name: "install.sh refuses unsupported operating systems",
            fn(assert) {
                const src = read("install.sh");
                assert.ok(/\/etc\/os-release/.test(src), "does not read /etc/os-release");
                assert.ok(/ubuntu/i.test(src) && /debian/i.test(src), "does not name supported distros");
                assert.ok(/Unsupported operating system/.test(src), "has no unsupported-OS message");
            },
        },
        {
            name: "install.sh never overwrites an existing .env",
            fn(assert) {
                const src = read("install.sh");
                assert.ok(
                    /Existing \.env preserved — it will NOT be overwritten/.test(src),
                    "the .env preservation guarantee is missing"
                );
                // A blind top-level `cp .env.example .env` would be a regression.
                assert.ok(
                    !/^\s*cp\s+["']?\.env\.example["']?\s+["']?\.env/m.test(src),
                    "found an unconditional `cp .env.example .env` that could clobber .env"
                );
            },
        },
        {
            name: "install.sh never uses destructive filesystem or security commands",
            fn(assert) {
                const src = read("install.sh");
                // Anchored to line start so ordinary prose cannot false-positive.
                const banned = [
                    /^\s*rm\s+-rf\s+["']?\$APP_DIR/m,
                    /^\s*rm\s+-rf\s+\/(\s|$)/m,
                    /^\s*rm\s+-rf\s+\.\s*$/m,
                    /^\s*git\s+reset\s+--hard/m,
                    /^\s*git\s+clean\s+-[a-z]*f/m,
                    /^\s*mkfs/m,
                    /^\s*dd\s+if=/m,
                    /^\s*(sudo\s+)?(shutdown|reboot|poweroff|halt)\b/m,
                    /^\s*(sudo\s+)?iptables\b/m,
                    /^\s*(sudo\s+)?ufw\s+(disable|reset)\b/m,
                    /^\s*(sudo\s+)?systemctl\s+(disable|mask)\s+ssh/m,
                    /PermitRootLogin|^\s*PasswordAuthentication\s+no/m,
                ];
                for (const pattern of banned) {
                    assert.ok(!pattern.test(src), `install.sh contains a banned pattern: ${pattern}`);
                }
            },
        },
        {
            name: "install.sh supports safe reruns and the documented flags",
            fn(assert) {
                const src = read("install.sh");
                for (const flag of [
                    "--yes",
                    "--no-service",
                    "--service",
                    "--skip-deps",
                    "--no-tests",
                    "--dry-run",
                    "--help",
                ]) {
                    assert.ok(src.includes(flag), `missing supported flag: ${flag}`);
                }
            },
        },
        {
            name: "install.sh supports a strictly read-only dry run",
            fn(assert) {
                const src = read("install.sh");
                assert.ok(/strictly read-only/.test(src), "dry-run read-only guarantee is not documented");
                assert.ok(/\[dry-run\] no \.env yet/.test(src), "dry run does not guard .env creation");
            },
        },
        {
            name: "install.sh masks secrets and never echoes them",
            fn(assert) {
                const src = read("install.sh");
                assert.ok(/read -r -s/.test(src), "no silent (hidden) prompt for the token");
                assert.ok(/input hidden/.test(src), "the hidden prompt does not say the input is hidden");
                assert.ok(!/\becho\s+["']?\$TOKEN/.test(src), "install.sh echoes the token");
                assert.ok(!/\becho\s+["']?\$LAV_PASS/.test(src), "install.sh echoes the Lavalink password");
                assert.ok(
                    !/printf[^\n]*\$TOKEN[^\n]*\\n[^\n]*$/m.test(src.replace(/env_set[^\n]*/g, "")),
                    "install.sh may print the token value"
                );
            },
        },
        {
            name: "install.sh discovers the entry point instead of hardcoding it",
            fn(assert) {
                const src = read("install.sh");
                assert.ok(
                    /require\("\.\/package\.json"\)/.test(src),
                    "install.sh does not read the entry point from package.json"
                );
                assert.ok(/ENTRY_POINT/.test(src), "ENTRY_POINT is not used");
            },
        },
        {
            name: "install.sh prefers the lockfile for reproducible installs",
            fn(assert) {
                const src = read("install.sh");
                assert.ok(/npm ci/.test(src), "install.sh never uses `npm ci`");
                assert.ok(/package-lock\.json/.test(src), "install.sh does not check for the lockfile");
            },
        },
        {
            name: "install.sh distinguishes a static check from a live connection",
            fn(assert) {
                const src = read("install.sh");
                assert.ok(
                    /does NOT prove Lavalink is reachable/.test(src),
                    "install.sh does not qualify its Lavalink validation"
                );
                assert.ok(/doctor -- --live/.test(src), "install.sh does not point at the live check");
            },
        },
        {
            name: "install.sh sets restrictive permissions on the secrets file",
            fn(assert) {
                const src = read("install.sh");
                assert.ok(/chmod 600 "\$ENV_FILE"/.test(src), "install.sh does not chmod 600 .env");
            },
        },
        {
            name: "install.sh offers systemd support and allows skipping it",
            fn(assert) {
                const src = read("install.sh");
                assert.ok(/systemctl enable/.test(src), "never enables the service");
                assert.ok(/systemctl daemon-reload/.test(src), "never reloads systemd");
                assert.ok(/journalctl/.test(src), "does not document log inspection");
                assert.ok(/WANT_SERVICE/.test(src), "service installation is not optional");
            },
        },
        {
            name: ".gitignore protects .env and config.local.js",
            fn(assert) {
                const ignore = read(".gitignore");
                assert.ok(/^\.env$/m.test(ignore), ".gitignore does not ignore .env");
                assert.ok(/^config\.local\.js$/m.test(ignore), ".gitignore does not ignore config.local.js");
                assert.ok(/^!\.env\.example$/m.test(ignore), ".env.example should still be tracked");
                assert.ok(/^node_modules\/$/m.test(ignore), ".gitignore does not ignore node_modules");
                assert.ok(/\*\.log/m.test(ignore), ".gitignore does not ignore log files");
                assert.ok(/\*\.zip/m.test(ignore), ".gitignore does not exclude zip archives");
                assert.ok(/^data\/$/m.test(ignore), ".gitignore does not protect runtime data");
            },
        },
        {
            name: "no committable file contains a real Discord token",
            fn(assert) {
                // Prefer Git's own view: tracked files plus untracked files that
                // .gitignore does NOT exclude. When the project was deployed as
                // a plain tarball (no .git), fall back to a directory walk that
                // applies the same important exclusions. Either way the test is
                // meaningful — it never silently passes.
                const files = listCommittableFiles();
                assert.ok(files.length > 5, "could not enumerate project files to scan");

                const offenders = [];
                for (const rel of files) {
                    if (/\.(png|jpg|jpeg|gif|zip|gz|jar|woff2?|ico)$/i.test(rel)) continue;
                    let text;
                    try {
                        text = fs.readFileSync(path.join(ROOT, rel), "utf8");
                    } catch (_e) {
                        continue;
                    }
                    if (/[MN][A-Za-z\d_-]{22,}\.[\w-]{6,}\.[\w-]{27,}/.test(text)) {
                        offenders.push(rel);
                    }
                }
                assert.deepStrictEqual(
                    offenders,
                    [],
                    `possible bot tokens found in: ${offenders.join(", ")}`
                );
            },
        },
        {
            name: "the secret-scan fallback excludes .env and config.local.js",
            fn(assert) {
                const files = listCommittableFiles();
                assert.ok(!files.includes(".env"), ".env must be excluded from scans and commits");
                assert.ok(
                    !files.includes("config.local.js"),
                    "config.local.js must be excluded from scans and commits"
                );
                assert.ok(
                    !files.some((f) => f.startsWith("node_modules/")),
                    "node_modules must be excluded"
                );
                assert.ok(files.includes("index.js"), "the scan did not find the bot entry point");
            },
        },
        {
            name: "systemd unit template uses the expected placeholders",
            fn(assert) {
                const unit = read("deploy/tanveer-music-bot.service.in");
                for (const token of [
                    "@@APP_DIR@@",
                    "@@RUN_USER@@",
                    "@@RUN_GROUP@@",
                    "@@NODE_BIN@@",
                    "@@ENTRY_POINT@@",
                ]) {
                    assert.ok(unit.includes(token), `service template is missing ${token}`);
                }
                assert.ok(/Restart=on-failure/.test(unit), "service does not restart after a crash");
                assert.ok(/EnvironmentFile=/.test(unit), "service does not load .env as an EnvironmentFile");
                assert.ok(/WantedBy=multi-user\.target/.test(unit), "service is not enabled at boot");
                assert.ok(unit.includes("TANVEER MUSIC BOT V3"), "service description lost the branding");
            },
        },
        {
            name: "package.json exposes start, test and doctor scripts",
            fn(assert) {
                const pkg = JSON.parse(read("package.json"));
                assert.ok(pkg.scripts && pkg.scripts.start, "npm start is not defined");
                assert.ok(pkg.scripts.test, "npm test is not defined");
                assert.ok(pkg.scripts.doctor, "npm run doctor is not defined");
                assert.ok(pkg.main, "package.json has no entry point");
                assert.ok(
                    fs.existsSync(path.join(ROOT, pkg.scripts.start.replace(/^node\s+/, ""))),
                    "the npm start target does not exist"
                );
                assert.ok(
                    fs.existsSync(path.join(ROOT, pkg.main)),
                    `the declared entry point "${pkg.main}" does not exist`
                );
            },
        },
        {
            name: "package.json declares the runtime dependency set",
            fn(assert) {
                const pkg = JSON.parse(read("package.json"));
                for (const dep of ["discord.js", "riffy", "riffy-spotify"]) {
                    assert.ok(
                        Object.prototype.hasOwnProperty.call(pkg.dependencies || {}, dep),
                        `missing runtime dependency: ${dep}`
                    );
                }
                assert.ok(fs.existsSync(path.join(ROOT, "package-lock.json")), "lockfile is missing");
            },
        },
        {
            name: "the package-lock.json stayed in sync with package.json",
            fn(assert) {
                const pkg = JSON.parse(read("package.json"));
                const lock = JSON.parse(read("package-lock.json"));
                assert.strictEqual(lock.name, pkg.name, "lockfile name differs from package.json");
                assert.strictEqual(lock.version, pkg.version, "lockfile version differs from package.json");
                for (const [dep, range] of Object.entries(pkg.dependencies || {})) {
                    assert.strictEqual(
                        lock.packages?.[""]?.dependencies?.[dep],
                        range,
                        `lockfile is out of sync for dependency "${dep}"`
                    );
                }
            },
        },
        {
            name: "the existing music code and commands are preserved",
            fn(assert) {
                const index = read("index.js");
                // Every pre-existing slash command must still be registered.
                const commands = [
                    "play",
                    "playnext",
                    "pause",
                    "resume",
                    "skip",
                    "stop",
                    "queue",
                    "nowplaying",
                    "volume",
                    "shuffle",
                    "loop",
                    "remove",
                    "move",
                    "jump",
                    "replay",
                    "clear",
                    "help",
                    "lyrics",
                    "seek",
                    "bassboost",
                    "filters",
                    "history",
                    "247",
                ];
                for (const cmd of commands) {
                    assert.ok(
                        index.includes(`setName("${cmd}")`),
                        `slash command /${cmd} was removed`
                    );
                }
                assert.ok(/Riffy/.test(index), "the Riffy/Lavalink client is gone");
                assert.ok(/riffy\.init/.test(index), "Riffy is never initialised");
            },
        },
        {
            name: "README contains the banner and all mandatory branding",
            fn(assert) {
                const readme = read("README.md");
                for (const needle of [
                    "TANVEER MUSIC BOT V3",
                    "MADE BY TANVEER",
                    "Discord: tanveer5637",
                ]) {
                    assert.ok(readme.includes(needle), `README is missing "${needle}"`);
                }
                assert.ok(
                    readme.includes("+======================================================================+"),
                    "README does not contain the ASCII banner box"
                );
            },
        },
        {
            name: "the README banner is byte-identical to branding/banner.txt",
            fn(assert) {
                const readme = read("README.md");
                const branding = require("../utils/branding.js");
                const art = branding.getBannerArt();
                assert.ok(
                    readme.includes(art),
                    "the README banner has drifted from branding/banner.txt — " +
                        "one source of truth is required"
                );
            },
        },
        {
            name: "branding is wired into the bot's embeds and startup",
            fn(assert) {
                const index = read("index.js");
                const messages = read("utils/messages.js");
                assert.ok(/require\("\.\/utils\/branding\.js"\)/.test(index), "index.js does not use the branding module");
                assert.ok(/require\("\.\/branding\.js"\)/.test(messages), "messages.js does not use the branding module");
                assert.ok(/branding\.printBanner/.test(index), "the banner is not printed at startup");
                assert.ok(/branding\.printSignature/.test(index), "no startup signature line");
                assert.ok(/branding\.getFooter/.test(messages), "embed footers do not use the branding module");
            },
        },
        {
            name: "README documents the one-command installation",
            fn(assert) {
                const readme = read("README.md");
                assert.ok(readme.includes("git clone"), "README does not show git clone");
                assert.ok(readme.includes("./install.sh"), "README does not show the installer");
                assert.ok(readme.includes("chmod +x install.sh"), "README does not show chmod +x");
                assert.ok(readme.includes("Tanveer9830/Music-bot-v2"), "README does not name the real repo");
            },
        },
        {
            name: "README does not leak secrets",
            fn(assert) {
                const readme = read("README.md");
                assert.ok(
                    !/[MN][A-Za-z\d_-]{22,}\.[\w-]{6,}\.[\w-]{27,}/.test(readme),
                    "README appears to contain a real bot token"
                );
            },
        },
    ],
};
