export interface Profile {
  id: number,
  login: string
  username: string,
  description: string,
  avatarUrl: string | null,
  isActive: boolean,
  city: string
}
