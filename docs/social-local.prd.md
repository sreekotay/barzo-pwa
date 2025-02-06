**Persona-Based Social & Messaging Platform -- PRD**
===================================================

**1\. Overview**
----------------

This document outlines the requirements and structure for a **persona-based social and messaging platform**. The system allows users to interact **as themselves or on behalf of personas** (businesses, groups, or alternate identities), with **granular visibility controls, threaded conversations, real-time engagement, and notification tracking**.

These are the core features and functionality of the platform as expresed in these tables and RLS policies.

1. Users
```sql
-- Authentication handled by Supabase Auth (auth.users table)
-- No separate users table needed
```
✅ User authentication and core data handled by Supabase Auth

2. Personas Table
```sql
CREATE TABLE personas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    type persona_type NOT NULL,
    handle TEXT UNIQUE NOT NULL CHECK (handle ~ '^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,29}$'),
    avatar_url TEXT,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```
✅ Personas represent businesses, groups, or alternate identities
✅ Core fields are normalized for efficient querying
✅ Public profile data stored in metadata JSONB
✅ GIN index on metadata enables efficient filtering
✅ Handles must start with letter/number/underscore, can contain hyphens after
✅ Maximum handle length of 30 characters

3. Personas Private Table
```sql
CREATE TABLE personas_private (
    persona_id UUID PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
    email TEXT,
    phone TEXT,
    dob DATE,
    full_name TEXT,
    address JSONB,
    social_security TEXT,
    tax_id TEXT,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```
✅ Stores sensitive/private persona information
✅ Strict RLS policies limit access to owners and managers
✅ Flexible metadata for type-specific private data
✅ Cascading deletes with parent persona

#### **Private Metadata Structure**

The private `metadata` JSONB field contains sensitive type-specific information:

For type "user":
```json
{
  "identity": {
    "first_name": "John",
    "last_name": "Doe",
    "external_id": "12345"
  },
  "preferences": {
    "email_notifications": true,
    "theme": "dark"
  },
  "settings": {
    "language": "en",
    "timezone": "America/Los_Angeles"
  }
}
```

For type "business":
```json
{
  "banking": {
    "account_number": "****1234",
    "routing_number": "****5678",
    "bank_name": "First National Bank"
  },
  "tax": {
    "ein": "12-3456789",
    "tax_jurisdiction": "CA"
  },
  "legal": {
    "incorporation_date": "2020-01-01",
    "business_type": "LLC",
    "registered_agent": {
      "name": "John Smith",
      "address": "123 Main St"
    }
  }
}
```

For type "group":
```json
{
  "profile": {
    "banner_image_url": "https://...",
    "name": "SF Hikers",
    "description": "Hiking group in SF",
    "rules": ["Be nice", "Leave no trace"],
    "join_requirements": "approval_needed",
    "category": "outdoors"
  }
}
```

For type "band":
```json
{
  "profile": {
    "banner_image_url": "https://...",
    "name": "The Rockers",
    "genre": ["rock", "indie"],
    "booking_email": "book@therockers.com",
    "members": [
      {"name": "John", "instrument": "guitar"},
      {"name": "Jane", "instrument": "drums"}
    ],
    "upcoming_shows": [
      {"date": "2024-04-01", "venue": "The Forum"}
    ]
  }
}
```

For type "event":
```json
{
  "profile": {
    "banner_image_url": "https://...",
    "name": "Summer Festival 2024",
    "date": {
      "start": "2024-07-01T15:00:00Z",
      "end": "2024-07-03T23:00:00Z"
    },
    "venue": {
      "name": "Central Park",
      "address": "123 Park Ave",
      "lat": 37.7749,
      "lng": -122.4194
    },
    "tickets": {
      "url": "https://tickets.com/...",
      "price_range": ["$50", "$200"]
    }
  }
}
```

Benefits:
- **Type-Specific Fields**: Each persona type has relevant fields
- **Flexible Schema**: Easy to add new fields per type
- **Efficient Storage**: Only store needed fields
- **Queryable**: GIN index enables searching metadata
- **Versioning**: Can add schema version for migrations

#### **Persona Types**

Different persona types have different profile expectations:
- **Business**: Emphasizes contact info, hours, location
- **Group**: Focuses on purpose, membership rules
- **Alias**: May omit or use pseudonymous information
- **Band**: Highlights genre, bookings, members
- **Event**: Dates, venue, ticketing info

4. Persona Relationships Table
```sql
CREATE TABLE persona_relationships (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
    type relationship_type NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, persona_id)
);
```

