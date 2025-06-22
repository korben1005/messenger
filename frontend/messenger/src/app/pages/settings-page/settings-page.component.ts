import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule, FormControl } from '@angular/forms';
import { ProfileService } from '../../data/services/profile.service';
import { Router } from '@angular/router';
import { Profile } from '../../data/interfaces/profile';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { ChatsService } from '../../data/services/chats.service';
import { FileSelectionPageComponent } from '../../common-ui/file-selection-page/file-selection-page.component';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [ReactiveFormsModule, FileSelectionPageComponent],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss'
})
export class SettingsPageComponent {
  profileService = inject(ProfileService)
  chatService = inject(ChatsService)
  fb = inject(FormBuilder)
  router = inject(Router)
  login: string = ''
  avatarUrl: string = ''
  preview: string = ''
  searchControl = new FormControl('');
  filteredCities: {id: number, city: string} [] | null = null;
  showDropdown: boolean = false;

  userForm = this.fb.group({
    username: ['', Validators.required],
    description: ['', Validators.required],
    city: ['', Validators.required],
  })

  constructor() {
    this.searchControl.valueChanges
    .pipe(
      debounceTime(300), // Задержка обработки ввода
      distinctUntilChanged() // Избегаем обработки одинаковых значений
    )
    .subscribe(query => {
      query === '' ? this.filteredCities = null : null
      if (query !== null) {
        query = query[0].toUpperCase() + query.substring(1, query.length)
        this.profileService.searchCity(query).subscribe(data => {
          this.filteredCities = data;
          this.userForm.patchValue({city: query})
        });
      }
    });
  }

  openFileList(){
    this.chatService.openFileWindow.set(true)
  }

  selectCity(city: string) {
    this.userForm.patchValue({city: city})
    this.searchControl.setValue(city, { emitEvent: false })
    this.filteredCities = null
  }

  hideDropdown() {
    setTimeout(() => {
      this.showDropdown = false;
    }, 200); // Небольшая задержка, чтобы успеть выбрать элемент
  }

  patchForm(profile: Profile): void {
    this.userForm.patchValue({
      username: profile.username,
      description: profile.description,
      city: profile.city
    });
  }

  ngOnInit(){
    this.profileService.getMe().subscribe({
      next: (profile: Profile) => {
        this.patchForm(profile);
        this.login = profile.login
        this.preview = profile.avatarUrl ? `https://localhost:443/data/uploads/${profile.avatarUrl}` : '/additions/user-solid.svg'
      },
      error: (err) => {
        console.error('Ошибка при загрузке профиля:', err);
      }
    });
  }

  async onSubmit(){
    if(this.chatService.fileArr().length > 0) {
      let avatar = ''
      if(!this.chatService.checkFileArrTypes(this.chatService.fileArr()[0])) {
        avatar = await this.chatService.sendFiles(this.chatService.fileArr()[0] as File)
      } else {
        avatar = this.chatService.fileArr()[0] as string
      }
      console.log(avatar)
      this.profileService.upLoadAvatar(avatar).subscribe(data => console.log(data.message))
      this.chatService.fileArr.set([])
    }
    if(this.userForm.valid) {
      const userSettings = this.userForm.value as { username: string; description: string; city: string };
      console.log(userSettings)
      this.profileService.updateProfile(userSettings).subscribe({
        next: (response) => {
          console.log('Профиль успешно обновлён:', response);
          this.router.navigate(['/profile/me']); // Перенаправляем на страницу профиля (можно изменить путь)
        },
        error: (err) => {
          console.error('Ошибка при обновлении профиля:', err);
        }
      })
    }
    this.chatService.fileArr.set([])
  }
}
