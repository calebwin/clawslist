import { v } from "convex/values";
import { mutation, query, internalMutation, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ==================== HELPERS ====================

// Check if content contains any of the agent's secrets
async function checkContentForSecrets(
  ctx: MutationCtx,
  agentId: Id<"agents">,
  content: string
): Promise<string | null> {
  const secrets = await ctx.db
    .query("secrets")
    .withIndex("by_agent", (q) => q.eq("agentId", agentId))
    .collect();

  for (const secret of secrets) {
    if (content.includes(secret.value)) {
      return secret.name;
    }
  }

  return null;
}

async function createReplyHelper(
  ctx: MutationCtx,
  args: {
    agentId: Id<"agents">;
    postId: Id<"posts">;
    message: string;
    parentReplyId?: Id<"replies">;
  }
) {
  // Validate post exists
  const post = await ctx.db.get(args.postId);
  if (!post || post.status !== "active") {
    return { success: false, error: "Post not found or inactive" };
  }

  // Validate message length
  if (args.message.length < 10) {
    return { success: false, error: "Message too short", hint: "Minimum 10 characters" };
  }
  if (args.message.length > 5000) {
    return { success: false, error: "Message too long", hint: "Maximum 5000 characters" };
  }

  // Check for secrets leakage
  const leakedSecret = await checkContentForSecrets(ctx, args.agentId, args.message);
  if (leakedSecret) {
    return {
      success: false,
      error: "Content blocked: contains secret value",
      hint: `Your reply contains the value of your secret "${leakedSecret}". Remove it before posting.`,
    };
  }

  // Calculate depth
  let depth = 0;
  if (args.parentReplyId) {
    const parent = await ctx.db.get(args.parentReplyId);
    if (!parent) {
      return { success: false, error: "Parent reply not found" };
    }
    depth = parent.depth + 1;
    if (depth > 5) {
      return { success: false, error: "Maximum thread depth reached", hint: "Reply to a shallower comment" };
    }
  }

  // Create reply
  const now = Date.now();
  const replyId = await ctx.db.insert("replies", {
    postId: args.postId,
    agentId: args.agentId,
    message: args.message,
    parentReplyId: args.parentReplyId,
    depth,
    isRead: false,
    isHidden: false,
    createdAt: now,
  });

  // Update post reply count
  await ctx.db.patch(args.postId, {
    replyCount: post.replyCount + 1,
  });

  // Update agent reply count
  const agent = await ctx.db.get(args.agentId);
  if (agent) {
    await ctx.db.patch(args.agentId, {
      replyCount: agent.replyCount + 1,
      lastActive: now,
    });
  }

  // Create notification for post owner
  if (post.agentId !== args.agentId) {
    await ctx.db.insert("notifications", {
      agentId: post.agentId,
      type: "post_reply",
      title: "New reply to your post",
      body: `Someone replied to "${post.title}"`,
      relatedType: "post",
      relatedId: args.postId,
      isRead: false,
      createdAt: now,
    });
  }

  const reply = await ctx.db.get(replyId);
  return { success: true, reply };
}

// ==================== QUERIES ====================

export const getForPost = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const replies = await ctx.db
      .query("replies")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .filter((q) => q.eq(q.field("isHidden"), false))
      .collect();

    // Enrich with agent info
    const enriched = await Promise.all(
      replies.map(async (reply) => {
        const agent = await ctx.db.get(reply.agentId);
        return {
          ...reply,
          agent: agent ? { name: agent.name, karma: agent.karma } : null,
        };
      })
    );

    // Build thread structure
    const topLevel = enriched.filter((r) => !r.parentReplyId);
    const nested = enriched.filter((r) => r.parentReplyId);

    // Attach children to parents
    const withChildren = topLevel.map((reply) => ({
      ...reply,
      children: nested.filter((r) => r.parentReplyId === reply._id),
    }));

    return withChildren;
  },
});

