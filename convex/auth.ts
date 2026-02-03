import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";

// Generate cryptographically secure random string using Web Crypto API
function generateSecureToken(length = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(randomValues[i] % chars.length);
  }
  return result;
}

// ==================== OAUTH STATE ====================

export const createOAuthState = internalMutation({
  args: {
    provider: v.string(),
    claimToken: v.optional(v.string()),
    redirectPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const state = generateSecureToken(32);
    const now = Date.now();

    await ctx.db.insert("oauthStates", {
      state,
      provider: args.provider,
      claimToken: args.claimToken,
      redirectPath: args.redirectPath,
      createdAt: now,
      expiresAt: now + 10 * 60 * 1000, // 10 minutes
    });

    return state;
  },
});

export const getOAuthState = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const stateDoc = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();

    if (!stateDoc) return null;
    if (stateDoc.expiresAt < Date.now()) return null;

    return stateDoc;
  },
});

export const deleteOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const stateDoc = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();

    if (stateDoc) {
      await ctx.db.delete(stateDoc._id);
    }
  },
});

// ==================== SESSIONS ====================

export const createSession = internalMutation({
  args: {
    userId: v.id("users"),
    userAgent: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sessionId = generateSecureToken(64);
    const now = Date.now();

    await ctx.db.insert("sessions", {
      sessionId,
      userId: args.userId,
      userAgent: args.userAgent,
      ipAddress: args.ipAddress,
      createdAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30 days
      lastActive: now,
    });

    return sessionId;
  },
});

export const getSession = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) return null;
    if (session.expiresAt < Date.now()) return null;

    return session;
  },
});

export const getSessionWithUser = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) return null;
    if (session.expiresAt < Date.now()) return null;

    const user = await ctx.db.get(session.userId);
    if (!user) return null;

    return {
      session,
      user: {
        _id: user._id,
        displayName: user.displayName,
        handle: user.handle,
        avatarUrl: user.avatarUrl,
        provider: user.provider,
        isAdmin: user.isAdmin,
        isModerator: user.isModerator,
      },
    };
  },
});

export const updateSessionActivity = internalMutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (session) {
      await ctx.db.patch(session._id, {
        lastActive: Date.now(),
      });
    }
  },
});

export const deleteSession = internalMutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
    }
  },
});

export const deleteAllUserSessions = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    await Promise.all(sessions.map((s) => ctx.db.delete(s._id)));

    return { deletedCount: sessions.length };
  },
});

// ==================== CLEANUP (Can be called by scheduled job) ====================

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Clean expired sessions
    const expiredSessions = await ctx.db
      .query("sessions")
      .withIndex("by_expires")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    await Promise.all(expiredSessions.map((s) => ctx.db.delete(s._id)));

    // Clean expired OAuth states
    const expiredStates = await ctx.db
      .query("oauthStates")
      .withIndex("by_expires")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    await Promise.all(expiredStates.map((s) => ctx.db.delete(s._id)));

    return {
      sessionsDeleted: expiredSessions.length,
      statesDeleted: expiredStates.length,
    };
  },
});
