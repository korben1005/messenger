import { Component, inject, ElementRef, ViewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChatsService } from '../../data/services/chats.service';
import { Message } from '../../data/interfaces/message';
import { Chat } from '../../data/interfaces/chat';
import { ImgUrlPipe } from '../../pipes/img-url.pipe';
import { AuthService } from '../../authentication/auth.service';
import { ProfileService } from '../../data/services/profile.service';
import { catchError } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { FileSizePipe } from '../../pipes/file-size.pipe';
import { FileUrlPipe } from '../../pipes/file-url.pipe';

@Component({
  selector: 'app-chats-page',
  standalone: true,
  imports: [RouterLink, ImgUrlPipe, FormsModule, DatePipe, FileSizePipe, FileUrlPipe],
  templateUrl: './chats-page.component.html',
  styleUrl: './chats-page.component.scss'
})
export class ChatsPageComponent {
  selectedChatId: number | null = null;
  chatService = inject(ChatsService)
  chats: Chat[] = [];
  messages: Message[] = [];
  newMessage: string = '';
  authService = inject(AuthService)
  token: string = ''
  profileService = inject(ProfileService)
  avatarUrl: string = ''
  selectedFiles: File[] = [];
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;


  ngOnInit() {
    this.chatService.startTokenRefresh()
    this.chatService.authenticate()
    this.chatService.getChats().subscribe((data) => {
      this.chats = this.filterAndSortChats(data)
      if(this.profileService.conversationId() !== 0){
        this.selectChat(this.profileService.conversationId())
        this.profileService.conversationId.set(0)
        console.log(this.profileService.conversationId());

      }
      this.profileService.getMe().subscribe()
    })

    // Подписка на WebSocket для обработки новых чатов и сообщений
    this.chatService.onMessage().subscribe((message) => {
      if (message.type === 'newMessage') {
        this.handleNewMessage(message);
      } else if (message.type === 'newChat') {
        this.handleNewChat(message);
      } else if (message.type === 'tokenExpired') {
        this.authService.refreshAuthToken().subscribe((data) => {
          this.token = data.token;
        });
      }
    });
  }

  filterAndSortChats(chats: Chat[]) {
    if (!Array.isArray(chats)) {
      throw new Error('Аргумент должен быть массивом.');
    }

    // Фильтруем чаты, у которых есть lastMessageTime
    const filteredChats = chats.filter(chat => chat.lastMessageTime);


    // Сортируем чаты по lastMessageTime в порядке убывания
    const sortedChats = filteredChats.sort((a, b) => {
      const dateA = new Date(a.lastMessageTime).getTime();
      const dateB = new Date(b.lastMessageTime).getTime();
      return dateB - dateA; // Для сортировки от нового к старому
    });

    return sortedChats;
  }

  deleteChat(conversationId: number) {
    if (confirm('Вы уверены, что хотите удалить этот чат?')) {
      console.log(`Удаление чата с conversationId: ${conversationId}`);
      const index = this.chats.findIndex(c => c.conversationId = conversationId)
      this.chats.splice(index, 1);
      this.chatService.deleteChat(conversationId).subscribe(data => console.log(data))
    }
  }

  // Выбор чата для отображения сообщений
  selectChat(conversationId: number) {
    this.selectedChatId = conversationId;
    this.avatarUrl = this.chats.find(c => c.conversationId === this.selectedChatId)!.avatarUrl

    // Загрузка сообщений для выбранного чата
    this.chatService.getMessages(conversationId).pipe(
      catchError(error => {
        if (error.status === 404) {
          this.messages = [];
        } else {
          console.error('Произошла ошибка:', error);
        }
        return []; // Возвращаем пустой массив, чтобы продолжить выполнение
      })
    ).subscribe((data) => {
      this.messages = data;
    });
  }

  handleNewMessage(message: any) {
    const chat = this.chats.find(c => c.conversationId === message.conversationId);
    if (chat) {
      chat.lastMessage = message.content;
      chat.lastMessageTime = message.sentAt;
    }

    if (this.selectedChatId === message.conversationId) {
      this.messages.push(message);
    }
    this.chats = this.filterAndSortChats(this.chats)
  }

  handleNewChat(chat: any) {
    this.chats.unshift(chat);
    this.filterAndSortChats(this.chats)
  }

  // Отправка нового сообщения
  sendMessage() {
    const userId = this.profileService.me()!.id

    if (this.newMessage.trim() && this.selectedChatId) {
      this.chatService.sendMessage({
        conversationId: this.selectedChatId,
        senderId: userId, // ID текущего пользователя
        content: this.newMessage
      });
    }
    this.newMessage= ''
  }

  onEscape() {
    this.selectedChatId = null
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input?.files) {
      this.selectedFiles = Array.from(input.files); // Сохраняем выбранные файлы
      console.log('Выбраны файлы:', this.selectedFiles);
    }
  }

  triggerFileInput() {
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    fileInput.click();
  }

  sendFiles() {
    if (this.selectedFiles.length === 0) {
      console.error('Нет файлов для загрузки');
      return;
    }

    const userId = this.profileService.me()!.id;

    this.selectedFiles.forEach((file) => {
      const reader = new FileReader();

      // Начинаем чтение файла
      reader.readAsDataURL(file);

      reader.onload = () => {
        const base64FileContent = reader.result?.toString().split(',')[1]; // Преобразование файла в Base64

        const fileData = {
          conversationId: this.selectedChatId,
          senderId: userId,
          fileName: file.name,
          fileContent: base64FileContent
        };

        // Отправляем файл
        this.chatService.sendFile(fileData);
      };

      reader.onerror = () => {
        console.error('Ошибка чтения файла');
      };
    });

    // Очистить список выбранных файлов после загрузки
    this.selectedFiles = [];
  }

  removeFile(file: File) {
    this.selectedFiles = this.selectedFiles.filter((f) => f !== file);
  }

  isImageFile(filePath: string) {
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
    const fileExtension = filePath.toLowerCase()
    return validExtensions.includes(`.${fileExtension}`)
  }

  isAudioFile(filePath: string): boolean {
    const validExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'];
    const fileExtension = filePath.toLowerCase().split('.').pop(); // Извлекаем расширение файла
    return fileExtension ? validExtensions.includes(`.${fileExtension}`) : false;
  }

  ngAfterViewInit() {
    if (this.messagesContainer && this.messagesContainer.nativeElement) {
      const container = this.messagesContainer.nativeElement;
      container.scrollTop = container.scrollHeight;
    } else {
      console.warn('messagesContainer не инициализирован.');
    }
  }
}
