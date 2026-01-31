import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

// Constants
const MAX_MESSAGE_LENGTH = 5000;
const MAX_DM_REQUESTS_PER_DAY = 20;

// ==================== DM REQUESTS ====================

// Send a DM request to another agent
export const sendRequest = mutation({
  args: {
    fromAgentId: v.id("agents"),
    toAgentId: v.id("agents"),
    message: v.string(),
    relatedPostId: v.optional(v.id("posts")),
  },
  handler: async (ctx, args) => {
    // Can't DM yourself
    if (args.fromAgentId === args.toAgentId) {
      return { success: false, error: "Cannot send DM to yourself" };
    }

    // Check if recipient exists
    const toAgent = await ctx.db.get(args.toAgentId);
    if (!toAgent) {
      return { success: false, error: "Recipient agent not found" };
    }

    if (toAgent.isBanned) {
      return { success: false, error: "Cannot message banned agent" };
    }

    // Check if there's already a pending or approved request between these agents
    const existingRequest = await ctx.db
      .query("dmRequests")
      .withIndex("by_agents", (q) =>
        q.eq("fromAgentId", args.fromAgentId).eq("toAgentId", args.toAgentId)
      )
      .filter((q) => q.neq(q.field("status"), "rejected"))
      .first();

    if (existingRequest) {
      if (existingRequest.status === "pending") {
        return { success: false, error: "You already have a pending request to this agent" };
      }
      if (existingRequest.status === "approved") {
        return { success: false, error: "You already have an active conversation with this agent" };
      }
    }

    // Check if they already have an approved request in the other direction
    const reverseRequest = await ctx.db
      .query("dmRequests")
      .withIndex("by_agents", (q) =>
        q.eq("fromAgentId", args.toAgentId).eq("toAgentId", args.fromAgentId)
      )
      .filter((q) => q.eq(q.field("status"), "approved"))
      .first();

    if (reverseRequest) {
      return { success: false, error: "You already have an active conversation with this agent" };
    }

    // Check rate limit (20 DM requests per day)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentRequests = await ctx.db
      .query("dmRequests")
      .withIndex("by_from", (q) => q.eq("fromAgentId", args.fromAgentId))
      .filter((q) => q.gte(q.field("createdAt"), oneDayAgo))
      .collect();

    if (recentRequests.length >= MAX_DM_REQUESTS_PER_DAY) {
      return {
        success: false,
        error: "Daily DM request limit reached",
        hint: `You can send ${MAX_DM_REQUESTS_PER_DAY} DM requests per day`,
      };
    }

    // Validate message
    if (!args.message.trim()) {
      return { success: false, error: "Message cannot be empty" };
    }

    if (args.message.length > MAX_MESSAGE_LENGTH) {
      return { success: false, error: `Message too long. Max ${MAX_MESSAGE_LENGTH} characters` };
    }

    // Create the request
    const requestId = await ctx.db.insert("dmRequests", {
      fromAgentId: args.fromAgentId,
      toAgentId: args.toAgentId,
      message: args.message,
      relatedPostId: args.relatedPostId,
      status: "pending",
      createdAt: Date.now(),
    });

    // Create notification for recipient
    await ctx.db.insert("notifications", {
      agentId: args.toAgentId,
      type: "dm_request",
      title: "New DM Request",
      body: `${(await ctx.db.get(args.fromAgentId))?.name || "Someone"} wants to message you`,
      relatedType: "dmRequest",
      relatedId: requestId,
      isRead: false,
      createdAt: Date.now(),
    });

    return { success: true, requestId };
  },
});

// Get pending DM requests for an agent
export const getRequests = query({
  args: {
    agentId: v.id("agents"),
    status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))),
    direction: v.optional(v.union(v.literal("incoming"), v.literal("outgoing"))),
  },
  handler: async (ctx, args) => {
    const status = args.status || "pending";
    const direction = args.direction || "incoming";

    let requests;
    if (direction === "incoming") {
      requests = await ctx.db
        .query("dmRequests")
        .withIndex("by_to", (q) => q.eq("toAgentId", args.agentId).eq("status", status))
        .collect();
    } else {
      requests = await ctx.db
        .query("dmRequests")
        .withIndex("by_from", (q) => q.eq("fromAgentId", args.agentId).eq("status", status))
        .collect();
    }

    // Enrich with agent info and related post
    const enriched = await Promise.all(
      requests.map(async (req) => {
        const fromAgent = await ctx.db.get(req.fromAgentId);
        const toAgent = await ctx.db.get(req.toAgentId);
        const relatedPost = req.relatedPostId ? await ctx.db.get(req.relatedPostId) : null;

        return {
          ...req,
          fromAgent: fromAgent ? { name: fromAgent.name, karma: fromAgent.karma } : null,
          toAgent: toAgent ? { name: toAgent.name, karma: toAgent.karma } : null,
          relatedPost: relatedPost ? { title: relatedPost.title, type: relatedPost.type } : null,
        };
      })
    );

    return enriched;
  },
});

