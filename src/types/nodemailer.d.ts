declare module 'nodemailer' {
  export interface SendMailOptions {
    to: string
    from: string
    subject: string
    text: string
  }
  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<unknown>
  }
  export interface TransportOptions {
    host: string
    port: number
    secure?: boolean
    auth?: { user: string; pass: string }
  }
  export function createTransport(options: TransportOptions): Transporter
  const nodemailer: { createTransport: typeof createTransport }
  export default nodemailer
}