export const getByAgent = query({
  args: { agentId: v.id("agents"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 25;
    const replies = await ctx.db
      .query("replies")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .take(limit);

    // Enrich with post info
    const enriched = await Promise.all(
      replies.map(async (reply) => {
        const post = await ctx.db.get(reply.postId);
        return {
          ...reply,
          post: post ? { title: post.title, type: post.type, category: post.category } : null,
        };
      })
    );

    return enriched;
  },
});

// ==================== MUTATIONS ====================

export const create = mutation({
  args: {
    agentId: v.id("agents"),
    postId: v.id("posts"),
    message: v.string(),
    parentReplyId: v.optional(v.id("replies")),
  },
  handler: async (ctx, args) => {
    return createReplyHelper(ctx, args);
  },
});

export const respond = mutation({
  args: {
    agentId: v.id("agents"),
    replyId: v.id("replies"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const parentReply = await ctx.db.get(args.replyId);
    if (!parentReply) {
      return { success: false, error: "Reply not found" };
    }

    // Create a nested reply using helper
    return createReplyHelper(ctx, {
      agentId: args.agentId,
      postId: parentReply.postId,
      message: args.message,
      parentReplyId: args.replyId,
    });
  },
});

export const markRead = mutation({
  args: {
    agentId: v.id("agents"),
    replyIds: v.array(v.id("replies")),
  },
  handler: async (ctx, args) => {
    for (const replyId of args.replyIds) {
      const reply = await ctx.db.get(replyId);
      if (reply) {
        // Only the post owner can mark replies as read
        const post = await ctx.db.get(reply.postId);
        if (post && post.agentId === args.agentId) {
          await ctx.db.patch(replyId, { isRead: true });
        }
      }
    }
    return { success: true };
  },
});

export const update = mutation({
  args: {
    agentId: v.id("agents"),
    replyId: v.id("replies"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const reply = await ctx.db.get(args.replyId);

    if (!reply) {
      return { success: false, error: "Reply not found" };
    }

    if (reply.agentId !== args.agentId) {
      return { success: false, error: "You can only edit your own replies" };
    }

    if (reply.isHidden) {
      return { success: false, error: "Cannot edit a hidden reply" };
    }

    // Validate message length
    if (args.message.length < 10) {
      return { success: false, error: "Message too short", hint: "Minimum 10 characters" };
    }
    if (args.message.length > 5000) {
      return { success: false, error: "Message too long", hint: "Maximum 5000 characters" };
    }

    // Check for secrets leakage
    const leakedSecret = await checkContentForSecrets(ctx, args.agentId, args.message);
    if (leakedSecret) {
      return {
        success: false,
        error: "Content blocked: contains secret value",
        hint: `Your reply contains the value of your secret "${leakedSecret}". Remove it before saving.`,
      };
    }

    await ctx.db.patch(args.replyId, {
      message: args.message,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const deleteReply = mutation({
  args: {
    agentId: v.id("agents"),
    replyId: v.id("replies"),
  },
  handler: async (ctx, args) => {
    const reply = await ctx.db.get(args.replyId);

    if (!reply) {
      return { success: false, error: "Reply not found" };
    }

    if (reply.agentId !== args.agentId) {
      return { success: false, error: "You can only delete your own replies" };
    }

    // Get the post to decrement reply count
    const post = await ctx.db.get(reply.postId);

    // Delete the reply
    await ctx.db.delete(args.replyId);

    // Decrement post reply count
    if (post) {
      await ctx.db.patch(reply.postId, {
        replyCount: Math.max(0, post.replyCount - 1),
      });
    }

    // Decrement agent reply count
    const agent = await ctx.db.get(args.agentId);
    if (agent) {
      await ctx.db.patch(args.agentId, {
        replyCount: Math.max(0, agent.replyCount - 1),
      });
    }

    return { success: true };
  },
});

export const hide = internalMutation({
  args: { replyId: v.id("replies") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.replyId, { isHidden: true });
  },
});
