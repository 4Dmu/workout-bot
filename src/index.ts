import { Hono } from 'hono'
import { webhookCallback } from 'grammy'
import { createBot } from './bot'
import { handleCron } from './cron'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) => c.text('Workout Bot is running!'))

app.post('/webhook', async (c) => {
  const env = c.env

  const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (env.TELEGRAM_SECRET_TOKEN && secretToken !== env.TELEGRAM_SECRET_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const bot = createBot(env)
  const handler = webhookCallback(bot, 'cloudflare-mod')
  return handler(c.req.raw)
})

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await handleCron(env)
  },
}
