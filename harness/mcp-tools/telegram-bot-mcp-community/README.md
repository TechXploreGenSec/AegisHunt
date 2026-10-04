# Telegram Bot MCP Server

[![smithery badge](https://smithery.ai/badge/node2flow/telegram-bot)](https://smithery.ai/server/node2flow/telegram-bot)
[![npm version](https://img.shields.io/npm/v/@node2flow/telegram-bot-mcp.svg)](https://www.npmjs.com/package/@node2flow/telegram-bot-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP (Model Context Protocol) server for Telegram Bot API. Send messages, manage chats, handle webhooks, and more through 27 tools.

Works with Claude Desktop, Cursor, VS Code, and any MCP client.

---

## Quick Start

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "@node2flow/telegram-bot-mcp"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "your-bot-token"
      }
    }
  }
}
```

### Cursor / VS Code

Add to MCP settings:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "@node2flow/telegram-bot-mcp"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "your-bot-token"
      }
    }
  }
}
```

### HTTP Mode (Streamable HTTP)

For remote deployment or shared access:

```bash
TELEGRAM_BOT_TOKEN=your_token npx @node2flow/telegram-bot-mcp --http
```

Server starts on port 3000 (configurable via `PORT` env var). MCP endpoint: `http://localhost:3000/mcp`

---

## Configuration

| Environment Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram Bot token from [@BotFather](https://t.me/BotFather) |
| `PORT` | No | Port for HTTP server (default: `3000`, only used with `--http`) |

---

## All Tools (27 tools)

### Bot Info (2 tools)

| Tool | Description |
|---|---|
| `tg_get_me` | Get bot information |
| `tg_set_my_commands` | Set bot command menu |

### Send Messages (8 tools)

| Tool | Description |
|---|---|
| `tg_send_message` | Send text with Markdown/HTML formatting |
| `tg_send_photo` | Send photo (URL or file_id) |
| `tg_send_document` | Send document/file (max 50MB) |
| `tg_send_video` | Send video (MPEG4, max 50MB) |
| `tg_send_audio` | Send audio (MP3/M4A, max 50MB) |
| `tg_send_location` | Send geographic location |
| `tg_send_poll` | Send poll (regular or quiz) |
| `tg_send_contact` | Send phone contact card |

### Edit/Delete (3 tools)

| Tool | Description |
|---|---|
| `tg_edit_message_text` | Edit message text |
| `tg_edit_message_caption` | Edit media caption |
| `tg_delete_message` | Delete a message (48hr limit) |

### Chat Management (5 tools)

| Tool | Description |
|---|---|
| `tg_get_chat` | Get chat details |
| `tg_get_chat_member_count` | Get member count |
| `tg_get_chat_member` | Get member info |
| `tg_ban_chat_member` | Ban user from chat |
| `tg_unban_chat_member` | Unban user |

### Webhooks (3 tools)

| Tool | Description |
|---|---|
| `tg_set_webhook` | Set webhook URL |
| `tg_delete_webhook` | Remove webhook |
| `tg_get_webhook_info` | Get webhook status |

### Callbacks & Files (3 tools)

| Tool | Description |
|---|---|
| `tg_answer_callback_query` | Answer inline button press |
| `tg_get_file` | Get file download URL |
| `tg_get_user_profile_photos` | Get user profile photos |

### Pins & Invite Links (3 tools)

| Tool | Description |
|---|---|
| `tg_pin_chat_message` | Pin a message |
| `tg_unpin_chat_message` | Unpin a message |
| `tg_create_chat_invite_link` | Create invite link |

---

## Requirements

- **Node.js** 18+
- **Telegram Bot token**

### How to Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the token and use it as `TELEGRAM_BOT_TOKEN`

---

## For Developers

```bash
git clone https://github.com/node2flow-th/telegram-bot-mcp-community.git
cd telegram-bot-mcp-community
npm install
npm run build

# Run in stdio mode
TELEGRAM_BOT_TOKEN=your_token npm start

# Run in dev mode (hot reload)
TELEGRAM_BOT_TOKEN=your_token npm run dev

# Run in HTTP mode
TELEGRAM_BOT_TOKEN=your_token npm start -- --http
```

---

## License

MIT License - see [LICENSE](LICENSE)

Copyright (c) 2026 [Node2Flow](https://node2flow.net)

## Links

- [npm Package](https://www.npmjs.com/package/@node2flow/telegram-bot-mcp)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [MCP Protocol](https://modelcontextprotocol.io/)
- [Node2Flow](https://node2flow.net)
