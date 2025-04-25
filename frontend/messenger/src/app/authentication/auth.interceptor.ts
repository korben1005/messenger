import { HttpInterceptorFn, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { AuthService } from './auth.service';
import { inject } from '@angular/core';
import { BehaviorSubject, catchError, filter, switchMap, tap, throwError } from 'rxjs';
import { Token } from './token';

let isRefreshing$ = new BehaviorSubject<boolean>(false)

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.token

  if(!token) return next(req)

    if(isRefreshing$.value) {
        return refreshAndProcced(authService, req, next)
    }

    return next(addToken(req, token)).pipe(
        catchError(error => {
            if(error.status === 403) {
                return refreshAndProcced(authService, req, next)
            }
            return throwError(error)
        })
    )
};

const refreshAndProcced = (authService: AuthService, req: HttpRequest<any>, next: HttpHandlerFn) => {
  if(!isRefreshing$.value){
      isRefreshing$.next(true)
      return authService.refreshAuthToken()
      .pipe(
          switchMap((res: Token) => {
              return next(addToken(req, res.token))
                .pipe(
                  tap(() => isRefreshing$.next(false))
                )
          })
      )
  }

  if(req.url.includes('refresh')) return next(addToken(req, authService.token!))

  return isRefreshing$.pipe(
    filter(isRefreshing => !isRefreshing),
    switchMap(res => {
      return next(addToken(req, authService.token!))
    })
  )
}

const addToken = (req: HttpRequest<any>, token: string) => {
  return req.clone({
      setHeaders: {
          Authorization: `Bearer ${token}`
      }
  })
}
