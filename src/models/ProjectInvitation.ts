// src/models/ProjectInvitation.ts
import mongoose, { Schema } from 'mongoose';
import { IProjectInvitation } from '../types';

const projectInvitationSchema = new Schema<IProjectInvitation>({
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  project: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  invitedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'member', 'viewer'],
    default: 'member'
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'expired'],
    default: 'pending'
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  },
  acceptedAt: Date,
  acceptedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for efficient queries
projectInvitationSchema.index({ token: 1 });
projectInvitationSchema.index({ email: 1, project: 1 });
projectInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Clean up expired invitations
projectInvitationSchema.index({ 
  expiresAt: 1 
}, { 
  expireAfterSeconds: 0,
  partialFilterExpression: { status: 'pending' }
});

export default mongoose.model<IProjectInvitation>('ProjectInvitation', projectInvitationSchema);