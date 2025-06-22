import { File } from "./file";

export interface Post {
  id: number,
  userId: number,
  content: string,
  created_at: string,
  files?: File[]
}
