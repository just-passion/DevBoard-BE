import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import User from '../models/User';
import { SocketUser } from '../types';

interface JWTPayload {
  userId: string;
}

export const setupSocket = (io: Server): void => {
  // Authentication middleware for socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
      const user = await User.findById(decoded.userId);

      if (!user) {
        return next(new Error('User not found'));
      }

      // thanks to module augmentation, this is now type-safe
      socket.user = {
        _id: user._id,
        email: user.email,
        fullName: user.fullName
      } as SocketUser;

      socket.join(user._id.toString()); // Join user to their own room
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    // .user is now typed
    console.log(`User ${socket.user?.email} connected`);

    socket.on('joinProject', (projectId: string) => {
      socket.join(`project:${projectId}`);
      console.log(`User ${socket.user?.email} joined project ${projectId}`);
    });

    socket.on('leaveProject', (projectId: string) => {
      socket.leave(`project:${projectId}`);
      console.log(`User ${socket.user?.email} left project ${projectId}`);
    });

    socket.on('taskUpdate', (data: { projectId: string; task: any }) => {
      socket.to(`project:${data.projectId}`).emit('taskUpdated', data);
    });

    socket.on('typing', (data: { projectId: string; taskId: string }) => {
      socket.to(`project:${data.projectId}`).emit('userTyping', {
        userId: socket.user?._id,
        userName: socket.user?.fullName,
        taskId: data.taskId
      });
    });

    socket.on('stopTyping', (data: { projectId: string; taskId: string }) => {
      socket.to(`project:${data.projectId}`).emit('userStoppedTyping', {
        userId: socket.user?._id,
        taskId: data.taskId
      });
    });

    socket.on('disconnect', () => {
      console.log(`User ${socket.user?.email} disconnected`);
    });
  });
};
