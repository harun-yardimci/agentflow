import type { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Handle multer file size limit errors
  if ((err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File too large — 10 MB per-file limit' });
    return;
  }

  // Client-side errors from libraries that set `status` (send, http-errors, etc.).
  // Log path + status only — no stack — so noise from missing favicons or stale
  // browser-cached asset hashes doesn't drown the real signal.
  const httpStatus =
    (err as { status?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500) {
    console.warn(`[${httpStatus}] ${req.method} ${req.originalUrl} — ${err.message}`);
    res.status(httpStatus).json({ error: err.message });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
