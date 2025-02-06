-- Create ENUMs for common types
CREATE TYPE relationship_type AS ENUM (
  'blocked',
  'muted',
  'follower',
  'acquaintance', 
  'friend',
  'member',
  'moderator',
  'manager',
  'owner'
);

CREATE TYPE target_type AS ENUM (
  'user',
  'persona'
);

CREATE TYPE persona_type AS ENUM (
  'user',
  'business',
  'group',
  'alias',
  'band',
  'event'
);

-- Create composite type for post returns
CREATE TYPE post_with_author AS (
  -- Post fields
  id UUID,
  content JSONB,
  visibility_level relationship_type,
  response_level relationship_type,
  created_at TIMESTAMP WITH TIME ZONE,
  distance_meters FLOAT,
  -- Author fields
  user_id UUID,
  user_handle TEXT,
  user_avatar_url TEXT,
  user_relationship relationship_type,
  -- Persona fields
  persona_id UUID,
  persona_handle TEXT,
  persona_avatar_url TEXT,
  persona_relationship relationship_type
);

-- Posts table
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content JSONB NOT NULL,
  visibility_level relationship_type NOT NULL,
  response_level relationship_type NOT NULL,
  persona_id UUID REFERENCES personas(id),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  parent_id UUID REFERENCES posts(id),
  lat FLOAT,
  lng FLOAT,
  views INTEGER DEFAULT 0,
  tags JSONB DEFAULT '[]'::JSONB,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create GIN index for tags
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_persona_id ON posts(persona_id);
CREATE INDEX idx_posts_parent_id ON posts(parent_id);
CREATE INDEX idx_post_tags ON posts USING GIN (tags);
CREATE INDEX idx_posts_location ON posts USING GIST(
  ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
);

-- Effective relationships table
CREATE TABLE effective_relationships (
  user_id UUID REFERENCES auth.users(id),
  target_id UUID NOT NULL,
  target_type target_type NOT NULL,
  effective_type relationship_type NOT NULL,
  PRIMARY KEY (user_id, target_id)
);

-- Read/delivery tracking for large groups
CREATE TABLE post_read_delivery (
  post_id UUID REFERENCES posts(id),
  user_id UUID REFERENCES auth.users(id),
  delivered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read_at TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (post_id, user_id)
);

-- Helper function to get relationship type ordinal
CREATE OR REPLACE FUNCTION relationship_type_ordinal(rel relationship_type) 
RETURNS int AS $$
BEGIN
  -- Order matches our ENUM definition:
  -- blocked = 0, muted = 1, follower = 2, acquaintance = 3, friend = 4,
  -- member = 5, moderator = 6, manager = 7, owner = 8
  RETURN array_position(
    ARRAY['blocked', 'muted', 'follower', 'acquaintance', 'friend', 
          'member', 'moderator', 'manager', 'owner']::relationship_type[],
    rel
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Enhanced get_posts function with normalized data
CREATE OR REPLACE FUNCTION get_posts(
  p_lat float DEFAULT NULL,
  p_lng float DEFAULT NULL,
  p_radius_meters float DEFAULT NULL,
  p_max_results int DEFAULT 100,
  p_min_created_at timestamp DEFAULT NULL,
  p_persona_id uuid DEFAULT NULL,
  p_parent_id uuid DEFAULT NULL,
  p_tags jsonb DEFAULT NULL
) RETURNS SETOF post_with_author AS $$
BEGIN
  RETURN QUERY
  WITH filtered_posts AS (
    SELECT 
      p.*,
      CASE 
        WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
          ST_Distance(
            ST_MakePoint(p.lng, p.lat)::geography,
            ST_MakePoint(p_lng, p_lat)::geography
          )
        ELSE NULL
      END as distance_meters
    FROM posts p
    WHERE 
      -- Basic filters
      p.deleted_at IS NULL
      -- Location filter if coordinates provided
      AND (
        (p_lat IS NULL AND p_lng IS NULL) OR
        ST_DWithin(
          ST_MakePoint(p.lng, p.lat)::geography,
          ST_MakePoint(p_lng, p_lat)::geography,
          p_radius_meters
        )
      )
      -- Other filters
      AND (p_persona_id IS NULL OR p.persona_id = p_persona_id)
      AND (p_parent_id IS NULL OR p.parent_id = p_parent_id)
      AND (p_tags IS NULL OR p.tags @> p_tags)
      AND (p_min_created_at IS NULL OR p.created_at > p_min_created_at)
      -- Security: Only return posts user can see
      AND (
        auth.uid() = p.user_id 
        OR p.visibility_level = 'public'
        OR EXISTS (
          SELECT 1 FROM effective_relationships er
          WHERE er.user_id = auth.uid()
          AND (
            (er.target_id = p.user_id AND er.target_type = 'user')
            OR (er.target_id = p.persona_id AND er.target_type = 'persona')
          )
          AND relationship_type_ordinal(er.effective_type) >= relationship_type_ordinal(p.visibility_level)
        )
      )
  ),
  relationships AS (
    -- Get effective relationships for the current user
    SELECT 
      target_id,
      target_type,
      effective_type
    FROM effective_relationships
    WHERE user_id = auth.uid()
  )
  SELECT 
    p.id,
    p.content,
    p.visibility_level,
    p.response_level,
    p.created_at,
    p.distance_meters,
    -- Author info
    p.user_id,
    u.handle as user_handle,
    u.avatar_url as user_avatar_url,
    COALESCE(ur.effective_type, 'public'::relationship_type) as user_relationship,
    -- Persona info
    p.persona_id,
    per.handle as persona_handle,
    per.avatar_url as persona_avatar_url,
    COALESCE(pr.effective_type, 'public'::relationship_type) as persona_relationship
  FROM filtered_posts p
  LEFT JOIN users u ON p.user_id = u.id
  LEFT JOIN personas per ON p.persona_id = per.id
  -- Join relationships
  LEFT JOIN relationships ur ON ur.target_id = p.user_id AND ur.target_type = 'user'
  LEFT JOIN relationships pr ON pr.target_id = p.persona_id AND pr.target_type = 'persona'
  ORDER BY 
    CASE 
      WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN distance_meters
      ELSE p.created_at 
    END DESC
  LIMIT LEAST(p_max_results, 1000);
END;
$$ 
LANGUAGE plpgsql
SECURITY DEFINER
STABLE;

-- Notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID NOT NULL,
  recipient_type target_type NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mention', 'reply', 'reaction', 'follow', 'new_post', 'dm', 'system')),
  source_id UUID NOT NULL,
  persona_id UUID REFERENCES personas(id),
  delivered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read_at TIMESTAMP WITH TIME ZONE,
  handled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tags table
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL
);

