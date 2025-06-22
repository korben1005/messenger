import { File } from "./file";

export interface Message {
  conversationId: number,
  messageId: number,
  senderId: number,
  content: string,
  sentAt: string,
  isRead: number,
  file: File
}
