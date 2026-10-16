const {
    Client,
    GatewayDispatchEvents,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ComponentType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const { Riffy }   = require("riffy");
const { Spotify } = require("riffy-spotify");
const config     = require("./config.js");
const messages   = require("./utils/messages.js");
const emojis     = require("./emojis.js");
const branding   = require("./utils/branding.js");

// ─── Preflight ─────────────────────────────────────────────────────────────────
// Fail with a helpful message instead of an opaque discord.js stack trace.
const MIN_NODE_MAJOR = 18;
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (Number.isFinite(nodeMajor) && nodeMajor < MIN_NODE_MAJOR) {
    branding.printBanner({ subtitle: "Startup aborted — unsupported Node.js version" });
    console.error(
        `${emojis.error} Node.js ${process.versions.node} is not supported.\n` +
        `   TANVEER MUSIC BOT V3 requires Node.js ${MIN_NODE_MAJOR} or newer.\n` +
        `   Install an LTS release:  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`
    );
    process.exit(1);
}

if (!config.botToken || !config.clientId) {
    branding.printBanner({ subtitle: "Startup aborted — missing Discord credentials" });
    console.error(
        `${emojis.error} Missing Discord credentials.\n` +
        `   Set DISCORD_TOKEN and DISCORD_CLIENT_ID in your .env file (see .env.example),\n` +
        `   or export them in the environment. Run \`npm run doctor\` for a full check.`
    );
    process.exit(1);
}

// ─── Discord Client ────────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
    ],
});

// ─── Riffy (Lavalink) ──────────────────────────────────────────────────────────
// Spotify resolution is optional; skip the plugin cleanly when unset so the
// bot still boots for YouTube/SoundCloud-only setups.
const riffyPlugins = [];
if (config.spotify.enabled) {
    riffyPlugins.push(new Spotify({
        clientId:     config.spotify.clientId,
        clientSecret: config.spotify.clientSecret,
    }));
}
client.riffy = new Riffy(client, config.nodes, {
    send: (payload) => {
        const guild = client.guilds.cache.get(payload.d.guild_id);
        if (guild) guild.shard.send(payload);
    },
    defaultSearchPlatform: "ytsearch",
    restVersion: "v4",
    plugins: riffyPlugins,
});

// ─── Idle Timer ────────────────────────────────────────────────────────────────
const idleTimers = new Map();
function clearIdleTimer(guildId) {
    if (idleTimers.has(guildId)) { clearTimeout(idleTimers.get(guildId)); idleTimers.delete(guildId); }
}
function startIdleTimer(player) {
    if (tfnMode.has(player.guildId)) return;
    clearIdleTimer(player.guildId);
    const timer = setTimeout(() => {
        const ch = client.channels.cache.get(player.textChannel);
        if (ch) ch.send(`${emojis.info} | Idle for 1 week — leaving the voice channel. 👋`);
        leaveVoiceChannel(player);
        idleTimers.delete(player.guildId);
    }, 7 * 24 * 60 * 60 * 1000);
    idleTimers.set(player.guildId, timer);
}

// ─── State Maps ────────────────────────────────────────────────────────────────
const tfnMode       = new Set();  // guildIds with 24/7 enabled
const bassBoostState= new Map();  // guildId -> level string
const autoplayState = new Set();  // guildIds with autoplay enabled
const skipState     = new Set();  // manual-skip flags
const lastTrackMap  = new Map();  // guildId -> last track
const connectedNodes= new Set();  // connected Lavalink node names
const topicState    = new Map();  // guildId -> topic string
const filterState   = new Map();  // guildId -> filter name
const historyMap    = new Map();  // guildId -> [{title,author,uri,duration,isStream}]
const aloneTimers   = new Map();  // guildId -> alone-in-VC timeout handle

