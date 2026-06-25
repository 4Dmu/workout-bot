import type { Bot } from 'grammy'
import type { BotContext } from '../bot'
import { users, workouts, exercises } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { WorkoutSession, SessionExercise } from '../types'

const SESSION_TTL = 60 * 60 * 4 // 4 hours
const PENDING = '__pending__'

async function getSession(kv: KVNamespace, telegramId: number): Promise<WorkoutSession | null> {
  return kv.get<WorkoutSession>(`session:${telegramId}`, 'json')
}

async function setSession(kv: KVNamespace, telegramId: number, session: WorkoutSession): Promise<void> {
  await kv.put(`session:${telegramId}`, JSON.stringify(session), { expirationTtl: SESSION_TTL })
}

async function clearSession(kv: KVNamespace, telegramId: number): Promise<void> {
  await kv.delete(`session:${telegramId}`)
}

function parseExercise(text: string): SessionExercise | null {
  const t = text.trim()
  if (!t) return null

  // Name [NxN] [N.Nkg]  e.g. "Bench Press 3x10 80kg"
  const setsRepsWeight = /^(.+?)\s+(\d+)x(\d+)(?:\s+(\d+(?:\.\d+)?)\s*kg)?$/i.exec(t)
  if (setsRepsWeight) {
    return {
      name: setsRepsWeight[1].trim(),
      sets: parseInt(setsRepsWeight[2]),
      reps: parseInt(setsRepsWeight[3]),
      weight: setsRepsWeight[4] ? parseFloat(setsRepsWeight[4]) : undefined,
    }
  }

  // Name [N min]  e.g. "Running 30min"
  const minMatch = /^(.+?)\s+(\d+)\s*min$/i.exec(t)
  if (minMatch) {
    return { name: minMatch[1].trim(), durationSeconds: parseInt(minMatch[2]) * 60 }
  }

  // Name [N s]  e.g. "Plank 60s"
  const secMatch = /^(.+?)\s+(\d+)\s*s$/i.exec(t)
  if (secMatch) {
    return { name: secMatch[1].trim(), durationSeconds: parseInt(secMatch[2]) }
  }

  // Just a name
  return { name: t }
}

export function formatExercise(ex: SessionExercise | { name: string; sets: number | null; reps: number | null; weight: number | null; durationSeconds: number | null }): string {
  const parts: string[] = [ex.name]
  if (ex.sets && ex.reps) parts.push(`${ex.sets}×${ex.reps}`)
  if (ex.weight) parts.push(`@ ${ex.weight}kg`)
  if (ex.durationSeconds) {
    const mins = Math.floor(ex.durationSeconds / 60)
    const secs = ex.durationSeconds % 60
    parts.push(mins > 0 ? `${mins}m${secs > 0 ? `${secs}s` : ''}` : `${secs}s`)
  }
  return parts.join(' ')
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

export function registerLogHandlers(bot: Bot<BotContext>) {
  bot.command('log', async (ctx) => {
    if (!ctx.from) return

    const existing = await getSession(ctx.kv, ctx.from.id)
    if (existing && existing.workoutName !== PENDING) {
      await ctx.reply(
        `You already have an active workout: <b>${existing.workoutName}</b>\n` +
        `Use /done to save it or /cancel to discard.`,
        { parse_mode: 'HTML' }
      )
      return
    }

    const args = ctx.match?.trim()
    if (!args) {
      await setSession(ctx.kv, ctx.from.id, { workoutName: PENDING, exercises: [], startedAt: Date.now() })
      await ctx.reply('What workout are you logging? (e.g. "Push Day", "Morning Run")')
      return
    }

    await setSession(ctx.kv, ctx.from.id, { workoutName: args, exercises: [], startedAt: Date.now() })
    await ctx.reply(
      `Started logging <b>${args}</b>.\n\n` +
      `Send exercises like:\n` +
      `<code>Bench Press 3x10 80kg</code>\n` +
      `<code>Running 30min</code>\n` +
      `<code>Plank 60s</code>\n\n` +
      `Use /done when finished or /cancel to discard.`,
      { parse_mode: 'HTML' }
    )
  })

  bot.command('done', async (ctx) => {
    if (!ctx.from) return

    const session = await getSession(ctx.kv, ctx.from.id)
    if (!session || session.workoutName === PENDING) {
      await ctx.reply('No active workout. Use /log to start one.')
      return
    }
    if (session.exercises.length === 0) {
      await ctx.reply('Add at least one exercise before saving, or use /cancel to discard.')
      return
    }

    const user = await ensureUser(ctx)
    const now = Math.floor(Date.now() / 1000)

    const [workout] = await ctx.db.insert(workouts).values({
      userId: user.id,
      name: session.workoutName,
      completedAt: now,
    }).returning()

    await ctx.db.insert(exercises).values(
      session.exercises.map(ex => ({
        workoutId: workout.id,
        name: ex.name,
        sets: ex.sets ?? null,
        reps: ex.reps ?? null,
        weight: ex.weight ?? null,
        durationSeconds: ex.durationSeconds ?? null,
      }))
    )

    await clearSession(ctx.kv, ctx.from.id)

    const list = session.exercises.map(ex => `  • ${formatExercise(ex)}`).join('\n')
    await ctx.reply(
      `✅ <b>${session.workoutName}</b> saved!\n\n${list}`,
      { parse_mode: 'HTML' }
    )
  })

  bot.command('cancel', async (ctx) => {
    if (!ctx.from) return
    const session = await getSession(ctx.kv, ctx.from.id)
    if (!session) {
      await ctx.reply('No active workout.')
      return
    }
    await clearSession(ctx.kv, ctx.from.id)
    await ctx.reply('Workout cancelled.')
  })

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from || ctx.message.text.startsWith('/')) return next()

    const session = await getSession(ctx.kv, ctx.from.id)
    if (!session) return

    if (session.workoutName === PENDING) {
      const name = ctx.message.text.trim()
      await setSession(ctx.kv, ctx.from.id, { workoutName: name, exercises: [], startedAt: session.startedAt })
      await ctx.reply(
        `Started logging <b>${name}</b>.\n\n` +
        `Send exercises like:\n` +
        `<code>Bench Press 3x10 80kg</code>\n` +
        `<code>Running 30min</code>\n\n` +
        `Use /done when finished.`,
        { parse_mode: 'HTML' }
      )
      return
    }

    const parsed = parseExercise(ctx.message.text)
    if (!parsed) {
      await ctx.reply(
        'Could not parse exercise. Try: <code>Bench Press 3x10 80kg</code>',
        { parse_mode: 'HTML' }
      )
      return
    }

    session.exercises.push(parsed)
    await setSession(ctx.kv, ctx.from.id, session)
    await ctx.reply(`Added: <b>${formatExercise(parsed)}</b>`, { parse_mode: 'HTML' })
  })
}
