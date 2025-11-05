import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

// Verify Resend API key at startup (non-blocking)
if (!process.env.RESEND_API_KEY) {
  console.error("Mailer: RESEND_API_KEY is not configured");
} else {
  console.log("Mailer: Resend API key configured successfully");
}

export async function sendMail(to, subject, html, text) {
  const from = process.env.FROM_EMAIL || 'noreply@nextlib.com';

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not configured');
    throw new Error('Email service not configured');
  }

  const emailData = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ''),
  };

  try {
    const { data, error } = await resend.emails.send(emailData);
    
    if (error) {
      console.error('Resend error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('Email sent successfully via Resend:', data);
    }
    
    return data;
  } catch (err) {
    console.error('Failed to send email:', err);
    throw err;
  }
}

export default sendMail;
