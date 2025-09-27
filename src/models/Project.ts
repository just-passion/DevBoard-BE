import mongoose, { Schema } from 'mongoose';
import { IProject } from '../types';

const projectSchema = new Schema<IProject>({
  name: {
    type: String,
    required: [true, 'Project name is required'],
    trim: true,
    maxlength: [100, 'Project name cannot exceed 100 characters']
  },
  key: {
    type: String,
    required: [true, 'Project key is required'],
    unique: true,
    uppercase: true,
    match: [/^[A-Z]{2,10}$/, 'Project key must be 2-10 uppercase letters']
  },
  description: {
    type: String,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member', 'viewer'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  status: {
    type: String,
    enum: ['planning', 'active', 'on-hold', 'completed', 'archived'],
    default: 'planning'
  },
  taskCounts: {
    total: { type: Number, default: 0 },
    todo: { type: Number, default: 0 },
    inProgress: { type: Number, default: 0 },
    review: { type: Number, default: 0 },
    done: { type: Number, default: 0 }
  },
  settings: {
    isPublic: { type: Boolean, default: false },
    allowGuestView: { type: Boolean, default: false },
    taskPrefix: { type: String, default: 'TASK' }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for total tasks
projectSchema.virtual('totalTasks').get(function(this: IProject) {
  return this.taskCounts.total;
});

// Update task counts method
projectSchema.methods.updateTaskCounts = async function(this: IProject): Promise<IProject> {
  const Task = mongoose.model('Task');
  
  const counts = await Task.aggregate([
    { $match: { project: this._id } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  // Reset counts
  this.taskCounts = {
    total: 0,
    todo: 0,
    inProgress: 0,
    review: 0,
    done: 0
  };

  // Update counts from aggregation
  counts.forEach(item => {
    const statusKey = item._id === 'in-progress' ? 'inProgress' : item._id;
    if (this.taskCounts.hasOwnProperty(statusKey)) {
      this.taskCounts[statusKey as keyof typeof this.taskCounts] = item.count;
      this.taskCounts.total += item.count;
    }
  });

  return this.save();
};

// Indexes
projectSchema.index({ key: 1 });
projectSchema.index({ owner: 1 });
projectSchema.index({ 'members.user': 1 });
projectSchema.index({ status: 1, updatedAt: -1 });

export default mongoose.model<IProject>('Project', projectSchema);
