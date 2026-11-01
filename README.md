# PokeTwo Autocatcher Bot

## Quick Start

### 1. Install Node.js (one time)

Open Terminal and run:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
```

Verify it worked:
```bash
node --version   # should print v20 or higher
```

### 2. Install dependencies

Navigate to this folder in Terminal, then run:

```bash
npm install
```

### 3. Create your `.env` file

Copy the example file:
```bash
cp .env.example .env
```

Open `.env` in any text editor and paste in your Discord token(s):
```
DISCORD_TOKEN=your_real_token_here
```

> **Single account:** use `DISCORD_TOKEN`
> **Two accounts:** use `DISCORD_TOKEN_BARUSU` and `DISCORD_TOKEN_VENTI` (or any suffix you like)

### 4. Run the bot

```bash
npm start
```

You should see:
```
[BOT] Starting 1 account(s): MAIN
[BOT:MAIN] Logged in as YourUsername#1234
```

---

## Run 24/7 with pm2 (recommended)

Install pm2 once:
```bash
npm install -g pm2
```

Start the bot through pm2:
```bash
pm2 start "npm start" --name poketwo-bot
pm2 save
pm2 startup
```

Run the command that `pm2 startup` prints — after that the bot **auto-restarts even after a Mac reboot**.

Useful pm2 commands:

| Command | What it does |
|---|---|
| `pm2 logs poketwo-bot` | See live bot output |
| `pm2 stop poketwo-bot` | Stop the bot |
| `pm2 restart poketwo-bot` | Restart it |
| `pm2 status` | Check if it's running |

---

## Bot Commands

Type these in any Discord channel where the bot is active:

| Command | What it does |
|---|---|
| `$pause` | Stop catching (bot stays connected) |
| `$resume` | Resume catching |
| `$status` | Show stats: caught/missed/last caught |
| `$missed` | List all missed Pokémon this session |
| `$corrections` | Show learned OCR corrections |

---

## Environment Variables

| Variable | Example | Description |
|---|---|---|
| `DISCORD_TOKEN` | `abc123...` | Single account token |
| `DISCORD_TOKEN_<NAME>` | `DISCORD_TOKEN_BARUSU=...` | Named/multiple accounts |
| `CHANNEL_IDS` | `123,456` | Limit to specific channels (blank = all) |
| `CHANNEL_IDS_<NAME>` | `CHANNEL_IDS_BARUSU=123` | Per-account channel limit |
