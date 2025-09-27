import { Request, Response, NextFunction } from 'express';

interface CustomError extends Error {
  statusCode?: number;
  code?: number;
  keyValue?: { [key: string]: any };
  errors?: { [key: string]: { message: string } };
}

export const errorHandler = (err: CustomError, req: Request, res: Response, next: NextFunction): void => {
  console.error('Error:', err);

  let error = { ...err };
  error.message = err.message;

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = {
      ...error,
      message,
      statusCode: 404
    };
  }

  // Mongoose duplicate key
  if (err.code === 11000 && err.keyValue) {
    const field = Object.keys(err.keyValue)[0];
    const message = `${field} already exists`;
    error = {
      ...error,
      message,
      statusCode: 400
    };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError' && err.errors) {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = {
      ...error,
      message,
      statusCode: 400
    };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = {
      ...error,
      message: 'Invalid token',
      statusCode: 401
    };
  }

  if (err.name === 'TokenExpiredError') {
    error = {
      ...error,
      message: 'Token expired',
      statusCode: 401
    };
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Server Error'
  });
};