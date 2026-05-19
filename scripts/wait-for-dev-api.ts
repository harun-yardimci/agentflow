import { setTimeout as delay } from 'node:timers/promises';
import {
  resolveApiPortForDev,
  resolveAppPort,
} from '../server/config/ports.js';

const apiPort = resolveApiPortForDev();
const appPort = resolveAppPort();
const healthUrl = `http://127.0.0.1:${apiPort}/api/health`;
const timeoutMs = 30_000;
const pollMs = 250;

async function isApiReady(): Promise<boolean> {
  try {
    const response = await fetch(healthUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForApi(): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isApiReady()) {
      console.log(
        `[dev] API ready on :${apiPort}; starting Vite on :${appPort}`,
      );
      return;
    }

    await delay(pollMs);
  }

  console.error(
    `[dev] Timed out waiting for API on :${apiPort} after ${timeoutMs}ms`,
  );
  process.exit(1);
}

await waitForApi();
