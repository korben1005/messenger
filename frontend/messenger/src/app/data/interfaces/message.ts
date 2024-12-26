export interface Message {
  messageId: number,
  senderId: number,
  content: string,
  sentAt: string,
  isRead: number,
  file: {
    fileName: string,
    fileUrl: string,
    fileExpansion: string
  }
}
