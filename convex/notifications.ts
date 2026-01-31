import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

// ==================== QUERIES ====================

export const list = query({
  args: {
    agentId: v.id("agents"),
    unreadOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    let query = ctx.db
      .query("notifications")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .order("desc");

    let notifications = await query.take(limit);

    // Filter unread if requested
    if (args.unreadOnly) {
      notifications = notifications.filter((n) => !n.isRead);
    }

    // Filter expired notifications
    const now = Date.now();
    notifications = notifications.filter((n) => !n.expiresAt || n.expiresAt > now);

    return notifications;
  },
});

export const getUnreadCount = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_agent_unread", (q) =>
        q.eq("agentId", args.agentId).eq("isRead", false)
      )
      .collect();

    return notifications.length;
  },
});

// ==================== MUTATIONS ====================

export const markRead = mutation({
  args: {
    agentId: v.id("agents"),
    ids: v.array(v.id("notifications")),
  },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      const notification = await ctx.db.get(id);
      if (notification && notification.agentId === args.agentId) {
        await ctx.db.patch(id, { isRead: true });
      }
    }
    return { success: true };
  },
});

export const markAllRead = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_agent_unread", (q) =>
        q.eq("agentId", args.agentId).eq("isRead", false)
      )
      .collect();

    for (const notification of unread) {
      await ctx.db.patch(notification._id, { isRead: true });
    }

    return { success: true, count: unread.length };
  },
});

export const deleteNotification = mutation({
  args: {
    agentId: v.id("agents"),
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) {
      return { success: false, error: "Notification not found" };
    }

    if (notification.agentId !== args.agentId) {
      return { success: false, error: "Cannot delete another agent's notification" };
    }

    await ctx.db.delete(args.notificationId);
    return { success: true };
  },
});

// ==================== INTERNAL MUTATIONS ====================

export const create = internalMutation({
  args: {
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
    relatedType: v.optional(v.string()),
    relatedId: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const notificationId = await ctx.db.insert("notifications", {
      agentId: args.agentId,
      type: args.type,
      title: args.title,
      body: args.body,
      relatedType: args.relatedType,
      relatedId: args.relatedId,
      isRead: false,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    });

    return notificationId;
  },
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Delete old read notifications
    const oldNotifications = await ctx.db
      .query("notifications")
      .filter((q) =>
        q.and(
          q.eq(q.field("isRead"), true),
          q.lt(q.field("createdAt"), thirtyDaysAgo)
        )
      )
      .collect();

    for (const notification of oldNotifications) {
      await ctx.db.delete(notification._id);
    }

    return { deleted: oldNotifications.length };
  },
});
