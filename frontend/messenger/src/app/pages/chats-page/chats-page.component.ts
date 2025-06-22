import { Component, inject, ElementRef, ViewChild, ViewChildren, AfterViewInit, QueryList, ChangeDetectorRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChatsService } from '../../data/services/chats.service';
import { Message } from '../../data/interfaces/message';
import { Chat } from '../../data/interfaces/chat';
import { AuthService } from '../../authentication/auth.service';
import { ProfileService } from '../../data/services/profile.service';
import { catchError, of } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { FileUrlPipe } from '../../pipes/file-url.pipe';
import { FileSelectionPageComponent } from '../../common-ui/file-selection-page/file-selection-page.component';

@Component({
  selector: 'app-chats-page',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe, FileUrlPipe, FileSelectionPageComponent],
  templateUrl: './chats-page.component.html',
  styleUrl: './chats-page.component.scss'
})
export class ChatsPageComponent implements AfterViewInit {
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
  uploadProgress: number = 0;
  videoMessageIndices: number[] = [];
  audioMessageIndices: number[] = [];
  fullscreenState: { [key: number]: boolean } = {};
  cdr = inject(ChangeDetectorRef);
  isSidebarVisible: boolean = true;
  @ViewChildren('videoPlayer') videoElements: QueryList<ElementRef<HTMLVideoElement>> | undefined;
  @ViewChild('messagesContainer') messagesContainer: ElementRef<HTMLDivElement> | undefined;
  @ViewChildren('audioPlayer') audioElements: QueryList<ElementRef<HTMLAudioElement>> | undefined;


  ngOnInit() {
    this.chatService.startTokenRefresh()
    this.chatService.authenticate()
    this.chatService.getChats().subscribe((data) => {
      console.log(data)
      this.chats = this.filterAndSortChats(data)
      if(this.profileService.conversationId() !== 0){
        this.selectChat(this.profileService.conversationId())
        this.profileService.conversationId.set(0)
      }
      this.profileService.getMe().subscribe()
    })

    // Подписка на WebSocket для обработки новых чатов и сообщений
    this.chatService.onMessage().subscribe((message) => {
      switch (message.type) {
        case 'newMessage':
          this.handleNewMessage(message);
          break;
        case 'newChat':
          this.handleNewChat(message);
          break;
        case 'ReadingChat':
          this.handleReadingChat(message);
          break;
        case 'tokenExpired':
          this.authService.refreshAuthToken()
          break;
          default:
            break;
      }
    });
  }

