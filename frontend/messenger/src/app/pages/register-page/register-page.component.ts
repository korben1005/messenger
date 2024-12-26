import { Component, inject, OnDestroy } from '@angular/core';
import { FormGroup, FormControl, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors, FormBuilder} from '@angular/forms';
import { AuthService } from '../../authentication/auth.service';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './register-page.component.html',
  styleUrl: './register-page.component.scss'
})
export class RegisterPageComponent implements OnDestroy{
  authService = inject(AuthService)
  router = inject(Router)
  fb = inject(FormBuilder)
  registrationFormSub: Subscription
  errorLogin: string | null = null;

  registrationForm = this.fb.group({
    login: ['', [Validators.required]],
    password: ['', [Validators.required]],
    confirmPassword: ['', [Validators.required]],
    },
    { validators: this.passwordMatchValidator }
  )

  passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password')?.value;
    const confirmPassword = control.get('confirmPassword')?.value;

    return password === confirmPassword ? null : { passwordMismatch: true };
  }

  constructor() {
    this.registrationFormSub = this.registrationForm.valueChanges
    .subscribe(() => {
      const form = this.registrationForm;
      if (form.hasError('passwordMismatch')) {
        form.get('confirmPassword')?.setErrors({ passwordMismatch: true });
      } else {
        form.get('confirmPassword')?.setErrors(null);
      }
    });
  }

  onSubmit() {
    if (this.registrationForm.valid) {
      const payload = this.registrationForm.value as { login: string; password: string; confirmPassword: string };
      console.log(payload);

      this.authService.register(payload).subscribe({
        next: (res) => {
          this.router.navigate(['/settingsAccount']);
        },
        error: (err) => {
          if (err.status === 409) {
            // Если статус 409, выводим сообщение о конфликте
            this.errorLogin = 'Пользователь с таким именем уже существует.';
          } else {
            // Обрабатываем другие возможные ошибки
            this.errorLogin = err.error.message || 'Произошла ошибка при регистрации.';
          }
        }
      });
    }
  }



  goToLogin(){
    this.router.navigate(['/login']);
  }

  ngOnDestroy() {
    this.registrationFormSub?.unsubscribe();
  }

}
