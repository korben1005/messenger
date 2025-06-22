import { Component, HostListener, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../authentication/auth.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent {
  authService = inject(AuthService);
  router = inject(Router);

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
  ];

  isMobile = false;
  isSidebarCollapsed = false;

  constructor() {
    this.checkScreenSize();
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: Event) {
    this.checkScreenSize();
  }

  checkScreenSize() {
    this.isMobile = window.innerWidth <= 768;
    if (this.isMobile && !this.isSidebarCollapsed) {
      this.isSidebarCollapsed = true; // Сворачиваем по умолчанию на мобильных
    }
    console.log(window.innerWidth)
  }

  toggleSidebar() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/login']); // Перенаправление после выхода
  }

  isActive(link: string): boolean {
    return this.router.isActive(link, {
      paths: 'exact', // Точное совпадение пути
      queryParams: 'ignored',
      fragment: 'ignored',
      matrixParams: 'ignored'
    });
  }
}