✅ Stores all relationships, including social connections, memberships, and moderation roles.
✅ blocked and muted override any other relationship.

5. Effective Relationships Table
```sql
CREATE TABLE effective_relationships (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    target_id UUID NOT NULL,
    target_type target_type NOT NULL,
    effective_type relationship_type NOT NULL,
    PRIMARY KEY (user_id, target_id, target_type)
);
```
✅ Precomputed for efficient RLS and permission lookups.

6. Posts Table
```sql
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content JSONB NOT NULL,
    visibility_level relationship_type NOT NULL,
    response_level relationship_type NOT NULL,
    persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    lat FLOAT,
    lng FLOAT,
    views INTEGER DEFAULT 0,
    tags JSONB DEFAULT '[]'::JSONB,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```
✅ Tags are stored as a JSONB array of tag GUIDs for optimized filtering.
✅ Uses visibility_level and response_level to control access.

7. Post Read & Delivery Tracking
```sql
CREATE TABLE post_read_delivery (
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    delivered_at TIMESTAMP DEFAULT NOW(),
    read_at TIMESTAMP NULL,
    PRIMARY KEY (post_id, user_id)
);
```
✅ For non-public posts, tracks when a post is delivered and read.

8. Notifications Table
```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL,
    recipient_type ENUM('user', 'persona') NOT NULL,
    type ENUM('mention', 'reply', 'reaction', 'follow', 'new_post', 'dm', 'system') NOT NULL,
    source_id UUID NOT NULL,
    persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
    delivered_at TIMESTAMP DEFAULT NOW(),
    read_at TIMESTAMP NULL,
    handled_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```
✅ Stores all notifications, including persona-related ones.
✅ handled_at is used for moderators acting on persona mentions.

9. Tags Table
```sql
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL
);
```
✅ Stores tags with GUIDs to prevent inconsistencies.

10. Post Engagements Table (Reactions, Topics, etc.)
```sql
CREATE TABLE post_engagement (
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    type ENUM('tag', 'topic', 'reaction') NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id, type, value)
);
```
✅ Stores reactions, topics, and tags in one optimized table.

11. Mentions Table
```sql
CREATE TABLE mentions (
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    mentioned_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (post_id, mentioned_id)
);
```
✅ Stores mentions for efficient notifications and lookups.

12. User Blocks Table
```sql
CREATE TABLE user_blocks (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    blocked_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    reason TEXT,
    blocked_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, blocked_user_id)
);
```
✅ For system-wide user blocks outside of personas.

* * * * *

**2\. Core Features & Functionality**
-------------------------------------

### **2.1 Personas & Relationships**

-   Users can interact as **personas**, which represent **businesses, groups, or alternate identities**.
-   **Personas replace traditional groups and DMs**, making all interactions **persona-based**.
-   **A unified relationship model governs visibility and permissions.**

#### **Relationship Types (Hierarchical Access Control)**

Relationships are ordered by increasing access level:
```sql
CREATE TYPE relationship_type AS ENUM (
  'blocked',   -- 0: No access
  'muted',     -- 1: Hidden but not blocked
  'follower',  -- 2: Basic access
  'acquaintance', -- 3: Closer than follower
  'friend',    -- 4: Trusted connection
  'member',    -- 5: Group membership
  'moderator', -- 6: Can moderate
  'manager',   -- 7: Can manage
  'owner'      -- 8: Full control
);
```

