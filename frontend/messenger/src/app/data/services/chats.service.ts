import { inject, Injectable, signal } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { HttpClient } from '@angular/common/http';
import { Chat } from '../interfaces/chat';
import { Message } from '../interfaces/message';
import { AuthService } from '../../authentication/auth.service';

@Injectable({
  providedIn: 'root'
})
export class ChatsService {
  socket$: WebSocketSubject<any> = webSocket('wss://localhost:3000');
  apiUrl = 'https://localhost:3000/'
  http = inject(HttpClient)
  authService = inject(AuthService)
  chats: Chat[] = [];
  messages: Message[] = [];
  token = this.authService.token
  openFileWindow = signal<boolean> (false)
  fileArr = signal<(string | File)[]> ([])

  startTokenRefresh() {
    const refreshInterval = 13 * 60 * 1000; // Обновление токена каждые 13 минут (до истечения 15 минут)

    setInterval(() => {
      this.authService.refreshAuthToken()
        .subscribe({
          next: (response) => {
            this.token = response.token; // Обновляем токен
            console.log('Токен обновлен:', this.token);
          },
          error: (err) => {
            console.error('Ошибка обновления токена:', err);
          },
        });
    }, refreshInterval);
  }

  authenticate() {
    this.socket$.next({ type: 'authenticate', token: this.token });
  }
  // Получение всех чатов
  getChats() {
    return this.http.get<Chat[]>(`${this.apiUrl}chats`);
  }

  // Получение сообщений конкретного чата
  getMessages(conversationId: number) {
    return this.http.get<Message[]>(`${this.apiUrl}chats/${conversationId}/messages`);
  }

  chatCheck(otherUserId: number) {
    return this.http.post<{ conversationId: number }>(`${this.apiUrl}chats/checkExistence`, {otherUserId: otherUserId });
  }

  // Отправка нового сообщения через WebSocket
  sendMessage(message: any) {
    this.socket$.next({ type: 'newMessage', ...message });
  }

  readingChatMes(reading: {conversationId: number, userId: number}) {
    this.socket$.next({ type: 'readingChat', ...reading});
  }

  // Отправка нового сообщения через WebSocket
  newChat(chat: {userIds: number[]}) {
    this.socket$.next({ type: 'newChat', ...chat });
  }

  deleteChat(conversationId: number){
    return this.http.delete<{success: boolean, message: string}>(`${this.apiUrl}chats/${conversationId}`);
  }

  // Получение данных из WebSocket
  onMessage() {
    return this.socket$;
  }

  // Проверка уже загруженных фрагментов
  checkChunks(conversationId: number, fileName: string){
    return this.http.get<any>(`${this.apiUrl}chats/${conversationId}/check-chunks`, {params: { fileName }});
  }

  uploadChunk(conversationId: number, formData: FormData) {
    return this.http.post(`${this.apiUrl}chats/${conversationId}/upload-chunk`, formData);
  }

  // Завершение загрузки
  completeUpload(conversationId: number, fileName: string, totalChunks: number) {
    return this.http.post(`${this.apiUrl}chats/${conversationId}/complete-upload`, {fileName, totalChunks});
  }
}
