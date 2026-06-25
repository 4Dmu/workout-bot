export interface Env {
  DB: D1Database
  KV: KVNamespace
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_SECRET_TOKEN: string
  BOT_PASSWORD: string
}

export interface WorkoutSession {
  workoutName: string
  exercises: SessionExercise[]
  startedAt: number
}

export interface SessionExercise {
  name: string
  sets?: number
  reps?: number
  weight?: number
  durationSeconds?: number
}
