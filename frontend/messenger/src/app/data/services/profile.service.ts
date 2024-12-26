import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Profile } from '../interfaces/profile';
import { tap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  http = inject(HttpClient)
  bazeApiUrl = 'http://localhost:3000/'
  me = signal<Profile | null> (null)
  conversationId = signal<number> (0)

  getMe() {
    return this.http.get<Profile>(`${this.bazeApiUrl}account/me`)
    .pipe(
      tap(res => {
        this.me.set(res)
      })
    )
  }

  getAccount(id: string) {
    return this.http.get<Profile>(`${this.bazeApiUrl}account/${id}`)
  }

  updateProfile(userSettings: {username: string; description: string; city: string}) {
    return this.http.patch(`${this.bazeApiUrl}account/update`, userSettings)
  }

  upLoadAvatar(file: File) {
    const fd = new FormData
    fd.append('image', file)
    return this.http.patch(`${this.bazeApiUrl}account/update_image`, fd)
  }

  searchCity(city: string) {
    return this.http.patch<{id: number, city: string}[]>(`${this.bazeApiUrl}account/cities`, {city: city})
  }

  searchProfiles(username: string) {
    return this.http.patch<Profile[]>(`${this.bazeApiUrl}search-users`, {username: username})
  }
}
