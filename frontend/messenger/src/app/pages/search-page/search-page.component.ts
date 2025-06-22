import { Component, inject } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { ProfileService } from '../../data/services/profile.service';
import { Profile } from '../../data/interfaces/profile';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { FileUrlPipe } from '../../pipes/file-url.pipe';
import { Router } from '@angular/router';

@Component({
  selector: 'app-search-page',
  standalone: true,
  imports: [ReactiveFormsModule, FileUrlPipe],
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.scss'
})
export class SearchPageComponent {
  profileService = inject(ProfileService)
  profiles: Profile[] | null = null
  searchControl = new FormControl('');
  showDropdown: boolean = false;
  router = inject(Router);

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

  routeToProfile(id: number) {
    this.router.navigate(['profile/' + id.toString()])
  }
}
