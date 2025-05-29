export interface Message {
  conversationId: number,
  messageId: number,
  senderId: number,
  content: string,
  sentAt: string,
  isRead: number,
  file: {
    fileName: string,
    fileUrl: string,
    fileExpansion: string,
    duration: number
    progress?: number;
  }
}
