import mongoose, { Model, Schema } from 'mongoose';
import { ITask, IProject } from '../types';

const taskSchema = new Schema<ITask>({
  title: {
    type: String,
    required: [true, 'Task title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    maxlength: [5000, 'Description cannot exceed 5000 characters']
  },
  taskNumber: {
    type: Number,
    required: true
  },
  taskId: {
    type: String,
    required: true,
    unique: true
  },
  project: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  assignee: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  reporter: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['todo', 'in-progress', 'review', 'done'],
    default: 'todo'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  dueDate: Date,
  estimatedHours: {
    type: Number,
    min: 0
  },
  loggedHours: {
    type: Number,
    default: 0,
    min: 0
  },
  attachments: [{
    filename: String,
    originalName: String,
    url: String,
    publicId: String,
    size: Number,
    mimeType: String,
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  statusHistory: [{
    status: String,
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    changedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Generate task ID before saving
taskSchema.pre<ITask>('save', async function(next) {
  if (this.isNew) {
    const Project = mongoose.model<IProject>('Project');
    const project = await Project.findById(this.project);
    
    if (!project) {
      return next(new Error('Project not found'));
    }

    // Get the next task number for this project
    const TaskModel = this.constructor as Model<ITask>;
    const lastTask = await TaskModel
      .findOne({ project: this.project })
      .sort({ taskNumber: -1 });

    this.taskNumber = lastTask ? lastTask.taskNumber + 1 : 1;
    this.taskId = `${project.key}-${this.taskNumber}`;

    // Add to status history
    this.statusHistory.push({
      status: this.status,
      changedBy: this.reporter,
      changedAt: new Date()
    });
  }
  
  next();
});

// Update project task counts after save/remove
taskSchema.post<ITask>('save', async function() {
  const Project = mongoose.model<IProject>('Project');
  const project = await Project.findById(this.project);
  if (project) {
    await project.updateTaskCounts();
  }
});

taskSchema.post<ITask>('deleteOne', async function() {
  const Project = mongoose.model<IProject>('Project');
  const project = await Project.findById(this.project);
  if (project) {
    await project.updateTaskCounts();
  }
});

// Compound indexes
taskSchema.index({ project: 1, taskNumber: 1 }, { unique: true });
taskSchema.index({ taskId: 1 }, { unique: true });
taskSchema.index({ project: 1, status: 1 });
taskSchema.index({ assignee: 1, status: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ updatedAt: -1 });

export default mongoose.model<ITask>('Task', taskSchema);