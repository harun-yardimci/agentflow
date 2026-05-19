import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const router = Router();

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * GET /api/filesystem/browse?dir=/some/path
 * Returns directory contents (directories only, hidden dirs excluded).
 */
router.get('/browse', (req, res) => {
  const dirParam = (req.query.dir as string) || os.homedir();
  const resolvedDir = path.resolve(dirParam);

  try {
    const stat = fs.statSync(resolvedDir);
    if (!stat.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'Directory not found' });
    return;
  }

  try {
    const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
    const dirs: DirEntry[] = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({
        name: e.name,
        path: path.join(resolvedDir, e.name),
        isDirectory: true,
      }));

    const parentDir = path.dirname(resolvedDir);

    res.json({
      current: resolvedDir,
      parent: parentDir !== resolvedDir ? parentDir : null,
      entries: dirs,
    });
  } catch {
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

/**
 * GET /api/filesystem/validate?dir=/some/path
 * Validates a directory path exists and is accessible.
 */
router.get('/validate', (req, res) => {
  const dirParam = req.query.dir as string;
  if (!dirParam) {
    res.status(400).json({ valid: false, error: 'No path provided' });
    return;
  }

  const resolvedDir = path.resolve(dirParam);

  try {
    const stat = fs.statSync(resolvedDir);
    if (!stat.isDirectory()) {
      res.json({ valid: false, resolved: resolvedDir, error: 'Not a directory' });
      return;
    }
    fs.accessSync(resolvedDir, fs.constants.R_OK);
    res.json({ valid: true, resolved: resolvedDir });
  } catch {
    res.json({ valid: false, resolved: resolvedDir, error: 'Path not found or not accessible' });
  }
});

export default router;
