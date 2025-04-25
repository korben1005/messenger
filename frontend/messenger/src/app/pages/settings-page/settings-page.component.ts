import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { ProfileService } from '../../data/services/profile.service';
import { Router } from '@angular/router';
import { Profile } from '../../data/interfaces/profile';
import { FormControl } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss'
})
export class SettingsPageComponent {
  profileService = inject(ProfileService)
  fb = inject(FormBuilder)
  router = inject(Router)
  login: string = ''
  avatar: File | null = null
  avatarUrl: string = ''
  preview = signal <string> ('')
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
        this.profileService.searchCity(query).subscribe(data => {
          this.filteredCities = data;
          this.userForm.patchValue({city: query}) 
        });
      }
    });
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

  onFileSelected(event: Event) {
    const file =(event.target as HTMLInputElement)?.files?.[0]
    this.proccessFile(file)
  }

  triggerFileInput() {
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    fileInput.click();
  }

  proccessFile(file: File | null | undefined) {
    if(!file || !file.type.match('image')) return

    const reader = new FileReader()
    reader.onload = event => {
      this.preview.set(event.target?.result?.toString() || '')
    }
    reader.readAsDataURL(file)
    this.avatar = file
  }

  ngOnInit(){
    this.profileService.getMe().subscribe({
      next: (profile: Profile) => {
        this.patchForm(profile);
        this.login = profile.login
        this.preview.set(profile.avatarUrl ? `http://localhost:3000/uploads/${profile.avatarUrl}` : '/additions/user-solid.svg')
      },
      error: (err) => {
        console.error('Ошибка при загрузке профиля:', err);
      }
    });
  }

  onSubmit(){
    this.avatar ? this.profileService.upLoadAvatar(this.avatar) : null;
    if(this.userForm.valid) {
      const userSettings = this.userForm.value as { username: string; description: string; city: string };
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
  }
}
