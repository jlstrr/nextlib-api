import nodemailer from "nodemailer";
import dotenv from 'dotenv';
dotenv.config();

const createTransport = () => {
  // Prefer explicit SMTP configuration via environment variables
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;

  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE === 'true' || Number(SMTP_PORT) === 465, // true for 465, false for other ports
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }

  // Fallback: jsonTransport will not actually deliver email but will return JSON of the message
  // This is handy for development when SMTP is not set up.
  return nodemailer.createTransport({ jsonTransport: true });
};

const transporter = createTransport();

// Verify transporter connection at startup (non-blocking)
// Use callback style because some transports (or older nodemailer versions)
// may not return a Promise from verify(), causing `.then` to be undefined.
if (typeof transporter.verify === "function") {
  try {
    transporter.verify((err, success) => {
      if (err) {
        console.error("Mailer: SMTP verification failed:", err && err.message ? err.message : err);
      } else {
        console.log("Mailer: SMTP connection verified successfully");
      }
    });
  } catch (err) {
    console.error("Mailer: verify call threw an error:", err && err.message ? err.message : err);
  }
} else {
  // transporter has no verify method
  console.warn("Mailer: transporter.verify is not available");
}

export async function sendMail(to, subject, html, text) {
  const from = process.env.FROM_EMAIL || process.env.SMTP_USER || `no-reply@${process.env.APP_DOMAIN || 'localhost'}`;

  const mailOptions = {
    from,
    to,
    subject,
    text: text || html.replace(/<[^>]+>/g, ''),
    html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    // If using jsonTransport, `info` will contain message data — log for debugging
    if (process.env.NODE_ENV !== 'production') console.log('Email sent (info):', info);
    return info;
  } catch (err) {
    console.error('Failed to send email:', err);
    throw err;
  }
}

export default sendMail;
