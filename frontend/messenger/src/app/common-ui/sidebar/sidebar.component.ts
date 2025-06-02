import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../authentication/auth.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent {
  authService = inject(AuthService)

  menuItems = [
    {
      label: 'Моя страница',
      icon: 'fa-house',
      link: 'profile/me'
    },
    {
      label: 'Чаты',
      icon: 'fa-message',
      link: 'chats'
    },
    {
      label: 'Поиск',
      icon: 'fa-magnifying-glass',
      link: 'searchProfile'
    }
  ]

  logout() {
    this.authService.logout()
  }
}
