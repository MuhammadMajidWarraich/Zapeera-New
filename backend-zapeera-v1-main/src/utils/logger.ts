/**
 * Lightweight structured logger.
 *
 * - In development: all levels output to stdout/stderr.
 * - In production: only info, warn, error are output (debug is suppressed).
 * - Every line is JSON-parseable for log aggregators.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: Level =
  (process.env.LOG_LEVEL as Level) ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return;

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    lvl: level,
    msg: message,
  };
  if (meta && Object.keys(meta).length > 0) {
    entry.meta = meta;
  }

  const line = JSON.stringify(entry);

  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info:  (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};

export default logger;