-- Post engagements table
CREATE TABLE post_engagement (
  post_id UUID REFERENCES posts(id),
  user_id UUID REFERENCES auth.users(id),
  type TEXT NOT NULL CHECK (type IN ('tag', 'topic', 'reaction')),
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id, type, value)
);

-- Mentions table
CREATE TABLE mentions (
  post_id UUID REFERENCES posts(id),
  mentioned_id UUID NOT NULL,
  mentioned_type target_type NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (post_id, mentioned_id)
);

-- User blocks table
CREATE TABLE user_blocks (
  user_id UUID REFERENCES auth.users(id),
  blocked_user_id UUID REFERENCES auth.users(id),
  reason TEXT,
  blocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, blocked_user_id)
);

-- Personas table
CREATE TABLE personas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type persona_type NOT NULL,
  handle TEXT UNIQUE NOT NULL CHECK (handle ~ '^[a-zA-Z0-9_]{1,30}$'),
  avatar_url TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for metadata queries
CREATE INDEX idx_personas_metadata ON personas USING GIN (metadata);

-- Add trigger to update updated_at
CREATE TRIGGER set_timestamp
  BEFORE UPDATE ON personas
  FOR EACH ROW
  EXECUTE PROCEDURE trigger_set_timestamp();

-- Persona relationships table
CREATE TABLE persona_relationships (
  user_id UUID REFERENCES auth.users(id),
  persona_id UUID REFERENCES personas(id),
  type relationship_type NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, persona_id)
);

-- Add indexes for performance
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, recipient_type);
CREATE INDEX idx_notifications_unread ON notifications(recipient_id) WHERE read_at IS NULL;
CREATE INDEX idx_post_engagement_type ON post_engagement(type, value);
CREATE INDEX idx_mentions_mentioned ON mentions(mentioned_id, mentioned_type);
CREATE INDEX idx_persona_relationships_type ON persona_relationships(type);

-- RLS Policies

-- Enable RLS on all tables
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE effective_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_read_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_relationships ENABLE ROW LEVEL SECURITY;

-- Posts policies
CREATE POLICY "Users can read posts they have access to" ON posts
  FOR SELECT USING (
    auth.uid() = user_id 
    OR visibility_level = 'public'
    OR EXISTS (
      SELECT 1 FROM effective_relationships er
      WHERE er.user_id = auth.uid()
      AND (
        (er.target_id = user_id AND er.target_type = 'user')
        OR (er.target_id = persona_id AND er.target_type = 'persona')
      )
      AND relationship_type_ordinal(er.effective_type) >= relationship_type_ordinal(visibility_level)
    )
  );

CREATE POLICY "Users can create their own posts" ON posts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own posts" ON posts
  FOR UPDATE USING (auth.uid() = user_id);

-- Effective relationships policies
CREATE POLICY "Users can read their relationships" ON effective_relationships
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can manage relationships" ON effective_relationships
  USING (auth.uid() IS NOT NULL);

-- Post read delivery policies
CREATE POLICY "Users can see their own read status" ON post_read_delivery
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own read status" ON post_read_delivery
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Notifications policies
CREATE POLICY "Users can read their notifications" ON notifications
  FOR SELECT USING (
    (recipient_type = 'user' AND recipient_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM persona_relationships pr
      WHERE pr.user_id = auth.uid()
      AND pr.persona_id = recipient_id
      AND recipient_type = 'persona'
      AND pr.type IN ('moderator', 'manager', 'owner')
    )
  );

