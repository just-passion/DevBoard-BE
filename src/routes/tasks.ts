// src/routes/tasks.ts - Complete version with email notifications
import express, { Router, Response } from 'express';
import type { Request as ExpressRequest } from 'express';
import { body, validationResult } from 'express-validator';
import { Types } from 'mongoose';
import Task from '../models/Task';
import Project from '../models/Project';
import User from '../models/User';
import Notification from '../models/Notification';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest, IProject, IUser } from '../types';
import emailService from '../services/emailService';

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
      await task.populate('assignee', 'firstName lastName avatar email');
      await task.populate('reporter', 'firstName lastName avatar');

      // Send notifications if assignee is different from reporter
      if (assignee && !new Types.ObjectId(assignee).equals(authReq.user._id)) {
        const assigneeUser = await User.findById(assignee);
        if (assigneeUser) {
          // Create in-app notification
          await createNotification(
            new Types.ObjectId(assignee),
            'task_assigned',
            'New task assigned',
            `${authReq.user.fullName} assigned you a task: ${title}`,
            task._id,
            new Types.ObjectId(projectId)
          );

          // Send email notification if user has email notifications enabled
          if (assigneeUser.preferences.notifications.email && assigneeUser.preferences.notifications.taskUpdates) {
            await emailService.sendTaskAssignmentNotification(
              assigneeUser.email,
              assigneeUser.fullName,
              authReq.user.fullName,
              title,
              task.taskId,
              project.name
            );
          }

          // Emit socket event for real-time notification
          authReq.io.to(assignee.toString()).emit('notification', {
            type: 'task_assigned',
            message: `New task assigned: ${title}`
          });
        }
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
        .populate('project', 'owner members name')
        .populate('assignee', 'firstName lastName avatar email');

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
      const oldAssignee = task.assignee;

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

        // Create notification for status change
        if (task.assignee && String(task.assignee) !== String(authReq.user._id)) {
          await createNotification(
            task.assignee as Types.ObjectId,
            'task_status_changed',
            'Task status updated',
            `${authReq.user.fullName} changed status of "${task.title}" to ${body.status}`,
            task._id,
            project._id
          );
        }
      }

      await task.save();
      await task.populate('assignee', 'firstName lastName avatar email');
      await task.populate('reporter', 'firstName lastName avatar');

      // Handle assignee change notifications
      if (body.assignee !== undefined) {
        const newAssigneeId = body.assignee ? new Types.ObjectId(body.assignee) : null;
        const oldAssigneeId = oldAssignee as Types.ObjectId | null;
        
        // Check if assignee actually changed
        const assigneeChanged = (!newAssigneeId && oldAssigneeId) ||
                               (newAssigneeId && !oldAssigneeId) ||
                               (newAssigneeId && oldAssigneeId && !newAssigneeId.equals(oldAssigneeId));

        if (assigneeChanged) {
          // Notify new assignee
          if (newAssigneeId && !newAssigneeId.equals(authReq.user._id)) {
            const newAssignee = await User.findById(newAssigneeId);
            if (newAssignee) {
              await createNotification(
                newAssigneeId,
                'task_assigned',
                'Task assigned to you',
                `${authReq.user.fullName} assigned you to task: ${task.title}`,
                task._id,
                project._id
              );

              // Send email notification
              if (newAssignee.preferences.notifications.email && newAssignee.preferences.notifications.taskUpdates) {
                await emailService.sendTaskAssignmentNotification(
                  newAssignee.email,
                  newAssignee.fullName,
                  authReq.user.fullName,
                  task.title,
                  task.taskId,
                  project.name
                );
              }

              // Real-time notification
              authReq.io.to(newAssigneeId.toString()).emit('notification', {
                type: 'task_assigned',
                message: `Task assigned: ${task.title}`
              });
            }
          }

          // Notify old assignee about unassignment
          if (oldAssigneeId && !oldAssigneeId.equals(authReq.user._id)) {
            await createNotification(
              oldAssigneeId,
              'task_status_changed',
              'Task unassigned',
              `${authReq.user.fullName} unassigned you from task: ${task.title}`,
              task._id,
              project._id
            );
          }
        }
      }

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

