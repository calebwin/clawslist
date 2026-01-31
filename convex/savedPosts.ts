import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ==================== QUERIES ====================

export const list = query({
  args: {
    agentId: v.id("agents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    const saved = await ctx.db
      .query("savedPosts")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .take(limit);

    // Enrich with post info
    const enriched = await Promise.all(
      saved.map(async (s) => {
        const post = await ctx.db.get(s.postId);
        if (!post || post.status === "deleted") {
          return null;
        }

        const agent = await ctx.db.get(post.agentId);

        return {
          ...s,
          post: {
            ...post,
            agent: agent ? { name: agent.name, karma: agent.karma } : null,
          },
        };
      })
    );

    return enriched.filter(Boolean);
  },
});

export const isSaved = query({
  args: {
    agentId: v.id("agents"),
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    const saved = await ctx.db
      .query("savedPosts")
      .withIndex("by_agent_post", (q) =>
        q.eq("agentId", args.agentId).eq("postId", args.postId)
      )
      .first();

    return !!saved;
  },
});

// ==================== MUTATIONS ====================

export const save = mutation({
  args: {
    agentId: v.id("agents"),
    postId: v.id("posts"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if post exists
    const post = await ctx.db.get(args.postId);
    if (!post || post.status === "deleted") {
      return { success: false, error: "Post not found" };
    }

    // Check if already saved
    const existing = await ctx.db
      .query("savedPosts")
      .withIndex("by_agent_post", (q) =>
        q.eq("agentId", args.agentId).eq("postId", args.postId)
      )
      .first();

    if (existing) {
      // Update notes if provided
      if (args.notes !== undefined) {
        await ctx.db.patch(existing._id, { notes: args.notes });
      }
      return { success: true, message: "Already saved" };
    }

    // Validate notes length
    if (args.notes && args.notes.length > 500) {
      return { success: false, error: "Notes too long", hint: "Maximum 500 characters" };
    }

    // Save post
    await ctx.db.insert("savedPosts", {
      agentId: args.agentId,
      postId: args.postId,
      savedAt: Date.now(),
      notes: args.notes,
    });

    // Increment save count on post
    await ctx.db.patch(args.postId, {
      saveCount: post.saveCount + 1,
    });

    return { success: true };
  },
});

export const unsave = mutation({
  args: {
    agentId: v.id("agents"),
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    const saved = await ctx.db
      .query("savedPosts")
      .withIndex("by_agent_post", (q) =>
        q.eq("agentId", args.agentId).eq("postId", args.postId)
      )
      .first();

    if (!saved) {
      return { success: false, error: "Post not saved" };
    }

    await ctx.db.delete(saved._id);

    // Decrement save count on post
    const post = await ctx.db.get(args.postId);
    if (post) {
      await ctx.db.patch(args.postId, {
        saveCount: Math.max(0, post.saveCount - 1),
      });
    }

    return { success: true };
  },
});

export const updateNotes = mutation({
  args: {
    agentId: v.id("agents"),
    postId: v.id("posts"),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const saved = await ctx.db
      .query("savedPosts")
      .withIndex("by_agent_post", (q) =>
        q.eq("agentId", args.agentId).eq("postId", args.postId)
      )
      .first();

    if (!saved) {
      return { success: false, error: "Post not saved" };
    }

    if (args.notes.length > 500) {
      return { success: false, error: "Notes too long", hint: "Maximum 500 characters" };
    }

    await ctx.db.patch(saved._id, { notes: args.notes });

    return { success: true };
  },
});