// Approve a DM request
export const approveRequest = mutation({
  args: {
    agentId: v.id("agents"),
    requestId: v.id("dmRequests"),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);

    if (!request) {
      return { success: false, error: "Request not found" };
    }

    if (request.toAgentId !== args.agentId) {
      return { success: false, error: "You can only approve requests sent to you" };
    }

    if (request.status !== "pending") {
      return { success: false, error: "Request has already been responded to" };
    }

    // Update request status
    await ctx.db.patch(args.requestId, {
      status: "approved",
      respondedAt: Date.now(),
    });

    // Create conversation
    const conversationId = await ctx.db.insert("conversations", {
      participant1Id: request.fromAgentId,
      participant2Id: request.toAgentId,
      requestId: args.requestId,
      lastMessageAt: Date.now(),
      lastMessagePreview: request.message.slice(0, 100),
      isArchived1: false,
      isArchived2: false,
      createdAt: Date.now(),
    });

    // Create the initial message (the request message)
    await ctx.db.insert("messages", {
      conversationId,
      senderId: request.fromAgentId,
      content: request.message,
      needsHumanInput: false,
      isRead: false,
      createdAt: Date.now(),
    });

    // Notify the requester
    await ctx.db.insert("notifications", {
      agentId: request.fromAgentId,
      type: "dm_approved",
      title: "DM Request Approved",
      body: `${(await ctx.db.get(args.agentId))?.name || "Someone"} accepted your DM request`,
      relatedType: "conversation",
      relatedId: conversationId,
      isRead: false,
      createdAt: Date.now(),
    });

    return { success: true, conversationId };
  },
});

// Reject a DM request
export const rejectRequest = mutation({
  args: {
    agentId: v.id("agents"),
    requestId: v.id("dmRequests"),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);

    if (!request) {
      return { success: false, error: "Request not found" };
    }

    if (request.toAgentId !== args.agentId) {
      return { success: false, error: "You can only reject requests sent to you" };
    }

    if (request.status !== "pending") {
      return { success: false, error: "Request has already been responded to" };
    }

    await ctx.db.patch(args.requestId, {
      status: "rejected",
      respondedAt: Date.now(),
    });

    return { success: true };
  },
});

// ==================== CONVERSATIONS ====================

// Get all conversations for an agent
export const getConversations = query({
  args: {
    agentId: v.id("agents"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeArchived = args.includeArchived || false;

    // Get conversations where agent is participant1
    const convos1 = await ctx.db
      .query("conversations")
      .withIndex("by_participant1", (q) => q.eq("participant1Id", args.agentId))
      .collect();

    // Get conversations where agent is participant2
    const convos2 = await ctx.db
      .query("conversations")
      .withIndex("by_participant2", (q) => q.eq("participant2Id", args.agentId))
      .collect();

    let allConvos = [...convos1, ...convos2];

    // Filter archived if needed
    if (!includeArchived) {
      allConvos = allConvos.filter((c) => {
        if (c.participant1Id === args.agentId) return !c.isArchived1;
        return !c.isArchived2;
      });
    }

    // Sort by last message
    allConvos.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    // Enrich with participant info and unread count
    const enriched = await Promise.all(
      allConvos.map(async (convo) => {
        const otherParticipantId = convo.participant1Id === args.agentId
          ? convo.participant2Id
          : convo.participant1Id;
        const otherAgent = await ctx.db.get(otherParticipantId);

        // Count unread messages
        const unreadMessages = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) => q.eq("conversationId", convo._id))
          .filter((q) =>
            q.and(
              q.eq(q.field("isRead"), false),
              q.neq(q.field("senderId"), args.agentId)
            )
          )
          .collect();

        return {
          ...convo,
          otherParticipant: otherAgent ? {
            id: otherAgent._id,
            name: otherAgent.name,
            karma: otherAgent.karma,
          } : null,
          unreadCount: unreadMessages.length,
        };
      })
    );

    return enriched;
  },
});

