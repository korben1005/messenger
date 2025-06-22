import { Component, inject, QueryList, ViewChildren, ElementRef, ChangeDetectorRef} from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { ProfileService } from '../../data/services/profile.service';
import { switchMap, firstValueFrom } from 'rxjs';
import { ChatsService } from '../../data/services/chats.service';
import { Post } from '../../data/interfaces/post';
import { FileUrlPipe } from '../../pipes/file-url.pipe';
import { File } from '../../data/interfaces/file';

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [AsyncPipe, DatePipe, FileUrlPipe],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.scss'
})
export class ProfilePageComponent {
  profileService = inject(ProfileService)
  route = inject(ActivatedRoute)
  router = inject(Router)
  chatService = inject(ChatsService)
  otherUserId: string = ''
  posts: Post[] = []
  loading: boolean = false
  offset: number = 0;
  totalPosts: number = 0;
  videoIndices: { postIndex: number; fileIndex: number }[] = [];
  audioIndices: { postIndex: number; fileIndex: number }[] = [];
  @ViewChildren('videoElement') videoElements!: QueryList<ElementRef<HTMLVideoElement>>;
  @ViewChildren('audioElement') audioElements!: QueryList<ElementRef<HTMLVideoElement>>;
  fullscreenState: { [key: number]: boolean } = {};
  cdr = inject(ChangeDetectorRef);

  me$ = toObservable(this.profileService.me)

  profile$ = this.route.params
    .pipe(
      switchMap(({id}) => {
        if(id === 'me') return this.me$
          return this.profileService.getAccount(id)
      })
    )

  toSettings(){
    this.router.navigate(['/settingsAccount'])
  }

  toMessage() {
    this.route.params.subscribe(params => {
        this.otherUserId = params['id']
      }
    )
    const chat = {userIds:[this.profileService.me()!.id, Number(this.otherUserId)]}
    this.chatService.chatCheck(Number(this.otherUserId)).subscribe(data => {
      if(data.conversationId === 0) {
        this.chatService.newChat(chat)
      } else {
        this.profileService.conversationId.set(data.conversationId)
      }
    })
    this.router.navigate(['/chats'])
  }

  toCreatepost(){
    this.router.navigate(['create-post'])
  }

  loadPosts() {
    if (this.loading || (this.totalPosts > 0 && this.offset >= this.totalPosts)) return;

    this.loading = true;
    let id: number | null = null
    if(this.route.snapshot.params['id'] == 'me') {
      id = Number(this.profileService.me()!.id)
    } else {
      id = Number(this.route.snapshot.params['id'])
    }
    this.profileService.getPosts(id, this.offset).subscribe({
      next: (response) => {
        console.log(response)
        this.posts = [...this.posts, ...response.posts];
        this.totalPosts = response.total
        this.offset += 10;
        this.loading = false;
        console.log(this.posts)
      },
      error: (err) => {
        console.error('Ошибка загрузки постов:', err);
        this.loading = false;
      }
    });
  }

  updateVideoProgress() {
    if (!this.videoElements || !this.posts) {
      console.warn('videoElements or posts is undefined');
      return;
    }

    const videoArray = this.videoElements.toArray();
    if (videoArray.length === 0) {
      console.warn('No video elements found in DOM');
      return;
    }

    this.posts.forEach((post, postIndex) => {
      if(post.files) {
        post.files.forEach((file, fileIndex) => {
          if (file.fileUrl && this.chatService.isVideoFile(file.fileExpansion)) {
            this.videoIndices.push({ postIndex, fileIndex });
          }
        });
      }
    });

    // Сопоставляем видеоэлементы с постами и файлами
    videoArray.forEach((videoRef, videoIndex) => {
      if (videoIndex >= this.videoIndices.length) {
        console.warn(`No matching post/file for video element ${videoIndex}`);
        return;
      }

      const { postIndex, fileIndex } = this.videoIndices[videoIndex];
      const post = this.posts[postIndex];
      const file = post.files![fileIndex];

      if (file.duration && !isNaN(file.duration) && file.duration !== Infinity) {
        const video = videoRef.nativeElement;
        video.addEventListener('timeupdate', () => {
          file.progress = video.currentTime; // Обновляем прогресс файла
          if (video.currentTime >= file.duration) {
            video.dispatchEvent(new Event('ended'));
          }
        }, { once: false });

        video.addEventListener('error', (err) => {
          console.error(`Video at post ${postIndex}, file ${fileIndex} error:`, err);
        }, { once: false });
      } else {
        console.log(`Invalid duration for post ${postIndex}, file ${fileIndex}:`, file.duration);
      }
    });
  }

  toggleFullscreen(post: Post, fileIndex: number) {
    const postIndex = this.posts.indexOf(post);
    const videoElement = this.videoElements.toArray()[postIndex * this.posts[postIndex].files!.length + fileIndex].nativeElement;
    console.log(postIndex, videoElement)
    if (videoElement) {
      const wrapper = videoElement.closest('.fullscreen-wrapper') as HTMLElement;
      if (wrapper) {
        this.fullscreenState[postIndex] = !this.fullscreenState[postIndex] || false;
        wrapper.classList.toggle('fullscreen', this.fullscreenState[postIndex]);
        videoElement.classList.toggle('fullscreen', this.fullscreenState[postIndex]);
        const controls = videoElement.nextElementSibling as HTMLElement;
        if (controls && controls.classList.contains('video-controls')) {
          controls.classList.toggle('fullscreen-controls', this.fullscreenState[postIndex]);
        }
        this.cdr.detectChanges();
      }
    }
  }