// ─── Slash Command Definitions ────────────────────────────────────────────────
const slashCommands = [
    new SlashCommandBuilder()
        .setName("play")
        .setDescription("Search and play a song from YouTube")
        .addStringOption(o => o.setName("song").setDescription("Song name or URL").setRequired(true)),
    new SlashCommandBuilder()
        .setName("playnext")
        .setDescription("Add a song to the TOP of the queue (plays next)")
        .addStringOption(o => o.setName("song").setDescription("Song name or URL").setRequired(true)),
    new SlashCommandBuilder().setName("pause").setDescription("Pause the current track"),
    new SlashCommandBuilder().setName("resume").setDescription("Resume the current track"),
    new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
    new SlashCommandBuilder().setName("stop").setDescription("Stop playback and leave the voice channel"),
    new SlashCommandBuilder().setName("queue").setDescription("Show the current queue"),
    new SlashCommandBuilder().setName("nowplaying").setDescription("Show what is currently playing"),
    new SlashCommandBuilder()
        .setName("volume")
        .setDescription("Set the player volume")
        .addIntegerOption(o => o.setName("level").setDescription("Volume 0-100").setRequired(true).setMinValue(0).setMaxValue(100)),
    new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the queue"),
    new SlashCommandBuilder().setName("loop").setDescription("Cycle loop mode: Off → Track → Queue"),
    new SlashCommandBuilder()
        .setName("remove")
        .setDescription("Remove a track from the queue")
        .addIntegerOption(o => o.setName("position").setDescription("Queue position").setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
        .setName("move")
        .setDescription("Move a track to a different queue position")
        .addIntegerOption(o => o.setName("from").setDescription("Current position").setRequired(true).setMinValue(1))
        .addIntegerOption(o => o.setName("to").setDescription("New position").setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
        .setName("jump")
        .setDescription("Jump to a specific position in the queue")
        .addIntegerOption(o => o.setName("position").setDescription("Queue position to jump to").setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName("replay").setDescription("Restart the current track from the beginning"),
    new SlashCommandBuilder().setName("clear").setDescription("Clear the queue"),
    new SlashCommandBuilder().setName("help").setDescription("Show all commands"),
    new SlashCommandBuilder()
        .setName("lyrics")
        .setDescription("Get lyrics for the current or any song")
        .addStringOption(o => o.setName("song").setDescription("Song name (blank = current track)").setRequired(false)),
    new SlashCommandBuilder()
        .setName("seek")
        .setDescription("Jump to a specific time in the current track")
        .addStringOption(o => o.setName("time").setDescription("Time e.g. 1:30 or 90").setRequired(true)),
    new SlashCommandBuilder()
        .setName("bassboost")
        .setDescription("Set bass boost level")
        .addStringOption(o =>
            o.setName("level").setDescription("Bass boost level").setRequired(true)
                .addChoices(
                    { name: "Off",    value: "off"    },
                    { name: "Low",    value: "low"    },
                    { name: "Medium", value: "medium" },
                    { name: "High",   value: "high"   },
                    { name: "Insane", value: "insane" }
                )
        ),
    new SlashCommandBuilder()
        .setName("filters")
        .setDescription("Apply an audio filter effect")
        .addStringOption(o =>
            o.setName("filter").setDescription("Filter to apply").setRequired(true)
                .addChoices(
                    { name: "⚡ Nightcore — Fast + High Pitch",  value: "nightcore" },
                    { name: "🌊 Vaporwave — Slow + Low Pitch",   value: "vaporwave" },
                    { name: "🎧 8D Audio — Rotating Sound",      value: "8d"        },
                    { name: "🎤 Karaoke — Vocal Removal",        value: "karaoke"   },
                    { name: "〰️ Tremolo — Volume Wave",         value: "tremolo"   },
                    { name: "🎵 Vibrato — Pitch Wave",           value: "vibrato"   },
                    { name: "🌸 Soft — Smooth, Mellow Sound",   value: "soft"      },
                    { name: "🎶 Pop — Enhanced Clarity",         value: "pop"       },
                    { name: "🔄 Reset — Remove All Filters",     value: "reset"     }
                )
        ),
    new SlashCommandBuilder().setName("history").setDescription("Show recently played tracks this session"),
    new SlashCommandBuilder().setName("247").setDescription("Toggle 24/7 mode — bot stays in VC even when queue ends"),
    new SlashCommandBuilder().setName("about").setDescription("About this bot — creator, version and node status"),
    new SlashCommandBuilder().setName("ping").setDescription("Check bot latency and Lavalink node status"),
];

// ─── Startup Banner ────────────────────────────────────────────────────────────
// Printed on every bot start / service restart so branding persists in logs.
branding.printBanner({
    subtitle: config.spotify.enabled
        ? "Spotify resolution: enabled"
        : "Spotify resolution: disabled (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set)",
});
branding.printSignature({ extra: `v${require("./package.json").version} · starting` });
for (const warning of config.warnings) console.warn(`${emojis.info} ${warning}`);

// ─── Ready ─────────────────────────────────────────────────────────────────────
client.on("ready", async () => {
    client.riffy.init(client.user.id);
    console.log(`${emojis.success} Logged in as ${client.user.tag}`);
    branding.printSignature({ extra: `online as ${client.user.tag}` });

    // Node / Lavalink configuration summary — never prints the password.
    const node = config.nodes[0];
    console.log(
        `${emojis.music} Lavalink node "${node.name}" → ` +
        `${node.secure ? "wss" : "ws"}://${node.host}:${node.port}` +
        `${config.spotify.enabled ? "  ·  Spotify: enabled" : ""}`
    );
    console.log(`${emojis.time} Idle timeout: 7 days  ·  24/7 mode: available via /247`);

    const rest = new REST({ version: "10" }).setToken(config.botToken);
    try {
        // Guild-scoped registration is instant — ideal while testing.
        if (config.guildId) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, config.guildId),
                { body: slashCommands.map(c => c.toJSON()) }
            );
            console.log(`${emojis.success} Slash commands registered in guild ${config.guildId} (instant).`);
        } else {
            await rest.put(Routes.applicationCommands(client.user.id), {
                body: slashCommands.map(c => c.toJSON()),
            });
            console.log(`${emojis.success} Slash commands registered globally (may take up to 1 hour to appear).`);
        }
    } catch (err) {
        console.error(`${emojis.error} Failed to register slash commands: ${err.message}`);
    }

    branding.printSignature({ extra: "ready" });
});

// ─── Interaction Router ────────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton())      { await handleButton(interaction);      return; }
    if (interaction.isModalSubmit()) { await handleModalSubmit(interaction); return; }
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const needsVC = ["play","playnext","skip","stop","pause","resume","queue","nowplaying",
                     "volume","shuffle","loop","remove","move","jump","replay","clear",
                     "seek","bassboost","filters","history","247","lyrics"];
    if (needsVC.includes(commandName) && !interaction.member.voice.channel) {
        return interaction.reply({ content: `${emojis.error} | You must be in a voice channel!`, ephemeral: true });
    }

    switch (commandName) {
        case "play":       await cmdPlay(interaction);       break;
        case "playnext":   await cmdPlayNext(interaction);   break;
        case "pause":      await cmdPause(interaction);      break;
        case "resume":     await cmdResume(interaction);     break;
        case "skip":       await cmdSkip(interaction);       break;
        case "stop":       await cmdStop(interaction);       break;
        case "queue":      await cmdQueue(interaction);      break;
        case "nowplaying": await cmdNowPlaying(interaction); break;
        case "volume":     await cmdVolume(interaction);     break;
        case "shuffle":    await cmdShuffle(interaction);    break;
        case "loop":       await cmdLoop(interaction);       break;
        case "remove":     await cmdRemove(interaction);     break;
        case "move":       await cmdMove(interaction);       break;
        case "jump":       await cmdJump(interaction);       break;
        case "replay":     await cmdReplay(interaction);     break;
        case "clear":      await cmdClear(interaction);      break;
        case "help":       await cmdHelp(interaction);       break;
        case "lyrics":     await cmdLyrics(interaction);     break;
        case "seek":       await cmdSeek(interaction);       break;
        case "bassboost":  await cmdBassBoost(interaction);  break;
        case "filters":    await cmdFilters(interaction);    break;
        case "history":    await cmdHistory(interaction);    break;
        case "247":        await cmdTfn(interaction);        break;
        case "about":      await cmdAbout(interaction);      break;
        case "ping":       await cmdPing(interaction);       break;
    }
});

// ─── Utilities ─────────────────────────────────────────────────────────────────
function formatDuration(ms) {
    if (!ms || ms <= 0) return "LIVE";
    const s = Math.floor((ms/1000)%60), m = Math.floor((ms/60000)%60), h = Math.floor(ms/3600000);
    if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function getOrCreatePlayer(interaction) {
    return client.riffy.createConnection({
        guildId: interaction.guild.id,
        voiceChannel: interaction.member.voice.channel.id,
        textChannel: interaction.channel.id,
        deaf: true,
    });
}
function getCurrentTrack(player) {
    return player.current ?? player.queue?.current ?? null;
}
function parseTimeToMs(input) {
    input = input.trim();
    const parts = input.split(":").map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 1) return parts[0] * 1000;
    if (parts.length === 2) return (parts[0]*60 + parts[1]) * 1000;
    if (parts.length === 3) return (parts[0]*3600 + parts[1]*60 + parts[2]) * 1000;
    return null;
}

