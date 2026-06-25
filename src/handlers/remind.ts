import type { Bot } from 'grammy'
import type { BotContext } from '../bot'
import { users, schedules } from '../db/schema'
import { eq, and } from 'drizzle-orm'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const DAY_MAP: Record<string, number> = {
  '0': 0, sun: 0, sunday: 0,
  '1': 1, mon: 1, monday: 1,
  '2': 2, tue: 2, tuesday: 2,
  '3': 3, wed: 3, wednesday: 3,
  '4': 4, thu: 4, thursday: 4,
  '5': 5, fri: 5, friday: 5,
  '6': 6, sat: 6, saturday: 6,
}

const SHORTHANDS: Record<string, number[]> = {
  daily:    [0, 1, 2, 3, 4, 5, 6],
  everyday: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [1, 2, 3, 4, 5],
  weekends: [0, 6],
}

function parseDays(token: string): number[] | null {
  const lower = token.toLowerCase()
  if (SHORTHANDS[lower]) return SHORTHANDS[lower]

  const parts = lower.split(',').map(s => s.trim()).filter(Boolean)
  const days: number[] = []
  for (const part of parts) {
    const d = DAY_MAP[part]
    if (d === undefined) return null
    if (!days.includes(d)) days.push(d)
  }
  return days.length > 0 ? days.sort((a, b) => a - b) : null
}

export function formatDays(daysOfWeek: string): string {
  const days = daysOfWeek.split(',').map(Number).sort((a, b) => a - b)
  if (days.length === 7) return 'Daily'
  if (days.join(',') === '1,2,3,4,5') return 'Weekdays'
  if (days.join(',') === '0,6') return 'Weekends'
  return days.map(d => DAY_NAMES[d]).join(', ')
}

function fmtTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC`
}

function fmtTimestamp(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
  }) + ' UTC'
}

type ParsedRemind =
  | { kind: 'weekly'; daysOfWeek: string; hour: number; minute: number; name: string }
  | { kind: 'interval'; intervalDays: number; nextFireAt: number; name: string }

function parseRemind(args: string, now: number): ParsedRemind | null {
  const parts = args.trim().split(/\s+/)
  if (parts.length < 2) return null

  const [first, ...rest] = parts

  // Interval: 2d, 3d, ... 7d
  const intervalMatch = /^(\d+)d$/i.exec(first)
  if (intervalMatch) {
    const intervalDays = parseInt(intervalMatch[1])
    if (intervalDays < 2 || intervalDays > 365) return null
    const name = rest.join(' ')
    if (!name) return null
    const nextFireAt = now + intervalDays * 86400
    return { kind: 'interval', intervalDays, nextFireAt, name }
  }

  // Weekly: <day(s)> <HH:MM> <name>
  if (parts.length < 3) return null
  const [dayStr, timeStr, ...nameParts] = parts
  const name = nameParts.join(' ')
  if (!name) return null

  const days = parseDays(dayStr)
  if (!days) return null

  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeStr)
  if (!timeMatch) return null

  const hour = parseInt(timeMatch[1])
  const minute = parseInt(timeMatch[2])
  if (hour > 23 || minute > 59) return null

  return { kind: 'weekly', daysOfWeek: days.join(','), hour, minute, name }
}

async function ensureUser(ctx: BotContext) {
  if (!ctx.from) throw new Error('No user')
  let user = await ctx.db.query.users.findFirst({ where: eq(users.telegramId, ctx.from.id) })
  if (!user) {
    const [created] = await ctx.db.insert(users).values({
      telegramId: ctx.from.id,
      username: ctx.from.username ?? null,
      firstName: ctx.from.first_name,
    }).returning()
    user = created
  }
  return user
}

export function registerRemindHandlers(bot: Bot<BotContext>) {
  bot.command('remind', async (ctx) => {
    if (!ctx.from) return

    const args = ctx.match?.trim()
    if (!args) {
      await ctx.reply(
        'Usage: <code>/remind &lt;schedule&gt; &lt;workout name&gt;</code>\n\n' +
        '<b>Weekly (day + time UTC):</b>\n' +
        '<code>/remind monday 08:00 Push Day</code>\n' +
        '<code>/remind mon,wed,fri 08:00 Push Day</code>\n' +
        '<code>/remind weekdays 07:00 Gym</code>\n' +
        '<code>/remind daily 06:30 Morning Run</code>\n' +
        '<code>/remind weekends 09:00 Long Run</code>\n\n' +
        '<b>Interval (every N days from now):</b>\n' +
        '<code>/remind 2d Push Day</code> — every 2 days\n' +
        '<code>/remind 3d Legs</code> — every 3 days\n' +
        '<code>/remind 7d Full Body</code> — every 7 days\n\n' +
        'Weekly times are in UTC.',
        { parse_mode: 'HTML' }
      )
      return
    }

    const now = Math.floor(Date.now() / 1000)
    const parsed = parseRemind(args, now)
    if (!parsed) {
      await ctx.reply(
        'Could not parse. Examples:\n' +
        '<code>/remind mon,wed,fri 08:00 Push Day</code>\n' +
        '<code>/remind 2d Push Day</code>',
        { parse_mode: 'HTML' }
      )
      return
    }

    const user = await ensureUser(ctx)

    if (parsed.kind === 'interval') {
      const [schedule] = await ctx.db.insert(schedules).values({
        userId: user.id,
        type: 'interval',
        intervalDays: parsed.intervalDays,
        nextFireAt: parsed.nextFireAt,
        workoutName: parsed.name,
        reminderHour: 0,
        reminderMinute: 0,
      }).returning()

      await ctx.reply(
        `⏰ Interval reminder set!\n\n` +
        `<b>${parsed.name}</b>\n` +
        `Every ${parsed.intervalDays} days — first reminder: ${fmtTimestamp(parsed.nextFireAt)}\n\n` +
        `ID: <code>${schedule.id}</code> — use /deleteremind ${schedule.id} to remove`,
        { parse_mode: 'HTML' }
      )
    } else {
      const [schedule] = await ctx.db.insert(schedules).values({
        userId: user.id,
        type: 'weekly',
        daysOfWeek: parsed.daysOfWeek,
        workoutName: parsed.name,
        reminderHour: parsed.hour,
        reminderMinute: parsed.minute,
      }).returning()

      await ctx.reply(
        `⏰ Reminder set!\n\n` +
        `<b>${parsed.name}</b>\n` +
        `${formatDays(parsed.daysOfWeek)} at ${fmtTime(parsed.hour, parsed.minute)}\n\n` +
        `ID: <code>${schedule.id}</code> — use /deleteremind ${schedule.id} to remove`,
        { parse_mode: 'HTML' }
      )
    }
  })

  bot.command('reminders', async (ctx) => {
    if (!ctx.from) return

    const user = await ctx.db.query.users.findFirst({ where: eq(users.telegramId, ctx.from.id) })
    if (!user) {
      await ctx.reply('No reminders set. Use /remind to add one.')
      return
    }

    const active = await ctx.db.query.schedules.findMany({
      where: and(eq(schedules.userId, user.id), eq(schedules.active, true)),
    })

    if (active.length === 0) {
      await ctx.reply('No active reminders. Use /remind to add one.')
      return
    }

    const lines = ['<b>Your Reminders</b>\n']
    for (const s of active) {
      if (s.type === 'interval' && s.intervalDays && s.nextFireAt) {
        lines.push(
          `[<code>${s.id}</code>] <b>${s.workoutName}</b> — every ${s.intervalDays} days` +
          ` (next: ${fmtTimestamp(s.nextFireAt)})`
        )
      } else if (s.daysOfWeek) {
        lines.push(
          `[<code>${s.id}</code>] <b>${s.workoutName}</b> — ${formatDays(s.daysOfWeek)} at ${fmtTime(s.reminderHour, s.reminderMinute)}`
        )
      }
    }
    lines.push('\nUse /deleteremind &lt;id&gt; to remove.')

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  })

  bot.command('deleteremind', async (ctx) => {
    if (!ctx.from) return

    const id = parseInt(ctx.match?.trim() ?? '')
    if (isNaN(id)) {
      await ctx.reply('Usage: <code>/deleteremind &lt;id&gt;</code>', { parse_mode: 'HTML' })
      return
    }

    const user = await ctx.db.query.users.findFirst({ where: eq(users.telegramId, ctx.from.id) })
    if (!user) {
      await ctx.reply('Reminder not found.')
      return
    }

    const deleted = await ctx.db.delete(schedules)
      .where(and(eq(schedules.id, id), eq(schedules.userId, user.id)))
      .returning()

    await ctx.reply(deleted.length > 0 ? `Reminder #${id} deleted.` : 'Reminder not found.')
  })
}