  toggleSidebar() {
    this.isSidebarVisible = !this.isSidebarVisible;
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

  scrollToBottom() {
  if (this.messagesContainer) {
    const container = this.messagesContainer.nativeElement;
    // Убеждаемся, что контейнер полностью отрендерен
    setTimeout(() => {
      const maxScrollTop = container.scrollHeight - container.clientHeight;
      if (maxScrollTop >= 0) { // Проверяем, есть ли что прокручивать
        container.scrollTop = maxScrollTop;
      }
    }, 0); // Минимальная задержка для следующего цикла рендеринга
  }
}

  selectChat(conversationId: number) {
    if(this.selectedChatId != conversationId) {
      this.selectedChatId = conversationId;
      const chatIndex = this.chats.find(c => c.conversationId === this.selectedChatId)
      this.avatarUrl = chatIndex!.avatarUrl;
      this.chatService.getMessages(conversationId).pipe(
        catchError(error => {
          if (error.status === 404) {
            this.messages = [];
          } else {
            console.error('Произошла ошибка:', error);
          }
          return of([]);
        })
      ).subscribe((data) => {
        this.messages = data.map((msg: Message) => ({
            ...msg,
            file: { ...msg.file, progress: msg.file.progress || 0 }
          }
        ));
        this.cdr.detectChanges(); // Принудительное обновление DOM
        setTimeout(() => this.scrollToBottom(), 0); // Отложенная прокрутка
        const reading = {
          conversationId: conversationId,
          userId: this.profileService.me()!.id
        }
        if(chatIndex!.unreadCount != 0) {
          this.chatService.readingChatMes(reading)
          chatIndex!.unreadCount = 0;
        }
      });
    }
  }

  updateVideoProgress() {
    this.videoMessageIndices = []
    if (!this.videoElements || !this.messages) {
      console.warn('videoElements or messages is undefined');
      return;
    }
    const videoArray = this.videoElements.toArray();
    if (videoArray.length === 0) {
      console.warn('No video elements found in DOM');
      return;
    }
    this.messages.forEach((msg, idx) => {
      if (msg.file.fileUrl && this.chatService.isVideoFile(msg.file.fileExpansion)) {
        this.videoMessageIndices.push(idx);
      }
    });
    // Перебираем videoArray и сопоставляем с индексами сообщений
    videoArray.forEach((videoRef, videoIndex) => {
      // Проверяем, есть ли сообщение для данного videoIndex
      if (videoIndex >= this.videoMessageIndices.length) {
        console.warn(`No matching message for video element ${videoIndex}`);
        return;
      }

      const msgIndex = this.videoMessageIndices[videoIndex];
      const msg = this.messages[msgIndex];

      if (msg.file.duration && !isNaN(msg.file.duration) && msg.file.duration !== Infinity) {
        const video = videoRef.nativeElement;
        video.addEventListener('timeupdate', () => {
          msg.file.progress = video.currentTime;
          if(video.currentTime >= msg.file.duration){
            video.dispatchEvent(new Event('ended'));
          }
        }, { once: false });
      video.addEventListener('error', (err) => {
        console.error(`Video ${msgIndex} error:`, err);
      }, { once: false });
      } else {
        console.log(`Invalid duration for message ${msgIndex}:`, msg.file.duration);
      }
    });
  }

  seekTo(message: Message, event: Event) {
    const input = event.target as HTMLInputElement;
    const msgIndex = this.messages.indexOf(message); // Находим индекс сообщения
    console.log('Message index:', msgIndex);
    if (msgIndex === -1) {
      console.warn('Message not found in this.messages');
      return;
    }
    // Находим позицию сообщения среди видеосообщений
    const videoIndex = this.videoMessageIndices.indexOf(msgIndex);
    console.log('Video index:', videoIndex);
    if (videoIndex === -1) {
      console.warn(`No video element found for message ${msgIndex}`);
      return;
    }
    const video = this.videoElements?.toArray()[videoIndex]?.nativeElement;
    console.log('Video element:', video);
    if (video && message.file.duration && Number.isFinite(message.file.duration)) {
      const newTime = parseFloat(input.value);
      video.currentTime = newTime;
      message.file.progress = newTime;
    } else {
      console.warn(`No video element or invalid duration for message ${msgIndex}`);
    }
  }

  toggleFullscreen(item: Message) {
    const msgIndex = this.messages.indexOf(item);
    const videoIndex = this.videoMessageIndices.indexOf(msgIndex);
    const video = this.videoElements?.toArray()[videoIndex]?.nativeElement;
    if (video) {
      const wrapper = video.closest('.fullscreen-wrapper') as HTMLElement;
        if (wrapper) {
          this.fullscreenState[msgIndex] = !this.fullscreenState[msgIndex];
          wrapper.classList.toggle('fullscreen', this.fullscreenState[msgIndex]);
          video.classList.toggle('fullscreen', this.fullscreenState[msgIndex]);
          const controls = video.nextElementSibling as HTMLElement;
          if (controls && controls.classList.contains('video-controls')) {
              controls.classList.toggle('fullscreen-controls', this.fullscreenState[msgIndex]);
          }
          this.cdr.detectChanges();
        }
    }
  }

  seekAudio(message: Message, event: Event) {
    const input = event.target as HTMLInputElement;
    const msgIndex = this.messages.indexOf(message);
    if (msgIndex === -1) {
      console.warn('Message not found in this.messages');
      return;
    }
    // Находим позицию сообщения среди видеосообщений
    const audioIndex = this.audioMessageIndices.indexOf(msgIndex);
    console.log('audio index:', audioIndex);
    if (audioIndex === -1) {
      console.warn(`No video element found for message ${msgIndex}`);
      return;
    }
    const audio = this.audioElements?.toArray()[audioIndex]?.nativeElement;
    console.log('Video element:', audio);
    if (audio && message.file.duration && Number.isFinite(message.file.duration)) {
      const newTime = parseFloat(input.value);
      audio.currentTime = newTime;
      message.file.progress = newTime;
    } else {
      console.warn(`No video element or invalid duration for message ${msgIndex}`);
    }
  }

  updateAudioProgress() {
    this.audioMessageIndices = [];
    const audioArray = this.audioElements!.toArray();
    const audioPromises = this.messages.map((msg, idx) => {
        return new Promise<{ idx: number, duration: number } | null>((resolve, reject) => {
            if (!msg.file?.fileUrl || !this.chatService.isAudioFile(msg.file.fileExpansion)) {
                resolve(null); // Пропускаем, если не аудио
                return;
            }

            const audio = new Audio();
            audio.src = `https://localhost:443/data/uploads/${msg.file.fileUrl}`;
            audio.onloadedmetadata = () => {
                if (!isNaN(audio.duration) && audio.duration !== Infinity) {
                    msg.file.duration = audio.duration;
                    resolve({ idx, duration: audio.duration }); // Возвращаем индекс и длительность
                } else {
                    reject(new Error(`Не удалось определить длительность для сообщения ${idx}`));
                }
                audio.remove();
            };
            audio.onerror = () => {
                reject(new Error(`Ошибка загрузки аудиофайла для сообщения ${idx}`));
                audio.remove();
            };
        });
    });
    // Ждём завершения всех промисов
    Promise.all(audioPromises)
        .then((results) => {
            // Фильтруем результаты, чтобы получить только успешные индексы
            results.forEach(result => {
                if (result) {
                    this.audioMessageIndices.push(result.idx);
                }
            });

            // Обновляем аудиоэлементы
            audioArray.forEach((audioRef, audioIndex) => {
                if (audioIndex >= this.audioMessageIndices.length) {
                    console.warn(`No matching message for audio element ${audioIndex}`);
                    return;
                }

                const msgIndex = this.audioMessageIndices[audioIndex];
                const msg = this.messages[msgIndex];

                if (msg.file?.duration && !isNaN(msg.file.duration) && msg.file.duration !== Infinity) {
                    const audio = audioRef.nativeElement;
                    audio.addEventListener('timeupdate', () => {
                        msg.file.progress = audio.currentTime;
                        if (audio.currentTime >= msg.file.duration) {
                            audio.dispatchEvent(new Event('ended'));
                        }
                    }, { once: false });
                    audio.addEventListener('error', (err) => {
                        console.error(`Audio ${msgIndex} error:`, err);
                    }, { once: false });
                } else {
                    console.log(`Invalid duration for message ${msgIndex}:`, msg.file?.duration);
                }
            });
        })
        .catch((error) => {
            console.error('Ошибка при загрузке длительностей аудио:', error);
        });
  }

  handleNewMessage(message: Message) {
    const chat = this.chats.find(c => c.conversationId === message.conversationId);
    if (chat) {
      chat.lastMessage = message.content;
      chat.lastMessageTime = message.sentAt;
    }

    if (this.selectedChatId === message.conversationId) {
      this.messages.push(message);
      this.cdr.detectChanges();
      if(message.senderId == this.profileService.me()?.id) {
        this.scrollToBottom()
      }
      if(message.senderId !== this.profileService.me()?.id){
        const reading = {
        conversationId: this.selectedChatId,
        userId: this.profileService.me()!.id
      }
      this.chatService.readingChatMes(reading)
      }
    } else {
        chat!.unreadCount++
    }
    this.chats = this.filterAndSortChats(this.chats)
  }

  handleNewChat(chat: Chat) {
    this.chats.unshift(chat);
    this.filterAndSortChats(this.chats)
  }

  handleReadingChat(data: {conversationId: number}){
    if(this.selectedChatId == data.conversationId) {
      this.messages.forEach(item => {
        if(item.senderId == this.profileService.me()?.id && item.isRead == 0) {
          item.isRead = 1
        }
      })
    }
    const chat = this.chats.find(c => c.conversationId === data.conversationId);
    chat!.unreadCount = 0
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

  async sendFiles(): Promise<void> {
    const userId = this.profileService.me()?.id;
    if (!userId) {
      alert('Пользователь не авторизован');
      throw new Error('Пользователь не авторизован');
    }

    const items = this.chatService.fileArr();
    for (const item of items) {
      try {
        if (this.chatService.checkFileArrTypes(item)) {
          this.chatService.sendMessage({
            conversationId: this.selectedChatId!,
            senderId: userId,
            fileUrl: item
          });
        } else {
          const data = await this.chatService.sendFiles(item as File);
          console.log(data)
          this.chatService.sendMessage({
            conversationId: this.selectedChatId,
            senderId: userId,
            fileUrl: data
          });
        }
      } catch (err) {
        console.error('Ошибка отправки или загрузки:', err);
        alert('Ошибка: ' + (err || 'Неизвестная ошибка'));
        throw err;
      }
    }

    this.chatService.fileArr.set([]);
  }

  onEscape() {
    this.selectedChatId = null
    this.chatService.openFileWindow.set(false)
  }



  openFileList(){
    this.chatService.openFileWindow.set(true)
  }

  ngAfterViewInit() {
    this.videoElements?.changes.subscribe(() => {
      this.updateVideoProgress();
    });
    this.audioElements?.changes.subscribe(() => {
      this.updateAudioProgress()
    })
  }
}
