const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
} = require("discord.js");
const emojis = require("../emojis.js");
const config  = require("../config.js");
const branding = require("./branding.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(ms) {
    if (!ms || ms <= 0 || ms === Infinity) return "0:00";
    const s = Math.floor((ms / 1000) % 60);
    const m = Math.floor((ms / 60000) % 60);
    const h = Math.floor(ms / 3600000);
    if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function getDur(track) {
    if (track.info.isStream) return "🔴 LIVE";
    return formatDuration(track.info.duration);
}

function buildProgressBar(position, duration, length = 14) {
    if (!duration || duration <= 0 || duration === Infinity) return null;
    const p = Math.min(Math.max(position / duration, 0), 1);
    const filled = Math.round(p * length);
    return "\u25B0".repeat(filled) + "\u25B1".repeat(length - filled);
}

function getSourceLabel(uri = "") {
    if (uri.includes("youtube") || uri.includes("youtu.be")) return "YouTube";
    if (uri.includes("spotify"))    return "Spotify";
    if (uri.includes("soundcloud")) return "SoundCloud";
    if (uri.includes("deezer"))     return "Deezer";
    return "Source";
}


// ─── Branding footer ──────────────────────────────────────────────────────────
// Uses the shared branding module so the creator credit can never drift or
// disappear from a future edit. Honours FOOTER_TEXT when the user overrides it.
function brand(extra) {
    const custom = (config.footerText || "").trim();
    // With no FOOTER_TEXT override, delegate to the branding module so the
    // creator credit and Discord's 2048-character footer cap are enforced in
    // exactly one place.
    if (!custom) return branding.getFooter(extra);
    return (extra ? `${extra}  ·  ${custom}` : custom).slice(0, 2000);
}

// Parse custom emoji string "<:name:id>" into API object for button setEmoji
function parseEmoji(str) {
    if (!str || typeof str !== "string") return "🎵";
    const m = str.match(/^<(a?):([^:]+):(\d+)>$/);
    if (m) return { name: m[2], id: m[3], animated: m[1] === "a" };
    return str;
}

// ─── Now Playing embed + control buttons ─────────────────────────────────────
// opts: { autoplayEnabled, activeTopic, activeFilter, volume, queueLength, position, isPaused }
function buildNowPlaying(track, opts = {}) {
    const {
        autoplayEnabled = false,
        activeTopic     = null,
        activeFilter    = null,
        volume          = 100,
        queueLength     = 0,
        position        = 0,
        isPaused        = false,
    } = opts;

    // Progress bar line
    const bar  = buildProgressBar(position, track.info.duration);
    const progLine = (!track.info.isStream && bar)
        ? `\`${bar}\`  \`${formatDuration(position)} / ${getDur(track)}\``
        : null;

    // Requester — prefer mention, fallback to username
    const req  = track.info.requester;
    const reqTxt = req?.id ? `<@${req.id}>` : (req?.username ?? "Unknown");

    const descLines = [
        `🔸  **Artist ·** ${track.info.author || "Unknown"}`,
        `🔸  **Duration ·** \`${getDur(track)}\``,
        `🔸  **Source ·** [Listen on ${getSourceLabel(track.info.uri)}](${track.info.uri})`,
        progLine ? `\n${progLine}` : null,
        `\n🛡️  **Requested by ·** ${reqTxt}`,
    ].filter(l => l !== null);

    // Footer
    const footerParts = [brand()];
    if (activeFilter) footerParts.push(`🎚 ${activeFilter}`);
    if (volume !== 100) footerParts.push(`🔊 ${volume}%`);
    if (queueLength > 0) footerParts.push(`📋 ${queueLength} in queue`);

    const embed = new EmbedBuilder()
        .setColor(config.embedColor)
        .setAuthor({ name: "🎵   Now Playing" })
        .setTitle(track.info.title)
        .setURL(track.info.uri)
        .setDescription(descLines.join("\n"))
        .setFooter({ text: footerParts.join("  ·  ") });

    if (track.info.thumbnail && typeof track.info.thumbnail === "string") {
        embed.setThumbnail(track.info.thumbnail);
    }

    // ── Row 1: Loop | Seek-15s | Pause/Play | Skip | Shuffle ────────────────
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("btn_loop")
            .setEmoji(parseEmoji(emojis.repeat))
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("btn_seek_back")
            .setEmoji(parseEmoji(emojis.previous))
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("btn_pause")
            .setEmoji(parseEmoji(isPaused ? emojis.play : emojis.pause))
            .setStyle(isPaused ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("btn_skip")
            .setEmoji(parseEmoji(emojis.skip))
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("btn_shuffle")
            .setEmoji(parseEmoji(emojis.shuffle))
            .setStyle(ButtonStyle.Secondary),
    );

    // ── Row 2: Queue | Vol- | Stop | Vol+ | Autoplay ─────────────────────────
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("btn_queue")
            .setEmoji(parseEmoji(emojis.queue))
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("btn_vol_down")
            .setEmoji("🔉")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("btn_stop")
            .setEmoji(parseEmoji(emojis.stop))
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId("btn_vol_up")
            .setEmoji("🔊")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("btn_autoplay")
            .setEmoji("🤖")
            .setStyle(autoplayEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    // ── Row 3: Topic Play | Filters ──────────────────────────────────────────
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("btn_topicplay")
            .setLabel(activeTopic ? `🎯 ${activeTopic}`.slice(0,80) : "🎯 Topic Play")
            .setStyle(activeTopic ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("btn_filters")
            .setLabel(activeFilter ? `🎚 ${activeFilter}`.slice(0,80) : "🎚 Filters")
            .setStyle(activeFilter ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    return { embed, row1, row2, row3 };
}

// ─── Track Queued embed ───────────────────────────────────────────────────────
function buildQueuedTrack(track, position) {
    const embed = new EmbedBuilder()
        .setColor(config.embedColor)
        .setAuthor({ name: "✅  Added to Queue" })
        .setTitle(track.info.title)
        .setURL(track.info.uri)
        .addFields(
            { name: "Artist",   value: track.info.author || "Unknown", inline: true },
            { name: "Duration", value: getDur(track),                  inline: true },
            { name: "Position", value: `#${position}`,                 inline: true }
        );
    if (track.info.thumbnail && typeof track.info.thumbnail === "string") {
        embed.setThumbnail(track.info.thumbnail);
    }
    embed.setFooter({ text: brand() });
    return embed;
}

// ─── Search Results embed ─────────────────────────────────────────────────────
function buildSearchResults(tracks, query) {
    const list = tracks
        .map((t,i) => `\`${i+1}.\` **${t.info.title}**\n↳ ${t.info.author} · ${formatDuration(t.info.duration)}`)
        .join("\n\n");
    return new EmbedBuilder()
        .setColor(config.embedColor)
        .setAuthor({ name: `🔍 Search: ${query}`.slice(0,256) })
        .setDescription(list)
        .setFooter({ text: brand("Pick a track below · Expires in 30s") });
}

// ─── Playlist Added embed ─────────────────────────────────────────────────────
function buildAddedPlaylist(playlistInfo, tracks) {
    const total = tracks.reduce((a,t) => a + (t.info.isStream ? 0 : t.info.duration||0), 0);
    const embed = new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle(`${emojis.success} Playlist Added`)
        .setDescription(`**${playlistInfo.name}**`)
        .addFields(
            { name: "Tracks",         value: `${tracks.length}`,    inline: true },
            { name: "Total Duration", value: formatDuration(total), inline: true }
        );
    if (playlistInfo.thumbnail) embed.setThumbnail(playlistInfo.thumbnail);
    embed.setFooter({ text: brand() });
    return embed;
}

// ─── Queue Page (paginated) ───────────────────────────────────────────────────
function buildQueuePage(queue, currentTrack, page = 0, itemsPerPage = 10) {
    const start = page * itemsPerPage;
    const end   = start + itemsPerPage;
    const slice = queue.slice(start, end);
    const totalPages = Math.max(1, Math.ceil(queue.length / itemsPerPage));
    const totalDur   = queue.reduce((a,t) => a + (t.info.isStream ? 0 : t.info.duration||0), 0);

    const embed = new EmbedBuilder().setColor(config.embedColor).setTitle(`${emojis.queue} Queue`);

    let desc = "";
    if (currentTrack && page === 0) {
        desc += `**Now Playing:**\n${emojis.play} **${currentTrack.info.title}** — ${getDur(currentTrack)}\n\n`;
    }
    if (slice.length) {
        desc += "**Up Next:**\n";
        desc += slice.map((t,i) => `\`${start+i+1}.\` ${t.info.title} — ${getDur(t)}`).join("\n");
        if (queue.length > end) desc += `\n*...and ${queue.length - end} more*`;
    } else {
        desc += "*Queue is empty*";
    }

    embed.setDescription(desc);
    if (page === 0 && currentTrack?.info?.thumbnail) embed.setThumbnail(currentTrack.info.thumbnail);

    const footerParts = [`${queue.length} track(s) in queue`];
    if (totalDur > 0) footerParts.push(`Total: ${formatDuration(totalDur)}`);
    if (totalPages > 1) footerParts.push(`Page ${page+1}/${totalPages}`);
    footerParts.push(brand());
    embed.setFooter({ text: footerParts.join("  ·  ") });

    return embed;
}

// ─── History embed ────────────────────────────────────────────────────────────
function buildHistory(history) {
    const list = history.slice(0,20)
        .map((t,i) => `\`${i+1}.\` **${t.title}** — ${formatDuration(t.duration)}`)
        .join("\n");
    return new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle("🕓 Recently Played")
        .setDescription(list || "*No history yet*")
        .setFooter({ text: brand(`${history.length} track(s) played this session`) });
}

// ─── Lyrics embed ─────────────────────────────────────────────────────────────
function buildLyrics(query, lyricsChunk, page, totalPages) {
    const embed = new EmbedBuilder()
        .setColor(config.embedColor)
        .setAuthor({ name: "📜 Lyrics" })
        .setTitle(query.slice(0,256))
        .setDescription(lyricsChunk);
    embed.setFooter({ text: brand(totalPages > 1 ? `Page ${page} of ${totalPages}` : "Lyrics via lyrics.ovh") });
    return embed;
}

// ─── Help embed ───────────────────────────────────────────────────────────────
function buildHelp() {
    const cmds = [
        ["/play <song>",          "Search YouTube, paste a URL or Spotify link"],
        ["/playnext <song>",      "Queue a song at the TOP — plays next"],
        ["/pause / /resume",      "Pause or resume playback"],
        ["/skip",                 "Skip the current track"],
        ["/stop",                 "Stop music and leave the voice channel"],
        ["/queue",                "Show the queue with page navigation"],
        ["/nowplaying",           "Refresh the Now Playing card"],
        ["/volume <0-100>",       "Set player volume"],
        ["/shuffle",              "Shuffle the queue"],
        ["/loop",                 "Cycle: Loop Off → Track → Queue"],
        ["/remove <pos>",         "Remove a track from the queue"],
        ["/move <from> <to>",     "Reorder a track in the queue"],
        ["/jump <pos>",           "Jump straight to a queue position"],
        ["/replay",               "Restart the current track from 0:00"],
        ["/clear",                "Clear the entire queue"],
        ["/seek <time>",          "Jump to a timestamp (e.g. 1:30 or 90)"],
        ["/bassboost <level>",    "Bass boost: off / low / medium / high / insane"],
        ["/filters <filter>",     "Audio FX: nightcore, vaporwave, 8D, karaoke, soft, pop, reset…"],
        ["/history",              "Show recently played tracks this session"],
        ["/lyrics [song]",        "Fetch lyrics for current or any song"],
        ["/247",                  "Toggle 24/7 mode — stay in VC forever"],
        ["/about",                "About TANVEER MUSIC BOT V3 — creator & node status"],
        ["/ping",                 "Check gateway latency and Lavalink node status"],
    ];
    const btnInfo = [
        "**Now Playing Buttons (Row 1):** 🔁 Loop  ⏪ Seek -15s  ⏸ Pause  ⏭ Skip  🔀 Shuffle",
        "**Now Playing Buttons (Row 2):** 📋 Queue  🔉 Vol-  ⏹ Stop  🔊 Vol+  🤖 Autoplay",
        "**Now Playing Buttons (Row 3):** 🎯 Topic Play  🎚 Filters",
    ];
    return new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle(`${emojis.info} Music Bot — All Commands`)
        .setDescription(
            cmds.map(([n,d]) => `${emojis.music} \`${n}\` — ${d}`).join("\n") +
            "\n\n" + btnInfo.join("\n")
        )
        .setFooter({ text: brand("Use / to access all slash commands") });
}

// ─── About embed ──────────────────────────────────────────────────────────────
// Permanent creator branding. The ASCII banner is rendered inside a code block
// so Discord preserves the alignment.
function buildAbout({ version, nodeName, nodeOnline, spotifyEnabled, guildCount, uptimeMs } = {}) {
    const b = branding.IDENTITY;
    const uptime = (() => {
        const total = Math.floor((uptimeMs || 0) / 1000);
        const d = Math.floor(total / 86400);
        const h = Math.floor((total % 86400) / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    })();

    const desc = [
        "```",
        branding.getBannerArt(),
        "```",
        "",
        `👑 **${b.product}**  \`v${version || "3.0.0"}\``,
        `✍️ **${b.madeBy}**`,
        `💬 **Discord:** \`${b.discord}\``,
        "",
        `🎧 **Lavalink node:** \`${nodeName}\` — ${nodeOnline ? "🟢 connected" : "🔴 not connected"}`,
        `🎵 **Spotify:** ${spotifyEnabled ? "🟢 enabled" : "⚪ disabled"}`,
        `🏠 **Servers:** \`${guildCount ?? 0}\``,
        `⏱️ **Uptime:** \`${uptime}\``,
    ].join("\n");

    return new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle(`${emojis.info} About this bot`)
        .setDescription(desc.slice(0, 4096))
        .setFooter({ text: brand() });
}

module.exports = {
    buildNowPlaying,
    buildQueuedTrack,
    buildSearchResults,
    buildAddedPlaylist,
    buildQueuePage,
    buildHistory,
    buildLyrics,
    buildHelp,
    buildAbout,
    formatDuration,
};
