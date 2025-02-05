**Persona-Based Social & Messaging Platform -- PRD**
===================================================

**1\. Overview**
----------------

This document outlines the requirements and structure for a **persona-based social and messaging platform**. The system allows users to interact **as themselves or on behalf of personas** (businesses, groups, or alternate identities), with **granular visibility controls, threaded conversations, real-time engagement, and notification tracking**.

These are the core features and functionality of the platform as expresed in these tables and RLS policies.

1. Users Table
```
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```
✅ Stores user accounts, authentication handled via Supabase Auth.

2. Personas Table
```
CREATE TABLE personas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('business', 'group', 'alias')),
    avatar_url TEXT,
    handle TEXT UNIQUE NOT NULL,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```
✅ Personas allow users to post as groups, businesses, or aliases.

3. Persona Relationships Table (Unified Relationship Model)
```
CREATE TABLE persona_relationships (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
    type ENUM(
        'follower', 'acquaintance', 'friend', 'member',
        'moderator', 'manager', 'owner', 'muted', 'blocked'
    ) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, persona_id)
);
```

✅ Stores all relationships, including social connections, memberships, and moderation roles.
✅ blocked and muted override any other relationship.

4. Effective Relationships Table (Precomputed for Fast Lookups)
```
CREATE TABLE effective_relationships (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    target_id UUID NOT NULL,
    target_type ENUM('user', 'persona') NOT NULL,
    effective_type ENUM(
        'public', 'follower', 'acquaintance', 'friend',
        'member', 'moderator', 'manager', 'owner',
        'muted', 'blocked'
    ) NOT NULL,
    PRIMARY KEY (user_id, target_id, target_type)
);
```
✅ Precomputed for efficient RLS and permission lookups.

5. Posts Table
```
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lat FLOAT NULL,
    lng FLOAT NULL,
    content JSONB NOT NULL,
    visibility_level ENUM(
        'public', 'follower', 'acquaintance', 'friend',
        'member', 'moderator', 'manager', 'owner'
    ) NOT NULL DEFAULT 'public',
    response_level ENUM(
        'public', 'follower', 'acquaintance', 'friend',
        'member', 'moderator', 'manager', 'owner'
    ) NOT NULL DEFAULT 'public',
    persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    views INT DEFAULT 0,
    deleted_at TIMESTAMP NULL,
    tags JSONB DEFAULT '[]'::JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_post_tags ON posts USING GIN (tags);
```
✅ Tags are stored as a JSONB array of tag GUIDs for optimized filtering.
✅ Uses visibility_level and response_level to control access.

6. Post Read & Delivery Tracking
```
CREATE TABLE post_read_delivery (
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    delivered_at TIMESTAMP DEFAULT NOW(),
    read_at TIMESTAMP NULL,
    PRIMARY KEY (post_id, user_id)
);
```
✅ For non-public posts, tracks when a post is delivered and read.

7. Notifications Table
```
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

8. Tags Table
```
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL
);
```
✅ Stores tags with GUIDs to prevent inconsistencies.

9. Post Engagements Table (Reactions, Topics, etc.)
```
CREATE TABLE post_engagement (
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type ENUM('tag', 'topic', 'reaction') NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id, type, value)
);
```
✅ Stores reactions, topics, and tags in one optimized table.

10. Mentions Table
```
CREATE TABLE mentions (
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    mentioned_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (post_id, mentioned_id)
);
```
✅ Stores mentions for efficient notifications and lookups.

11. User Blocks Table
```
CREATE TABLE user_blocks (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT,
    blocked_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, blocked_user_id)
);
```
✅ For system-wide user blocks outside of personas.

12. Persona Profiles Table
```
CREATE TABLE persona_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('business', 'group', 'alias')),
    avatar_url TEXT,
    handle TEXT UNIQUE NOT NULL,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```
✅ Stores additional metadata and profile information for personas.

* * * * *

**2\. Core Features & Functionality**
-------------------------------------

### **2.1 Personas & Relationships**

-   Users can interact as **personas**, which represent **businesses, groups, or alternate identities**.
-   **Personas replace traditional groups and DMs**, making all interactions **persona-based**.
-   **A unified relationship model governs visibility and permissions.**
#### **Relationship Types (One-Way, Directional, Precomputed Effective Relationship)**
-   **Social Connections:** `follower`, `acquaintance`, `friend`, `mute`, `block`
-   **Membership Roles (for Personas):** `member`, `moderator`, `manager`, `owner`
-   **Mute and block are instant downgrades**, overriding all other access.

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
ALTER TABLE posts ADD COLUMN tags JSONB DEFAULT '[]'::JSONB;
CREATE INDEX idx_post_tags ON posts USING GIN (tags);
```

🚀 **Filtering posts by tag is now fast and efficient**:

```
SELECT * FROM posts WHERE tags @> '["550e8400-e29b-41d4-a716-446655440000"]';
```

💚 **Avoids joins while keeping tagging flexible.**

* * * * *

### **2.5 Notifications System**

-   **Supabase Realtime notifications** for now (**later transition to Pusher**).
-   **Cascades persona-related notifications** to `moderators`, `managers`, and `owners`.
-   **Tracks delivered, read, and handled statuses**.

... (TODO rate-limiting, spam prevention, API considerations, and future roadmap)