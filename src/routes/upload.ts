import express, { Router, Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';

const router: Router = express.Router();

// Load and validate env
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  throw new Error('Missing Cloudinary environment variables');
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret
});


// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter function
const fileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback): void => {
  const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|xlsx|xls|ppt|pptx/;
  const extname = allowedTypes.test(file.originalname.toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed types: images, PDF, DOC, DOCX, TXT, XLSX, XLS, PPT, PPTX'));
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter
});

interface CloudinaryUploadResult {
  secure_url: string;
  public_id: string;
  original_filename?: string;
  bytes: number;
  format: string;
  resource_type: string;
}

// Wrap Cloudinary stream upload in a Promise
const uploadToCloudinary = (fileBuffer: Buffer, folder: string, options: any = {}): Promise<CloudinaryUploadResult> => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        use_filename: true,
        unique_filename: true,
        ...options
      },
      (error, result) => {
        if (error || !result) {
          reject(error);
        } else {
          resolve(result as CloudinaryUploadResult);
        }
      }
    ).end(fileBuffer);
  });
};

// @route   POST api/upload/single
// @desc    Upload single file
// @access  Private
router.post(
  '/single',
  authenticate,
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    try {
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No file provided' });
        return;
      }

      const result = await uploadToCloudinary(req.file.buffer, 'devboard/attachments');

      res.json({
        success: true,
        message: 'File uploaded successfully',
        data: {
          url: result.secure_url,
          publicId: result.public_id,
          filename: result.original_filename || req.file.originalname,
          originalName: req.file.originalname,
          size: result.bytes,
          mimeType: req.file.mimetype,
          format: result.format,
          resourceType: result.resource_type,
          uploadedBy: authReq.user._id,
          uploadedAt: new Date()
        }
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Upload failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// @route   POST api/upload/multiple
// @desc    Upload multiple files
// @access  Private
router.post(
  '/multiple',
  authenticate,
  upload.array('files', 5),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    try {
      const files = (req.files as Express.Multer.File[]) ?? [];

      if (!files || files.length === 0) {
        res.status(400).json({ success: false, message: 'No files provided' });
        return;
      }

      const results = await Promise.all(files.map(file => uploadToCloudinary(file.buffer, 'devboard/attachments')));

    const uploadedFiles = results.map((result, index) => {
    const file = files[index]!;
    return {
        url: result.secure_url,
        publicId: result.public_id,
        filename: result.original_filename || file.originalname,
        originalName: file.originalname,
        size: result.bytes,
        mimeType: file.mimetype,
        format: result.format,
        resourceType: result.resource_type,
        uploadedBy: authReq.user._id,
        uploadedAt: new Date()
    };
    });

      res.json({
        success: true,
        message: `${uploadedFiles.length} files uploaded successfully`,
        data: uploadedFiles
      });
    } catch (error) {
      console.error('Multiple upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Upload failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// @route   DELETE api/upload/:publicId
// @desc    Delete file from Cloudinary
// @access  Private
router.delete('/:publicId', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const publicId = req.params.publicId; // Express guarantees string
        if (!publicId) {
      res.status(400).json({ success: false, message: 'No publicId provided' });
      return;
    }

    const decodedPublicId = decodeURIComponent(publicId);

    const result = await cloudinary.uploader.destroy(decodedPublicId);

    if ((result as any).result === 'ok') {
      res.json({ success: true, message: 'File deleted successfully' });
    } else {
      res.status(404).json({ success: false, message: 'File not found or already deleted' });
    }
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// @route   POST api/upload/avatar
// @desc    Upload user avatar
// @access  Private
router.post(
  '/avatar',
  authenticate,
  upload.single('avatar'),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    try {
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No avatar file provided' });
        return;
      }

      if (!req.file.mimetype.startsWith('image/')) {
        res.status(400).json({ success: false, message: 'Avatar must be an image file' });
        return;
      }

      // Delete existing avatar if exists
      if (authReq.user.avatar?.publicId) {
        try {
          await cloudinary.uploader.destroy(authReq.user.avatar.publicId);
        } catch (error) {
          console.error('Failed to delete old avatar:', error);
        }
      }

      const result = await uploadToCloudinary(req.file.buffer, 'devboard/avatars', {
        transformation: [
          { width: 200, height: 200, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' }
        ],
        use_filename: false,
        unique_filename: true
      });

      authReq.user.avatar = {
        url: result.secure_url,
        publicId: result.public_id
      };
      await authReq.user.save();

      res.json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          url: result.secure_url,
          publicId: result.public_id
        }
      });
    } catch (error) {
      console.error('Avatar upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Avatar upload failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

export default router;
