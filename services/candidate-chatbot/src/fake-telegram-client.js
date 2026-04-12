export class FakeTelegramClient {
  constructor() {
    this.sent = [];  // [{ chatId, message }]
  }

  async notify(chatId, message) {
    this.sent.push({ chatId, message });
  }

  sentTo(chatId) {
    return this.sent.filter(s => s.chatId === chatId);
  }

  clear() {
    this.sent = [];
  }
}
