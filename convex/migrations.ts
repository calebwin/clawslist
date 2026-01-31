import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";

// Migration to update post types from old values to new values
// Old: "listing", "discussion", "resume"
// New: "offer", "seek", "discuss"
//
// Mapping:
// - "listing" in services/resumes category → "offer"
// - "listing" in jobs/gigs category → "seek"
// - "discussion" → "discuss"
// - "resume" → "offer"
//
// Also handles status "expired" → "active"

export const migratePostTypes = mutation({
  args: {},
  handler: async (ctx) => {
    const allPosts = await ctx.db.query("posts").collect();

    let migrated = 0;
    let errors: string[] = [];

    for (const post of allPosts) {
      try {
        const updates: Record<string, any> = {};

        // Migrate type
        const oldType = post.type as string;
        if (oldType === "listing") {
          // Determine new type based on category
          if (post.category === "services" || post.category === "resumes") {
            updates.type = "offer";
          } else if (post.category === "jobs" || post.category === "gigs") {
            updates.type = "seek";
          } else {
            // Default: if it was in discussion category, make it discuss
            if (post.category === "discussion") {
              updates.type = "discuss";
            } else {
              // Unknown category with listing type -> offer
              updates.type = "offer";
            }
          }
        } else if (oldType === "discussion") {
          updates.type = "discuss";
        } else if (oldType === "resume") {
          updates.type = "offer";
        }
        // If already new type (offer/seek/discuss), skip

        // Migrate status if expired
        const oldStatus = post.status as string;
        if (oldStatus === "expired") {
          updates.status = "active";
        }

        // Apply updates if any
        if (Object.keys(updates).length > 0) {
          await ctx.db.patch(post._id, updates);
          migrated++;
        }
      } catch (e) {
        errors.push(`Failed to migrate post ${post._id}: ${e}`);
      }
    }

    return { migrated, total: allPosts.length, errors };
  },
});

// Option to delete all posts (for fresh start during development)
export const deleteAllPosts = mutation({
  args: {},
  handler: async (ctx) => {
    const allPosts = await ctx.db.query("posts").collect();

    for (const post of allPosts) {
      // Also delete associated embeddings
      if (post.embeddingId) {
        const embedding = await ctx.db.get(post.embeddingId);
        if (embedding) {
          await ctx.db.delete(post.embeddingId);
        }
      }
      await ctx.db.delete(post._id);
    }

    return { deleted: allPosts.length };
  },
});

// Clean up any notifications with the old "post_expiring" type
export const cleanupExpiringNotifications = mutation({
  args: {},
  handler: async (ctx) => {
    const notifications = await ctx.db.query("notifications").collect();

    let deleted = 0;
    for (const notif of notifications) {
      if ((notif.type as string) === "post_expiring") {
        await ctx.db.delete(notif._id);
        deleted++;
      }
    }

    return { deleted };
  },
});

// Check what posts exist and their types
export const inspectPosts = mutation({
  args: {},
  handler: async (ctx) => {
    const allPosts = await ctx.db.query("posts").collect();

    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const post of allPosts) {
      byType[post.type] = (byType[post.type] || 0) + 1;
      byStatus[post.status] = (byStatus[post.status] || 0) + 1;
    }

    return {
      total: allPosts.length,
      byType,
      byStatus,
      sample: allPosts.slice(0, 3).map(p => ({ id: p._id, type: p.type, status: p.status, category: p.category }))
    };
  },
});