// ─── /play ─────────────────────────────────────────────────────────────────────
async function cmdPlay(interaction) {
    const query = interaction.options.getString("song");
    await interaction.deferReply();
    if (connectedNodes.size === 0) {
        return interaction.editReply({ content: `${emojis.error} | Music node not connected. Please wait a moment.` });
    }
    try {
        const resolve = await client.riffy.resolve({ query, requester: interaction.user });
        const { loadType, tracks, playlistInfo } = resolve;
        const isPlaylist = loadType === "playlist" || loadType === "PLAYLIST_LOADED";
        const noResults  = !tracks?.length || ["empty","NO_MATCHES","error","LOAD_FAILED"].includes(loadType);

        if (isPlaylist) {
            const player = getOrCreatePlayer(interaction);
            for (const t of tracks) { t.info.requester = interaction.user; player.queue.add(t); }
            clearIdleTimer(interaction.guild.id);
            if (!player.playing && !player.paused) player.play();
            return interaction.editReply({ embeds: [messages.buildAddedPlaylist(playlistInfo, tracks)] });
        }
        if (noResults) return interaction.editReply({ content: `${emojis.error} | No results for **${query}**.` });

        const top5 = tracks.slice(0, 5);
        const menu = new StringSelectMenuBuilder()
            .setCustomId("search_select")
            .setPlaceholder("🎵 Choose a track...")
            .addOptions(top5.map((t,i) => ({
                label: t.info.title.slice(0,100),
                description: `${t.info.author} · ${formatDuration(t.info.duration)}`.slice(0,100),
                value: String(i),
                emoji: "🎵",
            })));
        const reply = await interaction.editReply({
            embeds: [messages.buildSearchResults(top5, query)],
            components: [new ActionRowBuilder().addComponents(menu)],
        });
        const col = reply.createMessageComponentCollector({
            componentType: ComponentType.StringSelect, time: 30_000,
            filter: i => i.user.id === interaction.user.id,
        });
        col.on("collect", async sel => {
            col.stop();
            const chosen = top5[parseInt(sel.values[0])];
            chosen.info.requester = interaction.user;
            const player = getOrCreatePlayer(interaction);
            player.queue.add(chosen);
            clearIdleTimer(interaction.guild.id);
            if (!player.playing && !player.paused) player.play();
            await sel.update({ embeds: [messages.buildQueuedTrack(chosen, player.queue.length)], components: [] });
        });
        col.on("end", (_, r) => { if (r === "time") interaction.editReply({ components: [] }).catch(()=>{}); });
    } catch (err) {
        console.error(err);
        interaction.editReply({ content: `${emojis.error} | Error: ${err.message || "Please try again."}` });
    }
}

// ─── /playnext ─────────────────────────────────────────────────────────────────
async function cmdPlayNext(interaction) {
    const query = interaction.options.getString("song");
    await interaction.deferReply();
    if (connectedNodes.size === 0) return interaction.editReply({ content: `${emojis.error} | Music node not connected.` });
    try {
        const resolve = await client.riffy.resolve({ query, requester: interaction.user });
        const { loadType, tracks } = resolve;
        if (!tracks?.length || ["empty","NO_MATCHES","error","LOAD_FAILED"].includes(loadType)) {
            return interaction.editReply({ content: `${emojis.error} | No results for **${query}**.` });
        }
        const track = tracks[0];
        track.info.requester = interaction.user;
        const player = getOrCreatePlayer(interaction);
        player.queue.splice(0, 0, track);   // insert at front
        clearIdleTimer(interaction.guild.id);
        if (!player.playing && !player.paused) player.play();
        await interaction.editReply({ embeds: [messages.buildQueuedTrack(track, 1)] });
    } catch (err) {
        console.error(err);
        interaction.editReply({ content: `${emojis.error} | Error: ${err.message || "Please try again."}` });
    }
}

// ─── /pause ────────────────────────────────────────────────────────────────────
async function cmdPause(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    if (player.paused) return interaction.reply({ content: `${emojis.error} | Already paused!`, ephemeral: true });
    player.pause(true);
    const title = getCurrentTrack(player)?.info?.title ?? lastTrackMap.get(interaction.guild.id)?.info?.title;
    if (title) await updateVCStatus(player, "paused", title);
    await interaction.reply({ content: `${emojis.pause} | Paused!` });
}

// ─── /resume ───────────────────────────────────────────────────────────────────
async function cmdResume(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    if (!player.paused) return interaction.reply({ content: `${emojis.error} | Already playing!`, ephemeral: true });
    player.pause(false);
    const title = getCurrentTrack(player)?.info?.title ?? lastTrackMap.get(interaction.guild.id)?.info?.title;
    if (title) await updateVCStatus(player, "playing", title);
    await interaction.reply({ content: `${emojis.play} | Resumed!` });
}

// ─── /skip ─────────────────────────────────────────────────────────────────────
async function cmdSkip(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    await doSkip(player);
    await interaction.reply({ content: `${emojis.skip} | Skipped!` });
}

// ─── /stop ─────────────────────────────────────────────────────────────────────
async function cmdStop(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    await leaveVoiceChannel(player);
    await interaction.reply({ content: `${emojis.stop} | Stopped and left the voice channel.` });
}

// ─── /queue ────────────────────────────────────────────────────────────────────
async function cmdQueue(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });

    const ITEMS = 10;
    let page = 0;
    const liveQ = () => [...(client.riffy.players.get(interaction.guild.id)?.queue || [])];
    const liveC = () => { const p = client.riffy.players.get(interaction.guild.id); return p ? getCurrentTrack(p) : null; };
    const tpFn  = (q) => Math.max(1, Math.ceil(q.length / ITEMS));
    const mkRow  = (q, p) => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("q_prev").setLabel("◀ Prev").setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
        new ButtonBuilder().setCustomId("q_next").setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(p >= tpFn(q) - 1),
    );

    const q0 = liveQ();
    const tp0 = tpFn(q0);
    const reply = await interaction.reply({
        embeds: [messages.buildQueuePage(q0, liveC(), page, ITEMS)],
        components: tp0 > 1 ? [mkRow(q0, page)] : [],
        fetchReply: true,
    });
    if (tp0 <= 1) return;

    const col = reply.createMessageComponentCollector({
        componentType: ComponentType.Button, time: 90_000,
        filter: i => i.user.id === interaction.user.id && ["q_prev","q_next"].includes(i.customId),
    });
    col.on("collect", async btn => {
        const q = liveQ(), c = liveC(), tp = tpFn(q);
        if (btn.customId === "q_prev") page = Math.max(0, page - 1);
        if (btn.customId === "q_next") page = Math.min(tp - 1, page + 1);
        await btn.update({ embeds: [messages.buildQueuePage(q, c, page, ITEMS)], components: tp > 1 ? [mkRow(q, page)] : [] });
    });
    col.on("end", () => interaction.editReply({ components: [] }).catch(()=>{}));
}

// ─── /nowplaying ───────────────────────────────────────────────────────────────
async function cmdNowPlaying(interaction) {
    const player  = client.riffy.players.get(interaction.guild.id);
    const current = player ? getCurrentTrack(player) : null;
    if (!player || !current) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    const { embed, row1, row2, row3 } = messages.buildNowPlaying(current, {
        autoplayEnabled: autoplayState.has(interaction.guild.id),
        activeTopic:     topicState.get(interaction.guild.id),
        activeFilter:    filterState.get(interaction.guild.id),
        volume:          player.volume || 100,
        queueLength:     player.queue.length,
        position:        player.position || 0,
        isPaused:        player.paused,
    });
    await interaction.reply({ embeds: [embed], components: [row1, row2, row3] });
}

