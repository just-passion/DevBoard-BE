// src/routes/invitations.ts
import express, { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import ProjectInvitation from '../models/ProjectInvitation';
import Project from '../models/Project';
import User from '../models/User';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';

const router: Router = express.Router();

// @route   GET api/invitations/:token
// @desc    Get invitation details by token (public route)
// @access  Public
router.get('/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const invitation = await ProjectInvitation.findOne({
      token: req.params.token,
      status: 'pending'
    })
      .populate('project', 'name key description')
      .populate('invitedBy', 'firstName lastName');

    if (!invitation) {
      res.status(404).json({
        success: false,
        message: 'Invitation not found or expired'
      });
      return;
    }

    // Check if invitation is expired
    if (invitation.expiresAt < new Date()) {
      invitation.status = 'expired';
      await invitation.save();
      
      res.status(410).json({
        success: false,
        message: 'Invitation has expired'
      });
      return;
    }

    res.json({
      success: true,
      data: {
        email: invitation.email,
        project: invitation.project,
        invitedBy: invitation.invitedBy,
        role: invitation.role,
        expiresAt: invitation.expiresAt
      }
    });
  } catch (error) {
    console.error('Get invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST api/invitations/:token/accept
// @desc    Accept project invitation (requires authentication)
// @access  Private
router.post('/:token/accept', authenticate, async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;

  try {
    const invitation = await ProjectInvitation.findOne({
      token: req.params.token,
      status: 'pending'
    }).populate('project');

    if (!invitation) {
      res.status(404).json({
        success: false,
        message: 'Invitation not found or expired'
      });
      return;
    }

    // Check if invitation is expired
    if (invitation.expiresAt < new Date()) {
      invitation.status = 'expired';
      await invitation.save();
      
      res.status(410).json({
        success: false,
        message: 'Invitation has expired'
      });
      return;
    }

    // Check if user's email matches invitation email
    if (authReq.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      res.status(403).json({
        success: false,
        message: 'This invitation is for a different email address'
      });
      return;
    }

    // Get the project
    const project = await Project.findById(invitation.project);
    if (!project) {
      res.status(404).json({
        success: false,
        message: 'Project not found'
      });
      return;
    }

    // Check if user is already a member
    const isMember = project.members.some(
      member => member.user.toString() === authReq.user._id.toString()
    );

    if (isMember) {
      res.status(400).json({
        success: false,
        message: 'You are already a member of this project'
      });
      return;
    }

    // Add user to project
    project.members.push({
      user: authReq.user._id,
      role: invitation.role,
      joinedAt: new Date()
    });

    await project.save();

    // Update invitation status
    invitation.status = 'accepted';
    invitation.acceptedAt = new Date();
    invitation.acceptedBy = authReq.user._id;
    await invitation.save();

    // Populate project data for response
    await project.populate('owner', 'firstName lastName avatar');
    await project.populate('members.user', 'firstName lastName avatar');

    res.json({
      success: true,
      message: 'Successfully joined the project',
      data: project
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST api/invitations/:token/decline
// @desc    Decline project invitation
// @access  Public
router.post('/:token/decline', async (req: Request, res: Response): Promise<void> => {
  try {
    const invitation = await ProjectInvitation.findOne({
      token: req.params.token,
      status: 'pending'
    });

    if (!invitation) {
      res.status(404).json({
        success: false,
        message: 'Invitation not found or expired'
      });
      return;
    }

    // Update invitation status
    invitation.status = 'declined';
    await invitation.save();

    res.json({
      success: true,
      message: 'Invitation declined successfully'
    });
  } catch (error) {
    console.error('Decline invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET api/invitations/user/pending
// @desc    Get user's pending invitations
// @access  Private
router.get('/user/pending', authenticate, async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;

  try {
    const invitations = await ProjectInvitation.find({
      email: authReq.user.email.toLowerCase(),
      status: 'pending',
      expiresAt: { $gt: new Date() }
    })
      .populate('project', 'name key description')
      .populate('invitedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: invitations
    });
  } catch (error) {
    console.error('Get pending invitations error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

export default router;