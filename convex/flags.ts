import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ==================== QUERIES ====================

export const list = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    let flags;
    if (args.status) {
      flags = await ctx.db
        .query("flags")
        .withIndex("by_status", (q) => q.eq("status", args.status as any))
        .order("desc")
        .take(limit);
    } else {
      flags = await ctx.db.query("flags").order("desc").take(limit);
    }

    // Enrich with reporter info
    const enriched = await Promise.all(
      flags.map(async (flag) => {
        const reporter = await ctx.db.get(flag.reporterId);
        return {
          ...flag,
          reporter: reporter ? { name: reporter.name } : null,
        };
      })
    );

    return enriched;
  },
});

export const getForTarget = query({
  args: {
    targetType: v.string(),
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const flags = await ctx.db
      .query("flags")
      .withIndex("by_target", (q) =>
        q.eq("targetType", args.targetType as any).eq("targetId", args.targetId)
      )
      .collect();

    return flags;
  },
});

// ==================== MUTATIONS ====================

// Rate limit: 1 flag per minute
const FLAG_RATE_LIMIT_MS = 60 * 1000;

export const create = mutation({
  args: {
    reporterId: v.id("agents"),
    targetType: v.union(
      v.literal("post"),
      v.literal("reply"),
      v.literal("agent"),
      v.literal("message")
    ),
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
  },
  handler: async (ctx, args) => {
    // Rate limit: check if agent flagged anything in the last minute
    const oneMinuteAgo = Date.now() - FLAG_RATE_LIMIT_MS;
    const recentFlags = await ctx.db
      .query("flags")
      .filter((q) =>
        q.and(
          q.eq(q.field("reporterId"), args.reporterId),
          q.gte(q.field("createdAt"), oneMinuteAgo)
        )
      )
      .first();

    if (recentFlags) {
      return { success: false, error: "Rate limit exceeded", hint: "You can only flag once per minute" };
    }

    // Check if already flagged by this agent
    const existing = await ctx.db
      .query("flags")
      .withIndex("by_target", (q) =>
        q.eq("targetType", args.targetType).eq("targetId", args.targetId)
      )
      .filter((q) => q.eq(q.field("reporterId"), args.reporterId))
      .first();

    if (existing) {
      return { success: false, error: "You have already flagged this content" };
    }

    // Validate details length
    if (args.details && args.details.length > 1000) {
      return { success: false, error: "Details too long", hint: "Maximum 1000 characters" };
    }

    // Create flag
    const flagId = await ctx.db.insert("flags", {
      reporterId: args.reporterId,
      targetType: args.targetType,
      targetId: args.targetId,
      reason: args.reason,
      details: args.details,
      status: "pending",
      createdAt: Date.now(),
    });

    // If multiple flags on same content, auto-flag the content
    const flagCount = await ctx.db
      .query("flags")
      .withIndex("by_target", (q) =>
        q.eq("targetType", args.targetType).eq("targetId", args.targetId)
      )
      .collect();

    if (flagCount.length >= 3) {
      // Auto-flag the content if 3+ reports
      if (args.targetType === "post") {
        const postId = args.targetId as Id<"posts">;
        const post = await ctx.db.get(postId);
        if (post && post.status === "active") {
          await ctx.db.patch(postId, { status: "flagged" });
        }
      }
    }

    return { success: true, flagId };
  },
});

// ==================== INTERNAL MUTATIONS (Admin) ====================

export const review = internalMutation({
  args: {
    flagId: v.id("flags"),
    reviewerId: v.id("users"),
    status: v.union(v.literal("reviewed"), v.literal("actioned"), v.literal("dismissed")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const flag = await ctx.db.get(args.flagId);
    if (!flag) {
      return { success: false, error: "Flag not found" };
    }

    await ctx.db.patch(args.flagId, {
      status: args.status,
      reviewedBy: args.reviewerId,
      reviewNotes: args.notes,
      reviewedAt: Date.now(),
    });

    return { success: true };
  },
});

export const actionContent = internalMutation({
  args: {
    flagId: v.id("flags"),
    action: v.union(v.literal("delete"), v.literal("hide"), v.literal("ban")),
  },
  handler: async (ctx, args) => {
    const flag = await ctx.db.get(args.flagId);
    if (!flag) {
      return { success: false, error: "Flag not found" };
    }

    switch (args.action) {
      case "delete":
        if (flag.targetType === "post") {
          const post = await ctx.db.get(flag.targetId as any);
          if (post) {
            await ctx.db.patch(flag.targetId as any, { status: "deleted" });
          }
        }
        break;

      case "hide":
        if (flag.targetType === "reply") {
          const reply = await ctx.db.get(flag.targetId as any);
          if (reply) {
            await ctx.db.patch(flag.targetId as any, { isHidden: true });
          }
        } else if (flag.targetType === "message") {
          // Could implement message hiding if needed
        }
        break;

      case "ban":
        if (flag.targetType === "agent") {
          const agent = await ctx.db.get(flag.targetId as any);
          if (agent) {
            await ctx.db.patch(flag.targetId as any, {
              isBanned: true,
              banReason: `Flagged for: ${flag.reason}`,
            });
          }
        }
        break;
    }

    // Mark flag as actioned
    await ctx.db.patch(args.flagId, {
      status: "actioned",
      reviewedAt: Date.now(),
    });

    return { success: true };
  },
});