// @route   GET api/tasks/:id
// @desc    Get single task
// @access  Private
router.get('/:id', async (req: ExpressRequest, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  try {
    const task = await Task.findById(req.params.id)
      .populate('project', 'owner members name key')
      .populate('assignee', 'firstName lastName avatar')
      .populate('reporter', 'firstName lastName avatar')
      .populate('statusHistory.changedBy', 'firstName lastName avatar');

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

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE api/tasks/:id
// @desc    Delete task
// @access  Private
router.delete('/:id', async (req: ExpressRequest, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  try {
    const task = await Task.findById(req.params.id)
      .populate('project', 'owner members');

    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    // Check access (only project owner or task reporter can delete)
    const project = task.project as IProject;
    const isOwner = project.owner.toString() === authReq.user._id.toString();
    const isReporter = task.reporter.toString() === authReq.user._id.toString();

    if (!isOwner && !isReporter) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    await task.deleteOne();

    res.json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET api/tasks/user/assigned
// @desc    Get tasks assigned to current user
// @access  Private
router.get('/user/assigned', async (req: ExpressRequest, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const tasks = await Task.find({ assignee: authReq.user._id })
      .populate('project', 'name key')
      .populate('reporter', 'firstName lastName avatar')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Task.countDocuments({ assignee: authReq.user._id });

    res.json({
      success: true,
      data: tasks,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get assigned tasks error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET api/tasks/user/reported
// @desc    Get tasks reported by current user
// @access  Private
router.get('/user/reported', async (req: ExpressRequest, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const tasks = await Task.find({ reporter: authReq.user._id })
      .populate('project', 'name key')
      .populate('assignee', 'firstName lastName avatar')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Task.countDocuments({ reporter: authReq.user._id });

    res.json({
      success: true,
      data: tasks,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get reported tasks error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET api/tasks
// @desc    Get all tasks with filtering and pagination
// @access  Private
router.get('/', async (req: ExpressRequest, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    
    const { status, priority, assignee, project, search } = req.query;

    // Build filter
    const filter: any = {};
    
    // Only show tasks from projects user has access to
    const userProjects = await Project.find({
      $or: [
        { owner: authReq.user._id },
        { 'members.user': authReq.user._id }
      ]
    }).select('_id');
    
    filter.project = { $in: userProjects.map(p => p._id) };

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignee) filter.assignee = assignee;
    if (project) filter.project = project;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { taskId: { $regex: search, $options: 'i' } }
      ];
    }

    const tasks = await Task.find(filter)
      .populate('project', 'name key')
      .populate('assignee', 'firstName lastName avatar')
      .populate('reporter', 'firstName lastName avatar')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Task.countDocuments(filter);

    res.json({
      success: true,
      data: tasks,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT api/tasks/:id/log-time
// @desc    Log time for a task
// @access  Private
router.put('/:id/log-time', [
  body('hours').isNumeric().isFloat({ min: 0.1, max: 24 }).withMessage('Hours must be between 0.1 and 24')
], async (req: ExpressRequest, res: Response): Promise<void> => {
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

    const { hours } = req.body;
    const task = await Task.findById(req.params.id)
      .populate('project', 'owner members')
      .populate('assignee', 'firstName lastName');

    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    // Check access (assignee or project members can log time)
    const project = task.project as IProject;
    const hasAccess =
      project.owner.toString() === authReq.user._id.toString() ||
      project.members.some(m => m.user.toString() === authReq.user._id.toString()) ||
      (task.assignee && task.assignee.toString() === authReq.user._id.toString());

    if (!hasAccess) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    task.loggedHours += parseFloat(hours);
    await task.save();

    res.json({
      success: true,
      message: 'Time logged successfully',
      data: {
        loggedHours: task.loggedHours,
        hoursAdded: parseFloat(hours)
      }
    });
  } catch (error) {
    console.error('Log time error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;