// ─── /volume ───────────────────────────────────────────────────────────────────
async function cmdVolume(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    const vol = interaction.options.getInteger("level");
    player.setVolume(vol);
    await interaction.reply({ content: `${emojis.volume} | Volume set to **${vol}%**` });
}

// ─── /shuffle ──────────────────────────────────────────────────────────────────
async function cmdShuffle(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player || !player.queue.length) return interaction.reply({ content: `${emojis.error} | Queue is too short!`, ephemeral: true });
    player.queue.shuffle();
    await interaction.reply({ content: `${emojis.shuffle} | Queue shuffled!` });
}

// ─── /loop — cycles: none → track → queue ─────────────────────────────────────
async function cmdLoop(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    const modes = ["none","track","queue"];
    const next  = modes[(modes.indexOf(player.loop) + 1) % modes.length];
    player.setLoop(next);
    const labels = { none: "🔇 Loop **off**", track: "🔂 Loop **track**", queue: "🔁 Loop **queue**" };
    await interaction.reply({ content: `${emojis.repeat} | ${labels[next]}!` });
}

// ─── /remove ───────────────────────────────────────────────────────────────────
async function cmdRemove(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    const pos = interaction.options.getInteger("position");
    if (pos > player.queue.length) return interaction.reply({ content: `${emojis.error} | Position out of range!`, ephemeral: true });
    const removed = player.queue.remove(pos - 1);
    await interaction.reply({ content: `${emojis.success} | Removed **${removed.info.title}** from queue.` });
}

// ─── /move ─────────────────────────────────────────────────────────────────────
async function cmdMove(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player || !player.queue.length) return interaction.reply({ content: `${emojis.error} | Queue is empty!`, ephemeral: true });
    const from = interaction.options.getInteger("from");
    const to   = interaction.options.getInteger("to");
    if (from < 1 || from > player.queue.length || to < 1 || to > player.queue.length) {
        return interaction.reply({ content: `${emojis.error} | Invalid positions. Queue has **${player.queue.length}** tracks.`, ephemeral: true });
    }
    if (from === to) return interaction.reply({ content: `${emojis.info} | Track is already at that position!`, ephemeral: true });
    const [moved] = player.queue.splice(from - 1, 1);
    player.queue.splice(to - 1, 0, moved);
    await interaction.reply({ content: `${emojis.success} | Moved **${moved.info.title}** from #${from} → #${to}!` });
}

// ─── /jump ─────────────────────────────────────────────────────────────────────
async function cmdJump(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player || !player.queue.length) return interaction.reply({ content: `${emojis.error} | Queue is empty!`, ephemeral: true });
    const pos = interaction.options.getInteger("position");
    if (pos < 1 || pos > player.queue.length) {
        return interaction.reply({ content: `${emojis.error} | Invalid position. Queue has **${player.queue.length}** tracks.`, ephemeral: true });
    }
    const target = player.queue[pos - 1];
    player.queue.splice(0, pos - 1);   // remove everything before the target
    await doSkip(player);
    await interaction.reply({ content: `${emojis.success} | Jumped to **${target.info.title}**!` });
}

// ─── /replay ───────────────────────────────────────────────────────────────────
async function cmdReplay(interaction) {
    const player  = client.riffy.players.get(interaction.guild.id);
    const current = player ? getCurrentTrack(player) : null;
    if (!player || !current) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    if (current.info.isStream) return interaction.reply({ content: `${emojis.error} | Cannot replay a live stream!`, ephemeral: true });
    player.seekTo(0);
    await interaction.reply({ content: `${emojis.success} | 🔄 Replaying **${current.info.title}** from the start!` });
}

// ─── /clear ────────────────────────────────────────────────────────────────────
async function cmdClear(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player || !player.queue.length) return interaction.reply({ content: `${emojis.error} | Queue is already empty!`, ephemeral: true });
    player.queue.clear();
    await interaction.reply({ content: `${emojis.success} | Queue cleared!` });
}

// ─── /help ─────────────────────────────────────────────────────────────────────
async function cmdHelp(interaction) {
    await interaction.reply({ embeds: [messages.buildHelp()] });
}

// ─── /about ────────────────────────────────────────────────────────────────────
async function cmdAbout(interaction) {
    const node = config.nodes[0];
    const nodeOnline = connectedNodes.has(node.name);
    await interaction.reply({
        embeds: [
            messages.buildAbout({
                version:       require("./package.json").version,
                nodeName:      node.name,
                nodeOnline,
                spotifyEnabled: config.spotify.enabled,
                guildCount:    client.guilds.cache.size,
                uptimeMs:      client.uptime ?? 0,
            }),
        ],
    });
}

// ─── /ping ─────────────────────────────────────────────────────────────────────
async function cmdPing(interaction) {
    const node = config.nodes[0];
    const nodeOnline = connectedNodes.has(node.name);
    const ws = Math.max(0, Math.round(client.ws.ping));
    const lines = [
        `🏓 **Gateway latency:** \`${ws} ms\``,
        `${nodeOnline ? emojis.success : emojis.error} **Lavalink node "${node.name}":** ` +
            (nodeOnline ? "connected" : "not connected — playback unavailable"),
    ];
    await interaction.reply({
        content: lines.join("\n") + "\n-# " + branding.getFooter(),
        ephemeral: true,
    });
}

// ─── /history ──────────────────────────────────────────────────────────────────
async function cmdHistory(interaction) {
    const history = historyMap.get(interaction.guild.id);
    if (!history?.length) return interaction.reply({ content: `${emojis.info} | No track history yet this session!`, ephemeral: true });
    await interaction.reply({ embeds: [messages.buildHistory(history)] });
}

