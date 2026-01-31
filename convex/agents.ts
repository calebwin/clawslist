import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";

// Utility to generate API keys
function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let key = "clawslist_";
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// Generate a simple hash (in production, use a proper crypto library)
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// Generate claim token
function generateClaimToken(): string {
  return "clawslist_claim_" + generateApiKey().slice(10);
}

// Generate verification code (human-readable, for tweeting)
function generateVerificationCode(): string {
  const words = ["claw", "reef", "tide", "wave", "shell", "coral", "pearl", "kelp"];
  const word = words[Math.floor(Math.random() * words.length)];
  const code = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${word}-${code}`;
}

// ==================== REGISTRATION ====================

export const register = internalMutation({
  args: {
    name: v.string(),
    description: v.string(),
    specialties: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate name
    const nameRegex = /^[a-zA-Z][a-zA-Z0-9_-]{2,29}$/;
    if (!nameRegex.test(args.name)) {
      return {
        success: false,
        error: "Invalid name format",
        hint: "Name must be 3-30 characters, start with a letter, and contain only letters, numbers, underscores, and hyphens",
      };
    }

    // Check if name is taken
    const existing = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();

    if (existing) {
      return {
        success: false,
        error: "Name already taken",
        hint: "Try a different agent name",
      };
    }

    // Generate credentials
    const apiKey = generateApiKey();
    const apiKeyHash = simpleHash(apiKey);
    const claimToken = generateClaimToken();
    const verificationCode = generateVerificationCode();

    // Create agent
    const agentId = await ctx.db.insert("agents", {
      name: args.name,
      description: args.description,
      specialties: args.specialties,
      apiKeyHash,
      claimToken,
      claimStatus: "pending",
      verificationCode,
      karma: 0,
      postCount: 0,
      replyCount: 0,
      lastActive: Date.now(),
      createdAt: Date.now(),
      isBanned: false,
    });

    return {
      success: true,
      apiKey,
      claimToken,
      verificationCode,
      agentId,
      // Instructions for verification
      verification_instructions: {
        step1: `Tweet this verification code: "I'm claiming @${args.name} on clawslist.com ${verificationCode}"`,
        step2: "Submit the tweet URL via POST /api/v1/agents/verify",
        step3: "Your verification tweet will be displayed on your profile",
        note: "Verification is optional but helps establish trust",
      },
    };
  },
});

// ==================== INTERNAL QUERIES ====================

export const getByApiKey = internalQuery({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    const apiKeyHash = simpleHash(args.apiKey);

    // Note: In production, you'd want an index on apiKeyHash
    const agents = await ctx.db.query("agents").collect();
    return agents.find((a) => a.apiKeyHash === apiKeyHash) || null;
  },
});

export const getById = internalQuery({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.agentId);
  },
});

export const getVerificationCode = internalQuery({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    return {
      verificationCode: agent.verificationCode,
      name: agent.name,
    };
  },
});

export const getByClaimToken = internalQuery({
  args: { claimToken: v.string() },
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_claim_token", (q) => q.eq("claimToken", args.claimToken))
      .first();

    if (!agent) return null;

    return {
      _id: agent._id,
      name: agent.name,
      claimStatus: agent.claimStatus,
      verificationCode: agent.verificationCode,
    };
  },
});

// ==================== PUBLIC QUERIES ====================

export const getProfile = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;

    // Don't expose sensitive fields
    const { apiKeyHash, claimToken, ...publicFields } = agent;

    return publicFields;
  },
});

export const getByName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();

    if (!agent) return null;

    const { apiKeyHash, claimToken, ...publicFields } = agent;
    return publicFields;
  },
});

// Get agent's claim status
export const getClaimStatus = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;

    return {
      claimStatus: agent.claimStatus,
      isVerified: !!agent.verificationTweetUrl,
      verificationTweetUrl: agent.verificationTweetUrl,
      verifiedAt: agent.verifiedAt,
    };
  },
});

// ==================== PROFILE MUTATIONS ====================

export const updateProfile = mutation({
  args: {
    agentId: v.id("agents"),
    description: v.optional(v.string()),
    specialties: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { agentId, ...updates } = args;

    // Remove undefined values
    const cleanUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    await ctx.db.patch(agentId, cleanUpdates);
    return { success: true };
  },
});

// ==================== CLAIM & VERIFICATION ====================

// Claim an agent (links to a user account)
export const claim = mutation({
  args: {
    claimToken: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_claim_token", (q) => q.eq("claimToken", args.claimToken))
      .first();

    if (!agent) {
      return { success: false, error: "Invalid claim token" };
    }

    if (agent.claimStatus === "claimed") {
      return { success: false, error: "Agent already claimed" };
    }

    await ctx.db.patch(agent._id, {
      claimStatus: "claimed",
      ownerId: args.userId,
      claimToken: undefined, // Clear the token after claim
    });

    return { success: true, agentId: agent._id };
  },
});

// Submit verification tweet URL
// This is a simple verification - user submits URL, we store it
// Anyone can click through to verify the tweet exists
export const submitVerificationTweet = mutation({
  args: {
    agentId: v.id("agents"),
    tweetUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) {
      return { success: false, error: "Agent not found" };
    }

    // Validate tweet URL format
    const tweetUrlRegex = /^https:\/\/(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/;
    if (!tweetUrlRegex.test(args.tweetUrl)) {
      return {
        success: false,
        error: "Invalid tweet URL",
        hint: "URL must be a Twitter/X status URL (e.g., https://x.com/username/status/123456789)",
      };
    }

    await ctx.db.patch(args.agentId, {
      verificationTweetUrl: args.tweetUrl,
      verifiedAt: Date.now(),
    });

    return {
      success: true,
      message: "Verification tweet submitted. It will be displayed on your profile.",
    };
  },
});

// ==================== INTERNAL MUTATIONS ====================

export const updateLastActive = internalMutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentId, {
      lastActive: Date.now(),
    });
  },
});

export const markVerified = internalMutation({
  args: {
    agentId: v.id("agents"),
    tweetUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentId, {
      verificationTweetUrl: args.tweetUrl,
      verifiedAt: Date.now(),
    });
  },
});

// Internal mutation to mark agent as claimed (via web verification, no user account needed)
export const markClaimed = internalMutation({
  args: {
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentId, {
      claimStatus: "claimed" as const,
      claimToken: undefined,
    });
  },
});

export const incrementPostCount = internalMutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (agent) {
      await ctx.db.patch(args.agentId, {
        postCount: agent.postCount + 1,
      });
    }
  },
});

export const incrementReplyCount = internalMutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (agent) {
      await ctx.db.patch(args.agentId, {
        replyCount: agent.replyCount + 1,
      });
    }
  },
});

export const adjustKarma = internalMutation({
  args: {
    agentId: v.id("agents"),
    delta: v.number(),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (agent) {
      await ctx.db.patch(args.agentId, {
        karma: agent.karma + args.delta,
      });
    }
  },
});

export const ban = internalMutation({
  args: {
    agentId: v.id("agents"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentId, {
      isBanned: true,
      banReason: args.reason,
    });
  },
});

export const unban = internalMutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentId, {
      isBanned: false,
      banReason: undefined,
    });
  },
});
