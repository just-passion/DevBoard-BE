import { Document, Types } from 'mongoose';
import type { Request } from 'express';
import { Server } from 'socket.io';
import 'socket.io';

// types/socket.d.ts (or inside your types/index.d.ts)
declare module 'socket.io' {
  interface Socket {
    user?: SocketUser; // make it optional initially
  }
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  avatar?: {
    url: string;
    publicId: string;
  };
  bio?: string;
  role: 'admin' | 'manager' | 'developer';
  oAuthProviders: Array<{
    provider: 'github' | 'google';
    providerId: string;
    email: string;
  }>;
  preferences: {
    theme: 'light' | 'dark' | 'system';
    notifications: {
      email: boolean;
      push: boolean;
      mentions: boolean;
      taskUpdates: boolean;
    };
  };
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  isEmailVerified: boolean;
  emailVerificationToken?: string;
  lastActiveAt: Date;
  isActive: boolean;
  fullName: string;
  comparePassword(candidatePassword: string): Promise<boolean>;
  updateLastActive(): Promise<IUser>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProject extends Document {
  _id: Types.ObjectId;
  name: string;
  key: string;
  description?: string;
  owner: Types.ObjectId | IUser;
  members: Array<{
    user: Types.ObjectId | IUser;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    joinedAt: Date;
  }>;
  status: 'planning' | 'active' | 'on-hold' | 'completed' | 'archived';
  taskCounts: {
    total: number;
    todo: number;
    inProgress: number;
    review: number;
    done: number;
  };
  settings: {
    isPublic: boolean;
    allowGuestView: boolean;
    taskPrefix: string;
  };
  totalTasks: number;
  updateTaskCounts(): Promise<IProject>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITask extends Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  taskNumber: number;
  taskId: string;
  project: Types.ObjectId | IProject;
  assignee: Types.ObjectId | IUser | undefined;
  reporter: Types.ObjectId | IUser;
  status: 'todo' | 'in-progress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'critical';
  tags: string[];
  dueDate?: Date;
  estimatedHours?: number;
  loggedHours: number;
  attachments: Array<{
    _id: Types.ObjectId;
    filename: string;
    originalName: string;
    url: string;
    publicId?: string;
    size: number;
    mimeType: string;
    uploadedBy: Types.ObjectId | IUser;
    uploadedAt: Date;
  }>;
  statusHistory: Array<{
    status: string;
    changedBy: Types.ObjectId | IUser;
    changedAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IComment extends Document {
  _id: Types.ObjectId;
  content: string;
  author: Types.ObjectId | IUser;
  task: Types.ObjectId | ITask;
  parentComment?: Types.ObjectId | IComment;
  mentions: Array<Types.ObjectId | IUser>;
  isEdited: boolean;
  editedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface INotification extends Document {
  _id: Types.ObjectId;
  recipient: Types.ObjectId | IUser;
  type: 'task_assigned' | 'task_mentioned' | 'task_status_changed' | 'comment_added' | 'project_invited' | 'due_date_reminder';
  title: string;
  message: string;
  relatedTask?: Types.ObjectId | ITask;
  relatedProject?: Types.ObjectId | IProject;
  relatedUser?: Types.ObjectId | IUser;
  isRead: boolean;
  readAt?: Date;
  actionUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticatedRequest<
  P = any,
  ResBody = any,
  ReqBody = any,
  ReqQuery = any
> extends Request<P, ResBody, ReqBody, ReqQuery> {
  user: IUser;
  io: Server;
}

export interface SocketUser {
  _id: Types.ObjectId;
  email: string;
  fullName: string;
}

export interface AuthenticatedSocket {
  user: SocketUser;
  join: (room: string) => void;
  leave: (room: string) => void;
  to: (room: string) => any;
  emit: (event: string, data: any) => void;
  on: (event: string, callback: Function) => void;
  handshake: {
    auth: {
      token?: string;
    };
  };
}