import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { SetContextSchema } from '../types/api.js';
import * as contextService from '../services/context-service.js';

const router = Router();
const getParam = (value: string | string[]): string =>
  Array.isArray(value) ? value[0] ?? '' : value;

router.get('/pipelines/:pid/context', (req, res) => {
  res.json(contextService.getContext(getParam(req.params.pid)));
});

router.put('/pipelines/:pid/context', validate(SetContextSchema), (req, res) => {
  res.json(
    contextService.setContext(
      getParam(req.params.pid),
      req.body.key,
      req.body.value,
      req.body.setByTaskId,
    ),
  );
});

router.delete('/pipelines/:pid/context/:key', (req, res) => {
  res.json(
    contextService.deleteContext(getParam(req.params.pid), getParam(req.params.key)),
  );
});

export default router;
