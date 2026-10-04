/**
 * Telegram Bot API Client
 * Token is embedded in the URL path: https://api.telegram.org/bot{TOKEN}/method
 * Responses are wrapped in { ok: true, result: ... } and auto-unwrapped.
 */

import type {
  TelegramConfig,
  TelegramUser,
  TelegramMessage,
  TelegramChat,
  TelegramChatMember,
  TelegramFile,
  TelegramUserProfilePhotos,
  TelegramWebhookInfo,
  TelegramChatInviteLink,
  TelegramBotCommand,
} from './types.js';

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

export class TelegramClient {
  private config: TelegramConfig;
  private baseUrl = 'https://api.telegram.org';

  constructor(config: TelegramConfig) {
    this.config = config;
  }

  private async request<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/bot${this.config.botToken}/${method}`;

    const options: RequestInit = {};
    if (body) {
      options.method = 'POST';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = (await response.json()) as TelegramApiResponse<T>;

    if (!data.ok) {
      throw new Error(`Telegram API Error (${data.error_code}): ${data.description}`);
    }

    return data.result as T;
  }

  // ========== Bot Info ==========

  async getMe(): Promise<TelegramUser> {
    return this.request('getMe');
  }

  async getUpdates(opts?: Record<string, unknown>): Promise<unknown> {
    return this.request('getUpdates', opts);
  }

  async setMyCommands(
    commands: TelegramBotCommand[],
    scope?: Record<string, unknown>,
    languageCode?: string
  ): Promise<boolean> {
    const body: Record<string, unknown> = { commands };
    if (scope) body.scope = scope;
    if (languageCode) body.language_code = languageCode;
    return this.request('setMyCommands', body);
  }

  // ========== Send Messages ==========

  async sendMessage(
    chatId: string | number,
    text: string,
    opts?: Record<string, unknown>
  ): Promise<TelegramMessage> {
    return this.request('sendMessage', { chat_id: chatId, text, ...opts });
  }

  async sendPhoto(
    chatId: string | number,
    photo: string,
    opts?: Record<string, unknown>
  ): Promise<TelegramMessage> {
    return this.request('sendPhoto', { chat_id: chatId, photo, ...opts });
  }

  async sendDocument(
    chatId: string | number,
    document: string,
    opts?: Record<string, unknown>
  ): Promise<TelegramMessage> {
    return this.request('sendDocument', { chat_id: chatId, document, ...opts });
  }

  async sendVideo(
    chatId: string | number,
    video: string,
    opts?: Record<string, unknown>
  ): Promise<TelegramMessage> {
    return this.request('sendVideo', { chat_id: chatId, video, ...opts });
  }

  async sendAudio(
    chatId: string | number,
    audio: string,
    opts?: Record<string, unknown>
  ): Promise<TelegramMessage> {
    return this.request('sendAudio', { chat_id: chatId, audio, ...opts });
  }

  async sendLocation(
    chatId: string | number,
    latitude: number,
    longitude: number,
    opts?: Record<string, unknown>
  ): Promise<TelegramMessage> {
    return this.request('sendLocation', { chat_id: chatId, latitude, longitude, ...opts });
  }

  async sendPoll(
    chatId: string | number,
    question: string,
    options: string[],
    opts?: Record<string, unknown>
  ): Promise<TelegramMessage> {
    return this.request('sendPoll', { chat_id: chatId, question, options, ...opts });
  }

  async sendContact(
    chatId: string | number,
    phoneNumber: string,
    firstName: string,
    opts?: Record<string, unknown>
  ): Promise<TelegramMessage> {
    return this.request('sendContact', {
      chat_id: chatId,
      phone_number: phoneNumber,
      first_name: firstName,
      ...opts,
    });
  }

  // ========== Edit/Delete Messages ==========

  async editMessageText(
    chatId: string | number,
    messageId: number,
    text: string,
    opts?: Record<string, unknown>
  ): Promise<TelegramMessage | boolean> {
    return this.request('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...opts,
    });
  }

  async editMessageCaption(
    chatId: string | number,
    messageId: number,
    opts?: Record<string, unknown>
  ): Promise<TelegramMessage | boolean> {
    return this.request('editMessageCaption', {
      chat_id: chatId,
      message_id: messageId,
      ...opts,
    });
  }

  async deleteMessage(chatId: string | number, messageId: number): Promise<boolean> {
    return this.request('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  // ========== Chat Management ==========

  async getChat(chatId: string | number): Promise<TelegramChat> {
    return this.request('getChat', { chat_id: chatId });
  }

  async getChatMemberCount(chatId: string | number): Promise<number> {
    return this.request('getChatMemberCount', { chat_id: chatId });
  }

  async getChatMember(chatId: string | number, userId: number): Promise<TelegramChatMember> {
    return this.request('getChatMember', { chat_id: chatId, user_id: userId });
  }

  async banChatMember(
    chatId: string | number,
    userId: number,
    opts?: Record<string, unknown>
  ): Promise<boolean> {
    return this.request('banChatMember', { chat_id: chatId, user_id: userId, ...opts });
  }

  async unbanChatMember(
    chatId: string | number,
    userId: number,
    opts?: Record<string, unknown>
  ): Promise<boolean> {
    return this.request('unbanChatMember', { chat_id: chatId, user_id: userId, ...opts });
  }

  // ========== Webhooks ==========

  async setWebhook(url: string, opts?: Record<string, unknown>): Promise<boolean> {
    return this.request('setWebhook', { url, ...opts });
  }

  async deleteWebhook(opts?: Record<string, unknown>): Promise<boolean> {
    return this.request('deleteWebhook', opts || {});
  }

  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    return this.request('getWebhookInfo');
  }

  // ========== Callbacks & Files ==========

  async answerCallbackQuery(
    callbackQueryId: string,
    opts?: Record<string, unknown>
  ): Promise<boolean> {
    return this.request('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...opts,
    });
  }

  async getFile(fileId: string): Promise<TelegramFile & { download_url: string }> {
    const file = await this.request<TelegramFile>('getFile', { file_id: fileId });
    return {
      ...file,
      download_url: file.file_path
        ? `${this.baseUrl}/file/bot${this.config.botToken}/${file.file_path}`
        : '',
    };
  }

  async getUserProfilePhotos(
    userId: number,
    opts?: Record<string, unknown>
  ): Promise<TelegramUserProfilePhotos> {
    return this.request('getUserProfilePhotos', { user_id: userId, ...opts });
  }

  // ========== Pins & Invite Links ==========

  async pinChatMessage(
    chatId: string | number,
    messageId: number,
    opts?: Record<string, unknown>
  ): Promise<boolean> {
    return this.request('pinChatMessage', {
      chat_id: chatId,
      message_id: messageId,
      ...opts,
    });
  }

  async unpinChatMessage(
    chatId: string | number,
    messageId?: number
  ): Promise<boolean> {
    const body: Record<string, unknown> = { chat_id: chatId };
    if (messageId !== undefined) body.message_id = messageId;
    return this.request('unpinChatMessage', body);
  }

  async createChatInviteLink(
    chatId: string | number,
    opts?: Record<string, unknown>
  ): Promise<TelegramChatInviteLink> {
    return this.request('createChatInviteLink', { chat_id: chatId, ...opts });
  }
}
