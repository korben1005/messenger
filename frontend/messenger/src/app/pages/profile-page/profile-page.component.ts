import { Component, inject, signal } from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { ProfileService } from '../../data/services/profile.service';
import { switchMap, firstValueFrom } from 'rxjs';
import { ImgUrlPipe } from '../../pipes/img-url.pipe';
import { ChatsService } from '../../data/services/chats.service';
import { Post } from '../../data/interfaces/post';
import { CreatePostComponent } from '../../common-ui/create-post/create-post.component';

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [AsyncPipe, ImgUrlPipe, DatePipe, CreatePostComponent],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.scss'
})
export class ProfilePageComponent {
  profileService = inject(ProfileService)
  route = inject(ActivatedRoute)
  isCurrentUser = false;
  router = inject(Router)
  chatService = inject(ChatsService)
  otherUserId: string = ''
  posts: Post[] = []
  loading: boolean = false
  hasMore: boolean = true;
  offset: number = 0;

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

  openCreatePostWindow() {
    this.profileService.openCreatePostW.set(true)
  }

  loadPosts() {
    if (!this.hasMore || this.loading) return;
    this.loading = true;
    // this.route.params.subscribe(params => {
    //   const id = params['id']
    //   this.profileService.getPosts(this.offset, id)
    // })
    this.profileService.getPosts(this.offset, this.route.snapshot.params['id'])
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
  }
}
