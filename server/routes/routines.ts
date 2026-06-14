import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { CreateRoutineSchema, UpdateRoutineSchema } from '../types/api.js';
import * as routineService from '../services/routine-service.js';
import { triggerRoutine } from '../engine/routine-scheduler.js';
import { getTask } from '../services/task-service.js';

const router = Router();
const getParam = (value: string | string[]): string =>
  Array.isArray(value) ? value[0] ?? '' : value;

// List routines for a pipeline
router.get('/pipelines/:pid/routines', (req, res) => {
  res.json(routineService.listRoutines(getParam(req.params.pid)));
});

// Create a routine in a pipeline
router.post('/pipelines/:pid/routines', validate(CreateRoutineSchema), (req, res) => {
  res.status(201).json(routineService.createRoutine(getParam(req.params.pid), req.body));
});

// Update a routine
router.put('/routines/:id', validate(UpdateRoutineSchema), (req, res) => {
  res.json(routineService.updateRoutine(getParam(req.params.id), req.body));
});

// Delete a routine
router.delete('/routines/:id', (req, res) => {
  res.json(routineService.deleteRoutine(getParam(req.params.id)));
});

// Trigger a routine immediately (does not advance the recurring schedule)
router.post('/routines/:id/run', (req, res) => {
  const routine = routineService.getRoutine(getParam(req.params.id));
  if (!routine.enabled) {
    throw new AppError(400, 'Routine is disabled — enable it before running');
  }
  const taskId = triggerRoutine(routine, false);
  if (!taskId) {
    throw new AppError(409, 'Routine could not run (agent missing, or a previous run is still awaiting approval)');
  }
  res.status(201).json(getTask(taskId));
});

export default router;
