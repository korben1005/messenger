import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ProfileService } from '../../data/services/profile.service';
import { ChatsService } from '../../data/services/chats.service';
import { FileSelectionPageComponent } from '../file-selection-page/file-selection-page.component';
import { Post } from '../../data/interfaces/post';
import { Router } from '@angular/router';

@Component({
  selector: 'app-create-post',
  standalone: true,
  imports: [ReactiveFormsModule, FileSelectionPageComponent],
  templateUrl: './create-post.component.html',
  styleUrl: './create-post.component.scss'
})
export class CreatePostComponent {
  profileService = inject(ProfileService)
  chatService = inject(ChatsService)
  content = new FormControl('')
  fileUrls: string[] = []
  router = inject(Router)

  openFileList(){
    this.chatService.openFileWindow.set(true)
  }

  async o() {
    if(this.chatService.fileArr()) {
      for (const item of this.chatService.fileArr()) {
        try {
          if (this.chatService.checkFileArrTypes(item)) {
            this.fileUrls.push(item)
          } else {
            const data = await this.chatService.sendFiles(item as File);
            this.fileUrls.push(data)
          }
        } catch (err) {
          console.error('Ошибка отправки или загрузки:', err);
          alert('Ошибка: ' + (err || 'Неизвестная ошибка'));
          throw err;
        }
      }
    }
    const post = {
      content: this.content.value,
      files: this.fileUrls
    }
    console.log(post)
    this.profileService.loadPost(post).subscribe(data => this.goToProfile())
  }

  goToProfile() {
    this.router.navigate(['profile/me'])
  }
}
