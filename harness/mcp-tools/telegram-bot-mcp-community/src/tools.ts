/**
 * Telegram Bot API - MCP Tool Definitions (27 tools)
 */

export interface MCPToolDefinition {
  name: string;
  description: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema: Record<string, unknown>;
}

export const TOOLS: MCPToolDefinition[] = [
  // ========== Bot Info (2) ==========
  {
    name: 'tg_get_me',
    description:
      'Get basic information about the bot: id, username, first_name, can_join_groups, can_read_all_group_messages, supports_inline_queries.',
    annotations: {
      title: 'Get Bot Info',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        _fields: { type: 'string', description: 'Comma-separated list of fields to include in the response (e.g. "id,username,first_name")' },
      },
    },
  },
  {
    name: 'tg_get_updates',
    description:
      'Receive incoming messages, inline keyboard button presses (callback_query), and updates from users. Use this tool to check for user replies or button approvals.',
    annotations: {
      title: 'Get Bot Updates',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        offset: {
          type: 'number',
          description: 'Identifier of the first update to be returned.',
        },
        limit: {
          type: 'number',
          description: 'Limits the number of updates to be retrieved (1-100, default 100).',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds for long polling.',
        },
        allowed_updates: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of update types to receive (e.g. ["message", "callback_query"]).',
        },
      },
    },
  },
  {
    name: 'tg_set_my_commands',
    description:
      'Set the list of bot commands shown in the Telegram chat menu. Each command has a "command" (1-32 chars, lowercase a-z, 0-9, _) and a "description" (1-256 chars). Max 100 commands.',
    annotations: {
      title: 'Set Bot Commands',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command text without leading /' },
              description: { type: 'string', description: 'Description of the command' },
            },
            required: ['command', 'description'],
          },
          description: 'Array of BotCommand objects',
        },
        scope: {
          type: 'object',
          description: 'Optional scope e.g. {"type":"all_private_chats"}',
        },
        language_code: {
          type: 'string',
          description: 'Two-letter ISO 639-1 language code',
        },
      },
      required: ['commands'],
    },
  },

  // ========== Send Messages (8) ==========
  {
    name: 'tg_send_message',
    description:
      'Send a text message to a chat. Supports Markdown, MarkdownV2, and HTML formatting. Can include inline keyboards via reply_markup.',
    annotations: {
      title: 'Send Message',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat ID (number) or @channel_username',
        },
        text: {
          type: 'string',
          description: 'Message text (1-4096 characters)',
        },
        parse_mode: {
          type: 'string',
          description: '"Markdown", "MarkdownV2", or "HTML"',
        },
        reply_markup: {
          type: 'object',
          description: 'InlineKeyboardMarkup, ReplyKeyboardMarkup, etc.',
        },
        reply_to_message_id: {
          type: 'number',
          description: 'Message ID to reply to',
        },
        disable_notification: {
          type: 'boolean',
          description: 'Send silently (no notification sound)',
        },
        protect_content: {
          type: 'boolean',
          description: 'Prevent message from being forwarded/saved',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'tg_send_photo',
    description:
      'Send a photo to a chat. Provide a URL or file_id from a previously uploaded photo.',
    annotations: {
      title: 'Send Photo',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat ID or @channel_username',
        },
        photo: {
          type: 'string',
          description: 'Photo URL or file_id',
        },
        caption: {
          type: 'string',
          description: 'Photo caption (0-1024 characters)',
        },
        parse_mode: {
          type: 'string',
          description: 'Caption parse mode',
        },
        reply_markup: {
          type: 'object',
          description: 'Optional reply markup',
        },
        reply_to_message_id: {
          type: 'number',
          description: 'Message ID to reply to',
        },
      },
      required: ['photo'],
    },
  },
  {
    name: 'tg_send_document',
    description:
      'Send a document/file to a chat. Provide a URL or file_id. Max 50MB for bots.',
    annotations: {
      title: 'Send Document',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat ID or @channel_username',
        },
        document: {
          type: 'string',
          description: 'Document URL or file_id',
        },
        caption: {
          type: 'string',
          description: 'Document caption (0-1024 characters)',
        },
        parse_mode: {
          type: 'string',
          description: 'Caption parse mode',
        },
        reply_markup: {
          type: 'object',
          description: 'Optional reply markup',
        },
      },
      required: ['document'],
    },
  },
  {
    name: 'tg_send_video',
    description:
      'Send a video to a chat. Provide a URL or file_id. Supports MPEG4 format, max 50MB.',
    annotations: {
      title: 'Send Video',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat ID or @channel_username',
        },
        video: {
          type: 'string',
          description: 'Video URL or file_id',
        },
        caption: {
          type: 'string',
          description: 'Video caption',
        },
        parse_mode: {
          type: 'string',
          description: 'Caption parse mode',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds',
        },
        width: {
          type: 'number',
          description: 'Video width',
        },
        height: {
          type: 'number',
          description: 'Video height',
        },
      },
      required: ['video'],
    },
  },
  {
    name: 'tg_send_audio',
    description:
      'Send an audio file to a chat. Displayed as a music player. Provide a URL or file_id. Max 50MB, MP3/M4A format.',
    annotations: {
      title: 'Send Audio',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat ID or @channel_username',
        },
        audio: {
          type: 'string',
          description: 'Audio URL or file_id',
        },
        caption: {
          type: 'string',
          description: 'Audio caption',
        },
        parse_mode: {
          type: 'string',
          description: 'Caption parse mode',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds',
        },
        performer: {
          type: 'string',
          description: 'Performer name',
        },
        title: {
          type: 'string',
          description: 'Track name',
        },
      },
      required: ['audio'],
    },
  },
  {
    name: 'tg_send_location',
    description: 'Send a geographic location point to a chat.',
    annotations: {
      title: 'Send Location',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat ID or @channel_username',
        },
        latitude: {
          type: 'number',
          description: 'Latitude (-90 to 90)',
        },
        longitude: {
          type: 'number',
          description: 'Longitude (-180 to 180)',
        },
        reply_markup: {
          type: 'object',
          description: 'Optional reply markup',
        },
      },
      required: ['latitude', 'longitude'],
    },
  },
  {
    name: 'tg_send_poll',
    description:
      'Send a poll to a chat. Supports regular polls and quiz mode. For quiz mode, set type to "quiz" and provide correct_option_id.',
    annotations: {
      title: 'Send Poll',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat ID or @channel_username',
        },
        question: {
          type: 'string',
          description: 'Poll question (1-300 characters)',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Answer options (2-10 strings, each 1-100 chars)',
        },
        is_anonymous: {
          type: 'boolean',
          description: 'Anonymous poll (default: true)',
        },
        type: {
          type: 'string',
          description: '"regular" or "quiz"',
        },
        correct_option_id: {
          type: 'number',
          description: 'Required for quiz: 0-based index of correct answer',
        },
        allows_multiple_answers: {
          type: 'boolean',
          description: 'Allow multiple answers (regular polls only)',
        },
      },
      required: ['question', 'options'],
    },
  },
  {
    name: 'tg_send_contact',
    description: 'Send a phone contact card to a chat.',
    annotations: {
      title: 'Send Contact',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat ID or @channel_username',
        },
        phone_number: {
          type: 'string',
          description: 'Contact phone number',
        },
        first_name: {
          type: 'string',
          description: 'Contact first name',
        },
        last_name: {
          type: 'string',
          description: 'Contact last name',
        },
      },
      required: ['phone_number', 'first_name'],
    },
  },

  // ========== Edit/Delete Messages (3) ==========
  {
    name: 'tg_edit_message_text',
    description:
      'Edit the text of a previously sent message. The bot must be the author of the message.',
    annotations: {
      title: 'Edit Message Text',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID' },
        message_id: { type: 'number', description: 'Message ID to edit' },
        text: { type: 'string', description: 'New text (1-4096 characters)' },
        parse_mode: { type: 'string', description: 'Parse mode for new text' },
        reply_markup: { type: 'object', description: 'New inline keyboard markup' },
      },
      required: ['message_id', 'text'],
    },
  },
  {
    name: 'tg_edit_message_caption',
    description:
      'Edit the caption of a previously sent media message (photo, video, document, audio).',
    annotations: {
      title: 'Edit Message Caption',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID' },
        message_id: { type: 'number', description: 'Message ID to edit' },
        caption: { type: 'string', description: 'New caption (0-1024 characters)' },
        parse_mode: { type: 'string', description: 'Parse mode for caption' },
        reply_markup: { type: 'object', description: 'New inline keyboard markup' },
      },
      required: ['message_id'],
    },
  },
  {
    name: 'tg_delete_message',
    description:
      'Delete a message. Bot must have delete permission in group chats. Messages older than 48 hours cannot be deleted.',
    annotations: {
      title: 'Delete Message',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID' },
        message_id: { type: 'number', description: 'Message ID to delete' },
      },
      required: ['message_id'],
    },
  },

  // ========== Chat Management (5) ==========
  {
    name: 'tg_get_chat',
    description:
      'Get detailed information about a chat: title, description, type, member count, permissions, pinned message, etc.',
    annotations: {
      title: 'Get Chat Info',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID or @channel_username' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'tg_get_chat_member_count',
    description: 'Get the number of members in a chat.',
    annotations: {
      title: 'Get Chat Member Count',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID or @channel_username' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'tg_get_chat_member',
    description:
      'Get information about a specific member: status (creator, administrator, member, restricted, left, kicked), permissions, and custom title.',
    annotations: {
      title: 'Get Chat Member',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID or @channel_username' },
        user_id: { type: 'number', description: 'Telegram user ID' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'tg_ban_chat_member',
    description:
      'Ban a user from a group, supergroup, or channel. The user will be unable to return unless unbanned. Bot must be admin with ban permission.',
    annotations: {
      title: 'Ban Chat Member',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID' },
        user_id: { type: 'number', description: 'User ID to ban' },
        until_date: { type: 'number', description: 'Unix timestamp for ban expiry (0 or omit for permanent)' },
        revoke_messages: { type: 'boolean', description: 'Delete all messages from this user in the chat' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'tg_unban_chat_member',
    description:
      'Unban a previously banned user. The user is NOT added back automatically and must rejoin via invite link.',
    annotations: {
      title: 'Unban Chat Member',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID' },
        user_id: { type: 'number', description: 'User ID to unban' },
        only_if_banned: { type: 'boolean', description: 'Only unban if currently banned (default: false)' },
      },
      required: ['user_id'],
    },
  },

  // ========== Webhooks (3) ==========
  {
    name: 'tg_set_webhook',
    description:
      'Set a webhook URL for receiving Telegram updates. Telegram sends POST requests with JSON Update objects to this URL. Supported ports: 443, 80, 88, 8443.',
    annotations: {
      title: 'Set Webhook',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTPS URL for receiving updates' },
        max_connections: { type: 'number', description: 'Max simultaneous connections (1-100, default 40)' },
        allowed_updates: { type: 'array', items: { type: 'string' }, description: 'Update types to receive, e.g. ["message","callback_query"]' },
        secret_token: { type: 'string', description: 'Secret token for X-Telegram-Bot-Api-Secret-Token header (1-256 chars)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'tg_delete_webhook',
    description:
      'Remove the webhook integration. After this, you can use getUpdates for polling.',
    annotations: {
      title: 'Delete Webhook',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        drop_pending_updates: { type: 'boolean', description: 'Drop all pending updates' },
      },
    },
  },
  {
    name: 'tg_get_webhook_info',
    description:
      'Get current webhook status: URL, pending update count, last error date/message, max connections, and allowed update types.',
    annotations: {
      title: 'Get Webhook Info',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        _fields: { type: 'string', description: 'Comma-separated list of fields to include in the response (e.g. "url,pending_update_count")' },
      },
    },
  },

  // ========== Callbacks & Files (3) ==========
  {
    name: 'tg_answer_callback_query',
    description:
      'Answer a callback query from an inline keyboard button press. Must be called to stop the loading indicator on the button.',
    annotations: {
      title: 'Answer Callback Query',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        callback_query_id: { type: 'string', description: 'Callback query ID from the update' },
        text: { type: 'string', description: 'Notification text (0-200 chars)' },
        show_alert: { type: 'boolean', description: 'Show as alert popup instead of notification at top' },
      },
      required: ['callback_query_id'],
    },
  },
  {
    name: 'tg_get_file',
    description:
      'Get file info and download URL. Returns file_id, file_size, file_path, and a ready-to-use download_url. Files up to 20MB.',
    annotations: {
      title: 'Get File',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'File identifier from a message' },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'tg_get_user_profile_photos',
    description: 'Get a list of profile photos for a user.',
    annotations: {
      title: 'Get User Profile Photos',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'number', description: 'Telegram user ID' },
        offset: { type: 'number', description: 'Photo offset for pagination' },
        limit: { type: 'number', description: 'Max photos to return (1-100, default 100)' },
      },
      required: ['user_id'],
    },
  },

  // ========== Pins & Invite Links (3) ==========
  {
    name: 'tg_pin_chat_message',
    description:
      'Pin a message in a chat. Bot must have pin_messages admin permission in groups/supergroups.',
    annotations: {
      title: 'Pin Chat Message',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID' },
        message_id: { type: 'number', description: 'Message ID to pin' },
        disable_notification: { type: 'boolean', description: 'Pin silently (no notification)' },
      },
      required: ['message_id'],
    },
  },
  {
    name: 'tg_unpin_chat_message',
    description:
      'Unpin a message in a chat. If message_id is not provided, unpins the most recent pinned message.',
    annotations: {
      title: 'Unpin Chat Message',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID' },
        message_id: { type: 'number', description: 'Message ID to unpin (omit to unpin latest)' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'tg_create_chat_invite_link',
    description:
      'Create an additional invite link for a chat. Bot must be admin with invite_users permission.',
    annotations: {
      title: 'Create Chat Invite Link',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID' },
        name: { type: 'string', description: 'Invite link name (0-32 chars)' },
        expire_date: { type: 'number', description: 'Unix timestamp when the link expires' },
        member_limit: { type: 'number', description: 'Max users that can join via this link (1-99999)' },
      },
      required: ['chat_id'],
    },
  },
];
