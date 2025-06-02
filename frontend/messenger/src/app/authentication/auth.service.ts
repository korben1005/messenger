import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CookieService } from 'ngx-cookie-service';
import { tap } from 'rxjs/operators';
import { Token } from './token';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  http = inject(HttpClient)
  cookieService = inject(CookieService)
  userId: number | null = null
  token: string | null = null
  refresh_token: string | null = null
  bazeApiUrl = 'https://localhost:3000/'
  router = inject(Router)

  get isAuth() {
    if(!this.token){
      this.token = this.cookieService.get('token')
      this.refresh_token = this.cookieService.get('refresh_token')
    }
    return !!this.token
  }

  login(payload: {login: string, password: string}) {
    const fd = new FormData()
    fd.append('login', payload.login)
    fd.append('password', payload.password)
    this.cookieService.deleteAll()
    return this.http.post<Token>(`${this.bazeApiUrl}token`, fd)
    .pipe(
      tap(val=> {
        this.saveToken(val)
      })
    )
  }

  register(payload: {login: string, password: string, confirmPassword: string}) {
    const fd = new FormData()
    fd.append('login', payload.login)
    fd.append('password', payload.password)
    this.cookieService.deleteAll()
    return this.http.post<Token>(`${this.bazeApiUrl}register`, fd)
    .pipe(
      tap(val => this.saveToken(val))
    )
  }

  refreshAuthToken() {
    return this.http.post<Token>(
      `${this.bazeApiUrl}refresh`,
      {
        refresh_token: this.refresh_token
      }
    ).pipe(
      tap(val => this.saveToken(val)),
      catchError(err => {
        return throwError(err)
      })
    )
  }

  logout(){
    this.cookieService.deleteAll()
    this.token = null
    this.refresh_token = null
    this.router.navigate(['/login'])
  }

  saveToken(res: Token) {
    this.userId = res.userid
    this.token = res.token
    this.refresh_token = res.refresh_token
    this.cookieService.set('token', this.token)
    this.cookieService.set('refresh_token', this.refresh_token)
  }
}