  seekVideo(post: Post, file: File, event: Event) {
    const input = event.target as HTMLInputElement;
    const postIndex = this.posts.indexOf(post);
    if (postIndex === -1) {
      console.warn('Post not found in this.posts');
      return;
    }

    const fileIndex = post.files!.indexOf(file);
    if (fileIndex === -1) {
      console.warn(`File not found in post ${postIndex}`);
      return;
    }

    // Находим позицию аудио среди всех аудиоэлементов
    const videoIndex = this.videoIndices.findIndex(
      (index) => index.postIndex === postIndex && index.fileIndex === fileIndex
    );
    console.log('Audio index:', videoIndex);

    if (videoIndex === -1) {
      console.warn(`No audio element found for post ${postIndex}, file ${fileIndex}`);
      return;
    }

    const audio = this.videoElements?.toArray()[videoIndex]?.nativeElement;
    console.log('Videoelement:', audio);

    if (audio && file.duration && Number.isFinite(file.duration)) {
      const newTime = parseFloat(input.value);
      audio.currentTime = newTime;
      file.progress = newTime;
    } else {
      console.warn(`No audio element or invalid duration for post ${postIndex}, file ${fileIndex}`);
    }
  }

  seekAudio(post: Post, file: File, event: Event){
    const input = event.target as HTMLInputElement;
    const postIndex = this.posts.indexOf(post);
    if (postIndex === -1) {
      console.warn('Post not found in this.posts');
      return;
    }

    const fileIndex = post.files!.indexOf(file);
    if (fileIndex === -1) {
      console.warn(`File not found in post ${postIndex}`);
      return;
    }

    // Находим позицию аудио среди всех аудиоэлементов
    const audioIndex = this.audioIndices.findIndex(
      (index) => index.postIndex === postIndex && index.fileIndex === fileIndex
    );
    console.log('Audio index:', audioIndex);

    if (audioIndex === -1) {
      console.warn(`No audio element found for post ${postIndex}, file ${fileIndex}`);
      return;
    }

    const audio = this.audioElements?.toArray()[audioIndex]?.nativeElement;
    console.log('Audio element:', audio);

    if (audio && file.duration && Number.isFinite(file.duration)) {
      const newTime = parseFloat(input.value);
      audio.currentTime = newTime;
      file.progress = newTime;
    } else {
      console.warn(`No audio element or invalid duration for post ${postIndex}, file ${fileIndex}`);
    }
  }

  updateAudioProgress() {
    this.audioIndices = []
    const audioArray = this.audioElements.toArray();
    const audioPromises = this.posts.map((msg, idx) => {
      msg.files?.forEach(file => {
        return new Promise((resolve, reject) => {
            if (!file.fileUrl || !this.chatService.isAudioFile(file.fileExpansion)) {
                resolve(null); // Пропускаем, если не аудио
                return;
            }

            const audio = new Audio();
            audio.src = `https://localhost:443/data/uploads/${file.fileUrl}`;
            audio.onloadedmetadata = () => {
                if (!isNaN(audio.duration) && audio.duration !== Infinity) {
                    file.duration = audio.duration;
                    console.log(file.duration)
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
      })
    });
    Promise.all(audioPromises)
    .then(() => {
      this.posts.forEach((post, postIndex) => {
      if(post.files) {
        post.files.forEach((file, fileIndex) => {
          if (file.fileUrl && this.chatService.isAudioFile(file.fileExpansion)) {
            this.audioIndices.push({ postIndex, fileIndex });
            console.log(this.audioIndices.length)
          }
        });
      }
    });
    // Сопоставляем видеоэлементы с постами и файлами
    audioArray.forEach((audioRef, audioIndex) => {
      if (audioIndex >= this.audioIndices.length) {
        console.warn(`No matching post/file for video element ${audioIndex}`);
        return;
      }

      const { postIndex, fileIndex } = this.audioIndices[audioIndex];
      const post = this.posts[postIndex];
      const file = post.files![fileIndex];

      if (file.duration && !isNaN(file.duration) && file.duration !== Infinity) {
        const audio = audioRef.nativeElement;
        audio.addEventListener('timeupdate', () => {
          file.progress = audio.currentTime; // Обновляем прогресс файла
          if (audio.currentTime >= file.duration) {
            audio.dispatchEvent(new Event('ended'));
          }
        }, { once: false });

        audio.addEventListener('error', (err) => {
          console.error(`Video at post ${postIndex}, file ${fileIndex} error:`, err);
        }, { once: false });
      } else {
        console.log(`Invalid duration for post ${postIndex}, file ${fileIndex}:`, file.duration);
      }
    });
    })
  }

  onScroll(event: Event) {
    const container = event.target as HTMLElement;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    const scrollThreshold = scrollHeight - clientHeight - (clientHeight * 0.2); // 20% от оставшейся высоты

    if (scrollTop >= scrollThreshold && !this.loading && (this.totalPosts === 0 || this.offset < this.totalPosts)) {
      this.loadPosts();
    }
  }

  async ngOnInit() {
    const me = await firstValueFrom(this.profileService.getMe());
    const routeId = this.route.snapshot.params['id'];

    // Переадресация на /profile/me, если ID совпадает
    if (String(routeId) === String(me.id)) {
      this.router.navigate(['/profile/me']);
    }
    this.chatService.authenticate()
    // Здесь можно вызвать обработку WebSocket-сообщений
    this.chatService.onMessage().subscribe(message => {
      if (message.type === 'newChat') {
        this.profileService.conversationId.set(message.conversationId);
      }
    });
    this.loadPosts();
  }

  ngAfterViewInit() {
    this.videoElements?.changes.subscribe(() => {
      this.updateVideoProgress();
    });
    this.audioElements?.changes.subscribe(() => {
      this.updateAudioProgress()
      console.log(this.audioElements.length, this.audioIndices.length)
    })
  }
}
