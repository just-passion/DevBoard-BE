import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import { AuthenticatedRequest, IUser } from '../types';

interface JWTPayload {
  userId: string;
}

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'No token, authorization denied'
      });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Token is not valid'
      });
      return;
    }

    (req as AuthenticatedRequest).user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Token is not valid'
    });
  }
};

export const authorize = (...roles: Array<'admin' | 'manager' | 'developer'>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    
    if (!roles.includes(user.role)) {
      res.status(403).json({
        success: false,
        message: 'Access denied'
      });
      return;
    }
    next();
  };
};