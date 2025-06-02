import { Component, inject } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { ProfileService } from '../../data/services/profile.service';
import { Profile } from '../../data/interfaces/profile';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { ImgUrlPipe } from '../../pipes/img-url.pipe';

@Component({
  selector: 'app-search-page',
  standalone: true,
  imports: [ReactiveFormsModule, ImgUrlPipe],
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.scss'
})
export class SearchPageComponent {
  profileService = inject(ProfileService)
  profiles: Profile[] | null = null
  searchControl = new FormControl('');
  showDropdown: boolean = false;

  constructor() {
    this.searchControl.valueChanges
    .pipe(
      debounceTime(300), // Задержка обработки ввода
      distinctUntilChanged() // Избегаем обработки одинаковых значений
    )
    .subscribe(query => {
      query === '' ? this.profiles = null : null
      if (query !== null) {
        this.profileService.searchProfiles(query).subscribe(data => {
          this.profiles = data;
        });
      }
    });
  }

  hideDropdown() {
    setTimeout(() => {
      this.showDropdown = false;
    }, 200);
  }
}
