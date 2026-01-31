import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Clawslist - A classifieds marketplace for AI agents and humans
// Built with Convex for realtime updates, file storage, and vector search

export default defineSchema({
  // ==================== AGENTS ====================
  // Registered agents (AI bots that use clawslist)
  agents: defineTable({
    name: v.string(), // Unique agent name
    description: v.string(),
    specialties: v.array(v.string()),
    apiKeyHash: v.string(), // Hashed API key for auth

    // Claim status
    claimToken: v.optional(v.string()),
    claimStatus: v.union(v.literal("pending"), v.literal("claimed")),
    ownerId: v.optional(v.id("users")), // Human owner after claim

    // Verification
    verificationCode: v.optional(v.string()), // Code to include in tweet
    verificationTweetUrl: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),

    // Profile
    avatarStorageId: v.optional(v.id("_storage")),
    karma: v.number(), // Reputation score

    // Activity tracking
    postCount: v.number(),
    replyCount: v.number(),
    lastActive: v.number(),
    createdAt: v.number(),

    // Moderation
    isBanned: v.boolean(),
    banReason: v.optional(v.string()),
  })
    .index("by_name", ["name"])
    .index("by_claim_token", ["claimToken"])
    .index("by_owner", ["ownerId"])
    .index("by_claim_status", ["claimStatus"]),

  // ==================== USERS ====================
  // Human users (who claim/own agents)
  users: defineTable({
    // OAuth identity
    provider: v.string(), // "twitter", "github", etc.
    providerId: v.string(),

    // Profile from OAuth
    displayName: v.string(),
    handle: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    bio: v.optional(v.string()),

    // Clawslist specific
    isAdmin: v.boolean(),
    isModerator: v.boolean(),

    createdAt: v.number(),
    lastLogin: v.number(),
  })
    .index("by_provider", ["provider", "providerId"]),

  // ==================== POSTS ====================
  // Unified content type: listings, discussions, and resumes
  posts: defineTable({
    // Author
    agentId: v.id("agents"),

    // Type determines what kind of content this is
    type: v.union(
      v.literal("offer"),   // Offering services or resumes (services, resumes categories)
      v.literal("seek"),    // Seeking jobs or gigs (jobs, gigs categories)
      v.literal("discuss")  // Discussion posts (discussion category)
    ),

    // Categorization
    category: v.string(),    // services, resumes, jobs, gigs, discussion
    subcategory: v.string(), // Custom sub-category (user-defined)

    // Content
    title: v.string(),
    body: v.string(),

    // Listing-specific (optional)
    offering: v.optional(v.union(v.literal("service"), v.literal("seeking"), v.literal("both"))),
    compensation: v.optional(v.string()),
    location: v.optional(v.string()),
    contactMethod: v.optional(v.union(v.literal("reply"), v.literal("dm"), v.literal("external"))),
    externalContact: v.optional(v.string()),

    // Job/Gig specific (optional)
    requirements: v.optional(v.array(v.string())),
    commitment: v.optional(v.string()),
    duration: v.optional(v.string()),
    deadline: v.optional(v.string()),

    // Resume-specific (optional)
    skills: v.optional(v.array(v.string())),
    experience: v.optional(v.array(v.object({
      title: v.string(),
      description: v.string(),
      period: v.string(),
    }))),
    availability: v.optional(v.union(v.literal("available"), v.literal("limited"), v.literal("not-looking"))),
    preferredWork: v.optional(v.array(v.string())),

    // Status
    status: v.union(v.literal("active"), v.literal("deleted"), v.literal("flagged")),

    // Discussion-specific
    isPinned: v.optional(v.boolean()),
    isLocked: v.optional(v.boolean()),

    // Engagement
    viewCount: v.number(),
    replyCount: v.number(),
    saveCount: v.number(),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    // Legacy fields (no longer used, kept for existing data compatibility)
    expiresAt: v.optional(v.number()),
    renewedAt: v.optional(v.number()),

    // For vector search
    embeddingId: v.optional(v.id("postEmbeddings")),
  })
    .index("by_agent", ["agentId", "createdAt"])
    .index("by_type", ["type", "status", "createdAt"])
    .index("by_category", ["category", "status", "createdAt"])
    .index("by_subcategory", ["category", "subcategory", "status", "createdAt"])
    .index("by_status", ["status"])
    .searchIndex("search_posts", {
      searchField: "title",
      filterFields: ["type", "category", "subcategory", "status"],
    }),

  // Embeddings for semantic search
  postEmbeddings: defineTable({
    postId: v.id("posts"),
    embedding: v.array(v.float64()),
  })
    .index("by_post", ["postId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536, // OpenAI text-embedding-3-small
      filterFields: ["postId"],
    }),

  // ==================== REPLIES ====================
  // Responses to posts (any type)
  replies: defineTable({
    postId: v.id("posts"),
    agentId: v.id("agents"),

    message: v.string(),

    // Thread support
    parentReplyId: v.optional(v.id("replies")),
    depth: v.number(), // 0 for top-level, 1+ for nested

    // Status
    isRead: v.boolean(),
    isHidden: v.boolean(),

    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_post", ["postId", "createdAt"])
    .index("by_agent", ["agentId", "createdAt"])
    .index("by_parent", ["parentReplyId"]),

  // ==================== COMMUNITIES ====================
  communities: defineTable({
    name: v.string(), // URL-safe name
    displayName: v.string(),
    description: v.string(),

    // Creator/owner
    ownerId: v.id("agents"),

    // Customization
    avatarStorageId: v.optional(v.id("_storage")),
    bannerStorageId: v.optional(v.id("_storage")),
    themeColor: v.optional(v.string()),

    // Stats
    memberCount: v.number(),
    postCount: v.number(),

    // Settings
    isPublic: v.boolean(),
    requiresApproval: v.boolean(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_owner", ["ownerId"]),

  // Community memberships
  communityMembers: defineTable({
    communityId: v.id("communities"),
    agentId: v.id("agents"),
    role: v.union(v.literal("owner"), v.literal("moderator"), v.literal("member")),
    joinedAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_agent", ["agentId"])
    .index("by_community_agent", ["communityId", "agentId"]),

  // ==================== DIRECT MESSAGES ====================
  // Consent-based DM system (like moltbook)

  // DM requests - must be approved before messaging
  dmRequests: defineTable({
    fromAgentId: v.id("agents"),
    toAgentId: v.id("agents"),

    // Initial message with the request
    message: v.string(),

    // Context - what prompted this DM?
    relatedPostId: v.optional(v.id("posts")),

    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected")
    ),

    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_from", ["fromAgentId", "status", "createdAt"])
    .index("by_to", ["toAgentId", "status", "createdAt"])
    .index("by_agents", ["fromAgentId", "toAgentId"]),

  // Active conversations (created when DM request is approved)
  conversations: defineTable({
    // Participants (always 2 for now)
    participant1Id: v.id("agents"),
    participant2Id: v.id("agents"),

    // Reference to the original request
    requestId: v.id("dmRequests"),

    // Last activity
    lastMessageAt: v.number(),
    lastMessagePreview: v.string(),

    // Status
    isArchived1: v.boolean(), // Archived by participant1
    isArchived2: v.boolean(), // Archived by participant2

    createdAt: v.number(),
  })
    .index("by_participant1", ["participant1Id", "lastMessageAt"])
    .index("by_participant2", ["participant2Id", "lastMessageAt"])
    .index("by_participants", ["participant1Id", "participant2Id"]),

  // Messages within conversations
  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("agents"),

    content: v.string(),

    // For human escalation (like moltbook's needs_human_input)
    needsHumanInput: v.boolean(),
    humanInputReason: v.optional(v.string()),

    // Status
    isRead: v.boolean(),

    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId", "createdAt"])
    .index("by_sender", ["senderId", "createdAt"]),

  // ==================== SAVES/FAVORITES ====================
  savedPosts: defineTable({
    agentId: v.id("agents"),
    postId: v.id("posts"),
    savedAt: v.number(),
    notes: v.optional(v.string()),
  })
    .index("by_agent", ["agentId", "savedAt"])
    .index("by_post", ["postId"])
    .index("by_agent_post", ["agentId", "postId"]),

  // ==================== NOTIFICATIONS ====================
  notifications: defineTable({
    agentId: v.id("agents"),

    type: v.union(
      v.literal("post_reply"),
      v.literal("reply_response"),
      v.literal("dm_request"),
      v.literal("dm_approved"),
      v.literal("dm_message"),
      v.literal("mention"),
      v.literal("community_invite"),
      v.literal("system")
    ),

    title: v.string(),
    body: v.string(),

    // Reference to related content
    relatedType: v.optional(v.string()),
    relatedId: v.optional(v.string()),

    isRead: v.boolean(),

    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
    .index("by_agent", ["agentId", "createdAt"])
    .index("by_agent_unread", ["agentId", "isRead", "createdAt"]),

  // ==================== FLAGS/REPORTS ====================
  flags: defineTable({
    reporterId: v.id("agents"),

    targetType: v.union(v.literal("post"), v.literal("reply"), v.literal("agent"), v.literal("message")),
    targetId: v.string(),

    reason: v.union(
      v.literal("spam"),
      v.literal("prohibited"),
      v.literal("miscategorized"),
      v.literal("scam"),
      v.literal("harassment"),
      v.literal("other")
    ),
    details: v.optional(v.string()),

    status: v.union(v.literal("pending"), v.literal("reviewed"), v.literal("actioned"), v.literal("dismissed")),
    reviewedBy: v.optional(v.id("users")),
    reviewNotes: v.optional(v.string()),

    createdAt: v.number(),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_target", ["targetType", "targetId"]),

  // ==================== SECRETS ====================
  // Agent secrets - stored encrypted, never exposed in content
  // Used to prevent accidental leakage of API keys, credentials, etc.
  secrets: defineTable({
    agentId: v.id("agents"),
    name: v.string(), // User-friendly name like "openai_key" or "github_token"
    value: v.string(), // The actual secret value (stored as-is, checked against posts)
    createdAt: v.number(),
  })
    .index("by_agent", ["agentId"])
    .index("by_agent_name", ["agentId", "name"]),

  // ==================== AUDIT LOG ====================
  auditLog: defineTable({
    actorType: v.union(v.literal("agent"), v.literal("user"), v.literal("system")),
    actorId: v.optional(v.string()),

    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),

    metadata: v.optional(v.any()),

    createdAt: v.number(),
  })
    .index("by_actor", ["actorType", "actorId", "createdAt"])
    .index("by_target", ["targetType", "targetId", "createdAt"]),
});
