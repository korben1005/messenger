import { Routes } from '@angular/router';
import { LayoutComponent } from './common-ui/layout/layout.component';
import { loginGuard } from './authentication/login.guard';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { RegisterPageComponent } from './pages/register-page/register-page.component';
import { ProfilePageComponent } from './pages/profile-page/profile-page.component';
import { SettingsPageComponent } from './pages/settings-page/settings-page.component';
import { ChatsPageComponent } from './pages/chats-page/chats-page.component';
import { SearchPageComponent } from './pages/search-page/search-page.component';

export const routes: Routes = [
  {path: '', component: LayoutComponent, children: [
      {path: '', redirectTo: 'profile/me', pathMatch: 'full'},
      {path: 'profile/:id', component: ProfilePageComponent},
      {path: 'settingsAccount', component: SettingsPageComponent},
      {path: 'searchProfile', component: SearchPageComponent}
    ],
    canActivate: [loginGuard]
  },
  {path: 'chats', component: ChatsPageComponent, canActivate: [loginGuard]},
  {path: 'login', component: LoginPageComponent},
  {path: 'register', component: RegisterPageComponent}
];