CREATE POLICY "System can create notifications" ON notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Tags policies (public readable, admin writable)
CREATE POLICY "Anyone can read tags" ON tags
  FOR SELECT USING (true);

-- Post engagement policies
CREATE POLICY "Users can read engagements" ON post_engagement
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_id
      AND (
        p.visibility_level = 'public'
        OR auth.uid() = p.user_id
        OR EXISTS (
          SELECT 1 FROM effective_relationships er
          WHERE er.user_id = auth.uid()
          AND (
            (er.target_id = p.user_id AND er.target_type = 'user')
            OR (er.target_id = p.persona_id AND er.target_type = 'persona')
          )
          AND relationship_type_ordinal(er.effective_type) >= relationship_type_ordinal(p.visibility_level)
        )
      )
    )
  );

CREATE POLICY "Users can create their own engagements" ON post_engagement
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Mentions policies
CREATE POLICY "Users can read mentions they can see" ON mentions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_id
      AND (
        p.visibility_level = 'public'
        OR auth.uid() = p.user_id
        OR EXISTS (
          SELECT 1 FROM effective_relationships er
          WHERE er.user_id = auth.uid()
          AND (
            (er.target_id = p.user_id AND er.target_type = 'user')
            OR (er.target_id = p.persona_id AND er.target_type = 'persona')
          )
          AND relationship_type_ordinal(er.effective_type) >= relationship_type_ordinal(p.visibility_level)
        )
      )
    )
  );

-- User blocks policies
CREATE POLICY "Users can read their blocks" ON user_blocks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their blocks" ON user_blocks
  FOR ALL USING (auth.uid() = user_id);

-- Persona relationships policies
CREATE POLICY "Users can read persona relationships" ON persona_relationships
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM persona_relationships pr
      WHERE pr.user_id = auth.uid()
      AND pr.persona_id = persona_id
      AND pr.type IN ('moderator', 'manager', 'owner')
    )
  );

CREATE POLICY "Users can manage their relationships" ON persona_relationships
  FOR ALL USING (auth.uid() = user_id);

-- Function to search auth.users by phone or email
CREATE OR REPLACE FUNCTION search_auth_user(
  p_phone TEXT,
  p_email TEXT
) RETURNS TABLE (
  id UUID,
  email VARCHAR,
  phone VARCHAR,
  created_at TIMESTAMPTZ
) SECURITY DEFINER AS $$
BEGIN
  -- First try phone
  RETURN QUERY
  SELECT 
    au.id,
    au.email::VARCHAR,
    au.phone::VARCHAR,
    au.created_at
  FROM auth.users au
  WHERE au.phone = p_phone
  LIMIT 1;

  -- If no result, try email
  IF NOT FOUND AND p_email IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      au.id,
      au.email::VARCHAR,
      au.phone::VARCHAR,
      au.created_at
    FROM auth.users au
    WHERE au.email = p_email
    LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION search_auth_user TO service_role;

-- Add transaction helpers
CREATE OR REPLACE FUNCTION begin_transaction()
RETURNS void AS $$
BEGIN
  -- Start transaction
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION commit_transaction()
RETURNS void AS $$
BEGIN
  -- Commit transaction
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION rollback_transaction()
RETURNS void AS $$
BEGIN
  -- Rollback transaction
END;
$$ LANGUAGE plpgsql;

-- Add trigger for relationship changes
CREATE OR REPLACE FUNCTION notify_relationship_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify on significant changes
  IF (TG_OP = 'INSERT') OR 
     (TG_OP = 'UPDATE' AND OLD.type != NEW.type) THEN
    
    -- Insert notification
    INSERT INTO notifications (
      recipient_id,
      recipient_type,
      type,
      source_id,
      metadata
    ) VALUES (
      NEW.persona_id,
      'user',
      'relationship_change',
      NEW.user_id,
      jsonb_build_object(
        'old_type', CASE WHEN TG_OP = 'UPDATE' THEN OLD.type ELSE 'public' END,
        'new_type', NEW.type,
        'timestamp', NOW()
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER relationship_change_notify
  AFTER INSERT OR UPDATE ON persona_relationships
  FOR EACH ROW
  EXECUTE FUNCTION notify_relationship_change();

-- Enable RLS on personas table
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;

-- Allow reading all personas (since they represent public profiles)
CREATE POLICY "Anyone can view personas" ON personas
    FOR SELECT
    USING (true);

-- Only owners and admins can update their personas
CREATE POLICY "Users can update their own personas" ON personas
    FOR UPDATE
    USING (auth.uid() = owner_id);

-- Only owners and admins can delete their personas
CREATE POLICY "Users can delete their own personas" ON personas
    FOR DELETE
    USING (auth.uid() = owner_id);

-- Only authenticated users can create personas
CREATE POLICY "Authenticated users can create personas" ON personas
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated'); 