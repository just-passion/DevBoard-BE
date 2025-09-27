import express, { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import Project from '../models/Project';
import Task from '../models/Task';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';

const router: Router = express.Router();

// All routes are protected
router.use(authenticate);

interface CreateProjectRequest {
  name: string;
  key: string;
  description?: string;
}

// @route   GET api/projects
// @desc    Get user's projects
// @access  Private
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;

  try {
    const projects = await Project.find({
      $or: [
        { owner: authReq.user._id },
        { 'members.user': authReq.user._id }
      ]
    })
      .populate('owner', 'firstName lastName avatar')
      .populate('members.user', 'firstName lastName avatar')
      .sort({ updatedAt: -1 });

    res.json({
      success: true,
      data: projects
    });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST api/projects
// @desc    Create new project
// @access  Private
router.post(
  '/',
  [
    body('name').trim().isLength({ min: 1, max: 100 }),
    body('key').trim().matches(/^[A-Z]{2,10}$/),
    body('description').optional().isLength({ max: 1000 })
  ],
  async (req: Request, res: Response): Promise<void> => {
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

      const { name, key, description } = req.body as CreateProjectRequest;

      // Check if project key already exists
      const existingProject = await Project.findOne({ key: key.toUpperCase() });
      if (existingProject) {
        res.status(400).json({
          success: false,
          message: 'Project key already exists'
        });
        return;
      }

      // Create project
      const project = new Project({
        name,
        key: key.toUpperCase(),
        description,
        owner: authReq.user._id,
        members: [
          {
            user: authReq.user._id,
            role: 'owner' as const
          }
        ]
      });

      await project.save();

      // Populate owner and members
      await project.populate('owner', 'firstName lastName avatar');
      await project.populate('members.user', 'firstName lastName avatar');

      res.status(201).json({
        success: true,
        message: 'Project created successfully',
        data: project
      });
    } catch (error) {
      console.error('Create project error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @route   GET api/projects/:id/tasks
// @desc    Get project tasks
// @access  Private
router.get('/:id/tasks', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;

  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      res.status(404).json({
        success: false,
        message: 'Project not found'
      });
      return;
    }

    // Check access
const hasAccess =
  project.owner.toString() === authReq.user._id.toString() ||
  project.members.some(m => m.user.toString() === authReq.user._id.toString());


    if (!hasAccess) {
      res.status(403).json({
        success: false,
        message: 'Access denied'
      });
      return;
    }

    const tasks = await Task.find({ project: req.params.id })
      .populate('assignee', 'firstName lastName avatar')
      .populate('reporter', 'firstName lastName avatar')
      .sort({ updatedAt: -1 });

    res.json({
      success: true,
      data: tasks
    });
  } catch (error) {
    console.error('Get project tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

export default router;