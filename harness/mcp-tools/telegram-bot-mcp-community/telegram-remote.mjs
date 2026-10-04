#!/usr/bin/env node
/**
 * Telegram Remote Control Bridge
 * 
 * Bridges Telegram chat ↔ tmux session running OpenCode/agy.
 * 
 * How it works:
 * 1. Creates (or attaches to) a tmux session named "remote-agent"
 * 2. Polls Telegram for your messages
 * 3. Injects your messages into the tmux pane as keystrokes
 * 4. Captures tmux pane output and sends it back to Telegram
 * 
 * Usage:
 *   TELEGRAM_BOT_TOKEN='...' TELEGRAM_CHAT_ID='...' node telegram-remote.mjs [--session NAME] [--start "COMMAND"]
 * 
 * Examples:
 *   # Start opencode in a tmux session and control via Telegram
 *   node telegram-remote.mjs --start "opencode"
 * 
 *   # Start agy with a prompt
 *   node telegram-remote.mjs --start "agy -i 'scan target.com for vulnerabilities'"
 * 
 *   # Attach to an existing tmux session
 *   node telegram-remote.mjs --session my-existing-session
 */

import { execSync, exec } from 'child_process';

// ─── Config ────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SESSION_NAME = getArg('--session') || 'remote-agent';
const START_CMD = getArg('--start') || null;
const POLL_INTERVAL_MS = 1500;  // How often to poll Telegram
const OUTPUT_INTERVAL_MS = 3000; // How often to capture & send tmux output
const MAX_MSG_LEN = 4000;       // Telegram message limit

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('❌ TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
  process.exit(1);
}

// ─── Telegram API Helpers ──────────────────────────────────────────
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
let updateOffset = 0;

async function tgRequest(method, body) {
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {};
  const res = await fetch(`${API}/${method}`, opts);
  const data = await res.json();
  if (!data.ok) throw new Error(`TG API Error: ${data.description}`);
  return data.result;
}

async function sendTelegram(text) {
  // Split long messages
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX_MSG_LEN) {
    chunks.push(text.slice(i, i + MAX_MSG_LEN));
  }
  for (const chunk of chunks) {
    await tgRequest('sendMessage', { chat_id: CHAT_ID, text: chunk });
  }
}

async function getUpdates() {
  const updates = await tgRequest('getUpdates', {
    offset: updateOffset,
    timeout: 1,
    allowed_updates: ['message', 'callback_query'],
  });
  return updates;
}

// ─── tmux Helpers ──────────────────────────────────────────────────
function tmuxExists(name) {
  try {
    execSync(`tmux has-session -t "${name}" 2>/dev/null`);
    return true;
  } catch { return false; }
}

function tmuxCreate(name, cmd) {
  execSync(`tmux new-session -d -s "${name}" -x 200 -y 50 "${cmd || 'bash'}"`);
}

