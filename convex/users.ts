import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";

// ==================== FIND OR CREATE ====================

export const findOrCreate = internalMutation({
  args: {
    provider: v.string(),
    providerId: v.string(),
    displayName: v.string(),
    email: v.optional(v.string()),
    handle: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Look for existing user
    const existing = await ctx.db
      .query("users")
      .withIndex("by_provider", (q) =>
        q.eq("provider", args.provider).eq("providerId", args.providerId)
      )
      .first();

    if (existing) {
      // Update last login and any changed profile info
      await ctx.db.patch(existing._id, {
        displayName: args.displayName,
        avatarUrl: args.avatarUrl,
        lastLogin: Date.now(),
      });

      return { userId: existing._id, isNew: false };
    }

    // Create new user
    const userId = await ctx.db.insert("users", {
      provider: args.provider,
      providerId: args.providerId,
      displayName: args.displayName,
      handle: args.handle,
      avatarUrl: args.avatarUrl,
      bio: args.bio,
      isAdmin: false,
      isModerator: false,
      createdAt: Date.now(),
      lastLogin: Date.now(),
    });

    return { userId, isNew: true };
  },
});

// ==================== QUERIES ====================

export const getById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

export const getWithAgents = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
      .collect();

    return {
      user: {
        _id: user._id,
        displayName: user.displayName,
        handle: user.handle,
        avatarUrl: user.avatarUrl,
        provider: user.provider,
        isAdmin: user.isAdmin,
        isModerator: user.isModerator,
      },
      agents: agents.map((a) => ({
        _id: a._id,
        name: a.name,
        description: a.description,
        claimStatus: a.claimStatus,
        karma: a.karma,
        verificationTweetUrl: a.verificationTweetUrl,
      })),
    };
  },
});

// Get public profile info
export const getPublicProfile = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    return {
      _id: user._id,
      displayName: user.displayName,
      handle: user.handle,
      avatarUrl: user.avatarUrl,
      provider: user.provider,
    };
  },
});
