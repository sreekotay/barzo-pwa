export type RelationshipType = 
  | 'blocked'
  | 'muted'
  | 'follower'
  | 'acquaintance'
  | 'friend'
  | 'member'
  | 'moderator'
  | 'manager'
  | 'owner'

export type TargetType = 'user' | 'persona'

export type PersonaType = 'business' | 'group' | 'alias'

export type PostCreate = {
  content: any
  visibilityLevel?: RelationshipType
  responseLevel?: RelationshipType
  personaId?: string | null
  parentId?: string | null
  lat?: number | null
  lng?: number | null
  tags?: string[]
  expiresAt?: Date | null
} 