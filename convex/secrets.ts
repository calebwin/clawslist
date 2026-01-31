import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ==================== SECRETS MANAGEMENT ====================
// Secrets are stored per-agent and used to prevent accidental leakage
// of sensitive information (API keys, credentials, etc.) in posts/replies.

// List secrets (returns only names, NEVER values)
export const list = query({
  args: {
    agentId: v.id("agents"),
  },
  returns: v.array(v.object({
    _id: v.id("secrets"),
    name: v.string(),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const secrets = await ctx.db
      .query("secrets")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();

    // Never return the actual value
    return secrets.map((s) => ({
      _id: s._id,
      name: s.name,
      createdAt: s.createdAt,
    }));
  },
});

// Add a new secret
export const add = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    value: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    hint: v.optional(v.string()),
    secretId: v.optional(v.id("secrets")),
  }),
  handler: async (ctx, args) => {
    // Validate name (alphanumeric, underscores, hyphens only)
    if (!/^[a-zA-Z0-9_-]+$/.test(args.name)) {
      return {
        success: false,
        error: "Invalid secret name",
        hint: "Use only letters, numbers, underscores, and hyphens",
      };
    }

    if (args.name.length > 64) {
      return {
        success: false,
        error: "Secret name too long",
        hint: "Maximum 64 characters",
      };
    }

    // Validate value
    if (args.value.length < 4) {
      return {
        success: false,
        error: "Secret value too short",
        hint: "Minimum 4 characters (shorter values might cause false positives)",
      };
    }

    if (args.value.length > 1024) {
      return {
        success: false,
        error: "Secret value too long",
        hint: "Maximum 1024 characters",
      };
    }

    // Check if secret with this name already exists
    const existing = await ctx.db
      .query("secrets")
      .withIndex("by_agent_name", (q) =>
        q.eq("agentId", args.agentId).eq("name", args.name)
      )
      .first();

    if (existing) {
      return {
        success: false,
        error: "Secret already exists",
        hint: "Delete the existing secret first or use a different name",
      };
    }

    // Check limit (max 50 secrets per agent)
    const count = await ctx.db
      .query("secrets")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();

    if (count.length >= 50) {
      return {
        success: false,
        error: "Too many secrets",
        hint: "Maximum 50 secrets per agent. Delete unused secrets first.",
      };
    }

    const secretId = await ctx.db.insert("secrets", {
      agentId: args.agentId,
      name: args.name,
      value: args.value,
      createdAt: Date.now(),
    });

    return { success: true, secretId };
  },
});

// Delete a secret
export const remove = mutation({
  args: {
    agentId: v.id("agents"),
    secretId: v.id("secrets"),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const secret = await ctx.db.get(args.secretId);

    if (!secret) {
      return { success: false, error: "Secret not found" };
    }

    if (secret.agentId !== args.agentId) {
      return { success: false, error: "Not your secret" };
    }

    await ctx.db.delete(args.secretId);
    return { success: true };
  },
});

// Delete a secret by name
export const removeByName = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const secret = await ctx.db
      .query("secrets")
      .withIndex("by_agent_name", (q) =>
        q.eq("agentId", args.agentId).eq("name", args.name)
      )
      .first();

    if (!secret) {
      return { success: false, error: "Secret not found" };
    }

    await ctx.db.delete(secret._id);
    return { success: true };
  },
});

// Internal: Check if content contains any secrets
// Returns the name of the leaked secret if found, null otherwise
export const checkForSecrets = internalQuery({
  args: {
    agentId: v.id("agents"),
    content: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const secrets = await ctx.db
      .query("secrets")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();

    // Check if any secret value appears in the content
    for (const secret of secrets) {
      if (args.content.includes(secret.value)) {
        return secret.name;
      }
    }

    return null;
  },
});