// ─── /lyrics ───────────────────────────────────────────────────────────────────
async function cmdLyrics(interaction) {
    await interaction.deferReply();
    let query = interaction.options.getString("song");
    if (!query) {
        const player  = client.riffy.players.get(interaction.guild.id);
        const current = player ? getCurrentTrack(player) : null;
        if (!current) return interaction.editReply({ content: `${emojis.error} | No song playing and no song name provided!` });
        query = `${current.info.title} ${current.info.author}`;
    }
    try {
        const parts = query.split(" - ");
        const apiUrl = parts.length >= 2
            ? `https://api.lyrics.ovh/v1/${encodeURIComponent(parts[0].trim())}/${encodeURIComponent(parts.slice(1).join(" - ").trim())}`
            : `https://api.lyrics.ovh/v1/${encodeURIComponent(query.split(" ")[0])}/${encodeURIComponent(query.split(" ").slice(1).join(" "))}`;
        const res  = await fetch(apiUrl);
        const data = await res.json();
        if (!data.lyrics) return interaction.editReply({ content: `${emojis.error} | No lyrics found for **${query}**.` });
        const lyrics = data.lyrics.replace(/\n\n\n+/g, "\n\n");
        const chunks = [];
        let cur = "";
        for (const line of lyrics.split("\n")) {
            if ((cur + "\n" + line).length > 4000) { chunks.push(cur); cur = line; }
            else cur += (cur ? "\n" : "") + line;
        }
        if (cur) chunks.push(cur);
        await interaction.editReply({ embeds: [messages.buildLyrics(query, chunks[0], 1, chunks.length)] });
        for (let i = 1; i < chunks.length; i++)
            await interaction.followUp({ embeds: [messages.buildLyrics(query, chunks[i], i+1, chunks.length)] });
    } catch (err) {
        console.error(err);
        interaction.editReply({ content: `${emojis.error} | Failed to fetch lyrics. Try: \`Artist - Song Title\`` });
    }
}

// ─── /seek ─────────────────────────────────────────────────────────────────────
async function cmdSeek(interaction) {
    const player  = client.riffy.players.get(interaction.guild.id);
    const current = player ? getCurrentTrack(player) : null;
    if (!player || !current) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    if (current.info.isStream) return interaction.reply({ content: `${emojis.error} | Cannot seek in a live stream!`, ephemeral: true });
    const ms = parseTimeToMs(interaction.options.getString("time"));
    if (ms === null || ms < 0) return interaction.reply({ content: `${emojis.error} | Invalid time! Use \`1:30\` or \`90\`.`, ephemeral: true });
    if (ms > current.info.duration) return interaction.reply({ content: `${emojis.error} | Exceeds track duration (**${formatDuration(current.info.duration)}**)!`, ephemeral: true });
    player.seekTo(ms);
    await interaction.reply({ content: `${emojis.time} | Seeked to **${formatDuration(ms)}**!` });
}

// ─── /bassboost ────────────────────────────────────────────────────────────────
const bassBoostPresets = {
    off:    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    low:    [0.15,0.10,0.05,0,0,0,0,0,0,0,0,0,0,0,0],
    medium: [0.25,0.20,0.15,0.05,0,0,0,0,0,0,0,0,0,0,0],
    high:   [0.40,0.35,0.25,0.15,0.05,0,0,0,0,0,0,0,0,0,0],
    insane: [0.60,0.55,0.45,0.35,0.25,0.15,0.05,0,0,0,0,0,0,0,0],
};
async function cmdBassBoost(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    const level  = interaction.options.getString("level");
    const bands  = bassBoostPresets[level].map((gain,band) => ({ band, gain }));
    try {
        if (typeof player.filters?.setEqualizer === "function") player.filters.setEqualizer(bands);
        else if (typeof player.setEqualizer === "function") player.setEqualizer(bands);
        else await player.node.rest.updatePlayer({ guildId: player.guildId, data: { filters: { equalizer: bands } } });
    } catch (err) {
        console.error("Bass boost error:", err);
        return interaction.reply({ content: `${emojis.error} | Failed to apply bass boost.`, ephemeral: true });
    }
    level === "off" ? bassBoostState.delete(interaction.guild.id) : bassBoostState.set(interaction.guild.id, level);
    const labels = { off: "Off 🔇", low: "Low 🔉", medium: "Medium 🔊", high: "High 📢", insane: "INSANE 💥" };
    await interaction.reply({ content: `${emojis.volume} | Bass Boost → **${labels[level]}**!` });
}

// ─── /filters ──────────────────────────────────────────────────────────────────
const FILTER_PRESETS = {
    nightcore: { timescale: { speed: 1.25, pitch: 1.25, rate: 1.0 } },
    vaporwave: { timescale: { speed: 0.85, pitch: 0.8,  rate: 1.0 } },
    "8d":      { rotation:  { rotationHz: 0.2 } },
    karaoke:   { karaoke:   { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 } },
    tremolo:   { tremolo:   { frequency: 2.0, depth: 0.5 } },
    vibrato:   { vibrato:   { frequency: 2.0, depth: 0.5 } },
    soft: { equalizer: [
        {band:0,gain:-0.10},{band:1,gain:-0.10},{band:2,gain:-0.08},{band:3,gain:-0.05},
        {band:4,gain:-0.03},{band:5,gain:0.00}, {band:6,gain:0.00}, {band:7,gain:0.00},
        {band:8,gain:-0.05},{band:9,gain:-0.10},{band:10,gain:-0.15},{band:11,gain:-0.20},
        {band:12,gain:-0.25},{band:13,gain:-0.30},{band:14,gain:-0.35},
    ]},
    pop: { equalizer: [
        {band:0,gain:0.05},{band:1,gain:0.10},{band:2,gain:0.15},{band:3,gain:0.10},
        {band:4,gain:0.05},{band:5,gain:0.00},{band:6,gain:0.00},{band:7,gain:-0.05},
        {band:8,gain:-0.10},{band:9,gain:-0.10},{band:10,gain:-0.10},{band:11,gain:-0.10},
        {band:12,gain:-0.10},{band:13,gain:-0.05},{band:14,gain:0.00},
    ]},
    reset: null,
};
async function applyFilter(player, filterName) {
    const preset = FILTER_PRESETS[filterName];
    try {
        await player.node.rest.updatePlayer({ guildId: player.guildId, data: { filters: preset ?? {} } });
        return true;
    } catch (_) {
        try {
            if (filterName === "reset") {
                if (typeof player.filters?.clearAll === "function") player.filters.clearAll();
                else if (typeof player.filters?.update === "function") { Object.assign(player.filters,{equalizer:null,timescale:null,rotation:null,tremolo:null,vibrato:null,karaoke:null}); player.filters.update(); }
            } else if (preset && typeof player.filters === "object") {
                Object.assign(player.filters, preset);
                if (typeof player.filters.update === "function") player.filters.update();
            }
            return true;
        } catch (err) { console.error("Filter error:", err); return false; }
    }
}
async function cmdFilters(interaction) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: `${emojis.error} | Nothing is playing!`, ephemeral: true });
    const filterName = interaction.options.getString("filter");
    const success    = await applyFilter(player, filterName);
    if (!success) return interaction.reply({ content: `${emojis.error} | Failed to apply filter.`, ephemeral: true });
    if (filterName === "reset") { filterState.delete(interaction.guild.id); return interaction.reply({ content: `${emojis.success} | All filters removed!` }); }
    filterState.set(interaction.guild.id, filterName);
    const labels = { nightcore:"⚡ Nightcore",vaporwave:"🌊 Vaporwave","8d":"🎧 8D Audio",karaoke:"🎤 Karaoke",tremolo:"〰️ Tremolo",vibrato:"🎵 Vibrato",soft:"🌸 Soft",pop:"🎶 Pop" };
    await interaction.reply({ content: `${emojis.success} | Filter → **${labels[filterName]}**!` });
}

