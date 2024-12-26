import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const loginGuard: CanActivateFn = () => {
  const isLogged = inject(AuthService).isAuth
  if(isLogged){
    return true
  }
  return inject(Router).createUrlTree(['/login'])
};
