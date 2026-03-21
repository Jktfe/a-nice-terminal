import { Bot, type Context } from "grammy";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { PlatformAdapter, InboundMessage } from "../types.js";

export interface TelegramAdapterOptions {
  botToken: string;
}

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = "telegram";
  private bot: Bot;
  private messageHandler: ((msg: InboundMessage) => void) | null = null;
  private linkHandler: ((chatId: string, sessionName: string) => Promise<string | null>) | null = null;
  private unlinkHandler: ((chatId: string) => Promise<boolean>) | null = null;
  private statusHandler: ((chatId: string) => Promise<string>) | null = null;

  constructor(opts: TelegramAdapterOptions) {
    this.bot = new Bot(opts.botToken);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Bot commands
    this.bot.command("link", async (ctx) => {
      const sessionName = ctx.match?.trim();
      if (!sessionName) {
        await ctx.reply("Usage: /link <session-name>\n\nLinks this Telegram chat to an ANT conversation session.");
        return;
      }
      if (this.linkHandler) {
        const result = await this.linkHandler(String(ctx.chat.id), sessionName);
        if (result) {
          await ctx.reply(`Linked to ANT session: ${result}`);
        } else {
          await ctx.reply(`Could not find session "${sessionName}". Check the name and try again.`);
        }
      }
    });

    this.bot.command("unlink", async (ctx) => {
      if (this.unlinkHandler) {
        const ok = await this.unlinkHandler(String(ctx.chat.id));
        await ctx.reply(ok ? "Unlinked from ANT session." : "No mapping found for this chat.");
      }
    });

    this.bot.command("status", async (ctx) => {
      if (this.statusHandler) {
        const status = await this.statusHandler(String(ctx.chat.id));
        await ctx.reply(status, { parse_mode: "Markdown" });
      } else {
        await ctx.reply("Bridge is running but no status handler configured.");
      }
    });

    this.bot.command("start", async (ctx) => {
      await ctx.reply(
        "ANT Bridge Bot\n\n" +
        "Commands:\n" +
        "/link <session-name> — Link this chat to an ANT session\n" +
        "/unlink — Remove the link\n" +
        "/status — Show current mapping\n\n" +
        "Messages you send here will appear in the linked ANT session, and vice versa."
      );
    });

    // Regular messages → inbound handler
    this.bot.on("message:text", (ctx) => {
      if (!this.messageHandler) return;

      const msg: InboundMessage = {
        externalId: String(ctx.message.message_id),
        channelId: String(ctx.chat.id),
        author: this.getDisplayName(ctx),
        authorId: String(ctx.from?.id || "unknown"),
        content: ctx.message.text,
        replyToExternalId: ctx.message.reply_to_message
          ? String(ctx.message.reply_to_message.message_id)
          : undefined,
        timestamp: new Date(ctx.message.date * 1000),
      };

      this.messageHandler(msg);
    });

    // Photo messages — download and forward
    this.bot.on("message:photo", async (ctx) => {
      if (!this.messageHandler) return;

      const photo = ctx.message.photo[ctx.message.photo.length - 1]; // highest res
      let imagePath: string | undefined;

      const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

      try {
        const file = await ctx.api.getFile(photo.file_id);
        if (file.file_path) {
          if (file.file_size && file.file_size > MAX_PHOTO_BYTES) {
            console.warn(`[telegram] Photo too large (${file.file_size} bytes), skipping download`);
          } else {
            const tmpDir = path.join(os.tmpdir(), "ant-bridge");
            fs.mkdirSync(tmpDir, { recursive: true });
            const ext = path.extname(file.file_path) || ".jpg";
            const localPath = path.join(tmpDir, `${photo.file_id}${ext}`);

            const url = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
            const res = await globalThis.fetch(url);
            const buffer = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(localPath, buffer);
            imagePath = localPath;

            // Clean up after a delay so the message handler can reference the file
            setTimeout(() => {
              try { fs.unlinkSync(localPath); } catch {}
            }, 60_000);
          }
        }
      } catch (err) {
        // Redact bot token from error messages
        const errMsg = err instanceof Error ? err.message.replace(this.bot.token, "[REDACTED]") : String(err);
        console.error("[telegram] Failed to download photo:", errMsg);
      }

      const caption = ctx.message.caption || "";
      const content = imagePath
        ? `${caption ? caption + "\n" : ""}[Photo: ${imagePath}]`
        : caption || "[Photo]";

      const msg: InboundMessage = {
        externalId: String(ctx.message.message_id),
        channelId: String(ctx.chat.id),
        author: this.getDisplayName(ctx),
        authorId: String(ctx.from?.id || "unknown"),
        content,
        timestamp: new Date(ctx.message.date * 1000),
        imagePath,
      };

      this.messageHandler(msg);
    });
  }

  private getDisplayName(ctx: Context): string {
    const from = ctx.from;
    if (!from) return "Unknown";
    if (from.first_name && from.last_name) return `${from.first_name} ${from.last_name}`;
    return from.first_name || from.username || "Unknown";
  }

  async start(): Promise<void> {
    console.log("[telegram] Starting bot with long polling...");
    // Non-blocking start — grammY handles the polling loop
    this.bot.start({
      onStart: (botInfo) => {
        console.log(`[telegram] Bot @${botInfo.username} is running`);
      },
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    console.log("[telegram] Bot stopped");
  }

  async sendMessage(channelId: string, text: string, opts?: {
    replyTo?: string;
    senderName?: string;
    senderType?: string;
  }): Promise<string> {
    const result = await this.bot.api.sendMessage(Number(channelId), text, {
      reply_parameters: opts?.replyTo ? { message_id: Number(opts.replyTo) } : undefined,
    });
    return String(result.message_id);
  }

  onMessage(handler: (msg: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  // Extended handlers for bot commands that need bridge context
  onLink(handler: (chatId: string, sessionName: string) => Promise<string | null>): void {
    this.linkHandler = handler;
  }

  onUnlink(handler: (chatId: string) => Promise<boolean>): void {
    this.unlinkHandler = handler;
  }

  onStatus(handler: (chatId: string) => Promise<string>): void {
    this.statusHandler = handler;
  }
}