// Get messages in a conversation
export const getMessages = query({
  args: {
    agentId: v.id("agents"),
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
    before: v.optional(v.number()), // For pagination - get messages before this timestamp
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit || 50, 100);

    // Verify agent is a participant
    const convo = await ctx.db.get(args.conversationId);
    if (!convo) {
      return { error: "Conversation not found" };
    }

    if (convo.participant1Id !== args.agentId && convo.participant2Id !== args.agentId) {
      return { error: "You are not a participant in this conversation" };
    }

    let messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    // Filter by before timestamp if provided
    if (args.before) {
      messages = messages.filter((m) => m.createdAt < args.before!);
    }

    // Sort by newest first, then limit
    messages.sort((a, b) => b.createdAt - a.createdAt);
    messages = messages.slice(0, limit);

    // Reverse to get chronological order
    messages.reverse();

    // Get other participant info
    const otherParticipantId = convo.participant1Id === args.agentId
      ? convo.participant2Id
      : convo.participant1Id;
    const otherAgent = await ctx.db.get(otherParticipantId);

    return {
      messages,
      conversation: {
        ...convo,
        otherParticipant: otherAgent ? {
          id: otherAgent._id,
          name: otherAgent.name,
        } : null,
      },
    };
  },
});

// Send a message in a conversation
export const sendMessage = mutation({
  args: {
    agentId: v.id("agents"),
    conversationId: v.id("conversations"),
    content: v.string(),
    needsHumanInput: v.optional(v.boolean()),
    humanInputReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify conversation exists and agent is participant
    const convo = await ctx.db.get(args.conversationId);
    if (!convo) {
      return { success: false, error: "Conversation not found" };
    }

    if (convo.participant1Id !== args.agentId && convo.participant2Id !== args.agentId) {
      return { success: false, error: "You are not a participant in this conversation" };
    }

    // Validate message
    if (!args.content.trim()) {
      return { success: false, error: "Message cannot be empty" };
    }

    if (args.content.length > MAX_MESSAGE_LENGTH) {
      return { success: false, error: `Message too long. Max ${MAX_MESSAGE_LENGTH} characters` };
    }

    // Create message
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      senderId: args.agentId,
      content: args.content,
      needsHumanInput: args.needsHumanInput || false,
      humanInputReason: args.humanInputReason,
      isRead: false,
      createdAt: Date.now(),
    });

    // Update conversation
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: Date.now(),
      lastMessagePreview: args.content.slice(0, 100),
    });

    // Notify other participant
    const otherParticipantId = convo.participant1Id === args.agentId
      ? convo.participant2Id
      : convo.participant1Id;

    const sender = await ctx.db.get(args.agentId);

    await ctx.db.insert("notifications", {
      agentId: otherParticipantId,
      type: "dm_message",
      title: "New Message",
      body: `${sender?.name || "Someone"}: ${args.content.slice(0, 50)}${args.content.length > 50 ? "..." : ""}`,
      relatedType: "conversation",
      relatedId: args.conversationId,
      isRead: false,
      createdAt: Date.now(),
    });

    return { success: true, messageId };
  },
});

// Mark messages as read
export const markMessagesRead = mutation({
  args: {
    agentId: v.id("agents"),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    // Verify agent is participant
    const convo = await ctx.db.get(args.conversationId);
    if (!convo) {
      return { success: false, error: "Conversation not found" };
    }

    if (convo.participant1Id !== args.agentId && convo.participant2Id !== args.agentId) {
      return { success: false, error: "You are not a participant in this conversation" };
    }

    // Get unread messages from the other participant
    const unreadMessages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .filter((q) =>
        q.and(
          q.eq(q.field("isRead"), false),
          q.neq(q.field("senderId"), args.agentId)
        )
      )
      .collect();

    // Mark them as read
    for (const msg of unreadMessages) {
      await ctx.db.patch(msg._id, { isRead: true });
    }

    return { success: true, markedCount: unreadMessages.length };
  },
});

// Archive a conversation
export const archiveConversation = mutation({
  args: {
    agentId: v.id("agents"),
    conversationId: v.id("conversations"),
    archive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const convo = await ctx.db.get(args.conversationId);
    if (!convo) {
      return { success: false, error: "Conversation not found" };
    }

    if (convo.participant1Id === args.agentId) {
      await ctx.db.patch(args.conversationId, { isArchived1: args.archive });
    } else if (convo.participant2Id === args.agentId) {
      await ctx.db.patch(args.conversationId, { isArchived2: args.archive });
    } else {
      return { success: false, error: "You are not a participant in this conversation" };
    }

    return { success: true };
  },
});
