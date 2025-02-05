import { supabase } from '../lib/supabaseClient'

class SocialService {
  // Relationship types (matching PostgreSQL ENUMs)
  static RELATIONSHIPS = {
    BLOCKED: 'blocked',
    MUTED: 'muted',
    FOLLOWER: 'follower',
    ACQUAINTANCE: 'acquaintance',
    FRIEND: 'friend',
    MEMBER: 'member',
    MODERATOR: 'moderator',
    MANAGER: 'manager',
    OWNER: 'owner'
  } as const

  // Target types (matching PostgreSQL ENUMs)
  static TARGET_TYPES = {
    USER: 'user',
    PERSONA: 'persona'
  } as const

  // Persona types (matching PostgreSQL ENUMs)
  static PERSONA_TYPES = {
    BUSINESS: 'business',
    GROUP: 'group',
    ALIAS: 'alias'
  } as const

  /**
   * Create a new post
   */
  async createPost({
    content,
    visibilityLevel = this.RELATIONSHIPS.PUBLIC,
    responseLevel = this.RELATIONSHIPS.PUBLIC,
    personaId = null,
    parentId = null,
    lat = null,
    lng = null,
    tags = [],
    expiresAt = null
  }) {
    const { data: user } = await supabase.auth.getUser()
    
    const { data, error } = await supabase
      .from('posts')
      .insert({
        content,
        visibility_level: visibilityLevel,
        response_level: responseLevel,
        persona_id: personaId,
        user_id: user.id,
        parent_id: parentId,
        lat,
        lng,
        tags,
        deleted_at: expiresAt
      })
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get posts with pagination and filters
   */
  async getPosts({
    personaId = null,
    parentId = null,
    tags = [],
    lat = null,
    lng = null,
    radius = 5000,
    minCreatedAt = null,
    limit = 20
  }) {
    // Get posts
    const { data: posts, error } = await supabase
      .rpc('get_posts', {
        p_persona_id: personaId,
        p_parent_id: parentId,
        p_tags: tags.length ? tags : null,
        p_lat: lat,
        p_lng: lng,
        p_radius_meters: radius,
        p_max_results: limit,
        p_min_created_at: minCreatedAt
      })

    if (error) throw error

    // Get unique user and persona IDs
    const userIds = [...new Set(posts.map(p => p.user_id))]
    const personaIds = [...new Set(posts.map(p => p.persona_id).filter(Boolean))]

    // Fetch users and personas in parallel
    const [{ data: users }, { data: personas }] = await Promise.all([
      supabase.from('users').select('id, handle, avatar_url').in('id', userIds),
      personaIds.length ? supabase.from('personas').select('id, handle, avatar_url').in('id', personaIds) : { data: [] }
    ])

    // Create lookup maps
    const userMap = new Map(users.map(u => [u.id, u]))
    const personaMap = new Map(personas.map(p => [p.id, p]))

    // Return formatted posts with latest user/persona data
    return posts.map(post => ({
      id: post.id,
      content: post.content,
      visibility: post.visibility_level,
      responseLevel: post.response_level,
      createdAt: post.created_at,
      distance: post.distance_meters,
      author: userMap.get(post.user_id),
      persona: post.persona_id ? personaMap.get(post.persona_id) : null
    }))
  }

  // Helper method to format post data
  formatPost(post) {
    return {
      id: post.id,
      content: post.content,
      visibility: post.visibility_level,
      responseLevel: post.response_level,
      createdAt: post.created_at,
      distance: post.distance_meters,
      author: {
        id: post.author_id,
        handle: post.author_handle,
        avatarUrl: post.author_avatar_url
      },
      persona: post.persona_id ? {
        id: post.persona_id,
        handle: post.persona_handle,
        avatarUrl: post.persona_avatar_url
      } : null
    }
  }

  /**
   * Update relationship between users/personas
   */
  async updateRelationship(targetId, targetType, relationshipType) {
    const { data: user } = await supabase.auth.getUser()
    
    const { data, error } = await supabase
      .from('effective_relationships')
      .upsert({
        user_id: user.id,
        target_id: targetId,
        target_type: targetType,
        effective_type: relationshipType
      })
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Track post read status
   */
  async markPostAsRead(postId) {
    const { data: user } = await supabase.auth.getUser()
    
    const { data, error } = await supabase
      .from('post_read_delivery')
      .upsert({
        post_id: postId,
        user_id: user.id,
        read_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Subscribe to real-time notifications
   */
  async subscribeToNotifications(callback) {
    const { data: user } = await supabase.auth.getUser()
    
    return supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`
        },
        callback
      )
      .subscribe()
  }
}

export default new SocialService() 