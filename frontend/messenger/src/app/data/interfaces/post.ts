export interface Post {
  id: number,
  userId: number,
  content: string,
  created_at: string,
  file: {
    fileName: string,
    fileUrl: string,
    fileExpansion: string,
    duration: number
    progress?: number;
  }
}