// ─── /247 ──────────────────────────────────────────────────────────────────────
async function cmdTfn(interaction) {
    const guildId = interaction.guild.id;
    if (tfnMode.has(guildId)) {
        tfnMode.delete(guildId);
        await interaction.reply({ content: `${emojis.stop} | **24/7 mode disabled.** I will leave when queue ends.` });
    } else {
        tfnMode.add(guildId);
        clearIdleTimer(guildId);
        if (!client.riffy.players.get(guildId)) getOrCreatePlayer(interaction);
        await interaction.reply({ content: `${emojis.success} | **24/7 mode enabled!** I'll stay in VC even when queue is empty.` });
    }
}

// ─── Button Handler ────────────────────────────────────────────────────────────
async function handleButton(interaction) {
    // btn_topicplay opens a modal — handle BEFORE player check
    if (interaction.customId === "btn_topicplay") {
        const modal = new ModalBuilder().setCustomId("topic_modal").setTitle("🎯 Topic Play");
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("topic_input")
                .setLabel("Topic/mood (e.g. love, sad, slowed reverb)")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("love, sad, slowed and reverb, party, lofi…")
                .setRequired(true).setMaxLength(100)
        ));
        return interaction.showModal(modal);
    }

    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: `${emojis.error} | No active player!`, ephemeral: true });

    switch (interaction.customId) {
        // ── Playback ────────────────────────────────────────────────────────
        case "btn_pause": {
            const wasPaused = player.paused;
            wasPaused ? player.pause(false) : player.pause(true);
            const title = getCurrentTrack(player)?.info?.title ?? lastTrackMap.get(interaction.guild.id)?.info?.title;
            if (title) await updateVCStatus(player, wasPaused ? "playing" : "paused", title);
            await interaction.reply({ content: `${wasPaused ? emojis.play : emojis.pause} | ${wasPaused ? "Resumed" : "Paused"}!`, ephemeral: true });
            break;
        }
        case "btn_skip":
            await doSkip(player);
            await interaction.reply({ content: `${emojis.skip} | Skipped!`, ephemeral: true });
            break;
        case "btn_stop":
            await leaveVoiceChannel(player);
            await interaction.reply({ content: `${emojis.stop} | Stopped! Left the voice channel.`, ephemeral: true });
            break;
        case "btn_seek_back": {
            const cur = getCurrentTrack(player);
            if (!cur || cur.info.isStream) { await interaction.reply({ content: `${emojis.error} | Can't seek in a live stream!`, ephemeral: true }); break; }
            const newPos = Math.max(0, (player.position || 0) - 15000);
            player.seekTo(newPos);
            await interaction.reply({ content: `⏪ Seeked back to **${formatDuration(newPos)}**!`, ephemeral: true });
            break;
        }
        // ── Loop ────────────────────────────────────────────────────────────
        case "btn_loop": {
            const modes = ["none","track","queue"];
            const next  = modes[(modes.indexOf(player.loop) + 1) % modes.length];
            player.setLoop(next);
            const lbls  = { none:"🔇 Loop off", track:"🔂 Track loop", queue:"🔁 Queue loop" };
            await interaction.reply({ content: `${emojis.repeat} | ${lbls[next]}!`, ephemeral: true });
            break;
        }
        // ── Shuffle ─────────────────────────────────────────────────────────
        case "btn_shuffle":
            if (player.queue.length) player.queue.shuffle();
            await interaction.reply({ content: `${emojis.shuffle} | Shuffled!`, ephemeral: true });
            break;
        // ── Volume ──────────────────────────────────────────────────────────
        case "btn_vol_down": {
            const v = Math.max(0, (player.volume || 100) - 10);
            player.setVolume(v);
            await interaction.reply({ content: `${emojis.volume} | Volume → **${v}%**`, ephemeral: true });
            break;
        }
        case "btn_vol_up": {
            const v = Math.min(100, (player.volume || 100) + 10);
            player.setVolume(v);
            await interaction.reply({ content: `${emojis.volume} | Volume → **${v}%**`, ephemeral: true });
            break;
        }
        // ── Autoplay ────────────────────────────────────────────────────────
        case "btn_autoplay": {
            const guildId = interaction.guild.id;
            if (autoplayState.has(guildId)) {
                autoplayState.delete(guildId);
                await interaction.reply({ content: `${emojis.info} | Autoplay **disabled**.`, ephemeral: true });
            } else {
                autoplayState.add(guildId);
                await interaction.reply({ content: `${emojis.success} | Autoplay **enabled**!`, ephemeral: true });
            }
            break;
        }
        // ── Queue (ephemeral paginated) ─────────────────────────────────────
        case "btn_queue": {
            const ITEMS = 10;
            let qPage = 0;
            const lq  = () => [...(client.riffy.players.get(interaction.guild.id)?.queue || [])];
            const lc  = () => { const p = client.riffy.players.get(interaction.guild.id); return p ? getCurrentTrack(p) : null; };
            const tp  = (q) => Math.max(1, Math.ceil(q.length / ITEMS));
            const mkR = (q, p) => new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("bq_prev").setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
                new ButtonBuilder().setCustomId("bq_next").setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(p >= tp(q)-1),
            );
            const q0 = lq(), tp0 = tp(q0);
            const qReply = await interaction.reply({
                embeds: [messages.buildQueuePage(q0, lc(), qPage, ITEMS)],
                components: tp0 > 1 ? [mkR(q0, qPage)] : [],
                ephemeral: true, fetchReply: true,
            });
            if (tp0 <= 1) break;
            const qCol = qReply.createMessageComponentCollector({
                componentType: ComponentType.Button, time: 90_000,
                filter: i => i.user.id === interaction.user.id && ["bq_prev","bq_next"].includes(i.customId),
            });
            qCol.on("collect", async b => {
                const q2 = lq(), c2 = lc(), tp2 = tp(q2);
                if (b.customId === "bq_prev") qPage = Math.max(0, qPage-1);
                if (b.customId === "bq_next") qPage = Math.min(tp2-1, qPage+1);
                await b.update({ embeds: [messages.buildQueuePage(q2, c2, qPage, ITEMS)], components: tp2 > 1 ? [mkR(q2, qPage)] : [] });
            });
            qCol.on("end", () => interaction.editReply({ components: [] }).catch(()=>{}));
            break;
        }
        // ── Filters (select menu) ───────────────────────────────────────────
        case "btn_filters": {
            const fMenu = new StringSelectMenuBuilder()
                .setCustomId("filter_select")
                .setPlaceholder("🎚 Choose a filter…")
                .addOptions([
                    { label:"⚡ Nightcore",  description:"Speed + pitch up",      value:"nightcore" },
                    { label:"🌊 Vaporwave",  description:"Slow + pitch down",      value:"vaporwave" },
                    { label:"🎧 8D Audio",   description:"Rotating audio effect",  value:"8d"        },
                    { label:"🎤 Karaoke",    description:"Vocal removal",          value:"karaoke"   },
                    { label:"〰️ Tremolo",   description:"Volume wave",            value:"tremolo"   },
                    { label:"🎵 Vibrato",    description:"Pitch wave",             value:"vibrato"   },
                    { label:"🌸 Soft",       description:"Smooth, mellow sound",   value:"soft"      },
                    { label:"🎶 Pop",        description:"Enhanced pop EQ",        value:"pop"       },
                    { label:"🔄 Reset",      description:"Remove all filters",     value:"reset"     },
                ]);
            const fRep = await interaction.reply({
                content: "🎚 **Select an audio filter:**",
                components: [new ActionRowBuilder().addComponents(fMenu)],
                ephemeral: true, fetchReply: true,
            });
            const fCol = fRep.createMessageComponentCollector({
                componentType: ComponentType.StringSelect, time: 30_000,
                filter: i => i.user.id === interaction.user.id,
            });
            fCol.on("collect", async sel => {
                fCol.stop();
                const fn = sel.values[0];
                const ok = await applyFilter(player, fn);
                if (ok) { fn === "reset" ? filterState.delete(interaction.guild.id) : filterState.set(interaction.guild.id, fn); }
                const lbls = { nightcore:"⚡ Nightcore",vaporwave:"🌊 Vaporwave","8d":"🎧 8D Audio",karaoke:"🎤 Karaoke",tremolo:"〰️ Tremolo",vibrato:"🎵 Vibrato",soft:"🌸 Soft",pop:"🎶 Pop",reset:"🔄 Reset" };
                await sel.update({ content: ok ? `${emojis.success} | Filter → **${lbls[fn]}**!` : `${emojis.error} | Failed to apply filter.`, components: [] });
            });
            fCol.on("end", (_,r) => { if (r==="time") interaction.editReply({ components:[] }).catch(()=>{}); });
            break;
        }
    }
}

