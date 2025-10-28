import nodemailer from 'nodemailer';

// Create email transporter
const createTransporter = () => {
  // Using Gmail as example - you can use any email service
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD, // Use App Password for Gmail
    },
  });
};

/**
 * Send notification email to site owner about new submission
 */
export async function sendOwnerNotification(submissionData) {
  try {
    const transporter = createTransporter();

    const { artist_name, email, submission_type, payment_amount, content, youtube_url, spotify_url } = submissionData;

    const submissionTypeLabel = submission_type === 'featured' ? '🏆 Featured Article' : '📰 Regular Article';
    const amount = (payment_amount / 100).toFixed(2); // Convert cents to dollars

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.OWNER_EMAIL, // Your email
      subject: `🎵 New Music Submission - ${submissionTypeLabel} - ${artist_name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
            <h1 style="margin: 0;">🎵 New Music Submission!</h1>
          </div>

          <div style="padding: 30px; background: #f9f9f9;">
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #667eea; margin-top: 0;">${submissionTypeLabel}</h2>
              <p style="font-size: 18px; color: #28a745; font-weight: bold;">Payment: $${amount}</p>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">Artist Information</h3>
              <p><strong>Artist Name:</strong> ${artist_name}</p>
              <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">Submission Content</h3>
              <p style="white-space: pre-wrap; line-height: 1.6;">${content}</p>
            </div>

            ${youtube_url ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">🎥 YouTube Link</h3>
              <p><a href="${youtube_url}" style="color: #667eea;">${youtube_url}</a></p>
            </div>
            ` : ''}

            ${spotify_url ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">🎵 Spotify Link</h3>
              <p><a href="${spotify_url}" style="color: #667eea;">${spotify_url}</a></p>
            </div>
            ` : ''}

            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
              <p style="margin: 0; color: #856404;">
                <strong>Action Required:</strong> Review this submission and publish the article from your admin dashboard.
              </p>
            </div>
          </div>

          <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
            <p>This is an automated notification from Cry808</p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log('✅ Owner notification email sent successfully');
  } catch (error) {
    console.error('❌ Error sending owner notification email:', error.message);
    // Don't throw error - submission should still succeed even if email fails
  }
}

/**
 * Send confirmation email to customer
 */
export async function sendCustomerConfirmation(submissionData) {
  try {
    const transporter = createTransporter();

    const { artist_name, email, submission_type, payment_amount } = submissionData;

    const submissionTypeLabel = submission_type === 'featured' ? '🏆 Featured Article' : '📰 Regular Article';
    const amount = (payment_amount / 100).toFixed(2);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `🎉 Submission Received - ${artist_name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
            <h1 style="margin: 0;">🎉 Thank You, ${artist_name}!</h1>
          </div>

          <div style="padding: 30px; background: #f9f9f9;">
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #667eea; margin-top: 0;">Submission Confirmed</h2>
              <p style="font-size: 16px; line-height: 1.6;">
                Your music submission has been successfully received and your payment of <strong>$${amount}</strong> has been processed.
              </p>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">What You Purchased</h3>
              <p style="font-size: 18px; margin: 0;">${submissionTypeLabel}</p>
              ${submission_type === 'featured' ? `
              <p style="color: #28a745; margin-top: 10px;">
                ⭐ Your article will be featured on the homepage hero section for maximum visibility!
              </p>
              ` : ''}
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">What Happens Next?</h3>
              <ul style="line-height: 1.8;">
                <li>Our editorial team will review your submission</li>
                <li>You'll receive a decision within <strong>5-7 business days</strong></li>
                <li>If approved, your article will be published on Cry808</li>
                <li>We'll notify you via email once it's live</li>
              </ul>
            </div>

            <div style="background: #d1ecf1; padding: 15px; border-radius: 8px; border-left: 4px solid #0c5460;">
              <p style="margin: 0; color: #0c5460;">
                <strong>Questions?</strong> Reply to this email and we'll get back to you as soon as possible.
              </p>
            </div>
          </div>

          <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
            <p>Thank you for submitting to Cry808!</p>
            <p><a href="https://cry808.vercel.app" style="color: #667eea; text-decoration: none;">Visit Cry808</a></p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log('✅ Customer confirmation email sent successfully');
  } catch (error) {
    console.error('❌ Error sending customer confirmation email:', error.message);
    // Don't throw error - submission should still succeed even if email fails
  }
}
