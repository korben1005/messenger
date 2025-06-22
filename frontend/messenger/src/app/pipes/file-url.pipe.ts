import { Pipe, PipeTransform, Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root', // Делает пайп доступным глобально
})

@Pipe({
  name: 'fileUrl',
  standalone: true
})
export class FileUrlPipe implements PipeTransform {

  transform(value: string | null): string | null{
    if(!value) return null
    const arr = value.split('/')
    const fileName = arr[1]
    return `https://localhost:443/data/uploads/${arr[0]}/${fileName}`;
  }

}
