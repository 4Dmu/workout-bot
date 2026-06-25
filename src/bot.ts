import { Bot } from 'grammy'
import type { Context } from 'grammy'
import type { Env } from './types'
import { getDb } from './db'
import { messages, users } from './db/schema'
import { eq } from 'drizzle-orm'
import { registerStartHandler } from './handlers/start'
import { registerLogHandlers } from './handlers/log'
import { registerHistoryHandler } from './handlers/history'
import { registerRemindHandlers } from './handlers/remind'
import { registerClearHandler } from './handlers/clear'

export type BotContext = Context & {
  db: ReturnType<typeof getDb>
  kv: KVNamespace
}

export function createBot(env: Env): Bot<BotContext> {
  const db = getDb(env.DB)
  const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN)

  // Track all messages sent by the bot (captured via API transformer)
  bot.api.config.use(async (prev, method, payload, signal) => {
    const result = await prev(method, payload, signal)
    if (result.ok) {
      const r = result.result
      if (typeof r === 'object' && r !== null && !Array.isArray(r) &&
          'message_id' in r && 'chat' in r) {
        const msg = r as { message_id: number; chat: { id: number } }
        await db.insert(messages).values({
          chatId: msg.chat.id,
          messageId: msg.message_id,
          isBot: true,
        })
      }
    }
    return result
  })

  // Inject db and kv into context
  bot.use(async (ctx, next) => {
    ctx.db = db
    ctx.kv = env.KV
    await next()
  })

  // Track all incoming messages
  bot.use(async (ctx, next) => {
    if (ctx.message && ctx.chat) {
      await db.insert(messages).values({
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        isBot: false,
      })
    }
    await next()
  })

  // Keep last_chat_id current so reminders go to the right chat
  bot.use(async (ctx, next) => {
    if (ctx.from && ctx.chat) {
      await db.update(users)
        .set({ lastChatId: ctx.chat.id })
        .where(eq(users.telegramId, ctx.from.id))
    }
    await next()
  })

  // Auth gate: if BOT_PASSWORD is set, block all commands except /start for unauthenticated users
  if (env.BOT_PASSWORD) {
    bot.use(async (ctx, next) => {
      if (!ctx.from) return
      const isStart = ctx.message?.text?.split(' ')[0] === '/start'
      if (isStart) { await next(); return }

      const authed = await ctx.kv.get(`auth:${ctx.from.id}`)
      if (!authed) {
        await ctx.reply('🔒 Access restricted. Send /start <password> to authenticate.')
        return
      }
      await next()
    })
  }

  registerStartHandler(bot, env.BOT_PASSWORD)
  registerLogHandlers(bot)
  registerHistoryHandler(bot)
  registerRemindHandlers(bot)
  registerClearHandler(bot)

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `🏋️ <b>Workout Bot</b>\n\n` +
      `<b>Logging:</b>\n` +
      `/log [name] — Start a workout session\n` +
      `/done — Save the current workout\n` +
      `/cancel — Discard the current workout\n\n` +
      `<b>History:</b>\n` +
      `/history — Last 5 workouts\n` +
      `/stats — Your workout stats\n\n` +
      `<b>Reminders:</b>\n` +
      `/remind &lt;day(s)&gt; &lt;HH:MM UTC&gt; &lt;name&gt; — Weekly (mon,wed,fri / daily / weekdays)\n` +
      `/remind &lt;Nd&gt; &lt;name&gt; — Interval: every N days (2d–365d)\n` +
      `/reminders — List active reminders\n` +
      `/deleteremind &lt;id&gt; — Delete a reminder\n\n` +
      `<b>Utility:</b>\n` +
      `/clear — Delete tracked messages (all in group, bot-only in DM)\n\n` +
      `<b>Exercise format while logging:</b>\n` +
      `<code>Bench Press 3x10 80kg</code>\n` +
      `<code>Running 30min</code>\n` +
      `<code>Plank 60s</code>`,
      { parse_mode: 'HTML' }
    )
  })

  bot.catch((err) => {
    console.error('Bot error:', err)
  })

  return bot
}
