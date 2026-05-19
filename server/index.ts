import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { getDb, closeDb, getDbPath } from './db/connection.js';
import { createTables } from './db/schema.js';
import { seedDatabase } from './db/seed.js';
import { errorHandler } from './middleware/error-handler.js';
import { seedSafetyRules, listRules, toggleRule } from './safety/index.js';
import { recoverOrphans, setupCascadeListener } from './engine/pipeline-runner.js';
import { startCleanupScheduler, stopCleanupScheduler } from './engine/cleanup-service.js';
import { startRateLimitResumer, stopRateLimitResumer } from './engine/rate-limit-resumer.js';
import {
  startWorktreeCleanupScheduler,
  stopWorktreeCleanupScheduler,
} from './engine/worktree-cleanup-service.js';
import { workerPool } from './engine/worker-pool.js';
import { detectProviders } from './executor/index.js';
import { startNotificationService } from './notifications/index.js';
import pipelineRoutes from './routes/pipelines.js';
import taskRoutes from './routes/tasks.js';
import agentRoutes from './routes/agents.js';
import modelApiRoutes from './routes/models.js';
import logRoutes from './routes/logs.js';
import settingsRoutes from './routes/settings.js';
import contextRoutes from './routes/context.js';
import executionRoutes from './routes/execution.js';
import analyticsRoutes from './routes/analytics.js';
import memoryRoutes from './routes/memory.js';
import breakdownRoutes from './routes/breakdown.js';
import filesystemRoutes from './routes/filesystem.js';
import gitRoutes from './routes/git.js';
import uploadRoutes from './routes/uploads.js';
import { resolveAppPort } from './config/ports.js';
import { resolvePackageRoot } from './lib/runtime-paths.js';
import { createMcpServer } from '../mcp/server.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolvePackageRoot(import.meta.url);
const distPath = join(PACKAGE_ROOT, 'dist');

app.use(cors());
app.use(express.json());

// Initialize database
const db = getDb();
createTables(db);
seedDatabase(db);
seedSafetyRules();

const APP_PORT = resolveAppPort();
const isProduction = process.env.NODE_ENV === 'production';
// Dev: Vite occupies APP_PORT, backend runs on APP_PORT + 1
// Prod: Express serves everything on APP_PORT
const PORT = isProduction ? APP_PORT : APP_PORT + 1;

// Store project root so frontend can generate MCP config paths
db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('project_root', process.cwd());
db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('database_path', getDbPath());

// Recover orphaned tasks from previous crash/restart
recoverOrphans();

// Start cleanup scheduler (log rotation, old data purge)
startCleanupScheduler();
startWorktreeCleanupScheduler();
startRateLimitResumer();

// Setup cascade event listeners
setupCascadeListener();

// Reload worker pool settings
workerPool.loadMaxConcurrent();

// Start notification service (Telegram, Slack)
startNotificationService();

// Mount REST API routes
app.use('/api/pipelines', pipelineRoutes);
app.use('/api', taskRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/models', modelApiRoutes);
app.use('/api', logRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', contextRoutes);
app.use('/api', executionRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', memoryRoutes);
app.use('/api', breakdownRoutes);
app.use('/api/filesystem', filesystemRoutes);
app.use('/api', gitRoutes);
app.use('/api', uploadRoutes);

// ─── Setup / Onboarding ───

app.get('/api/setup/status', (_req, res) => {
  const setupDone = db.prepare("SELECT value FROM settings WHERE key = 'setup_completed'").get() as { value: string } | undefined;
  res.json({
    needsSetup: setupDone?.value !== 'true',
  });
});

app.get('/api/setup/detect-providers', async (_req, res) => {
  const providers = await detectProviders();
  res.json(providers);
});

app.post('/api/setup', (req, res) => {
  const body = req.body as Record<string, string>;
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(body)) {
      insertSetting.run(key, String(value));
    }
    insertSetting.run('setup_completed', 'true');
  });
  tx();

  // Reload worker pool settings
  workerPool.loadMaxConcurrent();
  res.json({ ok: true });
});

// ─── Safety Rules ───

app.get('/api/safety/rules', (_req, res) => {
  res.json(listRules());
});

app.put('/api/safety/rules/:id', (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  toggleRule(req.params.id as string, enabled);
  res.json({ ok: true });
});

// ─── Notification Test Endpoint ───

