// src/services/emailService.ts
import nodemailer from 'nodemailer';
import { IUser, IProject } from '../types';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' }); // path relative to project root

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

class EmailService {
  private transporter!: nodemailer.Transporter;

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const config: EmailConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASSWORD || ''
      }
    };

    this.transporter = nodemailer.createTransport(config);

    // Verify connection
    this.transporter.verify((error, success) => {
         console.log('Config used:', config);
      if (error) {
        console.error('Email transporter verification failed:', error);
      } else {
        console.log('Email transporter is ready to send messages');
      }
    });
  }

  async sendProjectInvitation(
    email: string,
    inviterName: string,
    projectName: string,
    projectKey: string,
    inviteToken: string
  ): Promise<boolean> {
    try {
      const inviteUrl = `${process.env.FRONTEND_URL}/invite/${inviteToken}`;
      
      const mailOptions = {
        from: {
          name: 'DevBoard',
          address: process.env.SMTP_FROM || process.env.SMTP_USER || ''
        },
        to: email,
        subject: `Invitation to join ${projectName} on DevBoard`,
        html: this.getProjectInvitationTemplate(
          inviterName,
          projectName,
          projectKey,
          inviteUrl
        )
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Project invitation sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send project invitation:', error);
      return false;
    }
  }

  async sendTaskAssignmentNotification(
    assigneeEmail: string,
    assigneeName: string,
    assignerName: string,
    taskTitle: string,
    taskId: string,
    projectName: string
  ): Promise<boolean> {
    try {
      const taskUrl = `${process.env.FRONTEND_URL}/tasks/${taskId}`;
      
      const mailOptions = {
        from: {
          name: 'DevBoard',
          address: process.env.SMTP_FROM || process.env.SMTP_USER || ''
        },
        to: assigneeEmail,
        subject: `New task assigned: ${taskTitle}`,
        html: this.getTaskAssignmentTemplate(
          assigneeName,
          assignerName,
          taskTitle,
          projectName,
          taskUrl
        )
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Task assignment notification sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send task assignment notification:', error);
      return false;
    }
  }

  async sendPasswordResetEmail(
    email: string,
    userName: string,
    resetToken: string
  ): Promise<boolean> {
    try {
      const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
      
      const mailOptions = {
        from: {
          name: 'DevBoard',
          address: process.env.SMTP_FROM || process.env.SMTP_USER || ''
        },
        to: email,
        subject: 'Password Reset Request',
        html: this.getPasswordResetTemplate(userName, resetUrl)
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Password reset email sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      return false;
    }
  }

  private getProjectInvitationTemplate(
    inviterName: string,
    projectName: string,
    projectKey: string,
    inviteUrl: string
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Project Invitation</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f9fafb; }
          .container { max-width: 600px; margin: 0 auto; background-color: white; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 600; }
          .content { padding: 40px 30px; }
          .invitation-box { background-color: #f8fafc; border: 2px solid #e2e8f0; border-radius: 8px; padding: 30px; margin: 20px 0; text-align: center; }
          .project-name { font-size: 24px; font-weight: 600; color: #1a202c; margin: 10px 0; }
          .project-key { background-color: #e2e8f0; color: #4a5568; padding: 5px 10px; border-radius: 4px; font-family: monospace; font-size: 14px; }
          .btn { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 15px 30px; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .btn:hover { opacity: 0.9; }
          .footer { background-color: #f7fafc; padding: 20px 30px; text-align: center; color: #718096; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚀 DevBoard</h1>
          </div>
          <div class="content">
            <h2>You've been invited to join a project!</h2>
            <p><strong>${inviterName}</strong> has invited you to collaborate on a project.</p>
            
            <div class="invitation-box">
              <div class="project-name">${projectName}</div>
              <div class="project-key">${projectKey}</div>
              <a href="${inviteUrl}" class="btn">Accept Invitation</a>
            </div>
            
            <p>Click the button above to accept the invitation and join the project. You'll be able to view tasks, collaborate with team members, and contribute to the project's success.</p>
            
            <p><small>If you can't click the button, copy and paste this link into your browser:<br>
            <a href="${inviteUrl}">${inviteUrl}</a></small></p>
          </div>
          <div class="footer">
            <p>This invitation was sent by DevBoard. If you didn't expect this invitation, you can safely ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getTaskAssignmentTemplate(
    assigneeName: string,
    assignerName: string,
    taskTitle: string,
    projectName: string,
    taskUrl: string
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Task Assignment</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f9fafb; }
          .container { max-width: 600px; margin: 0 auto; background-color: white; }
          .header { background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); padding: 40px 30px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 600; }
          .content { padding: 40px 30px; }
          .task-box { background-color: #f0fff4; border: 2px solid #9ae6b4; border-radius: 8px; padding: 30px; margin: 20px 0; }
          .task-title { font-size: 20px; font-weight: 600; color: #1a202c; margin: 10px 0; }
          .project-name { color: #4a5568; font-size: 16px; }
          .btn { display: inline-block; background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); color: white; text-decoration: none; padding: 15px 30px; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .btn:hover { opacity: 0.9; }
          .footer { background-color: #f7fafc; padding: 20px 30px; text-align: center; color: #718096; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📋 New Task Assigned</h1>
          </div>
          <div class="content">
            <p>Hi ${assigneeName},</p>
            <p><strong>${assignerName}</strong> has assigned a new task to you.</p>
            
            <div class="task-box">
              <div class="task-title">${taskTitle}</div>
              <div class="project-name">Project: ${projectName}</div>
              <a href="${taskUrl}" class="btn">View Task</a>
            </div>
            
            <p>Click the button above to view the task details and get started. You can track progress, add comments, and collaborate with your team members.</p>
            
            <p><small>If you can't click the button, copy and paste this link into your browser:<br>
            <a href="${taskUrl}">${taskUrl}</a></small></p>
          </div>
          <div class="footer">
            <p>This notification was sent by DevBoard. You can manage your notification preferences in your account settings.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getPasswordResetTemplate(userName: string, resetUrl: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f9fafb; }
          .container { max-width: 600px; margin: 0 auto; background-color: white; }
          .header { background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%); padding: 40px 30px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 600; }
          .content { padding: 40px 30px; }
          .reset-box { background-color: #fffaf0; border: 2px solid #fbd38d; border-radius: 8px; padding: 30px; margin: 20px 0; text-align: center; }
          .btn { display: inline-block; background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%); color: white; text-decoration: none; padding: 15px 30px; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .btn:hover { opacity: 0.9; }
          .footer { background-color: #f7fafc; padding: 20px 30px; text-align: center; color: #718096; font-size: 14px; }
          .warning { background-color: #fed7d7; color: #c53030; padding: 15px; border-radius: 6px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Password Reset</h1>
          </div>
          <div class="content">
            <p>Hi ${userName},</p>
            <p>You requested a password reset for your DevBoard account. Click the button below to create a new password.</p>
            
            <div class="reset-box">
              <a href="${resetUrl}" class="btn">Reset Password</a>
            </div>
            
            <div class="warning">
              <strong>Security Notice:</strong> This link will expire in 1 hour for your security. If you didn't request this reset, please ignore this email.
            </div>
            
            <p><small>If you can't click the button, copy and paste this link into your browser:<br>
            <a href="${resetUrl}">${resetUrl}</a></small></p>
          </div>
          <div class="footer">
            <p>This email was sent by DevBoard. If you didn't request a password reset, please contact support.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

export default new EmailService();