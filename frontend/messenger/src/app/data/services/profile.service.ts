import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Profile } from '../interfaces/profile';
import { tap } from 'rxjs';
import { Post } from '../interfaces/post';

@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  http = inject(HttpClient)
  bazeApiUrl = 'https://localhost:443/'
  me = signal<Profile | null> (null)
  conversationId = signal<number> (0)
  fileArr = signal<(string | File)[]> ([])

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

  upLoadAvatar(file: string) {
    return this.http.patch<any>(`${this.bazeApiUrl}account/update-image`, {file: file})
  }

  searchCity(city: string) {
    return this.http.patch<{id: number, city: string}[]>(`${this.bazeApiUrl}account/cities`, {city: city})
  }

  searchProfiles(username: string) {
    return this.http.patch<Profile[]>(`${this.bazeApiUrl}search-users`, {username: username})
  }

  getFiles(){
    return this.http.get<string[]>(`${this.bazeApiUrl}files`)
  }

  getPosts(userId: number, offset: number) {
    return this.http.get<{posts: Post[], total: number}>(`${this.bazeApiUrl}${userId}/posts?offset=${offset}`)
  }

  loadPost(post: {content: string | null, files: string[] | null}) {
    return this.http.post(`${this.bazeApiUrl}load-post`, post)
  }
}
