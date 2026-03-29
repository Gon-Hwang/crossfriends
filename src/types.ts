export type Bindings = {
  DB: D1Database;
  R2: R2Bucket;
  YOUTUBE_API_KEY?: string;
  RESEND_API_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}

export interface User {
  id: number;
  email: string;
  name: string;
  bio?: string;
  avatar_url?: string;
  cover_url?: string;
  church?: string;
  pastor?: string;
  denomination?: string;
  location?: string;
  position?: string;
  role?: 'user' | 'admin' | 'moderator';
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: number;
  user_id: number;
  content: string;
  image_url?: string;
  verse_reference?: string;
  created_at: string;
  updated_at: string;
  user?: User;
  likes_count?: number;
  comments_count?: number;
  is_liked?: boolean;
}

export interface Comment {
  id: number;
  post_id: number;
  user_id: number;
  content: string;
  created_at: string;
  user?: User;
}

export interface Like {
  id: number;
  post_id: number;
  user_id: number;
  created_at: string;
}

export interface Friendship {
  id: number;
  user_id: number;
  friend_id: number;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  updated_at: string;
}

export interface PrayerRequest {
  id: number;
  user_id: number;
  title: string;
  content: string;
  is_anonymous: boolean;
  status: 'active' | 'answered' | 'closed';
  created_at: string;
  updated_at: string;
  user?: User;
  responses_count?: number;
}

export interface PrayerResponse {
  id: number;
  prayer_request_id: number;
  user_id: number;
  content: string;
  created_at: string;
  user?: User;
}
