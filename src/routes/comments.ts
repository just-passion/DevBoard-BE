import express, { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { Types } from 'mongoose';
import Comment from '../models/Comment';
import Task from '../models/Task';
import Notification from '../models/Notification';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest, ITask, IProject } from '../types';

const router: Router = express.Router();
router.use(authenticate);

interface CreateCommentRequest {
  content: string;
  task: string;
  mentions?: string[];
  parentComment?: string;
}

interface UpdateCommentRequest {
  content: string;
}

// Helper to normalize ObjectId
const toObjectId = (value: Types.ObjectId | any): Types.ObjectId => {
  if (value instanceof Types.ObjectId) return value;
  return new Types.ObjectId(value._id ?? value);
};

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

// @route   GET api/comments/task/:taskId
// @desc    Get task comments
// @access  Private
router.get('/task/:taskId', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;

  try {
    const task = await Task.findById(req.params.taskId).populate('project', 'owner members');

    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    const project = task.project as IProject;
    const ownerId = toObjectId(project.owner);
    const hasAccess =
      ownerId.equals(authReq.user._id) ||
      project.members.some(member => toObjectId(member.user).equals(authReq.user._id));

    if (!hasAccess) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const comments = await Comment.find({ task: req.params.taskId })
      .populate('author', 'firstName lastName avatar')
      .populate('mentions', 'firstName lastName')
      .populate('parentComment')
      .sort({ createdAt: 1 });

    res.json({ success: true, data: comments });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST api/comments
// @desc    Create comment
// @access  Private
router.post(
  '/',
  [
    body('content').trim().isLength({ min: 1, max: 2000 }),
    body('task').isMongoId(),
    body('mentions').optional().isArray(),
    body('parentComment').optional().isMongoId()
  ],
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
        return;
      }

      const { content, task: taskId, mentions, parentComment } = req.body as CreateCommentRequest;

      const task = await Task.findById(taskId).populate('project', 'owner members');
      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found' });
        return;
      }

      const project = task.project as IProject;
      const ownerId = toObjectId(project.owner);
      const hasAccess =
        ownerId.equals(authReq.user._id) ||
        project.members.some(member => toObjectId(member.user).equals(authReq.user._id));

      if (!hasAccess) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }

      const comment = new Comment({
        content,
        task: taskId,
        author: authReq.user._id,
        mentions: mentions?.map(id => new Types.ObjectId(id)) || [],
        parentComment: parentComment ? new Types.ObjectId(parentComment) : undefined
      });

      await comment.save();
      await comment.populate('author', 'firstName lastName avatar');
      await comment.populate('mentions', 'firstName lastName');

      // Create notifications for mentions
      if (mentions && mentions.length > 0) {
        for (const mentionedUserId of mentions) {
          if (!new Types.ObjectId(mentionedUserId).equals(authReq.user._id)) {
            await createNotification(
              new Types.ObjectId(mentionedUserId),
              'task_mentioned',
              'You were mentioned',
              `${authReq.user.fullName} mentioned you in a comment on "${task.title}"`,
              new Types.ObjectId(taskId),
              project._id as Types.ObjectId
            );

            authReq.io.to(mentionedUserId).emit('notification', {
              type: 'task_mentioned',
              message: `${authReq.user.fullName} mentioned you in a comment`
            });
          }
        }
      }

      // Notify task assignee about new comment (if not the commenter)
      if (task.assignee && !toObjectId(task.assignee).equals(authReq.user._id)) {
        await createNotification(
          toObjectId(task.assignee),
          'comment_added',
          'New comment on your task',
          `${authReq.user.fullName} commented on "${task.title}"`,
          new Types.ObjectId(taskId),
          project._id as Types.ObjectId
        );
      }

      authReq.io.to(`project:${project._id.toString()}`).emit('newComment', {
        taskId,
        comment
      });

      res.status(201).json({ success: true, message: 'Comment created successfully', data: comment });
    } catch (error) {
      console.error('Create comment error:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// @route   PUT api/comments/:id
// @desc    Update comment
// @access  Private
router.put(
  '/:id',
  [body('content').trim().isLength({ min: 1, max: 2000 })],
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
        return;
      }

      const comment = await Comment.findById(req.params.id)
        .populate('author', '_id')
        .populate('task', 'project');

      if (!comment) {
        res.status(404).json({ success: false, message: 'Comment not found' });
        return;
      }

      const authorId = toObjectId(comment.author);
      if (!authorId.equals(authReq.user._id)) {
        res.status(403).json({ success: false, message: 'You can only edit your own comments' });
        return;
      }

      comment.content = (req.body as UpdateCommentRequest).content;
      (comment as any).isEdited = true;
      (comment as any).editedAt = new Date();

      await comment.save();
      await comment.populate('author', 'firstName lastName avatar');

      res.json({ success: true, message: 'Comment updated successfully', data: comment });
    } catch (error) {
      console.error('Update comment error:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// @route   DELETE api/comments/:id
// @desc    Delete comment
// @access  Private
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;

  try {
    const comment = await Comment.findById(req.params.id)
      .populate('author', '_id')
      .populate('task', 'project');

    if (!comment) {
      res.status(404).json({ success: false, message: 'Comment not found' });
      return;
    }

    const task = comment.task as ITask;
    await task.populate('project', 'owner');
    const project = task.project as IProject;

    const isAuthor = toObjectId(comment.author).equals(authReq.user._id);
    const isProjectOwner = toObjectId(project.owner).equals(authReq.user._id);

    if (!isAuthor && !isProjectOwner) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    await comment.deleteOne();

    res.json({ success: true, message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
