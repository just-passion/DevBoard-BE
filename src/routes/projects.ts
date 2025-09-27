import express, { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import crypto from 'crypto';
import Project from '../models/Project';
import ProjectInvitation from '../models/ProjectInvitation';
import User from '../models/User';
import Task from '../models/Task';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest, IProject } from '../types';
import emailService from '../services/emailService';

const router: Router = express.Router();

// All routes are protected
router.use(authenticate);

interface CreateProjectRequest {
  name: string;
  key: string;
  description?: string;
  inviteEmails?: string[];
}

interface InviteUsersRequest {
  emails: string[];
  role?: 'admin' | 'member' | 'viewer';
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
    body('description').optional().isLength({ max: 1000 }),
    body('inviteEmails').optional().isArray()
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

      const { name, key, description, inviteEmails } = req.body as CreateProjectRequest;

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

      // Send invitations if emails provided
      if (inviteEmails && inviteEmails.length > 0) {
        const invitationPromises = inviteEmails.map(async (email: string) => {
          try {
            // Check if user already exists
            const existingUser = await User.findOne({ email: email.toLowerCase() });
            if (existingUser) {
              // Check if user is already a member
              const isMember = project.members.some(
                member => member.user.toString() === existingUser._id.toString()
              );
              if (!isMember) {
                // Add existing user to project
                project.members.push({
                  user: existingUser._id,
                  role: 'member',
                  joinedAt: new Date()
                });
              }
              return;
            }

            // Create invitation for non-existing user
            const token = crypto.randomBytes(32).toString('hex');
            const invitation = new ProjectInvitation({
              email: email.toLowerCase(),
              project: project._id,
              invitedBy: authReq.user._id,
              token,
              role: 'member'
            });

            await invitation.save();

            // Send invitation email
            await emailService.sendProjectInvitation(
              email,
              authReq.user.fullName,
              project.name,
              project.key,
              token
            );
          } catch (inviteError) {
            console.error(`Failed to invite ${email}:`, inviteError);
          }
        });

        await Promise.all(invitationPromises);
        await project.save(); // Save project with any new members
      }

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

// @route   POST api/projects/:id/invite
// @desc    Invite users to project
// @access  Private
router.post(
  '/:id/invite',
  [
    body('emails').isArray({ min: 1 }).withMessage('At least one email is required'),
    body('emails.*').isEmail().withMessage('Invalid email format'),
    body('role').optional().isIn(['admin', 'member', 'viewer'])
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

      const { emails, role = 'member' } = req.body as InviteUsersRequest;

      const project = await Project.findById(req.params.id);
      if (!project) {
        res.status(404).json({
          success: false,
          message: 'Project not found'
        });
        return;
      }

      // Check if user can invite (owner or admin)
      const userMember = project.members.find(
        m => m.user.toString() === authReq.user._id.toString()
      );
      const canInvite = project.owner.toString() === authReq.user._id.toString() ||
                       (userMember && ['owner', 'admin'].includes(userMember.role));

      if (!canInvite) {
        res.status(403).json({
          success: false,
          message: 'You do not have permission to invite users to this project'
        });
        return;
      }

      const results = {
        sent: [] as string[],
        errors: [] as { email: string; error: string }[]
      };

      for (const email of emails) {
        try {
          // Check if invitation already exists
          const existingInvitation = await ProjectInvitation.findOne({
            email: email.toLowerCase(),
            project: project._id,
            status: 'pending'
          });

          if (existingInvitation) {
            results.errors.push({
              email,
              error: 'Invitation already sent'
            });
            continue;
          }

          // Check if user already exists and is member
          const existingUser = await User.findOne({ email: email.toLowerCase() });
          if (existingUser) {
            const isMember = project.members.some(
              member => member.user.toString() === existingUser._id.toString()
            );
            if (isMember) {
              results.errors.push({
                email,
                error: 'User is already a project member'
              });
              continue;
            }
          }

          // Create invitation
          const token = crypto.randomBytes(32).toString('hex');
          const invitation = new ProjectInvitation({
            email: email.toLowerCase(),
            project: project._id,
            invitedBy: authReq.user._id,
            token,
            role
          });

          await invitation.save();

          // Send invitation email
          const emailSent = await emailService.sendProjectInvitation(
            email,
            authReq.user.fullName,
            project.name,
            project.key,
            token
          );

          if (emailSent) {
            console.log({email, emailSent})
            results.sent.push(email);
          } else {
            results.errors.push({
              email,
              error: 'Failed to send invitation email'
            });
          }
        } catch (error) {
          console.error(`Error inviting ${email}:`, error);
          results.errors.push({
            email,
            error: 'Failed to create invitation'
          });
        }
      }

      res.json({
        success: true,
        message: `${results.sent.length} invitations sent successfully`,
        data: results
      });
    } catch (error) {
      console.error('Invite users error:', error);
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

// @route   GET api/projects/:id
// @desc    Get single project details
// @access  Private
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;

  try {
    const project = await Project.findById(req.params.id)
      .populate('owner', 'firstName lastName avatar')
      .populate('members.user', 'firstName lastName avatar');

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

    res.json({
      success: true,
      data: project
    });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

export default router;