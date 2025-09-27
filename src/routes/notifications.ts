import express, { Router, Request, Response } from 'express';
import Notification from '../models/Notification';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';

const router: Router = express.Router();

// All routes are protected
router.use(authenticate);

// @route   GET api/notifications
// @desc    Get user notifications
// @access  Private
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const notifications = await Notification.find({ recipient: authReq.user._id })
      .populate('relatedUser', 'firstName lastName avatar')
      .populate('relatedTask', 'title taskId')
      .populate('relatedProject', 'name key')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Notification.countDocuments({ recipient: authReq.user._id });
    const unreadCount = await Notification.countDocuments({
      recipient: authReq.user._id,
      isRead: false
    });

    res.json({
      success: true,
      data: notifications,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        unreadCount
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT api/notifications/:id/read
// @desc    Mark notification as read
// @access  Private
router.put('/:id/read', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: authReq.user._id },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
      return;
    }

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

export default router;
