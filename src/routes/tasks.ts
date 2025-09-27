import express, { Router, Response } from 'express';
import type { Request as ExpressRequest } from 'express'; // alias to avoid confusion
import { body, validationResult } from 'express-validator';
import { Types } from 'mongoose';
import Task from '../models/Task';
import Project from '../models/Project';
import Notification from '../models/Notification';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest, IProject } from '../types';

const router: Router = express.Router();

// All routes are protected
router.use(authenticate);

interface CreateTaskRequest {
  title: string;
  description?: string;
  project: string;
  assignee?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  tags?: string[];
  dueDate?: string;
  estimatedHours?: number;
}

interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: 'todo' | 'in-progress' | 'review' | 'done';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  tags?: string[];
  dueDate?: string;
  estimatedHours?: number;
}

// Helper function to create notification
const createNotification = async (
  recipientId: Types.ObjectId,
  type: string,
  title: string,
  message: string,
  relatedTask?: Types.ObjectId,
  relatedProject?: Types.ObjectId
): Promise<void> => {
  try {
    const notification = new Notification({
      recipient: recipientId,
      type,
      title,
      message,
      relatedTask,
      relatedProject,
      actionUrl: relatedTask ? `/projects/${relatedProject}/kanban` : undefined
    });
    await notification.save();
  } catch (error) {
    console.error('Create notification error:', error);
  }
};

// @route   POST api/tasks
// @desc    Create new task
// @access  Private
router.post(
  '/',
  [
    body('title').trim().isLength({ min: 1, max: 200 }),
    body('description').optional().isLength({ max: 5000 }),
    body('project').isMongoId(),
    body('assignee').optional().isMongoId(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('tags').optional().isArray(),
    body('dueDate').optional().isISO8601()
  ],
  async (req: ExpressRequest, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
        return;
      }

      const { title, description, project: projectId, assignee, priority, tags, dueDate, estimatedHours } =
        req.body as CreateTaskRequest;

      // Check if project exists and user has access
      const project = await Project.findById(projectId);
      if (!project) {
        res.status(404).json({ success: false, message: 'Project not found' });
        return;
      }

      const hasAccess =
        project.owner.toString() === authReq.user._id.toString() ||
        project.members.some(m => m.user.toString() === authReq.user._id.toString());

      if (!hasAccess) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }

      // Create task
      const task = new Task({
        title,
        description,
        project: projectId,
        assignee: assignee ? new Types.ObjectId(assignee) : null,
        reporter: authReq.user._id,
        priority,
        tags,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        estimatedHours
      });

      await task.save();

      // Populate references
      await task.populate('assignee', 'firstName lastName avatar');
      await task.populate('reporter', 'firstName lastName avatar');

      // Create notification for assignee
      if (assignee && !new Types.ObjectId(assignee).equals(authReq.user._id)) {
        await createNotification(
          new Types.ObjectId(assignee),
          'task_assigned',
          'New task assigned',
          `${authReq.user.fullName} assigned you a task: ${title}`,
          task._id,
          new Types.ObjectId(projectId)
        );

        // Emit socket event for real-time notification
        authReq.io.to(assignee.toString()).emit('notification', {
          type: 'task_assigned',
          message: `New task assigned: ${title}`
        });
      }

      res.status(201).json({
        success: true,
        message: 'Task created successfully',
        data: task
      });
    } catch (error) {
      console.error('Create task error:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// @route   PUT api/tasks/:id
// @desc    Update task
// @access  Private
router.put(
  '/:id',
  [
    body('title').optional().trim().isLength({ min: 1, max: 200 }),
    body('description').optional().isLength({ max: 5000 }),
    body('status').optional().isIn(['todo', 'in-progress', 'review', 'done']),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('assignee').optional().isMongoId(),
    body('tags').optional().isArray(),
    body('dueDate').optional().isISO8601()
  ],
  async (req: ExpressRequest, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
        return;
      }

      const task = await Task.findById((req.params as any).id)
        .populate('project', 'owner members')
        .populate('assignee', 'firstName lastName avatar');

      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found' });
        return;
      }

      // Check access
      const project = task.project as IProject;
      const hasAccess =
        project.owner.toString() === authReq.user._id.toString() ||
        project.members.some(m => m.user.toString() === authReq.user._id.toString());

      if (!hasAccess) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }

      const oldStatus = task.status;

      // Update task fields
      const body = req.body as UpdateTaskRequest;
      const allowedFields: Array<keyof UpdateTaskRequest> = [
        'title',
        'description',
        'status',
        'priority',
        'assignee',
        'tags',
        'dueDate',
        'estimatedHours'
      ];

      allowedFields.forEach(key => {
        if (body[key] !== undefined) {
          if (key === 'assignee') {
            (task as any)[key] = body[key] ? new Types.ObjectId(body[key] as string) : null;
          } else if (key === 'dueDate') {
            (task as any)[key] = body[key] ? new Date(body[key] as string) : undefined;
          } else {
            (task as any)[key] = body[key];
          }
        }
      });

      // Add status change to history
      if (body.status && body.status !== oldStatus) {
        task.statusHistory.push({
          status: body.status,
          changedBy: authReq.user._id,
          changedAt: new Date()
        });
      }

      await task.save();
      await task.populate('assignee', 'firstName lastName avatar');
      await task.populate('reporter', 'firstName lastName avatar');

      // Emit socket event for real-time updates
      authReq.io.emit('taskUpdated', task);

      res.json({
        success: true,
        message: 'Task updated successfully',
        data: task
      });
    } catch (error) {
      console.error('Update task error:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

export default router;
