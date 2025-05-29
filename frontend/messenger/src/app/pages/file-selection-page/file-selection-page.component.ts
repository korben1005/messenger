import { Component, inject } from '@angular/core';
import { ProfileService } from '../../data/services/profile.service';
import { ChatsPageComponent } from '../chats-page/chats-page.component';
import { ChatsService } from '../../data/services/chats.service';

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

  ngOnInit() {
    this.profileService.getFiles().subscribe((data) => {
      this.fileArr = data
    })
  }

  triggerFileInput() {
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    fileInput.click();
  }

  onFileSelect(event: Event, file: string) {
    const checkbox = event.target as HTMLInputElement;
    if (checkbox.checked) {
      this.chatService.fileArr.update(files => [...files, file]); // Добавляем файл в выбранные
    } else {
     this.chatService.fileArr.update(files => files.filter(f => f !== file)); // Удаляем файл из выбранных
    }
    console.log('Selected files:', this.chatService.fileArr());
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
