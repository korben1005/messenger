import { Component, inject } from '@angular/core';
import { FormGroup, FormControl, ReactiveFormsModule } from '@angular/forms';
import { ProfileService } from '../../data/services/profile.service';

@Component({
  selector: 'app-create-post',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './create-post.component.html',
  styleUrl: './create-post.component.scss'
})
export class CreatePostComponent {
  profileService = inject(ProfileService)
  post = new FormGroup ({
    postContent: new FormControl<string>(''),
    postFiles: new FormControl<string[]>([]),
  })

  onSubmit() {

  }
}
