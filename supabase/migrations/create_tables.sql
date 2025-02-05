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
  -- Author reference only
  user_id UUID,
  -- Persona reference only
  persona_id UUID
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
  -- Security checks
  IF p_radius_meters > 50000 THEN
    RAISE EXCEPTION 'Radius cannot exceed 50km';
  END IF;

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
          AND er.effective_type >= p.visibility_level
        )
      )
  )
  SELECT 
    p.id,
    p.content,
    p.visibility_level,
    p.response_level,
    p.created_at,
    p.distance_meters,
    p.user_id,
    p.persona_id
  FROM filtered_posts p
  ORDER BY 
    CASE 
      WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN distance_meters
      ELSE p.created_at 
    END ASC
  LIMIT LEAST(p_max_results, 1000);
END;
$$ 
LANGUAGE plpgsql
SECURITY DEFINER
STABLE; 