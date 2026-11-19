import nodemailer from 'nodemailer'

export async function sendPasswordReset(email: string, link: string): Promise<boolean> {
  const host = process.env.SMTP_HOST?.trim()
  const from = process.env.SMTP_FROM?.trim()
  if (!host || !from) return false
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === '465',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  })
  await transporter.sendMail({
    to: email,
    from,
    subject: 'Set a new password',
    text: `A new password was requested for your budget account.\n\nSet a new password. The link is valid for 2 hours:\n${link}\n\nIf you did not ask for this, you can ignore this email.\n`,
  })
  return true
}

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim())
}
