import type { Bot } from 'grammy'
import type { BotContext } from '../bot'
import { messages } from '../db/schema'
import { eq, and } from 'drizzle-orm'

export function registerClearHandler(bot: Bot<BotContext>) {
  bot.command('clear', async (ctx) => {
    if (!ctx.chat) return

    const chatId = ctx.chat.id
    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'

    const rows = await ctx.db
      .select({ messageId: messages.messageId })
      .from(messages)
      .where(
        isGroup
          ? eq(messages.chatId, chatId)
          : and(eq(messages.chatId, chatId), eq(messages.isBot, true))
      )

    const ids = new Set(rows.map(r => r.messageId))

    // Include the /clear command message itself in group clears;
    // it may not be in the DB yet since tracking is awaited but sequenced before this handler runs.
    // In practice it will be there, but we add it defensively.
    if (isGroup && ctx.message?.message_id) {
      ids.add(ctx.message.message_id)
    }

    if (ids.size === 0) {
      if (!isGroup) await ctx.reply('Nothing to clear.')
      return
    }

    let deleted = 0
    await Promise.allSettled(
      [...ids].map(msgId =>
        ctx.api.deleteMessage(chatId, msgId)
          .then(() => { deleted++ })
          .catch(() => {})
      )
    )

    await ctx.db.delete(messages).where(
      isGroup
        ? eq(messages.chatId, chatId)
        : and(eq(messages.chatId, chatId), eq(messages.isBot, true))
    )

    if (!isGroup) {
      await ctx.reply(`🧹 Cleared ${deleted} message${deleted !== 1 ? 's' : ''}.`)
    }
  })
}
