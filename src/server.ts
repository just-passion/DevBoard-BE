// src/server.ts - Updated version
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import connectDB from './config/database';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import taskRoutes from './routes/tasks';
import commentRoutes from './routes/comments';
import notificationRoutes from './routes/notifications';
import invitationRoutes from './routes/invitations';
import uploadRoutes from './routes/upload';
import { errorHandler } from './middleware/errorHandler';
import { setupSocket } from './socket/socketManager';
import { AuthenticatedRequest } from './types';

dotenv.config();

console.log('SMTP_USER:', process.env.SMTP_USER);
console.log('SMTP_PASSWORD length:', process.env.SMTP_PASSWORD?.length);
console.log('SMTP_SECURE:', process.env.SMTP_SECURE);
console.log('SMTP_PORT:', process.env.SMTP_PORT);

const app: Application = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Connect to MongoDB
connectDB();

// Security middleware
app.use(helmet());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/api/', limiter);

// CORS configuration
app.use(cors({
   origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
  allowedHeaders: ['Content-Type','Authorization'],
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Make io available to all routes
app.use((req: Request, res: Response, next: NextFunction) => {
  (req as AuthenticatedRequest).io = io;
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/upload', uploadRoutes);

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    message: 'DevBoard API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Email service health check
app.get('/api/health/email', (req: Request, res: Response) => {
  const emailConfig = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE,
    user: process.env.SMTP_USER ? '***configured***' : 'not configured'
  };

  res.status(200).json({
    status: 'OK',
    message: 'Email service configuration',
    config: emailConfig
  });
});

// 404 handler for API routes
app.use(/^\/api\/.*/, (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

// Error handling middleware
app.use(errorHandler);

// Socket.IO setup
setupSocket(io);

const PORT: number = parseInt(process.env.PORT || '5000', 10);

server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📧 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Log email configuration status
  const emailConfigured = !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD
  );
  console.log(`📧 Email service: ${emailConfigured ? '✅ Configured' : '❌ Not configured'}`);
  
  if (!emailConfigured) {
    console.log('⚠️  Email invitations will not work. Please configure SMTP settings:');
    console.log('   - SMTP_HOST');
    console.log('   - SMTP_PORT');
    console.log('   - SMTP_USER');
    console.log('   - SMTP_PASSWORD');
    console.log('   - SMTP_FROM (optional)');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});