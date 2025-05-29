import { Component, inject, signal } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { ProfileService } from '../../data/services/profile.service';
import { catchError, switchMap } from 'rxjs';
import { ImgUrlPipe } from '../../pipes/img-url.pipe';
import { firstValueFrom } from 'rxjs';
import { ChatsService } from '../../data/services/chats.service';

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [AsyncPipe, ImgUrlPipe],
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

  async ngOnInit() {
    const me = await firstValueFrom(this.profileService.getMe());

    const routeId = this.route.snapshot.params['id'];

    // Переадресация на /profile/me, если ID совпадает
    if (String(routeId) === String(me.id)) {
      this.router.navigate(['/profile/me']);
      this.isCurrentUser = true;
    } else if (routeId === 'me') {
      this.isCurrentUser = true;
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
