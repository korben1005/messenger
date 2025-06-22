import { Component, inject } from '@angular/core';
import { ProfileService } from '../../data/services/profile.service';
import { ChatsService } from '../../data/services/chats.service';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-file-selection-page',
  standalone: true,
  imports: [],
  templateUrl: './file-selection-page.component.html',
  styleUrl: './file-selection-page.component.scss'
})
export class FileSelectionPageComponent {
  fileArr: string[] = [];
  profileService = inject(ProfileService);
  chatService = inject(ChatsService)
  selectedFiles: File[] = [];
  route = inject(ActivatedRoute)
  currentUrl = this.route.snapshot.url.map(segment => segment.path).join('/')

  ngOnInit() {
    this.profileService.getFiles().subscribe((data) => {
      if(this.currentUrl === 'settingsAccount') {
        data.forEach(item => {
          const extension = item.split('.').pop();
          if(extension && this.chatService.isImageFile(extension)) {
            this.fileArr.push(item)
          }
        })
      } else {
        this.fileArr = data
      }
    })
  }

  triggerFileInput() {
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    fileInput.click();
  }

  onFileSelect(event: Event, file: string) {
    const checkbox = event.target as HTMLInputElement;
    if (checkbox.checked) {
      this.chatService.fileArr.update(files => [...files, file]);
      if(this.currentUrl === 'settingsAccount' && this.chatService.fileArr().length > 0) {
        this.chatService.openFileWindow.set(false)
      } // Добавляем файл в выбранные
    } else {
     this.chatService.fileArr.update(files => files.filter(f => f !== file)); // Удаляем файл из выбранных
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input?.files) {
      this.selectedFiles = Array.from(input.files);
      this.chatService.fileArr.update(files => [...files, ...this.selectedFiles]);
    }
  }

  closeFileList() {
    this.chatService.openFileWindow.set(false)
  }
}
