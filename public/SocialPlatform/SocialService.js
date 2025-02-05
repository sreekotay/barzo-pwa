import { createClient } from '@supabase/supabase-js'

/** Mapping of relationship types to their numeric levels for comparison */
const RELATIONSHIP_LEVELS = {
  blocked: 0,
  muted: 1,
  follower: 2,
  acquaintance: 3,
  friend: 4,
  member: 5,
  moderator: 6,
  manager: 7,
  owner: 8
}

/** Valid relationship transitions defining allowed changes between relationship types */
const VALID_TRANSITIONS = {
  blocked: ['muted', 'follower'], // Can only unblock to muted or follower
  muted: ['blocked', 'follower'], // Can mute->block or unmute to follower
  follower: ['blocked', 'muted', 'acquaintance'],
  acquaintance: ['blocked', 'muted', 'follower', 'friend'],
  friend: ['blocked', 'muted', 'acquaintance', 'member'],
  member: ['blocked', 'muted', 'friend', 'moderator'],
  moderator: ['blocked', 'muted', 'member', 'manager'],
  manager: ['blocked', 'muted', 'moderator', 'owner'],
  owner: ['blocked', 'muted', 'manager']
}

/**
 * Service for managing social relationships and interactions
 */
export class SocialService {
  /**
   * Creates a new SocialService instance
   * @param {Object} supabase - Initialized Supabase client
   * @throws {Error} If supabase client is not authenticated
   */
  constructor(supabase) {
    if (!supabase) {
      throw new Error('Supabase client is required')
    }

    this.supabase = supabase
    
    // Get current session
    const { data: { session } } = supabase.auth.getSession()
    if (!session?.user) {
      throw new Error('Authentication required')
    }

    this.currentUser = session.user

    // Listen for auth state changes
    supabase.auth.onAuthStateChange((_event, session) => {
      this.currentUser = session?.user || null
    })
  }

  /**
   * Checks if service is authenticated
   * @returns {boolean} Whether there is a current user
   */
  isAuthenticated() {
    return !!this.currentUser
  }

  /**
   * Gets the current user
   * @returns {Object|null} Current user or null if not authenticated
   */
  getCurrentUser() {
    return this.currentUser
  }

  /**
   * Gets the current relationship between the current user and a target
   * @param {string} targetId - UUID of the target user/persona
   * @param {('user'|'persona')} targetType - Type of the target
   * @returns {Promise<string>} The relationship type, defaults to 'public' if none exists
   */
  async getRelationship(targetId, targetType = 'user') {
    const { data, error } = await this.supabase
      .from('effective_relationships')
      .select('effective_type')
      .eq('user_id', this.currentUser.id)
      .eq('target_id', targetId)
      .eq('target_type', targetType)
      .single()

    if (error) throw error
    return data?.effective_type || 'public'
  }

  /**
   * Sets or updates a relationship with a target, with validation and notifications
   * @param {string} targetId - UUID of the target user/persona
   * @param {('user'|'persona')} targetType - Type of the target
   * @param {string} newRelationType - The new relationship type to set
   * @throws {Error} If the relationship transition is invalid
   */
  async setRelationship(targetId, targetType, newRelationType) {
    // Get current relationship
    const currentType = await this.getRelationship(targetId, targetType)
    
    // Validate transition
    if (!this.isValidTransition(currentType, newRelationType)) {
      throw new Error(`Invalid relationship transition from ${currentType} to ${newRelationType}`)
    }

    // Start transaction
    const { error: txnError } = await this.supabase.rpc('begin_transaction')
    if (txnError) throw txnError

    try {
      // Update relationship
      const { error } = await this.supabase
        .from('persona_relationships')
        .upsert({
          user_id: this.currentUser.id,
          persona_id: targetId,
          type: newRelationType
        }, {
          onConflict: 'user_id,persona_id'
        })

      if (error) throw error

      // Create notification for recipient
      await this.supabase
        .from('notifications')
        .insert({
          recipient_id: targetId,
          recipient_type: targetType,
          type: 'relationship_change',
          source_id: this.currentUser.id,
          metadata: {
            old_type: currentType,
            new_type: newRelationType,
            timestamp: new Date().toISOString()
          }
        })

      // Commit transaction
      await this.supabase.rpc('commit_transaction')

    } catch (error) {
      // Rollback on error
      await this.supabase.rpc('rollback_transaction')
      throw error
    }
  }

  /**
   * Checks if a relationship transition is valid
   * @param {string} fromType - Current relationship type
   * @param {string} toType - Desired relationship type
   * @returns {boolean} Whether the transition is allowed
   */
  isValidTransition(fromType, toType) {
    // Public can transition to any non-privileged type
    if (fromType === 'public') {
      return ['follower', 'blocked', 'muted'].includes(toType)
    }

    // Check if transition is allowed
    return VALID_TRANSITIONS[fromType]?.includes(toType) || false
  }

  /**
   * Gets the numeric level of a relationship type
   * @param {string} type - The relationship type
   * @returns {number} The level (-1 if invalid)
   */
  getRelationshipLevel(type) {
    return RELATIONSHIP_LEVELS[type] || -1
  }

  // Helper to check if a relationship is an upgrade
  isRelationshipUpgrade(fromType, toType) {
    return this.getRelationshipLevel(toType) > this.getRelationshipLevel(fromType)
  }