function tmuxSendKeys(name, text) {
  // Escape special characters for tmux
  const escaped = text.replace(/'/g, "'\\''");
  execSync(`tmux send-keys -t "${name}" '${escaped}' Enter`);
}

function tmuxCapture(name) {
  try {
    const output = execSync(
      `tmux capture-pane -t "${name}" -p -S -50`,
      { encoding: 'utf8', maxBuffer: 1024 * 1024 }
    );
    return output.trim();
  } catch { return ''; }
}

function tmuxSendCtrlC(name) {
  execSync(`tmux send-keys -t "${name}" C-c`);
}

// ─── CLI Arg Parser ────────────────────────────────────────────────
function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

// ─── Main Loop ─────────────────────────────────────────────────────
let lastOutputHash = '';
let lastOutputSentAt = 0;
let monitoring = true;

async function handleMessage(text) {
  const cmd = text.trim();

  // Special commands
  if (cmd === '/status') {
    const output = tmuxCapture(SESSION_NAME);
    const last50 = output.split('\n').slice(-50).join('\n');
    await sendTelegram(`📋 Current Screen:\n\`\`\`\n${last50 || '(empty)'}\n\`\`\``);
    return;
  }

  if (cmd === '/stop' || cmd === '/cancel') {
    tmuxSendCtrlC(SESSION_NAME);
    await sendTelegram('⛔ Sent Ctrl+C to session');
    return;
  }

  if (cmd === '/kill') {
    try {
      execSync(`tmux kill-session -t "${SESSION_NAME}"`);
      await sendTelegram('💀 Session killed');
      process.exit(0);
    } catch (e) {
      await sendTelegram(`❌ Error: ${e.message}`);
    }
    return;
  }

  if (cmd === '/help') {
    await sendTelegram(
      '🤖 Telegram Remote Control\n\n' +
      'Just type any text → it gets sent to the terminal session as input.\n\n' +
      'Special commands:\n' +
      '/status — Show current screen content\n' +
      '/stop — Send Ctrl+C\n' +
      '/kill — Kill the tmux session and exit\n' +
      '/mute — Stop auto-sending output\n' +
      '/unmute — Resume auto-sending output\n' +
      '/help — Show this help'
    );
    return;
  }

  if (cmd === '/mute') {
    monitoring = false;
    await sendTelegram('🔇 Output monitoring muted. Use /unmute to resume.');
    return;
  }

  if (cmd === '/unmute') {
    monitoring = true;
    await sendTelegram('🔊 Output monitoring resumed.');
    return;
  }

  // Regular text → inject into tmux as keystrokes
  tmuxSendKeys(SESSION_NAME, cmd);
  await sendTelegram(`⌨️ Input sent: ${cmd.length > 100 ? cmd.slice(0, 100) + '...' : cmd}`);
}

async function pollTelegram() {
  try {
    const updates = await getUpdates();
    for (const u of updates) {
      updateOffset = u.update_id + 1;

      if (u.message && String(u.message.chat.id) === String(CHAT_ID) && u.message.text) {
        console.log(`📩 Received: ${u.message.text}`);
        await handleMessage(u.message.text);
      }

      if (u.callback_query && String(u.callback_query.from.id) === String(CHAT_ID)) {
        console.log(`🔘 Button: ${u.callback_query.data}`);
        await handleMessage(u.callback_query.data);
        await tgRequest('answerCallbackQuery', {
          callback_query_id: u.callback_query.id,
          text: '✅ Sent to session',
        });
      }
    }
  } catch (e) {
    if (e.message?.includes('Conflict')) {
      // Another instance briefly polled — wait 3s before retrying
      await new Promise(r => setTimeout(r, 3000));
    } else {
      console.error('Poll error:', e.message);
    }
  }
}

async function monitorOutput() {
  if (!monitoring) return;
  try {
    const output = tmuxCapture(SESSION_NAME);
    const hash = simpleHash(output);

    if (hash !== lastOutputHash && Date.now() - lastOutputSentAt > 5000) {
      // Output changed — find the new lines
      const lines = output.split('\n');
      const last30 = lines.slice(-30).join('\n').trim();

      if (last30 && last30.length > 5) {
        lastOutputHash = hash;
        lastOutputSentAt = Date.now();
        await sendTelegram(`📺 Output:\n\`\`\`\n${last30}\n\`\`\``);
      }
    }
  } catch (e) {
    // Session might have ended
  }
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

// ─── Startup ───────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Telegram Remote Control Bridge');
  console.log(`   Session: ${SESSION_NAME}`);
  console.log(`   Bot Token: ***${BOT_TOKEN.slice(-6)}`);
  console.log(`   Chat ID: ${CHAT_ID}`);

  // Flush old updates
  try {
    const old = await getUpdates();
    if (old.length > 0) {
      updateOffset = old[old.length - 1].update_id + 1;
    }
  } catch {}

  // Create or attach to tmux session
  if (!tmuxExists(SESSION_NAME)) {
    if (START_CMD) {
      tmuxCreate(SESSION_NAME, START_CMD);
      console.log(`✅ Created tmux session "${SESSION_NAME}" running: ${START_CMD}`);
    } else {
      tmuxCreate(SESSION_NAME);
      console.log(`✅ Created tmux session "${SESSION_NAME}" with bash`);
    }
  } else {
    console.log(`♻️  Attached to existing tmux session "${SESSION_NAME}"`);
  }

  await sendTelegram(
    '🟢 Remote Control Active!\n\n' +
    `Session: \`${SESSION_NAME}\`\n` +
    (START_CMD ? `Command: \`${START_CMD}\`\n` : '') +
    '\nType any message here → it goes straight to the terminal.\n' +
    'Type /help for special commands.'
  );

  // Start polling loops
  console.log('⏳ Listening for Telegram messages...\n');

  setInterval(pollTelegram, POLL_INTERVAL_MS);
  setInterval(monitorOutput, OUTPUT_INTERVAL_MS);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
