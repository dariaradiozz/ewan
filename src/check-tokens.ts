import 'dotenv/config';

async function checkToken(name: string, token: string): Promise<void> {
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: token,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { username?: string };
      console.log(`✅ ${name}: valid (logged in as ${data.username ?? 'unknown'})`);
    } else {
      const body = await res.text();
      console.log(`❌ ${name}: INVALID (HTTP ${res.status})`);
      console.log(`   Discord says: ${body}`);
    }
  } catch (err) {
    console.log(`❌ ${name}: ERROR checking token —`, err instanceof Error ? err.message : err);
  }
}

async function main() {
  const entries = Object.entries(process.env).filter(
    ([key, val]) => key.startsWith('DISCORD_TOKEN_') && !!val
  );

  if (process.env.DISCORD_TOKEN) {
    entries.push(['DISCORD_TOKEN_MAIN', process.env.DISCORD_TOKEN]);
  }

  if (entries.length === 0) {
    console.log('No DISCORD_TOKEN_* variables found in .env');
    return;
  }

  console.log(`Checking ${entries.length} token(s)...\n`);
  for (const [key, token] of entries) {
    const name = key.replace('DISCORD_TOKEN_', '').replace('DISCORD_TOKEN', 'MAIN');
    await checkToken(name, token as string);
  }
}

main();
