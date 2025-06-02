import { Component, inject, ElementRef, ViewChild, ViewChildren, AfterViewInit, QueryList, ChangeDetectorRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChatsService } from '../../data/services/chats.service';
import { Message } from '../../data/interfaces/message';
import { Chat } from '../../data/interfaces/chat';
import { ImgUrlPipe } from '../../pipes/img-url.pipe';
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
  imports: [RouterLink, ImgUrlPipe, FormsModule, DatePipe, FileUrlPipe, FileSelectionPageComponent],
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
        const maxScrollTop = container.scrollHeight - container.clientHeight;
        container.scrollTop = maxScrollTop;
    }
  }

  selectChat(conversationId: number) {
    if(this.selectedChatId != conversationId) {
      this.selectedChatId = conversationId;
    this.avatarUrl = this.chats.find(c => c.conversationId === this.selectedChatId)!.avatarUrl;
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
      console.log(data)
      this.messages = data.map((msg: Message) => ({
          ...msg,
          file: { ...msg.file, progress: msg.file.progress || 0 }
        }
      ));
      this.messages.forEach(item => {
        if(this.isAudioFile(item.file.fileExpansion)) {
          new Promise ((resolve, reject) => {
            const audio = new Audio();
            audio.src = `https://localhost:3000/uploads/${item.file.fileUrl}`; // Указываем URL аудиофайла
            audio.onloadedmetadata = () => {
                if (!isNaN(audio.duration) && audio.duration !== Infinity) {
                    item.file.duration = audio.duration // Длительность в секундах
                } else {
                    reject(new Error('Не удалось определить длительность аудио'));
                }
                audio.remove(); // Очищаем объект после использования
            };
          })
        }
      })
      this.cdr.detectChanges(); // Принудительное обновление DOM
      setTimeout(() => this.scrollToBottom(), 0); // Отложенная прокрутка
      const reading = {
        conversationId: conversationId,
        userId: this.profileService.me()!.id
      }
      this.chatService.readingChatMes(reading)
      this.chats.find(c => c.conversationId === this.selectedChatId)!.unreadCount = 0;
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
      if (msg.file.fileUrl && this.isVideoFile(msg.file.fileExpansion)) {
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

  toggleVideo(message: Message, event: Event) {
    const msgIndex = this.messages.indexOf(message);
    if (msgIndex === -1) {
      console.warn('Message not found in this.messages');
      return;
    }
    const videoIndex = this.videoMessageIndices.indexOf(msgIndex);
    if (videoIndex === -1) {
      console.warn(`No video element found for message ${msgIndex}`);
      return;
    }
    const video = this.videoElements?.toArray()[videoIndex]?.nativeElement;
    if (video) {
      if (video.paused) {
        video.play()
      } else {
        video.pause();
      }
    } else {
      console.warn(`No video element for message ${msgIndex}`);
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

  formatDuration(duration: number): string {
    if (!duration || duration < 0 || !isFinite(duration)) return '00:00';
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  toggleAudio(audio: HTMLAudioElement) {
      if (audio.paused) {
        audio.play();
      } else {
        audio.pause();
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
            if (!msg.file?.fileUrl || !this.isAudioFile(msg.file.fileExpansion)) {
                resolve(null); // Пропускаем, если не аудио
                return;
            }

            const audio = new Audio();
            audio.src = `https://localhost:3000/uploads/${msg.file.fileUrl}`;
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
        if(item.isRead == 0) {
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

  onEscape() {
    this.selectedChatId = null
    this.chatService.openFileWindow.set(false)
  }

  checkFileArrTypes(item: string | File): item is string {
    return typeof item === 'string';
  }

  sendFiles() {
    if (this.chatService.fileArr().length === 0) {
      alert('Нет файлов для отправки');
      return;
    }

    const filesToProcess = this.chatService.fileArr();
    console.log(filesToProcess)

    filesToProcess.forEach(item => {
      if (this.checkFileArrTypes(item)) {
        this.chatService.sendMessage({
          conversationId: this.selectedChatId,
          senderId: this.profileService.me()!.id,
          fileUrl: item
        })
      }
        else if(item instanceof File ) {
          const formData = new FormData();
        const uploadNextFile = (fileIndex: number) => {
          if (fileIndex >= filesToProcess.length) {
            this.uploadProgress = 0;
            alert('Все файлы успешно загружены!');
            return;
          }

          const file = filesToProcess[fileIndex] as File;
          const chunkSize = 1 * 1024 * 1024; // 1MB
          const totalChunks = Math.ceil(file.size / chunkSize);
          const fileName = `${Date.now()}-${file.name}`;
          console.log('Uploading file:', { fileName, fileSize: file.size, totalChunks });

          this.chatService.checkChunks(this.selectedChatId!, fileName).subscribe({
            next: (response) => {
              const uploadedChunks = response.uploadedChunks;
              let chunkIndex = 0;

              const sendNextChunk = () => {
                if (chunkIndex >= totalChunks) {
                  this.chatService.completeUpload(this.selectedChatId!, fileName, totalChunks).subscribe({
                    next: () => {
                      uploadNextFile(fileIndex + 1);
                    },
                    error: (err) => {
                      console.error('Ошибка завершения загрузки:', err);
                      this.uploadProgress = 0;
                      alert('Ошибка завершения загрузки: ' + (err.error?.message || 'Неизвестная ошибка'));
                    }
                  });
                  return;
                }

                if (uploadedChunks.includes(chunkIndex)) {
                  chunkIndex++;
                  this.uploadProgress = Math.round((100 * (chunkIndex + 1)) / totalChunks);
                  sendNextChunk();
                  return;
                }

                const start = chunkIndex * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                console.log('Sending chunk:', { chunkIndex, chunkSize: end - start });

                if (!chunk || chunk.size === 0) {
                  console.error('Chunk is empty or invalid:', { chunkIndex, chunkSize: end - start });
                  return;
                }

                formData.set('chunk', chunk, `${fileName}_chunk_${chunkIndex}`);
                formData.set('fileName', fileName);
                formData.set('chunkIndex', chunkIndex.toString());
                formData.set('totalChunks', totalChunks.toString());

                this.chatService.uploadChunk(this.selectedChatId!, formData).subscribe({
                  next: (res) => {
                    this.uploadProgress = Math.round((100 * (chunkIndex + 1)) / totalChunks);
                    chunkIndex++;
                    sendNextChunk();
                    console.log(res);

                  },
                  error: (err) => {
                    console.error('Ошибка загрузки фрагмента:', err);
                    this.uploadProgress = 0;
                    alert('Ошибка загрузки фрагмента: ' + (err.error?.message || 'Неизвестная ошибка'));
                  }
                });
              };

              sendNextChunk();
            },
            error: (err) => {
              console.error('Ошибка проверки фрагментов:', err);
              alert('Ошибка проверки фрагментов: ' + (err.error?.message || 'Неизвестная ошибка'));
            }
          });
        };
        uploadNextFile(0);
      }
    })
    this.chatService.fileArr.set([])
  }

  removeFile(file: string | File) {
   this.chatService.fileArr.update(files => files.filter(f => f !== file));
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
