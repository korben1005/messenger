import { inject, Injectable, signal } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { HttpClient } from '@angular/common/http';
import { Chat } from '../interfaces/chat';
import { Message } from '../interfaces/message';
import { AuthService } from '../../authentication/auth.service';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ChatsService {
  socket$: WebSocketSubject<any> = webSocket('wss://localhost:443');
  apiUrl = 'https://localhost:443/'
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

  formatDuration(duration: number): string {
    if (!duration || duration < 0 || !isFinite(duration)) return '00:00';
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  isImageFile(filePath: string): boolean {
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
    const fileExtension = filePath
    return validExtensions.includes(`.${fileExtension}`)
  }

  isAudioFile(filePath: string): boolean {
    const validExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'];
    const fileExtension = filePath
    return validExtensions.includes(`.${fileExtension}`)
  }

  isVideoFile(filePath: string): boolean {
    const validExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.flv', '.wmv'];
    const fileExtension = filePath
    return validExtensions.includes(`.${fileExtension}`)
  }

  toggleVideo(video: HTMLVideoElement) {
    if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
  }

  toggleAudio(audio: HTMLAudioElement) {
      if (audio.paused) {
        audio.play();
      } else {
        audio.pause();
      }
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
  checkChunks(fileName: string){
    return this.http.get<any>(`${this.apiUrl}chats/check-chunks`, {params: { fileName }});
  }

  uploadChunk(formData: FormData) {
    return this.http.post(`${this.apiUrl}chats/upload-chunk`, formData);
  }

  checkFileArrTypes(item: string | File): item is string {
      return typeof item === 'string';
  }

  sendFiles(file: File): Promise<string> {
    if (!file) {
      alert('Нет файлов для отправки');
      return Promise.resolve('');
    }

    let fileUrl: string | undefined;

    const uploadNextFile = (): Promise<void> => {
      const chunkSize = 1 * 1024 * 1024; // 1MB
      const totalChunks = Math.ceil(file.size / chunkSize);
      const fileName = `${Date.now()}-${file.name}`;
      console.log('Uploading file:', { fileName, fileSize: file.size, totalChunks });

      return lastValueFrom(this.checkChunks(fileName)).then((response) => {
        const uploadedChunks = response.uploadedChunks;
        let chunkIndex = 0;

        const sendNextChunk = (): Promise<void> => {
          if (chunkIndex >= totalChunks) {
            return lastValueFrom(this.completeUpload(fileName, totalChunks)).then((data) => {
              fileUrl = data;
            });
          }

          if (uploadedChunks.includes(chunkIndex)) {
            chunkIndex++;
            return sendNextChunk();
          }

          const start = chunkIndex * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const chunk = file.slice(start, end);
          console.log('Sending chunk:', { chunkIndex, chunkSize: end - start });

          if (!chunk || chunk.size === 0) {
            console.error('Chunk is empty or invalid:', { chunkIndex, chunkSize: end - start });
            return Promise.reject(new Error('Пустой фрагмент'));
          }

          const formData = new FormData();
          formData.set('chunk', chunk, `${fileName}_chunk_${chunkIndex}`);
          formData.set('fileName', fileName);
          formData.set('chunkIndex', chunkIndex.toString());
          formData.set('totalChunks', totalChunks.toString());

          return lastValueFrom(this.uploadChunk(formData)).then(() => {
            chunkIndex++;
            return sendNextChunk();
          });
        };

        return sendNextChunk();
      }).catch((err) => {
        console.error('Ошибка проверки фрагментов:', err);
        alert('Ошибка проверки фрагментов: ' + (err.message || 'Неизвестная ошибка'));
        return Promise.reject(err);
      });
    };

    return uploadNextFile().then(() => {
      if (!fileUrl) {
        return Promise.reject(new Error('Не удалось получить URL файла'));
      }
      return fileUrl;
    });
  }

  removeFile(file: string | File) {
   this.fileArr.update(files => files.filter(f => f !== file));
  }

  // Завершение загрузки
  completeUpload(fileName: string, totalChunks: number) {
    return this.http.post<string>(`${this.apiUrl}chats/complete-upload`, {fileName, totalChunks});
  }
}