// ─── Topic Play ────────────────────────────────────────────────────────────────
async function startTopicPlay(interaction, topic) {
    const guildId = interaction.guild.id;
    if (!interaction.member.voice.channel) return interaction.reply({ content: `${emojis.error} | Join a voice channel first!`, ephemeral: true });
    if (connectedNodes.size === 0) return interaction.reply({ content: `${emojis.error} | Music node not connected!`, ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
        const resolve = await client.riffy.resolve({ query: `${topic} songs`, requester: interaction.user });
        const tracks  = resolve?.tracks;
        if (!tracks?.length) return interaction.editReply({ content: `${emojis.error} | No songs found for **${topic}**.` });
        const player = client.riffy.createConnection({ guildId, voiceChannel: interaction.member.voice.channel.id, textChannel: interaction.channel.id, deaf: true });
        const picks  = tracks.slice(0, 10);
        for (const t of picks) { t.info.requester = interaction.user; player.queue.add(t); }
        topicState.set(guildId, topic);
        clearIdleTimer(guildId);
        if (!player.playing && !player.paused) player.play();
        await interaction.editReply({ content: `${emojis.success} | 🎯 Topic Play started for **${topic}**! Queued **${picks.length}** songs — I'll keep finding more.` });
    } catch (err) {
        console.error("Topic play error:", err);
        await interaction.editReply({ content: `${emojis.error} | Failed: ${err.message || "Please try again."}` });
    }
}
async function handleModalSubmit(interaction) {
    if (interaction.customId !== "topic_modal") return;
    const topic = interaction.fields.getTextInputValue("topic_input").trim();
    if (["off","stop","none","disable"].includes(topic.toLowerCase())) {
        topicState.delete(interaction.guild.id);
        return interaction.reply({ content: `${emojis.info} | Topic Play **disabled**.`, ephemeral: true });
    }
    await startTopicPlay(interaction, topic);
}

// ─── VC Status ─────────────────────────────────────────────────────────────────
async function updateVCStatus(player, state, trackTitle) {
    try {
        const vcId = player.voiceChannel;
        if (!vcId) return;
        const status = state === "playing" ? `🎵 ${trackTitle}` : state === "paused" ? `⏸️ ${trackTitle}` : "🔽 Waiting for music";
        await client.rest.put(`/channels/${vcId}/voice-status`, { body: { status } });
    } catch (e) { console.error("VC status:", e?.message ?? e); }
}

// ─── Leave VC ──────────────────────────────────────────────────────────────────
async function leaveVoiceChannel(player) {
    const guildId = player.guildId;
    await updateVCStatus(player, "idle", null);
    clearIdleTimer(guildId);
    filterState.delete(guildId);
    topicState.delete(guildId);
    if (aloneTimers.has(guildId)) { clearTimeout(aloneTimers.get(guildId)); aloneTimers.delete(guildId); }
    const guild = client.guilds.cache.get(guildId);
    if (guild && player.voiceChannel) guild.shard.send({ op:4, d:{ guild_id:guildId, channel_id:null, self_mute:false, self_deaf:true } });
    await new Promise(r => setTimeout(r, 300));
    try { player.destroy(); } catch (_) {}
}

// ─── Skip Helper ───────────────────────────────────────────────────────────────
async function doSkip(player) {
    if (player.queue.length > 0) {
        const prevLoop = player.loop;
        if (prevLoop !== "none") player.setLoop("none");
        player.stop();
        if (prevLoop !== "none") player.setLoop(prevLoop);
    } else {
        skipState.add(player.guildId);
        player.stop();
    }
}

// ─── Riffy Events ──────────────────────────────────────────────────────────────
client.riffy.on("nodeConnect",    node  => { connectedNodes.add(node.name);    console.log(`${emojis.success} Node "${node.name}" connected.`); });
client.riffy.on("nodeDisconnect", node  => { connectedNodes.delete(node.name); console.log(`${emojis.info} Node "${node.name}" disconnected.`); });
client.riffy.on("nodeError",      (n,e) => { console.error(`${emojis.error} Node "${n.name}" error: ${e.message}`); });

client.riffy.on("trackStart", async (player, track) => {
    clearIdleTimer(player.guildId);
    lastTrackMap.set(player.guildId, track);

    // History tracking
    const hist = historyMap.get(player.guildId) || [];
    hist.unshift({ title:track.info.title, author:track.info.author, uri:track.info.uri, duration:track.info.duration, isStream:track.info.isStream });
    if (hist.length > 20) hist.pop();
    historyMap.set(player.guildId, hist);

    const channel = client.channels.cache.get(player.textChannel);
    await new Promise(r => setTimeout(r, 500));
    await updateVCStatus(player, "playing", track.info.title);
    if (!channel) return;

    const { embed, row1, row2, row3 } = messages.buildNowPlaying(track, {
        autoplayEnabled: autoplayState.has(player.guildId),
        activeTopic:     topicState.get(player.guildId),
        activeFilter:    filterState.get(player.guildId),
        volume:          player.volume || 100,
        queueLength:     player.queue.length,
        position:        0,
        isPaused:        false,
    });
    channel.send({ embeds: [embed], components: [row1, row2, row3] });
});

client.riffy.on("queueEnd", async (player) => {
    const channel   = client.channels.cache.get(player.textChannel);
    const wasSkipped = skipState.has(player.guildId);
    skipState.delete(player.guildId);

    // Topic Play: keep going with same topic
    if (!wasSkipped && topicState.has(player.guildId)) {
        try {
            const topic = topicState.get(player.guildId);
            const res   = await client.riffy.resolve({ query: `${topic} songs`, requester: client.user });
            const tracks = res?.tracks;
            if (tracks?.length) {
                const pick = tracks[Math.floor(Math.random() * Math.min(10, tracks.length))];
                pick.info.requester = client.user;
                player.queue.add(pick);
                if (!player.playing && !player.paused) player.play();
                if (channel) channel.send(`${emojis.info} | 🎯 Topic Play (**${topic}**): **${pick.info.title}**`);
                return;
            }
            if (channel) channel.send(`${emojis.error} | Topic Play ran out of **${topic}** songs.`);
        } catch (e) { console.error("Topic continuation:", e); }
    }

    // Autoplay: seed from last track artist
    if (!wasSkipped && autoplayState.has(player.guildId)) {
        try {
            if (typeof player.autoplay === "function") {
                const queued = await player.autoplay(player);
                if (queued) { if (channel) channel.send(`${emojis.info} | 🔁 Autoplay: playing a related track!`); return; }
            }
            const last  = lastTrackMap.get(player.guildId);
            const seed  = last ? `${last.info.author} ${last.info.title}` : "popular music";
            const res   = await client.riffy.resolve({ query: `${seed} mix`, requester: client.user });
            const tracks = res?.tracks;
            if (tracks?.length) {
                const pick = tracks[Math.floor(Math.random() * Math.min(5, tracks.length))];
                pick.info.requester = client.user;
                player.queue.add(pick);
                if (!player.playing && !player.paused) player.play();
                if (channel) channel.send(`${emojis.info} | 🔁 Autoplay: **${pick.info.title}**`);
                return;
            }
            if (channel) channel.send(`${emojis.error} | Autoplay couldn't find a related track.`);
        } catch (e) { console.error("Autoplay error:", e); if (channel) channel.send(`${emojis.error} | Autoplay failed.`); }
    }

    await updateVCStatus(player, "idle", null);
    if (tfnMode.has(player.guildId)) {
        if (channel) channel.send(`${emojis.info} | Queue ended — **24/7 mode** is on. I'm staying! 🎵`);
        return;
    }
    if (channel) channel.send(`${emojis.info} | Queue ended. I'll stay for **1 week** — add more songs! 🎵`);
    startIdleTimer(player);
});

// ─── Alone-in-VC Auto-Leave ────────────────────────────────────────────────────
client.on("voiceStateUpdate", async (oldState, newState) => {
    const guildId = oldState.guild?.id ?? newState.guild?.id;
    if (!guildId) return;
    const player = client.riffy?.players?.get(guildId);
    if (!player?.voiceChannel) return;

    // Someone joined our VC → cancel alone timer
    if (newState.channelId === player.voiceChannel && oldState.channelId !== player.voiceChannel) {
        if (aloneTimers.has(guildId)) {
            clearTimeout(aloneTimers.get(guildId));
            aloneTimers.delete(guildId);
            const ch = client.channels.cache.get(player.textChannel);
            if (ch) ch.send(`${emojis.success} | Welcome back! Let\'s keep the music going! 🎵`);
        }
        return;
    }

    // Someone left our VC → check if alone
    if (oldState.channelId !== player.voiceChannel) return;
    if (tfnMode.has(guildId) || aloneTimers.has(guildId)) return;
    const vc = client.channels.cache.get(player.voiceChannel);
    if (!vc || vc.members.filter(m => !m.user.bot).size > 0) return;

    // Alone! Warn and start 3-min timer
    const ch = client.channels.cache.get(player.textChannel);
    if (ch) ch.send(`${emojis.info} | I\'m alone in the voice channel. Leaving in **3 minutes** unless someone returns. 👋`);
    const timer = setTimeout(async () => {
        const vcNow    = client.channels.cache.get(player.voiceChannel);
        const stillAlone = !vcNow || vcNow.members.filter(m => !m.user.bot).size === 0;
        if (stillAlone) {
            const chNow = client.channels.cache.get(player.textChannel);
            if (chNow) chNow.send(`${emojis.info} | No one came back — leaving the voice channel. Goodbye! 👋`);
            await leaveVoiceChannel(player);
        }
        aloneTimers.delete(guildId);
    }, 3 * 60 * 1000);
    aloneTimers.set(guildId, timer);
});

// ─── Discord Voice State Forwarding ───────────────────────────────────────────
client.on("raw", d => {
    if (![GatewayDispatchEvents.VoiceStateUpdate, GatewayDispatchEvents.VoiceServerUpdate].includes(d.t)) return;
    client.riffy.updateVoiceState(d);
});

// ─── Graceful Shutdown / Fatal Errors ──────────────────────────────────────────
let shuttingDown = false;
async function shutdown(reason, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${emojis.info} Shutting down (${reason})...`);
    try {
        for (const timer of idleTimers.values()) clearTimeout(timer);
        for (const timer of aloneTimers.values()) clearTimeout(timer);
        for (const player of client.riffy?.players?.values?.() ?? []) {
            try { player.destroy(); } catch (_e) { /* already gone */ }
        }
        await client.destroy();
    } catch (_err) {
        /* best effort */
    }
    branding.printSignature({ extra: `stopped (${reason})` });
    process.exit(code);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
    console.error(`${emojis.error} Unhandled promise rejection:`, reason);
});
process.on("uncaughtException", (err) => {
    console.error(`${emojis.error} Uncaught exception:`, err);
    // systemd (Restart=on-failure) will bring us back cleanly.
    shutdown("uncaughtException", 1);
});

// ─── Login ─────────────────────────────────────────────────────────────────────
client.login(config.botToken).catch((err) => {
    console.error(
        `${emojis.error} Discord login failed: ${err?.message || err}\n` +
        `   • Check DISCORD_TOKEN in .env (Developer Portal → Bot → Reset Token).\n` +
        `   • Make sure the "Message Content" and "Server Members" intents are enabled\n` +
        `     in the Developer Portal if your features need them.\n` +
        `   • Run \`npm run doctor\` for a full configuration report.`
    );
    process.exit(1);
});