app.post('/api/integrations/test', async (req, res) => {
  const { channel } = req.body as { channel: 'telegram' | 'slack' };

  try {
    if (channel === 'telegram') {
      const { sendTelegramMessage: send } = await import('./notifications/telegram.js');
      const { decrypt: dec } = await import('./lib/crypto.js');
      const tokenRow = db.prepare("SELECT value FROM settings WHERE key = 'telegram_bot_token'").get() as { value: string } | undefined;
      const chatIdRow = db.prepare("SELECT value FROM settings WHERE key = 'telegram_chat_id'").get() as { value: string } | undefined;

      if (!tokenRow?.value || !chatIdRow?.value) {
        res.status(400).json({ error: 'Telegram not configured' });
        return;
      }

      const token = tokenRow.value.startsWith('enc:') ? dec(tokenRow.value) : tokenRow.value;
      await send(token, chatIdRow.value, {
        emoji: '\ud83e\udd16',
        title: 'AgentFlow',
        body: 'Test notification — connection successful!',
      });
      res.json({ ok: true });
    } else if (channel === 'slack') {
      const { sendSlackMessage: send } = await import('./notifications/slack.js');
      const { decrypt: dec } = await import('./lib/crypto.js');
      const webhookRow = db.prepare("SELECT value FROM settings WHERE key = 'slack_webhook_url'").get() as { value: string } | undefined;
      const botTokenRow = db.prepare("SELECT value FROM settings WHERE key = 'slack_bot_token'").get() as { value: string } | undefined;
      const channelRow = db.prepare("SELECT value FROM settings WHERE key = 'slack_channel'").get() as { value: string } | undefined;

      const webhook = webhookRow?.value ? (webhookRow.value.startsWith('enc:') ? dec(webhookRow.value) : webhookRow.value) : '';
      const botToken = botTokenRow?.value ? (botTokenRow.value.startsWith('enc:') ? dec(botTokenRow.value) : botTokenRow.value) : '';

      if (!webhook && !botToken) {
        res.status(400).json({ error: 'Slack not configured' });
        return;
      }

      await send(webhook, botToken, channelRow?.value ?? '', {
        emoji: '\ud83e\udd16',
        title: 'AgentFlow',
        body: 'Test notification — connection successful!',
      });
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'Unknown channel' });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Health check ───

app.get('/api/health', (_req, res) => {
  const setupDone = db.prepare("SELECT value FROM settings WHERE key = 'setup_completed'").get() as { value: string } | undefined;
  res.json({
    status: 'ok',
    needsSetup: setupDone?.value !== 'true',
    pool: workerPool.getStatus(),
    timestamp: new Date().toISOString(),
  });
});

// ─── MCP over SSE ───
const activeSseTransports = new Map<string, SSEServerTransport>();

app.get('/mcp/sse', async (_req, res) => {
  const transport = new SSEServerTransport('/mcp/messages', res);
  activeSseTransports.set(transport.sessionId, transport);

  const server = createMcpServer();
  await server.connect(transport);

  transport.onclose = () => {
    activeSseTransports.delete(transport.sessionId);
  };
});

app.post('/mcp/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = activeSseTransports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

console.log('[AgentFlow MCP] Mounted on /mcp/sse');

// ─── Quiet browser/devtools probes ───
// Chrome auto-fetches /favicon.ico even when the page declares a <link rel="icon">.
// Chrome DevTools probes /.well-known/appspecific/com.chrome.devtools.json on open.
// Neither indicates a problem; serve empty/redirect replies so they don't show up
// as 404s in the log.
app.get('/favicon.ico', (_req, res) => {
  res.redirect(301, '/favicon.svg');
});
app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => {
  res.json({});
});

// ─── Static file serving (production) ───
if (isProduction && existsSync(distPath)) {
  app.use(express.static(distPath));
  // SPA fallback. Use the sendFile callback so an ENOENT from `send`
  // (e.g. a stale asset hash requested by a cached browser tab) becomes
  // a quiet 404 routed through the error handler instead of leaking the
  // raw stack trace into the server log.
  const indexHtml = join(distPath, 'index.html');
  app.get('{*path}', (_req, res, next) => {
    res.sendFile(indexHtml, (err) => {
      if (err) next(err);
    });
  });
  console.log('[AgentFlow] Serving frontend from dist/');
}

// Error handler (must be last)
app.use(errorHandler);

let httpServer: ReturnType<typeof app.listen> | null = null;

function startServer(port: number): void {
  const server = app.listen(port, () => {
    httpServer = server;
    // Persist the app port (what the user visits) so MCP config stays in sync
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('port', String(APP_PORT));

    if (isProduction) {
      console.log(`[AgentFlow] http://localhost:${port}`);
    } else {
      console.log(`[AgentFlow] App       → http://localhost:${APP_PORT}`);
      console.log(`[AgentFlow] API       → http://localhost:${port} (internal)`);
    }
    console.log(`[AgentFlow] REST API  → /api/*`);
    console.log(`[AgentFlow] MCP       → /mcp`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      const hint = isProduction
        ? `Stop the process using ${port} or restart AgentFlow with --port <port>.`
        : `AgentFlow is configured for app port ${APP_PORT}, so dev mode also needs internal API port ${PORT}. Stop the process using ${port} or choose a different app port.`;
      console.error(`[AgentFlow] Port ${port} is already in use. ${hint}`);
      process.exit(1);
    } else {
      console.error(`[AgentFlow] Server error: ${err.message}`);
      process.exit(1);
    }
  });
}

startServer(PORT);

// Graceful shutdown
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) {
    process.exit(1); // Second signal — force exit
  }
  shuttingDown = true;

  const aborted = workerPool.abortAll();
  if (aborted > 0) {
    console.log(`[Shutdown] Aborted ${aborted} running/queued tasks`);
  }
  stopCleanupScheduler();
  stopWorktreeCleanupScheduler();
  stopRateLimitResumer();
  closeDb();

  if (httpServer) {
    httpServer.close(() => process.exit(0));
    // Force exit after 1s — don't let open SSE connections or child processes delay shutdown
    setTimeout(() => process.exit(0), 1000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
