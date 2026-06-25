import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core'
import { relations, sql } from 'drizzle-orm'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull().unique(),
  username: text('username'),
  firstName: text('first_name').notNull(),
  notificationsEnabled: integer('notifications_enabled', { mode: 'boolean' }).notNull().default(true),
  lastChatId: integer('last_chat_id'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
})

export const workouts = sqliteTable('workouts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  notes: text('notes'),
  completedAt: integer('completed_at').notNull(),
})

export const exercises = sqliteTable('exercises', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workoutId: integer('workout_id').notNull().references(() => workouts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sets: integer('sets'),
  reps: integer('reps'),
  weight: real('weight'),
  durationSeconds: integer('duration_seconds'),
  notes: text('notes'),
})

export const schedules = sqliteTable('schedules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default('weekly'), // 'weekly' | 'interval'
  // weekly: comma-separated day numbers e.g. "1,3,5"; null for interval type
  daysOfWeek: text('days_of_week'),
  reminderHour: integer('reminder_hour').notNull().default(8),
  reminderMinute: integer('reminder_minute').notNull().default(0),
  // interval: repeat every N days; null for weekly type
  intervalDays: integer('interval_days'),
  nextFireAt: integer('next_fire_at'), // unix timestamp of next firing (interval only)
  workoutName: text('workout_name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
})

export const usersRelations = relations(users, ({ many }) => ({
  workouts: many(workouts),
  schedules: many(schedules),
}))

export const workoutsRelations = relations(workouts, ({ one, many }) => ({
  user: one(users, { fields: [workouts.userId], references: [users.id] }),
  exercises: many(exercises),
}))

export const exercisesRelations = relations(exercises, ({ one }) => ({
  workout: one(workouts, { fields: [exercises.workoutId], references: [workouts.id] }),
}))

export const schedulesRelations = relations(schedules, ({ one }) => ({
  user: one(users, { fields: [schedules.userId], references: [users.id] }),
}))

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').notNull(),
  messageId: integer('message_id').notNull(),
  isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (table) => ({
  chatBotIdx: index('idx_messages_chat_bot').on(table.chatId, table.isBot),
}))