  /**
   * Blocks a user
   * @param {string} userId - UUID of user to block
   * @param {string|null} reason - Optional reason for the block
   */
  async blockUser(userId, reason = null) {
    const { error } = await this.supabase
      .from('user_blocks')
      .insert({
        user_id: this.currentUser.id,
        blocked_user_id: userId,
        reason
      })

    if (error) throw error
  }

  /**
   * Mutes a user (hides their content without blocking)
   * @param {string} userId - UUID of user to mute
   */
  async muteUser(userId) {
    const { error } = await this.supabase
      .from('persona_relationships')
      .upsert({
        user_id: this.currentUser.id,
        persona_id: userId,
        type: 'muted'
      })

    if (error) throw error
  }

  /**
   * Removes a mute from a user
   * @param {string} userId - UUID of user to unmute
   */
  async unmuteUser(userId) {
    const { error } = await this.supabase
      .from('persona_relationships')
      .delete()
      .eq('user_id', this.currentUser.id)
      .eq('persona_id', userId)
      .eq('type', 'muted')

    if (error) throw error
  }

  /**
   * Removes a block from a user
   * @param {string} userId - UUID of user to unblock
   */
  async unblockUser(userId) {
    const { error } = await this.supabase
      .from('user_blocks')
      .delete()
      .eq('user_id', this.currentUser.id)
      .eq('blocked_user_id', userId)

    if (error) throw error
  }

  /**
   * Gets notifications for the current user
   * @param {number} limit - Maximum number of notifications to return
   * @returns {Promise<Array>} List of notifications
   */
  async getNotifications(limit = 20) {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', this.currentUser.id)
      .eq('recipient_type', 'user')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return data
  }

  /**
   * Marks a notification as read
   * @param {string} notificationId - UUID of notification
   */
  async markNotificationRead(notificationId) {
    const { error } = await this.supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('recipient_id', this.currentUser.id)

    if (error) throw error
  }

  /**
   * Subscribes to real-time notifications
   * @param {Function} callback - Function to call when notification received
   * @returns {Object} Subscription object
   */
  subscribeToNotifications(callback) {
    return this.supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${this.currentUser.id}`
      }, callback)
      .subscribe()
  }

  /**
   * Checks if current user has required permission level for target
   * @param {string} targetId - UUID of target user/persona
   * @param {('user'|'persona')} targetType - Type of target
   * @param {string} requiredLevel - Required relationship level
   * @returns {Promise<boolean>} Whether user has required permission
   */
  async hasPermission(targetId, targetType, requiredLevel) {
    const relationship = await this.getRelationship(targetId, targetType)
    // Use the ordinal function from our DB to compare levels
    const levels = ['blocked', 'muted', 'follower', 'acquaintance', 'friend', 
                   'member', 'moderator', 'manager', 'owner']
    return levels.indexOf(relationship) >= levels.indexOf(requiredLevel)
  }

  /**
   * Searches for personas with various filters
   * @param {Object} options - Search options
   * @param {string} options.query - Search query string
   * @param {string} options.type - Persona type to filter by
   * @param {number} options.limit - Max results to return
   * @param {number} options.offset - Pagination offset
   * @param {('all'|'blocked'|'muted'|'active')} options.filter - Relationship filter
   * @returns {Promise<Array>} Matching personas
   */
  async searchPersonas({ query = '', type = 'user', limit = 20, offset = 0, filter = 'all' }) {
    let blockedIds = []
    
    if (filter !== 'all') {
      // Get blocked/muted users
      const { data: relationships } = await this.supabase
        .from('effective_relationships')
        .select('target_id, effective_type')
        .eq('user_id', this.currentUser.id)
        .in('effective_type', ['blocked', 'muted'])
        .eq('target_type', 'user')

      if (filter === 'blocked') {
        // Only show blocked users
        blockedIds = relationships
          ?.filter(r => r.effective_type === 'blocked')
          .map(r => r.target_id) || []
      } else if (filter === 'muted') {
        // Only show muted users
        blockedIds = relationships
          ?.filter(r => r.effective_type === 'muted')
          .map(r => r.target_id) || []
      } else if (filter === 'active') {
        // Exclude blocked and muted
        blockedIds = relationships?.map(r => r.target_id) || []
      }
    }

    // Query personas with filters
    const queryObj = this.supabase
      .from('personas')
      .select(`
        *,
        effective_relationships!inner(effective_type)
      `)
      .eq('type', type)

    // Apply filter
    if (filter === 'blocked' || filter === 'muted') {
      queryObj.in('owner_id', blockedIds)
    } else if (filter === 'active') {
      queryObj.not('owner_id', 'in', blockedIds)
    }

    // Apply search
    if (query) {
      queryObj.or(`
        handle.ilike.%${query}%,
        metadata->profile->first_name.ilike.%${query}%,
        metadata->profile->last_name.ilike.%${query}%
      `)
    }

    const { data, error } = await queryObj
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    return data
  }

  /**
   * Gets all relationships for the current user
   * @param {string|null} type - Optional relationship type to filter by
   * @returns {Promise<Array>} List of relationships with persona details
   */
  async getMyRelationships(type = null) {
    const query = this.supabase
      .from('persona_relationships')
      .select(`
        type,
        persona:personas(
          id,
          handle,
          type,
          avatar_url,
          metadata,
          owner_id
        )
      `)
      .eq('user_id', this.currentUser.id)

    if (type) {
      query.eq('type', type)
    }

    const { data, error } = await query
    if (error) throw error
    return data
  }
} 