import { Router } from 'express';

import { getUsageAnalytics } from '../services/usage-analytics-service.js';

const router = Router();

router.get('/analytics/usage', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const pipelineId = typeof req.query.pipelineId === 'string'
    ? req.query.pipelineId
    : undefined;
  const provider = typeof req.query.provider === 'string'
    ? req.query.provider
    : undefined;
  const model = typeof req.query.model === 'string' ? req.query.model : undefined;

  res.json(getUsageAnalytics({
    from,
    model,
    pipelineId,
    provider,
    to,
  }));
});

export default router;
