import { Bot } from 'grammy'
import type { Env } from './types'
import { getDb } from './db'
import { schedules, users, messages } from './db/schema'
import { eq, and } from 'drizzle-orm'

export async function handleCron(env: Env): Promise<void> {
  const db = getDb(env.DB)
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN)

  const now = Math.floor(Date.now() / 1000)
  const date = new Date(now * 1000)
  const dayOfWeek = date.getUTCDay()
  const hour = date.getUTCHours()
  const minute = date.getUTCMinutes()
  // Cron runs every 5 min; bucket the current minute to the nearest multiple of 5
  const bucketStart = Math.floor(minute / 5) * 5

  const active = await db
    .select({
      id: schedules.id,
      type: schedules.type,
      telegramId: users.telegramId,
      lastChatId: users.lastChatId,
      workoutName: schedules.workoutName,
      daysOfWeek: schedules.daysOfWeek,
      reminderHour: schedules.reminderHour,
      reminderMinute: schedules.reminderMinute,
      intervalDays: schedules.intervalDays,
      nextFireAt: schedules.nextFireAt,
    })
    .from(schedules)
    .innerJoin(users, eq(schedules.userId, users.id))
    .where(and(eq(schedules.active, true), eq(users.notificationsEnabled, true)))

  const due = active.filter(s => {
    if (s.type === 'interval') {
      return s.nextFireAt !== null && s.nextFireAt <= now
    }
    // weekly
    if (!s.daysOfWeek) return false
    const days = s.daysOfWeek.split(',').map(Number)
    return (
      days.includes(dayOfWeek) &&
      s.reminderHour === hour &&
      s.reminderMinute >= bucketStart &&
      s.reminderMinute < bucketStart + 5
    )
  })

  // Advance interval reminders before sending so a slow send doesn't double-fire
  await Promise.all(
    due
      .filter(s => s.type === 'interval' && s.intervalDays && s.nextFireAt !== null)
      .map(s =>
        db.update(schedules)
          .set({ nextFireAt: s.nextFireAt! + s.intervalDays! * 86400 })
          .where(eq(schedules.id, s.id))
      )
  )

  await Promise.allSettled(
    due.map(s => {
      const chatId = s.lastChatId ?? s.telegramId
      return bot.api.sendMessage(
        chatId,
        `🏋️ Time for <b>${s.workoutName}</b>!\n\nUse /log to start logging your exercises.`,
        { parse_mode: 'HTML' }
      ).then(msg =>
        db.insert(messages).values({ chatId: msg.chat.id, messageId: msg.message_id, isBot: true })
      ).catch(err => console.error(`Failed to notify ${chatId}:`, err))
    })
  )
}