The order is significant and used for efficient permission checks:
```sql
-- Helper function to compare relationship levels
CREATE OR REPLACE FUNCTION relationship_type_ordinal(rel relationship_type) 
RETURNS int AS $$
BEGIN
  RETURN array_position(
    ARRAY['blocked', 'muted', 'follower', 'acquaintance', 'friend', 
          'member', 'moderator', 'manager', 'owner']::relationship_type[],
    rel
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

This enables efficient numeric comparisons for access control:
- If a post requires 'friend' level (4) to view
- And a user has 'moderator' level (6)
- Then `relationship_type_ordinal('moderator') >= relationship_type_ordinal('friend')` is true
- Therefore, the moderator can view the post

Key features:
- **Hierarchical Access**: Higher levels include all lower level permissions
- **Efficient Checks**: Uses numeric comparisons instead of string operations
- **Clear Progression**: From no access (blocked) to full control (owner)
- **Flexible Visibility**: Content can require any relationship level for access
- **Consistent Rules**: Same hierarchy applies to both users and personas

* * * * *

### **2.2 Posts & Threads**

-   Users can **post as themselves or as a persona**.
-   Every post supports **threaded conversations** (replies and discussions).
-   **Visibility & Response Levels** determine who can **view** and **comment**.
-   **Posts can be set to expire (**`**deleted_at**` **in the future).**
-   **Each post contains location data (**`**lat**`**,** `**lng**`**).**

#### **Post Structure**

| Field | Type | Description |
| `id` | `UUID` | Unique ID of the post |
| `lat` | `FLOAT` | Latitude (nullable) |
| `lng` | `FLOAT` | Longitude (nullable) |
| `content` | `JSONB` | Flexible post content |
| `visibility_level` | `ENUM` | Defines who can see the post (`public`, `follower`, `acquaintance`, etc.) |
| `response_level` | `ENUM` | Defines who can reply (`public`, `friend`, `member`, etc.) |
| `persona_id` | `UUID` | Persona posting the content |
| `user_id` | `UUID` | Actual user making the post |
| `parent_id` | `UUID` | For threads and replies |
| `views` | `INT` | Tracks how many times the post was seen |
| `deleted_at` | `TIMESTAMP` | Future timestamp for expiring posts |
| `tags` | `JSONB` | Array of tag GUIDs for efficient filtering |
| `created_at` | `TIMESTAMP` | Creation timestamp |

🚀 **Tag filtering is optimized with a GIN index on** `**tags**`.

* * * * *

### **2.3 Effective Relationships (Optimized Access Control)**

-   **Precomputed, indexed effective relationships** allow **fast visibility and response checks**.
-   **Directionality is enforced** (User1 → User2 is different from User2 → User1).
-   **Stored in a separate table**, avoiding complex RLS queries.
  
#### **Effective Relationship Table**

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | `UUID` | User viewing content |
| `target_id` | `UUID` | Target persona/user |
| `target_type` | `TEXT` | `'user'` or `'persona'` |
| `effective_type` | `TEXT` | Highest-level relationship (`friend`, `member`, `blocked`, etc.) |

#### **Implementation Details**

```sql
-- Effective relationships table with optimized structure
CREATE TABLE effective_relationships (
  user_id UUID REFERENCES auth.users(id),
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL,
  effective_type TEXT NOT NULL,
  PRIMARY KEY (user_id, target_id)
);
```

### **2.4 Posts & Location-Based Features**

-   **Posts include location data** (`lat`, `lng`) for geographic queries
-   **Nearby post queries use PostGIS** for efficient spatial lookups
-   **Location data is optional** (nullable fields)

#### **Nearby Posts Function**

```sql
CREATE OR REPLACE FUNCTION nearby_posts(
  lat float,
  lng float,
  radius_meters float
) RETURNS SETOF posts AS $$
  SELECT *
  FROM posts
  WHERE ST_DWithin(
    ST_MakePoint(lng, lat)::geography,
    ST_MakePoint($2, $1)::geography,
    $3
  );
$$ LANGUAGE sql STABLE;
```

### **2.5 Read & Delivery Tracking**

-   **Public posts track view counts** directly in `posts.views`
-   **Private messages and group posts** track delivery and read status
-   **Optimized for high-volume chat scenarios** using a dedicated table

#### **Read Tracking Table**

```sql
CREATE TABLE post_read_delivery (
  post_id UUID REFERENCES posts(id),
  user_id UUID REFERENCES auth.users(id),
  delivered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read_at TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (post_id, user_id)
);
```

### **2.6 Real-Time Features**

-   **Supabase Realtime** used for live updates
-   **Channel-based subscriptions** for notifications
-   **Optimized for mobile devices** with battery-efficient polling
-   **Supports offline mode** with local queue and sync

#### **Notification Subscription Example**

```javascript
// Subscribe to user notifications
socialService.subscribeToNotifications((payload) => {
  console.log('New notification:', payload)
})
```

### **2.7 Performance Considerations**

-   **GIN indexes** on JSONB fields for fast filtering
-   **PostGIS** for location queries
-   **Precomputed relationships** for fast permission checks
-   **Optimized read tracking** for high-volume scenarios

* * * * *

### **2.4 Tags, Topics & Reactions (Optimized for Filtering)**

-   **Tags are stored as a** `**JSONB**` **array of tag GUIDs in the** `**posts**` **table**.
-   **A GIN index is used to make tag filtering extremely fast.**
-   **Tags replace traditional joins with a** `**post_tags**` **table, reducing query complexity.**

#### **Schema Update for Optimized Tags**

```