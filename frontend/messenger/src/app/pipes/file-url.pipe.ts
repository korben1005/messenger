import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'fileUrl',
  standalone: true
})
export class FileUrlPipe implements PipeTransform {

  transform(value: string | null): string | null{
    if(!value) return null
    const arr = value.split('/')
    const fileName = encodeURIComponent(arr[1])
    return `http://localhost:3000/uploads/${arr[0]}/${fileName}`;
  }

}
