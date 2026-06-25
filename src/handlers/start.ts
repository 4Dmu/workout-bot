import type { Bot } from 'grammy'
import type { BotContext } from '../bot'
import { users } from '../db/schema'

export function registerStartHandler(bot: Bot<BotContext>, botPassword: string) {
  bot.command('start', async (ctx) => {
    if (!ctx.from) return

    if (botPassword) {
      const alreadyAuthed = await ctx.kv.get(`auth:${ctx.from.id}`)

      if (!alreadyAuthed) {
        const provided = ctx.match?.trim()
        if (!provided) {
          await ctx.reply(
            '🔒 This bot is password-protected.\n\nSend <code>/start &lt;password&gt;</code> to gain access.',
            { parse_mode: 'HTML' }
          )
          return
        }
        if (provided !== botPassword) {
          await ctx.reply('❌ Incorrect password.')
          return
        }
        await ctx.kv.put(`auth:${ctx.from.id}`, '1')
      }
    }

    const { id: telegramId, username, first_name: firstName } = ctx.from

    await ctx.db.insert(users).values({
      telegramId,
      username: username ?? null,
      firstName,
    }).onConflictDoUpdate({
      target: users.telegramId,
      set: { username: username ?? null, firstName },
    })

    await ctx.reply(
      `👋 Welcome to Workout Bot, ${firstName}!\n\n` +
      `<b>Getting started:</b>\n` +
      `Use /log to start a workout session, then send exercises like:\n` +
      `<code>Bench Press 3x10 80kg</code>\n` +
      `<code>Running 30min</code>\n` +
      `<code>Plank 60s</code>\n\n` +
      `When done, send /done to save.\n\n` +
      `Type /help to see all commands.`,
      { parse_mode: 'HTML' }
    )
  })
}
