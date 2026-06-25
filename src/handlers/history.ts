import type { Bot } from 'grammy'
import type { BotContext } from '../bot'
import { users, workouts } from '../db/schema'
import { eq, desc } from 'drizzle-orm'
import { formatExercise } from './log'

function fmtDate(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    timeZone: 'UTC',
  })
}

export function registerHistoryHandler(bot: Bot<BotContext>) {
  bot.command('history', async (ctx) => {
    if (!ctx.from) return

    const user = await ctx.db.query.users.findFirst({ where: eq(users.telegramId, ctx.from.id) })
    if (!user) {
      await ctx.reply('No workouts yet! Use /log to start logging.')
      return
    }

    const recent = await ctx.db.query.workouts.findMany({
      where: eq(workouts.userId, user.id),
      orderBy: [desc(workouts.completedAt)],
      limit: 5,
      with: { exercises: true },
    })

    if (recent.length === 0) {
      await ctx.reply('No workouts yet! Use /log to start logging.')
      return
    }

    const lines: string[] = ['<b>Recent Workouts</b>\n']
    for (const w of recent) {
      lines.push(`📅 <b>${w.name}</b> — ${fmtDate(w.completedAt)}`)
      for (const ex of w.exercises) {
        lines.push(`  • ${formatExercise(ex)}`)
      }
      lines.push('')
    }

    await ctx.reply(lines.join('\n').trimEnd(), { parse_mode: 'HTML' })
  })

  bot.command('stats', async (ctx) => {
    if (!ctx.from) return

    const user = await ctx.db.query.users.findFirst({ where: eq(users.telegramId, ctx.from.id) })
    if (!user) {
      await ctx.reply('No workouts yet! Use /log to start logging.')
      return
    }

    const all = await ctx.db.query.workouts.findMany({
      where: eq(workouts.userId, user.id),
      with: { exercises: true },
    })

    if (all.length === 0) {
      await ctx.reply('No workouts yet! Use /log to start logging.')
      return
    }

    const totalExercises = all.reduce((sum, w) => sum + w.exercises.length, 0)

    const byName: Record<string, number> = {}
    for (const w of all) {
      byName[w.name] = (byName[w.name] || 0) + 1
    }

    const top = Object.entries(byName)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `  • ${name}: ${count}×`)
      .join('\n')

    await ctx.reply(
      `<b>Your Stats</b>\n\n` +
      `Total workouts: <b>${all.length}</b>\n` +
      `Total exercises logged: <b>${totalExercises}</b>\n\n` +
      `<b>Most frequent:</b>\n${top}`,
      { parse_mode: 'HTML' }
    )
  })
}
