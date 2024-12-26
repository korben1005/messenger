import { Component, inject, signal } from '@angular/core';
import { FormGroup, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../authentication/auth.service';
import { Router } from '@angular/router';
import { CookieService } from 'ngx-cookie-service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss'
})
export class LoginPageComponent {
  authService = inject(AuthService)
  router = inject(Router)
  cookieService = inject(CookieService)


  loginForm = new FormGroup({
    login: new FormControl<string>('', [Validators.required]),
    password: new FormControl<string>('', [Validators.required]),
  });

  onSubmit() {
    if (this.loginForm.valid) {
      const payload = this.loginForm.value as { login: string; password: string };
      this.authService.login(payload).subscribe(
        res => {
          this.router.navigate(['']);
        }
      );
    }
  }

  isPasswordVisible = signal<boolean>(false)

  goToRegistration() {
    this.router.navigate(['/register']);
  }
}
