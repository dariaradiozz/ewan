import 'dotenv/config';
import { Client, Message, MessageEmbed, PartialMessage } from 'discord.js-selfbot-v13';
import { POKEMON_DATA } from './pokemon-data.js';
import fs from 'fs';
import path from 'path';
import http from 'http';

// ── Shared constants ──────────────────────────────────────────────────────────
const DEFAULT_MIN_DELAY = 1000;
const DEFAULT_MAX_DELAY = 3000;
const POKETWO_BOT_ID = '716390085896962058';
const POKENAME_USERNAME_FRAGMENTS = ['poke-name', 'pokéname', 'pokename', 'poké-name'];
const SPAWN_WINDOW_MS = 20_000;

const ALL_POKEMON_NAMES = Object.values(POKEMON_DATA);

// ── Shared helpers ────────────────────────────────────────────────────────────
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function matchPokemonName(raw: string): string | null {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const name of ALL_POKEMON_NAMES) {
    const pattern = new RegExp(`\\b${name.replace(/-/g, '[- ]?')}\\b`);
    if (pattern.test(cleaned)) return name;
  }
  return null;
}

// ── Raw name extraction for pokename text-mode ────────────────────────────────
// Used when the pokemon isn't in our known list (event forms, variants, etc.)
// Since pokename is now text-based and we trust it, extract whatever it sends.
function extractRawPokeNameText(text: string): string | null {
  if (!text) return null;

  // 1. Strip Discord custom/animated emoji  <:name:id>  <a:name:id>
  let s = text.replace(/<a?:\w+:\d+>/g, '');
  // 2. Strip user/role/channel mentions  <@123>  <#123>
  s = s.replace(/<[!#@&]?\d+>/g, '');
  // 3. Strip all markdown symbols: # * _ ~ ` | >
  s = s.replace(/[#*_~`|>]/g, '');
  // 4. Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  if (!s) return null;

  // "It's [a/an/the] Name" — e.g. "It's a Peakychu!"
  const itsMatch = s.match(/it'?s\s+(?:a\s+|an\s+|the\s+)?([A-Za-z][A-Za-z\- ]{0,40})/i);
  if (itsMatch) return itsMatch[1].trim().toLowerCase();

  // Whatever is left after stripping — take the leading name-like token(s)
  // Matches one or more capitalised/hyphenated words at the start of the string
  const leadMatch = s.match(/^([A-Za-z][A-Za-z\-]*(?:\s+[A-Za-z][A-Za-z\-]*){0,4})/);
  if (leadMatch) {
    const name = leadMatch[1].trim();
    if (name.length >= 2) return name.toLowerCase();
  }

  return null;
}

function isSpawnEmbed(embed: MessageEmbed): boolean {
  const title = (embed.title ?? '').toLowerCase();
  const desc = (embed.description ?? '').toLowerCase();
  return (
    title.includes('wild') ||
    desc.includes('wild') ||
    title.includes('pokémon has appeared') ||
    title.includes('pokemon has appeared') ||
    title.includes('has appeared')
  );
}

function isCaptchaMessage(message: Message): boolean {
  const content = (message.content ?? '').toLowerCase();
  const embed = message.embeds[0];
  const embedTitle = (embed?.title ?? '').toLowerCase();
  const embedDesc = (embed?.description ?? '').toLowerCase();
  return (
    content.includes('captcha') ||
    content.includes('suspicious') ||
    embedTitle.includes('captcha') ||
    embedTitle.includes('verify') ||
    embedDesc.includes('captcha') ||
    embedDesc.includes('verify') ||
    embedDesc.includes('suspicious')
  );
}

function isPokeName(message: Message): boolean {
  const username = (message.author.username ?? '').toLowerCase();
  return POKENAME_USERNAME_FRAGMENTS.some((frag) => username.includes(frag));
}

function matchHintPattern(hint: string): string[] {
  const pattern = new RegExp(
    '^' + hint.toLowerCase().replace(/[^a-z_\-]/g, '').replace(/_/g, '.') + '$'
  );
  const matches = ALL_POKEMON_NAMES.filter((name) => pattern.test(name));
  console.log(`[HINT] "${hint}" → ${matches.length} match(es): ${matches.join(', ') || 'none'}`);
  return matches;
}

// Reads the Pokemon name from a pokename bot message.
// First tries matching against our known list (fast, exact).
// Falls back to raw text extraction — handles event/unlisted forms like
// Shadow Lugia, Primal Kyogre, Origin Dialga, Crowned Zacian, etc.
async function readNameFromPokeNameMessage(
  message: Message
): Promise<string | null> {
  const embed = message.embeds[0];

  // ── 1. Try matching against our known list ────────────────────────────────
  const contentMatch = matchPokemonName(message.content ?? '');
  if (contentMatch) {
    console.log(`[POKENAME] Name from content (known): ${contentMatch}`);
    return contentMatch;
  }

  if (embed) {
    const titleMatch = matchPokemonName(embed.title ?? '');
    if (titleMatch) {
      console.log(`[POKENAME] Name from embed title (known): ${titleMatch}`);
      return titleMatch;
    }

    const descMatch = matchPokemonName(embed.description ?? '');
    if (descMatch) {
      console.log(`[POKENAME] Name from embed description (known): ${descMatch}`);
      return descMatch;
    }

    for (const field of embed.fields ?? []) {
      const fieldMatch = matchPokemonName(`${field.name} ${field.value}`);
      if (fieldMatch) {
        console.log(`[POKENAME] Name from embed field (known): ${fieldMatch}`);
        return fieldMatch;
      }
    }

    // ── 2. Raw text fallback — event/unlisted Pokemon ──────────────────────
    // pokename is now text-based, so extract the name directly even if it's
    // not in our local POKEMON_DATA (Shadow Lugia, Primal Kyogre, etc.)
    const rawSources = [
      embed.title ?? '',
      embed.description ?? '',
      ...(embed.fields ?? []).map((f) => `${f.name} ${f.value}`),
    ];
    for (const src of rawSources) {
      const rawName = extractRawPokeNameText(src);
      if (rawName) {
        console.log(`[POKENAME] Name from raw text (unlisted/event): ${rawName}`);
        return rawName;
      }
    }
  }

  // Also try raw message content if there was no embed or it had no useful text
  const rawContent = extractRawPokeNameText(message.content ?? '');
  if (rawContent) {
    console.log(`[POKENAME] Name from raw content (unlisted/event): ${rawContent}`);
    return rawContent;
  }

  return null;
}

// ── Bot factory — one instance per account ────────────────────────────────────
function createBot(token: string, channelIds: string[], name: string) {
  const tag = `[BOT:${name}]`;

  // Per-account state
  const pendingSpawns = new Map<
    string,
    { timestamp: number; send: (text: string) => Promise<unknown> }
  >();
  const pendingHints = new Map<string, (text: string) => Promise<unknown>>();

  // Live channel objects (in-memory, rebuilt each session as messages arrive)
  const activePoketwoChannels = new Map<string, Message['channel']>();

  // Persistent channel map — channel ID → last-seen timestamp (ms).
  // Channels not seen within CHANNEL_STALE_DAYS days are auto-removed on startup.
  const ACTIVE_CHANNELS_FILE = path.join(process.cwd(), 'src', `active-channels-${name}.json`);
  const CHANNEL_STALE_DAYS = 7;
  const savedChannelIds = new Map<string, number>(); // id → last seen timestamp

  function loadActiveChannels() {
    try {
      const raw = JSON.parse(fs.readFileSync(ACTIVE_CHANNELS_FILE, 'utf8'));
      // Back-compat: old format was a plain array of IDs
      if (Array.isArray(raw)) {
        (raw as string[]).forEach((id) => savedChannelIds.set(id, Date.now()));
      } else {
        for (const [id, ts] of Object.entries(raw as Record<string, number>)) {
          savedChannelIds.set(id, ts);
        }
      }
      if (savedChannelIds.size > 0)
        console.log(`${tag} Loaded ${savedChannelIds.size} remembered channel(s)`);
    } catch { /* no file yet — start fresh */ }
  }

  function saveActiveChannels() {
    const obj: Record<string, number> = {};
    for (const [id, ts] of savedChannelIds) obj[id] = ts;
    fs.writeFileSync(ACTIVE_CHANNELS_FILE, JSON.stringify(obj, null, 2));
  }

  function pruneStaleChannels() {
    const cutoff = Date.now() - CHANNEL_STALE_DAYS * 24 * 60 * 60 * 1000;
    let pruned = 0;
    for (const [id, ts] of savedChannelIds) {
      if (ts < cutoff) { savedChannelIds.delete(id); pruned++; }
    }
    if (pruned > 0) {
      saveActiveChannels();
      console.log(`${tag} Pruned ${pruned} stale channel(s) not seen in ${CHANNEL_STALE_DAYS} days`);
    }
  }

  function trackChannel(channelId: string, channel: Message['channel']) {
    activePoketwoChannels.set(channelId, channel);
    const isNew = !savedChannelIds.has(channelId);
    savedChannelIds.set(channelId, Date.now());
    if (isNew) {
      saveActiveChannels();
      console.log(`${tag} Remembered new channel ch=${channelId} (total: ${savedChannelIds.size})`);
    }
  }

  let minDelay = DEFAULT_MIN_DELAY;
  let maxDelay = DEFAULT_MAX_DELAY;

  let paused = false;
  let dotMode = false;
  let caughtCount = 0;
  let lastCaught = 'none';
  const missedList: string[] = [];

  async function doCatch(
    name: string,
    channelId: string,
    send: (text: string) => Promise<unknown>
  ) {
    const delay = randomDelay(minDelay, maxDelay);
    console.log(`${tag} [CATCH] ${name} in ch=${channelId} — sending in ${delay}ms`);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    try {
      await send(`<@${POKETWO_BOT_ID}> c ${name}`);
      caughtCount++;
      lastCaught = name;
      console.log(`${tag} [CAUGHT] ${name} (total: ${caughtCount})`);
      if (dotMode) {
        await new Promise<void>((resolve) => setTimeout(resolve, randomDelay(300, 800)));
        await send('.');
        console.log(`${tag} [DOT] Sent dot after catching ${name}`);
      }
    } catch (err) {
      console.error(`${tag} [ERROR] Failed to catch ${name}:`, err);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Client({ checkUpdate: false } as any);

  client.on('ready', () => {
    loadActiveChannels();
    pruneStaleChannels();
    console.log(`${tag} Logged in as ${client.user?.tag}`);
    console.log(`${tag} Watching ${channelIds.length > 0 ? channelIds.join(', ') : 'all channels'}`);
    console.log(`${tag} Delay: ${minDelay}ms – ${maxDelay}ms`);

    // On startup, pause incense on all remembered channels in case the bot
    // was cut off unexpectedly (sudden shutdown, battery death, etc.)
    if (savedChannelIds.size > 0) {
      console.log(`${tag} [STARTUP] Sending inc p to ${savedChannelIds.size} remembered channel(s) as safety pause...`);
      void (async () => {
        for (const chId of savedChannelIds.keys()) {
          try {
            const ch = await client.channels.fetch(chId) as Message['channel'] | null;
            if (ch && 'send' in ch) {
              await (ch as Message['channel']).send(`<@${POKETWO_BOT_ID}> inc p`);
              console.log(`${tag} [STARTUP] Sent inc p to ch=${chId}`);
              await new Promise<void>((resolve) => setTimeout(resolve, 600));
            }
          } catch (err) {
            console.error(`${tag} [STARTUP] Failed for ch=${chId}:`, err);
          }
        }
        console.log(`${tag} [STARTUP] Safety pause done. Type $incresume to start catching.`);
      })();
    }

    // Poll every 3 seconds for a pause trigger file (pause-<NAME>.txt)
    // Create the file from Terminal to pause just this account:
    //   touch ~/Downloads/poketwo-bot/pause-VENTI.txt
    const TRIGGER_FILE = path.join(process.cwd(), `pause-${name}.txt`);
    setInterval(() => {
      if (fs.existsSync(TRIGGER_FILE)) {
        try { fs.unlinkSync(TRIGGER_FILE); } catch { /* ignore */ }
        console.log(`${tag} [TRIGGER] Pause trigger file detected — pausing incense`);
        void pauseIncense();
      }
    }, 3000);
  });

  // Deduplicate message events — discord.js-selfbot-v13 sometimes fires the
  // same event multiple times, and occasionally with different IDs for the
  // same logical message. We use BOTH the message ID and a composite fingerprint
  // (channel + author + content + embed title) so either check catches it.
  const seenMessageIds = new Set<string>();

  function messageFingerprint(msg: Message): string {
    const embedTitle = msg.embeds[0]?.title ?? '';
    const embedDesc = (msg.embeds[0]?.description ?? '').slice(0, 80);
    const attachmentKey = msg.attachments.size
      ? [...msg.attachments.values()].map((a) => a.id).join(',')
      : '';
    const embedImageUrl = msg.embeds[0]?.image?.url ?? msg.embeds[0]?.thumbnail?.url ?? '';
    return `${msg.channelId}:${msg.author.id}:${msg.createdTimestamp}:${embedTitle}:${embedDesc}:${attachmentKey}:${embedImageUrl}`;
  }

  client.on('messageCreate', async (message: Message) => {
    console.log(`[RAW] id=${message.id} author=${message.author.username} bot=${message.author.bot} content="${message.content.slice(0,40)}" embeds=${message.embeds.length}`);
    // Check by ID first (fast path)
    if (seenMessageIds.has(message.id)) return;
    // Also check by content fingerprint to catch library re-fires with new IDs
    const fp = messageFingerprint(message);
    if (seenMessageIds.has(fp)) return;
    seenMessageIds.add(message.id);
    seenMessageIds.add(fp);
    // Keep the set small — remove after 10 seconds
    setTimeout(() => { seenMessageIds.delete(message.id); seenMessageIds.delete(fp); }, 10_000);

    const isSelf = message.author.id === client.user?.id;

    // ── Commands (only respond to messages from this account) ─────────────────
    if (isSelf) {
      const cmd = message.content.trim().toLowerCase();

      if (cmd === '$pause') {
        paused = true;
        console.log(`${tag} Paused`);
        await message.channel.send(`⏸ Account **${name}** autocatcher paused.`);
        return;
      }
      if (cmd === '$resume') {
        paused = false;
        console.log(`${tag} Resumed`);
        await message.channel.send(`▶️ Account **${name}** autocatcher resumed.`);
        return;
      }
      if (cmd === '$status') {
        const state = paused ? '⏸ Paused' : '▶️ Active';
        await message.channel.send(
          `**Account ${name} Status**\nState: ${state}\nDot mode: ${dotMode ? '🟢 ON' : '🔴 OFF'}\nCaught this session: **${caughtCount}**\nMissed this session: **${missedList.length}**\nLast caught: **${lastCaught}**`
        );
        return;
      }
      if (cmd === '$missed') {
        if (missedList.length === 0) {
          await message.channel.send(`✅ Account **${name}**: No Pokémon missed this session!`);
        } else {
          const lines = missedList.map((n, i) => `${i + 1}. ${n}`).join('\n');
          await message.channel.send(
            `**Account ${name} missed (${missedList.length}):**\n${lines}`
          );
        }
        return;
      }
      // $dot — toggle sending "." after every catch (helps trigger more spawns)
      if (cmd === '$dot') {
        dotMode = !dotMode;
        console.log(`${tag} Dot mode ${dotMode ? 'ON' : 'OFF'}`);
        await message.channel.send(
          dotMode
            ? '🟢 Dot mode **ON** — sending `.` after every catch.'
            : '🔴 Dot mode **OFF** — no longer sending `.` after catches.'
        );
        return;
      }
      // $help — list all commands
      if (cmd === '$help') {
        await message.channel.send(
          `**PokeTwo Autocatcher — Commands (Account ${name})**\n\n` +
          `**Catching**\n` +
          `\`$pause\` — Stop catching Pokémon\n` +
          `\`$resume\` — Resume catching Pokémon\n` +
          `\`$dot\` — Toggle sending \`.\` after every catch (on/off)\n` +
          `\`$status\` — Show current state, dot mode, caught/missed counts\n` +
          `\`$missed\` — List Pokémon missed this session\n\n` +
          `**Captcha / Incense**\n` +
          `\`$incpause\` — Send \`inc p\` to ALL remembered channels (pause incense everywhere)\n` +
          `\`$incresume\` — Send \`inc r\` to ALL remembered channels + resume bot (use after solving captcha)\n\n` +
          `**Channels**\n` +
          `\`$channels\` — List all remembered channels\n` +
          `\`$clearchannels\` — Wipe the remembered channel list\n\n` +
          `**Diagnostics**\n` +
          `\`$debug\` — Show internal state: pending spawns, dedup set, channel counts\n` +
          `\`$resetdedup\` — Clear the dedup set if the bot stops reacting to spawns\n` +
          `\`$delay <min> <max>\` — Change catch delay live in ms (e.g. \`$delay 2000 5000\`)`
        );
        return;
      }
      // $debug — show internal bot state for diagnosing catch/dedup issues
      if (cmd === '$debug') {
        const pendingList = [...pendingSpawns.entries()].map(
          ([chId, e]) => `  <#${chId}> — waiting ${Math.round((Date.now() - e.timestamp) / 1000)}s`
        );
        const hintList = [...pendingHints.keys()].map((chId) => `  <#${chId}>`);
        await message.channel.send(
          `**🔍 Debug — Account ${name}**\n` +
          `Paused: **${paused}** | Dot mode: **${dotMode}**\n` +
          `Caught: **${caughtCount}** | Missed: **${missedList.length}**\n` +
          `Dedup set size: **${seenMessageIds.size}**\n\n` +
          `Pending spawns (${pendingSpawns.size}):\n${pendingList.join('\n') || '  none'}\n\n` +
          `Pending hints (${pendingHints.size}):\n${hintList.join('\n') || '  none'}\n\n` +
          `Remembered channels (${savedChannelIds.size}):\n` +
          ([...savedChannelIds.keys()].map((id) => `  <#${id}>`).join('\n') || '  none')
        );
        return;
      }
      // $resetdedup — clear the dedup set (use if bot stops reacting to spawns)
      if (cmd === '$resetdedup') {
        const count = seenMessageIds.size;
        seenMessageIds.clear();
        await message.channel.send(`✅ Cleared dedup set (${count} entries removed).`);
        return;
      }
      // $delay <min> <max> — change catch delay range live
      if (cmd.startsWith('$delay ')) {
        const parts = cmd.slice(7).trim().split(/\s+/);
        const newMin = parseInt(parts[0], 10);
        const newMax = parseInt(parts[1], 10);
        if (isNaN(newMin) || isNaN(newMax) || newMin < 0 || newMax < newMin) {
          await message.channel.send('❌ Usage: `$delay <min_ms> <max_ms>` — e.g. `$delay 2000 5000`');
          return;
        }
        minDelay = newMin;
        maxDelay = newMax;
        await message.channel.send(`✅ Delay updated: **${minDelay}ms – ${maxDelay}ms**`);
        return;
      }
      // $incpause — send "inc p" to every remembered channel (manual pause incense everywhere)
      if (cmd === '$incpause') {
        if (savedChannelIds.size === 0) {
          await message.channel.send('❌ No channels remembered yet. The bot needs to see at least one PokeTwo spawn first.');
          return;
        }
        paused = true;
        console.log(`${tag} [INCPAUSE] Pausing incense in ${savedChannelIds.size} channel(s)...`);
        let sent = 0;
        let failed = 0;
        for (const chId of savedChannelIds.keys()) {
          try {
            const ch = activePoketwoChannels.get(chId)
              ?? await client.channels.fetch(chId) as Message['channel'] | null;
            if (ch && 'send' in ch) {
              await (ch as Message['channel']).send(`<@${POKETWO_BOT_ID}> inc p`);
              sent++;
              console.log(`${tag} [INCPAUSE] Sent inc p to ch=${chId}`);
              await new Promise<void>((resolve) => setTimeout(resolve, 600));
            }
          } catch (err) {
            failed++;
            console.error(`${tag} [INCPAUSE] Failed for ch=${chId}:`, err);
          }
        }
        await message.channel.send(
          `⏸ Account **${name}** paused.\n✅ Sent \`inc p\` to **${sent}** channel(s)${failed > 0 ? ` (${failed} failed)` : ''}.`
        );
        return;
      }
      // $incresume — send "inc r" to every remembered channel, then resume bot
      if (cmd === '$incresume') {
        if (savedChannelIds.size === 0) {
          await message.channel.send('❌ No channels remembered yet. The bot needs to see at least one PokeTwo spawn first.');
          return;
        }
        paused = false;
        console.log(`${tag} [INCRESUME] Resuming incense in ${savedChannelIds.size} channel(s)...`);
        let sent = 0;
        let failed = 0;
        for (const chId of savedChannelIds.keys()) {
          try {
            const ch = activePoketwoChannels.get(chId)
              ?? await client.channels.fetch(chId) as Message['channel'] | null;
            if (ch && 'send' in ch) {
              await (ch as Message['channel']).send(`<@${POKETWO_BOT_ID}> inc r`);
              sent++;
              console.log(`${tag} [INCRESUME] Sent inc r to ch=${chId}`);
              await new Promise<void>((resolve) => setTimeout(resolve, 600));
            }
          } catch (err) {
            failed++;
            console.error(`${tag} [INCRESUME] Failed for ch=${chId}:`, err);
          }
        }
        await message.channel.send(
          `▶️ Account **${name}** resumed.\n✅ Sent \`inc r\` to **${sent}** channel(s)${failed > 0 ? ` (${failed} failed)` : ''}.`
        );
        return;
      }
      // $channels — list all remembered channels
      if (cmd === '$channels') {
        if (savedChannelIds.size === 0) {
          await message.channel.send('📭 No channels remembered yet.');
          return;
        }
        const lines = [...savedChannelIds.entries()].map(([id, ts]) => {
          const daysAgo = Math.floor((Date.now() - ts) / 86_400_000);
          return `<#${id}> — last seen ${daysAgo === 0 ? 'today' : `${daysAgo}d ago`}`;
        }).join('\n');
        await message.channel.send(
          `**Account ${name} — remembered channels (${savedChannelIds.size}):**\n${lines}`
        );
        return;
      }
      // $clearchannels — wipe the remembered channel list
      if (cmd === '$clearchannels') {
        const count = savedChannelIds.size;
        savedChannelIds.clear();
        saveActiveChannels();
        await message.channel.send(`🗑️ Cleared ${count} remembered channel(s).`);
        return;
      }
      return;
    }

    // ── Pokétwo messages ───────────────────────────────────────────────────────
    if (message.author.id === POKETWO_BOT_ID) {
      const embed = message.embeds[0];
      trackChannel(message.channelId, message.channel);

      console.log(
        `${tag} [POKETWO] ch=${message.channelId} embeds=${message.embeds.length} "${message.content.slice(0, 60)}"`
      );
      if (embed) {
        console.log(`${tag} [POKETWO] title="${embed.title}" desc="${(embed.description ?? '').slice(0, 80)}"`);
      }

      // Captcha — pause and stop incense on all active channels
      if (isCaptchaMessage(message)) {
        paused = true;
        console.log(`${tag} [CAPTCHA] Detected! Pausing.`);
        for (const [chId, ch] of activePoketwoChannels) {
          try {
            await ch.send(`<@${POKETWO_BOT_ID}> inc p`);
            console.log(`${tag} [CAPTCHA] Sent inc p to ch=${chId}`);
          } catch {}
        }
        return;
      }

      // Wrong catch — request a hint
      if (
        message.content.toLowerCase().includes('wrong pokémon') ||
        message.content.toLowerCase().includes('wrong pokemon')
      ) {
        console.log(`${tag} [WRONG] Wrong catch in ch=${message.channelId} — requesting hint`);
        pendingHints.set(message.channelId, (text) => message.channel.send(text));
        try {
          await message.channel.send(`<@${POKETWO_BOT_ID}> hint`);
        } catch (err) {
          console.error(`${tag} [HINT] Failed to send hint request:`, err);
        }
        return;
      }

      // Hint response
      const hintSend = pendingHints.get(message.channelId);
      if (hintSend) {
        const hintContent = message.content.replace(/\\_/g, '_');
        const hintMatch = hintContent.match(/the pok[eé]mon is ([A-Za-z_\-]+)/i);
        if (hintMatch) {
          const hintStr = hintMatch[1];
          console.log(`${tag} [HINT] Got hint: "${hintStr}"`);
          const candidates = matchHintPattern(hintStr);
          if (candidates.length === 1) {
            pendingHints.delete(message.channelId);
            await doCatch(candidates[0], message.channelId, hintSend);
          } else if (candidates.length > 1) {
            console.log(`${tag} [HINT] Ambiguous (${candidates.length} candidates) — requesting another hint`);
            try {
              await message.channel.send(`<@${POKETWO_BOT_ID}> hint`);
            } catch (err) {
              console.error(`${tag} [HINT] Failed to send follow-up hint:`, err);
              pendingHints.delete(message.channelId);
              await doCatch(candidates[0], message.channelId, hintSend);
            }
          } else {
            pendingHints.delete(message.channelId);
            console.log(`${tag} [HINT] No Pokémon matched hint "${hintStr}"`);
          }
          return;
        }
      }

      if (paused) return;
      if (channelIds.length > 0 && !channelIds.includes(message.channelId)) return;

      // "Wild X fled" — log as missed
      if (embed) {
        const fledMatch = (embed.title ?? '').match(/^Wild (.+?) fled\./i);
        if (fledMatch) {
          const missedName = fledMatch[1].toLowerCase();
          missedList.push(missedName);
          console.log(`${tag} [MISSED] ${missedName} (total missed: ${missedList.length})`);
        }
      }

      // Spawn — wait for Poké-Name
      if (embed && isSpawnEmbed(embed)) {
        console.log(`${tag} [SPAWN] Pokétwo spawn in ch=${message.channelId} — waiting for Poké-Name...`);
        pendingSpawns.set(message.channelId, {
          timestamp: Date.now(),
          send: (text) => message.channel.send(text),
        });
        setTimeout(() => {
          const entry = pendingSpawns.get(message.channelId);
          if (entry && Date.now() - entry.timestamp >= SPAWN_WINDOW_MS) {
            pendingSpawns.delete(message.channelId);
            console.log(`${tag} [SPAWN] Window expired for ch=${message.channelId}`);
          }
        }, SPAWN_WINDOW_MS);
      }
      return;
    }

    // ── Poké-Name bot messages ─────────────────────────────────────────────────
    if (isPokeName(message)) {
      const channelId = message.channelId;
      console.log(`${tag} [POKENAME] Message in ch=${channelId} from ${message.author.username}`);

      const pending = pendingSpawns.get(channelId);
      if (!pending) {
        console.log(`${tag} [POKENAME] No pending spawn — skipping`);
        return;
      }
      if (paused) {
        pendingSpawns.delete(channelId);
        return;
      }

      const pokeName = await readNameFromPokeNameMessage(message);

      if (!pokeName) {
        // Don't delete the pending spawn yet — PokéName may edit/update the
        // message with the actual name a moment later (messageUpdate will catch it).
        console.log(`${tag} [POKENAME] Could not read name from initial message — keeping spawn pending for edits`);
        return;
      }

      pendingSpawns.delete(channelId);
      await doCatch(pokeName, channelId, pending.send);
    }
  });

  client.on(
    'messageUpdate',
    async (_old: Message | PartialMessage, message: Message | PartialMessage) => {
      if (paused) return;
      if (channelIds.length > 0 && !channelIds.includes(message.channelId)) return;

      // PokéName sometimes sends an empty message first and edits it with the
      // actual name — must check this BEFORE the Poketwo-only guard below.
      if (isPokeName(message as Message)) {
        const channelId = message.channelId;
        const pending = pendingSpawns.get(channelId);
        if (!pending) return;

        console.log(`${tag} [POKENAME/EDIT] PokéName edited message in ch=${channelId} — re-reading`);
        const pokeName = await readNameFromPokeNameMessage(message as Message);

        if (!pokeName) {
          // Still can't read — record as missed and move on
          console.log(`${tag} [POKENAME/EDIT] Still no name after edit — recording as missed`);
          pendingSpawns.delete(channelId);
          missedList.push('unknown (name unreadable)');
          return;
        }

        pendingSpawns.delete(channelId);
        await doCatch(pokeName, channelId, pending.send);
        return;
      }

      // Poketwo-only: detect spawn embeds that were edited in
      if (message.author?.id !== POKETWO_BOT_ID) return;

      const embed = message.embeds[0];
      if (embed && isSpawnEmbed(embed) && !pendingSpawns.has(message.channelId)) {
        console.log(`${tag} [SPAWN/EDIT] Updated spawn in ch=${message.channelId}`);
        trackChannel(message.channelId, message.channel as Message['channel']);
        pendingSpawns.set(message.channelId, {
          timestamp: Date.now(),
          send: (text) => (message.channel as Message['channel']).send(text),
        });
      }
    }
  );

  client.login(token).catch((err: Error) => {
    console.error(`${tag} [ERROR] Login failed:`, err.message);
  });

  // Called on shutdown — sends inc p to all remembered channels
  async function shutdown() {
    if (savedChannelIds.size === 0) return;
    console.log(`${tag} [SHUTDOWN] Sending inc p to ${savedChannelIds.size} channel(s)...`);
    for (const chId of savedChannelIds.keys()) {
      try {
        const ch = activePoketwoChannels.get(chId)
          ?? await client.channels.fetch(chId) as Message['channel'] | null;
        if (ch && 'send' in ch) {
          await (ch as Message['channel']).send(`<@${POKETWO_BOT_ID}> inc p`);
          console.log(`${tag} [SHUTDOWN] Sent inc p to ch=${chId}`);
          await new Promise<void>((resolve) => setTimeout(resolve, 600));
        }
      } catch (err) {
        console.error(`${tag} [SHUTDOWN] Failed for ch=${chId}:`, err);
      }
    }
    client.destroy();
  }

  // Called manually via SIGUSR1 — sends inc p to all channels without stopping the bot
  async function pauseIncense() {
    if (savedChannelIds.size === 0) {
      console.log(`${tag} [PAUSE] No remembered channels — nothing to pause`);
      return;
    }
    paused = true;
    console.log(`${tag} [PAUSE] Sending inc p to ${savedChannelIds.size} channel(s)...`);
    for (const chId of savedChannelIds.keys()) {
      try {
        const ch = activePoketwoChannels.get(chId)
          ?? await client.channels.fetch(chId) as Message['channel'] | null;
        if (ch && 'send' in ch) {
          await (ch as Message['channel']).send(`<@${POKETWO_BOT_ID}> inc p`);
          console.log(`${tag} [PAUSE] Sent inc p to ch=${chId}`);
          await new Promise<void>((resolve) => setTimeout(resolve, 600));
        }
      } catch (err) {
        console.error(`${tag} [PAUSE] Failed for ch=${chId}:`, err);
      }
    }
    console.log(`${tag} [PAUSE] Done. Bot paused — type $incresume in Discord to resume.`);
  }

  function getStatus(): string {
    const tag2 = client.user?.tag ?? 'not logged in';
    const state = paused ? '⏸ Paused' : '▶️ Active';
    return `[BOT:${name}] ${tag2} | ${state} | Caught: ${caughtCount} | Missed: ${missedList.length} | Last: ${lastCaught}`;
  }

  return { client, shutdown, pauseIncense, getStatus };
}

// ── Entry point ───────────────────────────────────────────────────────────────

// Lockfile guard — prevents two instances from running at the same time.
const LOCK_FILE = path.join(process.cwd(), 'bot.lock');

(function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const existingPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    if (!isNaN(existingPid)) {
      try {
        process.kill(existingPid, 0);
        console.error(
          `\n[BOT] ❌ Another instance is already running (PID ${existingPid}).\n` +
          `[BOT]    Run  killall node  or  pkill -f poketwo  to stop it first.\n`
        );
        process.exit(1);
      } catch {
        console.warn(`[BOT] Stale lock file found (PID ${existingPid} is gone) — overwriting.`);
      }
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  console.log(`[BOT] Lock acquired (PID ${process.pid})`);

  function releaseLock() {
    try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ }
  }
  process.on('exit', releaseLock);
  process.on('SIGINT',  releaseLock);
  process.on('SIGTERM', releaseLock);
})();

// Collect accounts from env vars.
const accounts: { token: string; channelIds: string[]; name: string }[] = [];

const seenTokens = new Set<string>();

const tokenEntries = Object.entries(process.env)
  .filter(([key, val]) => key.startsWith('DISCORD_TOKEN_') && !!val)
  .sort(([a], [b]) => a.localeCompare(b));

for (const [key, token] of tokenEntries) {
  if (seenTokens.has(token!)) {
    console.warn(`[BOT] Skipping duplicate token for ${key} — same token already registered`);
    continue;
  }
  seenTokens.add(token!);
  const suffix = key.slice('DISCORD_TOKEN_'.length);
  const raw = process.env[`CHANNEL_IDS_${suffix}`] ?? '';
  const channelIds = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  accounts.push({ token: token!, channelIds, name: suffix });
}

if (process.env.DISCORD_TOKEN && !seenTokens.has(process.env.DISCORD_TOKEN)) {
  const raw = process.env.CHANNEL_IDS ?? '';
  const channelIds = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  accounts.push({ token: process.env.DISCORD_TOKEN, channelIds, name: 'MAIN' });
}

if (accounts.length === 0) {
  console.error(
    '[ERROR] No tokens found.\n' +
    'Set DISCORD_TOKEN for a single account, or DISCORD_TOKEN_<name> for named/multiple accounts.\n' +
    'Examples: DISCORD_TOKEN_BARUSU, DISCORD_TOKEN_ALT, DISCORD_TOKEN_1'
  );
  process.exit(1);
}

console.log(`[BOT] Starting ${accounts.length} account(s): ${accounts.map((a) => a.name).join(', ')}`);
const bots = accounts.map((account) =>
  createBot(account.token, account.channelIds, account.name)
);

// ── Status dashboard (view all accounts at http://localhost:4000) ─────────────
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT) || 4000;
const dashboardServer = http.createServer((req, res) => {
  if (req.url === '/status.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accounts: bots.map((b) => b.getStatus()) }, null, 2));
    return;
  }
  const lines = bots.map((b) => b.getStatus()).join('\n');
  const html = `<!DOCTYPE html>
<html><head><title>Poketwo Bot Status</title>
<meta http-equiv="refresh" content="5">
<style>body{font-family:monospace;background:#111;color:#0f0;padding:20px}pre{font-size:16px;white-space:pre-wrap}</style>
</head><body><h2>Poketwo Bot — Account Status</h2><pre>${lines}</pre>
<p style="color:#888">Auto-refreshes every 5s. Last updated: ${new Date().toLocaleString()}</p>
</body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});
dashboardServer.listen(DASHBOARD_PORT, () => {
  console.log(`[BOT] Dashboard running at http://localhost:${DASHBOARD_PORT}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function gracefulShutdown(signal: string) {
  console.log(`\n[BOT] ${signal} received — pausing incense on all accounts before exit...`);
  await Promise.allSettled(bots.map((b) => b.shutdown()));
  console.log('[BOT] Done. Goodbye!');
  process.exit(0);
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('SIGUSR1', () => {
  console.log('\n[BOT] SIGUSR1 received — sending inc p on all accounts (bot stays running)...');
  void Promise.allSettled(bots.map((b) => b.pauseIncense()))
    .then(() => console.log('[BOT] inc p sent to all accounts.'));
});

process.on('SIGUSR2', () => {
  console.log('\n[BOT] ── Account Status ──────────────────────────');
  for (const b of bots) console.log(b.getStatus());
  console.log('[BOT] ─────────────────────────────────────────────');
});
