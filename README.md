```text
+======================================================================+
|                                                                      |
|  TTTTTTT   AAAAA   N   N  V   V  EEEEE  EEEEE  RRRRR   MUSIC BOT V3  |
|     T      A   A   NN  N  V   V  E      E      R   R                 |
|     T      AAAAA   N N N   V V   EEEE   EEEE   RRRR                  |
|     T      A   A   N  NN    V    E      E      R  R                  |
|     T      A   A   N   N    V    EEEEE  EEEEE  R   R                 |
|                                                                      |
|                    M A D E   B Y   T A N V E E R                     |
|                                                                      |
|                      Discord: tanveer5637                            |
|                    Premium Music Experience                          |
|                                                                      |
+======================================================================+
```

<div align="center">

**TANVEER MUSIC BOT V3** · **MADE BY TANVEER** · **Discord: tanveer5637**

A premium Discord music bot powered by **discord.js v14** + **Riffy** + **Lavalink v4**.
One-command Ubuntu/Debian VPS installer. Permanent creator branding.

</div>

---

## Table of contents

- [What this bot does](#what-this-bot-does)
- [Requirements](#requirements)
- [One-command installation](#one-command-installation)
- [Discord Developer Portal setup](#discord-developer-portal-setup)
- [Environment variables](#environment-variables)
- [Lavalink setup and connection](#lavalink-setup-and-connection)
- [Running the bot](#running-the-bot)
- [systemd service (auto-start)](#systemd-service-auto-start)
- [Updating safely](#updating-safely)
- [Troubleshooting](#troubleshooting)
- [Security guidance](#security-guidance)
- [Project structure](#project-structure)
- [Credits](#credits)

---

## What this bot does

TANVEER MUSIC BOT V3 is a slash-command music bot. All commands are Discord
application commands (`/play`, `/queue`, …) plus an interactive Now Playing card
with buttons.

### Music commands

| Command | What it does |
|---|---|
| `/play <song>` | Search YouTube, or paste a YouTube / Spotify URL. Shows a picker for the top 5 results. |
| `/playnext <song>` | Insert a track at the **top** of the queue so it plays next. |
| `/pause` · `/resume` | Pause or resume the current track. |
| `/skip` | Skip the current track (records it as a manual skip so autoplay/topic mode do not override you). |
| `/stop` | Stop playback and leave the voice channel. |
| `/queue` | Paged queue view with buttons. |
| `/nowplaying` | Re-post the Now Playing card. |
| `/volume <0-100>` | Set the player volume. |
| `/shuffle` | Shuffle the queue. |
| `/loop` | Cycle **Off → Track → Queue**. |
| `/remove <pos>` | Remove one track from the queue. |
| `/move <from> <to>` | Reorder the queue. |
| `/jump <pos>` | Jump straight to a queue position. |
| `/replay` | Restart the current track from 0:00. |
| `/clear` | Empty the queue. |
| `/seek <time>` | Seek to a timestamp (`1:30` or `90`). |

### Effects and extras

| Command | What it does |
|---|---|
| `/bassboost <level>` | Bass boost: `off` / `low` / `medium` / `high` / `insane`. |
| `/filters <filter>` | Audio FX: nightcore, vaporwave, 8D, karaoke, tremolo, vibrato, soft, pop, or `reset`. |
| `/history` | Recently played tracks for this session. |
| `/lyrics [song]` | Fetch lyrics for the current track or a named song. |
| `/247` | Toggle **24/7 mode** — the bot stays in the voice channel forever. |
| `/help` | All commands plus the button reference. |
| `/about` | **Creator credit, version, uptime and Lavalink node status.** |
| `/ping` | Gateway latency and Lavalink node status. |

### The Now Playing card

Interactive buttons in three rows:

- **Row 1** — Loop · Seek −15s · Pause/Resume · Skip · Shuffle
- **Row 2** — Queue · Volume − · Stop · Volume + · Autoplay
- **Row 3** — Topic Play · Filters

### Behaviour worth knowing

- **Idle timeout:** after the queue ends the bot waits **1 week** before leaving.
- **Alone in voice:** if everyone leaves, the bot warns, then leaves after **3 minutes**.
- **24/7 mode** (`/247`) disables both of the above.
- **Autoplay** keeps music going by seeding a related track from the last song's artist.
- **Topic Play** keeps a themed session going.
- **Reconnection:** Riffy retries the Lavalink node 20 times with a 5-second delay.
- **Graceful shutdown:** `SIGTERM`/`SIGINT` destroy players cleanly before exit, so
  `systemctl restart` never leaves a zombie voice connection.

> **Honest note:** playback requires a **running Lavalink server**. The bot itself
> only sends commands to Lavalink. See [Lavalink setup](#lavalink-setup-and-connection).

---

## Requirements

| | Minimum | Recommended |
|---|---|---|
| OS | Ubuntu 20.04 · Debian 11 | Ubuntu 22.04 / 24.04 · Debian 12 |
| Node.js | **18** | **22 LTS** |
| RAM | 512 MB (bot only) | 1 GB+ **plus** Lavalink's own memory |
| Disk | ~150 MB | 1 GB+ |
| Network | Outbound HTTPS to Discord + your Lavalink host | — |
| Other | A Discord application (bot) | A Lavalink v4 server |

The installer checks all of this for you and refuses to run on unsupported systems.

---

## One-command installation

The repository is **<https://github.com/Tanveer9830/Music-bot-v2>**
(owner: `Tanveer9830`, default branch: `main`).

Copy and paste this into your VPS:

```bash
git clone https://github.com/Tanveer9830/Music-bot-v2.git && cd Music-bot-v2 && chmod +x install.sh && ./install.sh
```

That single command will:

1. Print the **TANVEER MUSIC BOT V3** banner.
2. Verify this is really the bot project and that the entry point exists.
3. Confirm your OS is Ubuntu/Debian (and refuse clearly if it is not).
4. Ensure **Node.js 18+** and **npm** are installed — using APT when it is new
   enough, otherwise the official Node.js binary from `nodejs.org`
   **verified against `SHASUMS256.txt`**. It never pipes a download into a shell.
5. Create `.env` from `.env.example` — **only if `.env` does not already exist** —
   and lock it to mode `600`.
6. Prompt you (input hidden) for the Discord bot token and, optionally, the
   application ID, a development guild ID, and Lavalink details. **Lavalink can
   be skipped and configured later.**
7. Install dependencies reproducibly with `npm ci` (falling back to `npm install`).
8. Validate the configuration with the built-in doctor — **without printing any secret**.
9. Run the test suite.
10. Offer to install a **systemd service** so the bot starts on boot and restarts
    after a crash.
11. Print a summary, next steps, and honest status notes.

### Installer options

| Flag | Effect |
|---|---|
| `-y`, `--yes` | Non-interactive. Combine with environment variables for automation. |
| `--service` / `--no-service` | Install (or skip) the systemd service without being asked. |
| `--service-user <name>` | Run the service as this user instead of the auto-detected one. |
| `--skip-deps` | Do not run `npm install`. |
| `--no-tests` | Skip the test suite. |
| `--no-start` | Never start the bot at the end. |
| `--dry-run` | Print every step and change **nothing at all**. |
| `-h`, `--help` | Show usage. |

Fully unattended example:

```bash
DISCORD_TOKEN='your-token' \
DISCORD_CLIENT_ID='your-app-id' \
LAVALINK_HOST='127.0.0.1' LAVALINK_PORT='2333' LAVALINK_PASSWORD='your-password' \
./install.sh --yes --service
```

### Re-running is always safe

`./install.sh` is **idempotent**. Running it again to upgrade:

- **Never** touches an existing `.env` (it reads it and keeps every value).
- Writes a timestamped `.env.backup.*` before changing anything.
- **Never** deletes `node_modules`, databases, configuration or music data.
- Reinstalls only what is missing.

To be certain about a change first, run `./install.sh --dry-run`.

---

## Discord Developer Portal setup

1. Go to <https://discord.com/developers/applications> and click **New Application**.
   Name it whatever you like — for example `TANVEER MUSIC BOT V3`.
2. Open the **Bot** tab and click **Reset Token** → **Copy**. This is your
   `DISCORD_TOKEN`. Treat it like a password.
3. Still on the **Bot** tab, scroll to **Privileged Gateway Intents** and enable:
   - **Server Members Intent**
   - **Message Content Intent**
4. Open **General Information** and copy the **Application ID** — this is
   `DISCORD_CLIENT_ID`. *(Optional: the bot derives it from the token automatically.)*
5. Invite the bot: **OAuth2 → URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: **Connect**, **Speak**, **Send Messages**,
     **Embed Links**, **Read Message History**, **Use External Emojis**
   - Open the generated URL and add the bot to your server.

> Slash commands registered **globally** can take up to an hour to appear the
> first time. Set `DISCORD_GUILD_ID` to one server's ID during testing and they
> appear **instantly** in that server.

---

## Environment variables

All configuration lives in `.env` (mode `600`, never committed). Start from the
template:

```bash
cp .env.example .env && chmod 600 .env && nano .env
```

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DISCORD_TOKEN` | **Yes** | — | Bot token from the Developer Portal. |
| `DISCORD_CLIENT_ID` | No | derived from the token | Application ID. |
| `DISCORD_GUILD_ID` | No | — | Dev server ID → instant command registration. |
| `LAVALINK_HOST` | For playback | `127.0.0.1` | Hostname or IP of your Lavalink server. |
| `LAVALINK_PORT` | For playback | `2333` | Lavalink's own default. |
| `LAVALINK_PASSWORD` | For playback | `youshallnotpass` | Must match `lavalink.server.password`. |
| `LAVALINK_SECURE` | No | `false` | `true` only for `wss://` / `https://`. |
| `LAVALINK_NAME` | No | `Main Node` | Label used in logs. |
| `LAVALINK_RETRY_AMOUNT` | No | `20` | Reconnection attempts. |
| `LAVALINK_RETRY_DELAY` | No | `5000` | Delay between attempts (ms). |
| `SPOTIFY_CLIENT_ID` | No | — | Set **both** Spotify values, or neither. |
| `SPOTIFY_CLIENT_SECRET` | No | — | Never commit this. |
| `EMBED_COLOR` | No | `#7B2FBE` | Accent colour for embeds. |
| `FOOTER_TEXT` | No | `Made by Tanveer • Discord: tanveer5637` | Embed footer. |
| `NODE_ENV` | No | `production` | `development` tunes the runtime. |
| `FORCE_COLOR` | No | auto | `1` forces ANSI colour, `0` disables it. |

**No Gmail address, personal information, or unrelated credentials are ever
required.** Only Discord and (optionally) Lavalink and Spotify.

### Verify your configuration

```bash
npm run doctor          # static checks — works offline
npm run doctor -- --live   # ALSO performs a real Lavalink handshake
```

`npm run doctor` validates structure only. **`--live` is the only thing that
proves Lavalink is genuinely reachable and that your password is accepted.**

---

## Lavalink setup and connection

The bot does **not** stream audio itself. It connects to a **Lavalink v4** server
over WebSocket and tells it what to play. You need one Lavalink node.

### Connecting to a Lavalink server you already have

Just put its details in `.env`:

```env
LAVALINK_HOST=your.lavalink.host      # or 127.0.0.1 when it runs on this VPS
LAVALINK_PORT=2333
LAVALINK_PASSWORD=your-lavalink-password
LAVALINK_SECURE=false                 # true for wss:// / https://
LAVALINK_NAME=Main Node
```

Then confirm it for real:

```bash
npm run doctor -- --live
```

A successful run ends with a line like
`[ OK ] Lavalink (live/handshake) node "Main Node" handshake succeeded — Lavalink 4.x`.

### Installing Lavalink on the same VPS

The installer deliberately does **not** install Lavalink for you: it needs a Java
runtime and its own memory budget, and there is no single "correct" filesystem
path. Set it up separately:

```bash
sudo apt-get update && sudo apt-get install -y openjdk-17-jre-headless   # Java 17+
mkdir -p ~/lavalink && cd ~/lavalink
# Download the Lavalink v4 jar from https://github.com/lavalink-devs/Lavalink/releases
# then create application.yml from the example in that repository.
java -jar Lavalink.jar
```

Your `application.yml` must contain something like:

```yaml
server:
  port: 2333
  address: 127.0.0.1        # keep it on loopback — do not expose it publicly
lavalink:
  server:
    password: "change-this-to-a-long-random-value"
    sources:
      youtube: true
      soundcloud: true
```

Then set `LAVALINK_HOST=127.0.0.1`, `LAVALINK_PORT=2333` and
`LAVALINK_PASSWORD=<the same password>` in `.env`.

### Finishing Lavalink later

If you skipped Lavalink during installation, the bot still starts and `/help`,
`/about` and `/ping` still work — `/play` will report that the node is not
connected. To finish:

```bash
nano .env                 # set LAVALINK_HOST / PORT / PASSWORD
npm run doctor -- --live
sudo systemctl restart tanveer-music-bot
```

### Keeping Lavalink private

Lavalink's default port `2333` is unauthenticated apart from the password.
**Never expose it to the public internet.** Keep it on `127.0.0.1`, or if the
node is remote, restrict it with a firewall rule:

```bash
# allow only your bot's IP to reach Lavalink
sudo ufw allow from <your-bot-ip> to any port 2333 proto tcp
sudo ufw deny 2333
```

The installer never disables your firewall or SSH configuration.

---

## Running the bot

```bash
npm start                 # foreground
npm test                  # run the test suite
npm run doctor            # validate configuration (static)
npm run doctor -- --live  # validate configuration AND the Lavalink connection
npm run branding          # print the TANVEER banner
```

Startup logs show the banner, the running version, and the rendered signature:

```text
TANVEER MUSIC BOT V3 | MADE BY TANVEER | Discord: tanveer5637 | v3.0.0 · starting
✔ Logged in as YourBot#1234
TANVEER MUSIC BOT V3 | MADE BY TANVEER | Discord: tanveer5637 | online as YourBot#1234
🎵 Lavalink node "Main Node" → ws://127.0.0.1:2333
```

---

## systemd service (auto-start)

The installer offers this automatically. To install it later:

```bash
sudo ./install.sh --service
```

It writes `/etc/systemd/system/tanveer-music-bot.service` (rendered from
`deploy/tanveer-music-bot.service.in`), loads your `.env` as an
`EnvironmentFile`, restarts on failure, and starts on boot.

```bash
sudo systemctl start   tanveer-music-bot
sudo systemctl stop    tanveer-music-bot
sudo systemctl restart tanveer-music-bot
sudo systemctl status  tanveer-music-bot
sudo systemctl disable tanveer-music-bot     # stop auto-starting

sudo journalctl -u tanveer-music-bot -f                    # live logs
sudo journalctl -u tanveer-music-bot -n 100 --no-pager     # last 100 lines
sudo journalctl -u tanveer-music-bot --since "10 min ago"
```

Shortcuts: `npm run service:status`, `npm run service:restart`, `npm run logs`.

If you edit the unit file by hand:

```bash
sudo systemctl daemon-reload && sudo systemctl restart tanveer-music-bot
```

---

## Updating safely

**Already cloned? Do not clone again.** From inside the project directory:

```bash
cd ~/Music-bot-v2
git pull                      # fetch the new code
./install.sh                  # re-run the installer — .env and data are preserved
sudo systemctl restart tanveer-music-bot   # only if you use the service
```

What is preserved across an update:

- `.env` — never overwritten
- `node_modules` — only what changed is touched
- `config.local.js` — left alone (git-ignored)
- any `data/`, `*.db`, `*.sqlite` files — never deleted

Risky or destructive commands are **never** used. To see exactly what an update
would do, run `./install.sh --dry-run` first.

If the update pulls in a changed `package-lock.json`, the installer reruns
`npm ci` for you.

Rolling back:

```bash
git log --oneline -10          # find the previous commit
git checkout <commit-sha>
./install.sh
```

---

## Troubleshooting

### `/play` says "Music node not connected"

The Lavalink node is unreachable. Check, in order:

```bash
npm run doctor -- --live           # does the handshake succeed?
sudo systemctl status tanveer-music-bot
tail -n 50 <lavalink-dir>/logs/latest.log
```

Common causes: Lavalink is not running; the port is wrong (`2333` is only a
default); the password does not match `lavalink.server.password`; a firewall
blocks the port; or `LAVALINK_HOST` says `localhost` where only `127.0.0.1`
is bound.

### "Used disallowed intents" / the bot won't log in

Enable **Message Content Intent** and **Server Members Intent** in the Developer
Portal → Bot → Privileged Gateway Intents, then restart the bot.

### Slash commands don't appear

- Global registration can take up to **1 hour**. Set `DISCORD_GUILD_ID` to your
  server's ID for instant registration, then restart.
- The bot needs the `applications.commands` scope. Re-invite it using the
  OAuth2 URL Generator.

### "The application did not respond"

Usually a Lavalink timeout — the node took too long to resolve the query. Verify
with `npm run doctor -- --live` and check the Lavalink log.

### YouTube search/playback fails but the node is connected

Lavalink needs a working YouTube source plugin (LavaSrc or a recent Lavalink
build). Check your `application.yml` sources and Lavalink's release notes; this
is server-side and unrelated to this bot's code.

### The bot joins but there is no sound

- Give the bot **Connect** and **Speak** in the voice channel's permissions.
- Check `/volume` is not `0`.
- Look for `filters` still applied from an earlier session — use `/filters reset`.

### `npm ci` fails

```bash
node -v                 # must be 18+
npm cache clean --force
npm ci --omit=dev
```

If a proxy is required: `npm config set proxy http://your-proxy:port`.

### `./install.sh` says "Unsupported operating system"

It targets Ubuntu and Debian. On another distribution, install manually:

```bash
cp .env.example .env && chmod 600 .env     # fill in your credentials
npm ci --omit=dev
npm run doctor
npm start
```

### The service fails to start

```bash
sudo journalctl -u tanveer-music-bot -n 50 --no-pager
sudo systemctl cat tanveer-music-bot        # confirm the working directory
```

Most often: the `.env` file is missing or unreadable by the service user. Fix
with `sudo chmod 600 .env` and check ownership with `ls -l .env`.

### Something else

```bash
npm run doctor                 # first stop for almost every problem
cat install.log                # full installer transcript
```

---

## Security guidance

- **Never commit `.env`.** It is already in `.gitignore` — keep it there.
- `.env` is created with mode **`600`** (owner read/write only). Verify with
  `ls -l .env`; fix with `chmod 600 .env`.
- **Rotate any token that has ever been shared, screenshotted, pasted into a
  chat, or committed to Git.** In the Developer Portal: **Bot → Reset Token**.
  Then update `.env` and restart.
- The installer **never** disables SSH, firewalls, or any other security control,
  and **never** runs a downloaded script as root. The only network download is
  the official Node.js tarball, verified against `SHASUMS256.txt`.
- `config.local.js` is a legacy, git-ignored file. If it exists, migrate its
  values into `.env` and delete it — the bot will warn you at startup.
- Keep Lavalink on loopback. If it must be remote, restrict the port with a
  firewall rule and use a long random password.
- The systemd unit enables `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem`,
  `ProtectHome`, `ProtectKernelTunables` and `RestrictSUIDSGID`.
- Secrets live in `.env`, referenced by `EnvironmentFile=`. They never appear in
  the unit file, in `systemctl show`, or in the process command line.
- `npm run doctor` prints only the **presence and length** of a secret — never a
  prefix, suffix, hash or full value.

---

## Project structure

```text
Music-bot-v2/
├── index.js                       # bot entry point: client, commands, events
├── config.js                      # environment-driven config (no secrets)
├── emojis.js                      # custom emoji identifiers
├── package.json                   # npm scripts & runtime dependencies
├── package-lock.json              # reproducible dependency lockfile
├── install.sh                     # one-command Ubuntu/Debian VPS installer
├── .env.example                   # environment template (safe to commit)
├── .gitignore                     # protects .env, data, logs, archives
├── README.md                      # this file
├── branding/
│   └── banner.txt                 # THE banner artwork (single source of truth)
├── utils/
│   ├── branding.js                # permanent branding API (banner, signature, footer)
│   ├── env.js                     # zero-dependency .env parser
│   └── messages.js                # embeds, Now Playing card, help/about
├── scripts/
│   └── doctor.js                  # `npm run doctor` — config + live node checks
├── deploy/
│   └── tanveer-music-bot.service.in   # systemd unit template
└── tests/
    ├── run-tests.js               # dependency-free test runner
    ├── branding.test.js           # branding must never regress
    ├── config.test.js             # config + .env parser
    └── installer.test.js          # installer & repo hygiene
```

### Branding architecture

The banner lives in **exactly one place**: `branding/banner.txt`. Everything
else calls `utils/branding.js`:

```js
const branding = require("./utils/branding.js");

branding.printBanner({ subtitle: "starting" });  // artwork + signature block
branding.getFooter("Now Playing");               // embed footer text
branding.getSignature();                         // one-line log signature
branding.verifyBranding();                       // asserts the permanent strings
```

Branding is displayed in: the installer, every bot start, VPS terminal startup
logs, this README, `/help` and `/about`, embed footers, and service startup logs
(via `journalctl`). It degrades to plain text when ANSI colour is unavailable and
**can never crash the bot** — every branding call is wrapped defensively.

---

## Credits

```text
TANVEER MUSIC BOT V3
MADE BY TANVEER
Discord: tanveer5637
```

- **Creator:** Tanveer
- **Discord:** [tanveer5637](https://discord.com/users/tanveer5637)
- **GitHub:** [Tanveer9830](https://github.com/Tanveer9830)
- **Repository:** [Tanveer9830/Music-bot-v2](https://github.com/Tanveer9830/Music-bot-v2)

Built on the work of the [discord.js](https://discord.js.org/),
[Riffy](https://www.npmjs.com/package/riffy) and
[Lavalink](https://github.com/lavalink-devs/Lavalink) projects.

**Premium Music Experience — MADE BY TANVEER.**
