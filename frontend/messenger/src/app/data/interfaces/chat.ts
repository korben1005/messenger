export interface Chat {
  conversationId: number,
  otherUserId: number,
  username: string,
  avatarUrl: string,
  lastMessage: string,
  lastMessageTime: string,
  unreadCount: number
}
