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
function typeLabel(type) {
  if (type === 'priority') return '⚡ Priority (Skip the Line)';
  if (type === 'featured') return '🏆 Featured Article';
  if (type === 'genius')   return '📝 Genius Lyrics';
  if (type === 'free')     return '📬 Free Submission';
  return '📰 Regular Article';
}

export async function sendOwnerNotification(submissionData) {
  try {
    const transporter = createTransporter();

    const {
      artist_name, email, title, submission_type, payment_amount, content,
      youtube_url, spotify_url, soundcloud_url, apple_music_url,
      instagram_url, genre, image_url, document_url,
      genius_song_url, genius_lyrics,
    } = submissionData;

    const submissionTypeLabel = typeLabel(submission_type);
    const amount = payment_amount > 0 ? `$${(payment_amount / 100).toFixed(2)}` : 'Free';

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
              <p style="font-size: 18px; color: #28a745; font-weight: bold;">Payment: ${amount}</p>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">Artist Information</h3>
              <p><strong>Artist Name:</strong> ${artist_name}</p>
              <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">Article Title</h3>
              <p style="font-size: 18px; font-weight: bold; color: #667eea;">${title}</p>
            </div>

            ${content ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">Submission Content</h3>
              <p style="white-space: pre-wrap; line-height: 1.6;">${content}</p>
            </div>
            ` : ''}

            ${document_url ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">📄 Submitted Document</h3>
              <p style="margin-bottom: 10px;">The artist uploaded a document file with their content:</p>
              <a href="${document_url}" style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
                📥 Download Document
              </a>
              <p style="margin-top: 10px; font-size: 12px; color: #666;">
                <a href="${document_url}" style="color: #667eea; word-break: break-all;">${document_url}</a>
              </p>
            </div>
            ` : ''}

            ${image_url ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">📸 Submitted Image</h3>
              <img src="${image_url}" alt="Submission image" style="max-width: 100%; height: auto; border-radius: 8px;" />
              <p style="margin-top: 10px;"><a href="${image_url}" style="color: #667eea;">View Full Size</a></p>
            </div>
            ` : ''}

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

            ${soundcloud_url ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">☁️ SoundCloud Link</h3>
              <p><a href="${soundcloud_url}" style="color: #667eea;">${soundcloud_url}</a></p>
            </div>
            ` : ''}

            ${apple_music_url ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">🍎 Apple Music Link</h3>
              <p><a href="${apple_music_url}" style="color: #667eea;">${apple_music_url}</a></p>
            </div>
            ` : ''}

            ${instagram_url ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">📸 Instagram</h3>
              <p>${instagram_url}</p>
            </div>
            ` : ''}

            ${genre ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">🎶 Genre</h3>
              <p>${genre}</p>
            </div>
            ` : ''}

            ${genius_song_url ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">📝 Genius — Song Link</h3>
              <p><a href="${genius_song_url}" style="color: #667eea;">${genius_song_url}</a></p>
            </div>
            ` : ''}

            ${genius_lyrics ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">📝 Submitted Lyrics</h3>
              <pre style="white-space: pre-wrap; line-height: 1.7; font-family: monospace; font-size: 13px; color: #333;">${genius_lyrics}</pre>
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

    const submissionTypeLabel = typeLabel(submission_type);
    const amount = payment_amount > 0 ? `$${(payment_amount / 100).toFixed(2)}` : 'Free';

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
                ${payment_amount > 0
                  ? `Your music submission has been successfully received and your payment of <strong>${amount}</strong> has been processed.`
                  : 'Your free music submission has been successfully received.'}
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
              ${submission_type === 'priority' ? `
              <ul style="line-height: 1.8;">
                <li>You've been moved to the <strong>top of the review queue</strong></li>
                <li>Expect a response within <strong>1–2 business days</strong></li>
                <li>If approved, your article will be published on Cry808</li>
                <li>We'll email you once it's live</li>
              </ul>
              ` : submission_type === 'genius' ? `
              <ul style="line-height: 1.8;">
                <li>We'll find or create your song page on Genius.com</li>
                <li>Your lyrics will be posted within <strong>2–3 business days</strong></li>
                <li>We'll send you the Genius link once it's live</li>
              </ul>
              ` : `
              <ul style="line-height: 1.8;">
                <li>Our editorial team will review your submission</li>
                <li>You'll receive a decision within <strong>5–7 business days</strong></li>
                <li>If approved, your article will be published on Cry808</li>
                <li>We'll notify you via email once it's live</li>
              </ul>
              `}
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
