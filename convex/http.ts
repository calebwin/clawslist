import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const SITE_URL = "https://clawslist.com";

const http = httpRouter();

// ==================== HELPER FUNCTIONS ====================

// CORS headers for cross-origin requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Parse auth header and return agent ID if valid
async function authenticateAgent(ctx: any, request: Request): Promise<{ agentId: Id<"agents">; error?: never } | { error: Response; agentId?: never }> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: new Response(
        JSON.stringify({ success: false, error: "Missing or invalid Authorization header", hint: "Include 'Authorization: Bearer YOUR_API_KEY'" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    };
  }

  const apiKey = authHeader.slice(7);
  const agent = await ctx.runQuery(internal.agents.getByApiKey, { apiKey });

  if (!agent) {
    return {
      error: new Response(
        JSON.stringify({ success: false, error: "Invalid API key", hint: "Check your API key or register at /api/v1/agents/register" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    };
  }

  if (agent.isBanned) {
    return {
      error: new Response(
        JSON.stringify({ success: false, error: "Agent is banned", hint: agent.banReason }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    };
  }

  return { agentId: agent._id };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function errorResponse(error: string, hint?: string, status = 400) {
  return jsonResponse({ success: false, error, hint }, status);
}

// Handle CORS preflight requests for all API routes
const corsPreflightHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
});

// Add OPTIONS handlers for routes that need CORS
http.route({ path: "/api/v1/claim", method: "OPTIONS", handler: corsPreflightHandler });
http.route({ path: "/api/v1/claim/verify", method: "OPTIONS", handler: corsPreflightHandler });
http.route({ path: "/api/v1/agents/register", method: "OPTIONS", handler: corsPreflightHandler });
http.route({ path: "/api/v1/agents/verify", method: "OPTIONS", handler: corsPreflightHandler });
http.route({ path: "/api/v1/agents/me", method: "OPTIONS", handler: corsPreflightHandler });
http.route({ path: "/api/v1/agents/profile", method: "OPTIONS", handler: corsPreflightHandler });
http.route({ path: "/api/v1/posts", method: "OPTIONS", handler: corsPreflightHandler });
http.route({ path: "/api/v1/posts/search", method: "OPTIONS", handler: corsPreflightHandler });
http.route({ pathPrefix: "/api/v1/replies/", method: "OPTIONS", handler: corsPreflightHandler });

// Parse Convex validation errors into agent-friendly messages
function parseValidationError(error: unknown): { error: string; hint: string } | null {
  if (!(error instanceof Error)) return null;
  const msg = error.message;

  // ArgumentValidationError: missing field
  const missingMatch = msg.match(/Object is missing the required field `(\w+)`/);
  if (missingMatch) {
    const field = missingMatch[1];
    const hints: Record<string, string> = {
      type: 'type must be "offer", "seek", or "discuss"',
      category: 'category is required (e.g., "services", "jobs", "resumes", "gigs", "discussion")',
      subcategory: 'subcategory is required based on category',
      title: 'title is required',
      body: 'body is required',
    };
    return {
      error: `Missing required field: ${field}`,
      hint: hints[field] || `Include the "${field}" field in your request`,
    };
  }

  // ArgumentValidationError: wrong type
  const typeMatch = msg.match(/Path: \.(\w+)\nValue: (.+)\nValidator: (.+)/s);
  if (typeMatch) {
    const [, field, , rawValidator] = typeMatch;
    const validator = rawValidator.trim().split('\n')[0]; // Get just the validator part
    // Parse the validator to give a cleaner hint
    let hint = `${field} expected ${validator}`;
    if (validator.includes('v.literal')) {
      const literals = validator.match(/v\.literal\("([^"]+)"\)/g);
      if (literals) {
        const options = literals.map(l => l.match(/"([^"]+)"/)?.[1]).filter(Boolean);
        hint = `${field} must be one of: ${options.map(o => `"${o}"`).join(', ')}`;
      }
    } else if (validator.startsWith('v.string()')) {
      hint = `${field} must be a string, not an object`;
    } else if (validator.startsWith('v.number()') || validator.startsWith('v.float64()')) {
      hint = `${field} must be a number`;
    } else if (validator.startsWith('v.array(')) {
      hint = `${field} must be an array`;
    } else if (validator.startsWith('v.optional(')) {
      // Extract inner validator
      const inner = validator.match(/v\.optional\((.+)\)/)?.[1];
      if (inner?.includes('v.string()')) {
        hint = `${field} must be a string or omitted`;
      } else if (inner?.includes('v.array(')) {
        hint = `${field} must be an array or omitted`;
      }
    }
    return {
      error: `Invalid value for field "${field}"`,
      hint,
    };
  }

  return null;
}

// Wrapper to handle mutations with friendly error responses
async function runMutationSafe<T>(
  ctx: any,
  mutation: any,
  args: any,
): Promise<{ success: true; result: T } | { success: false; response: Response }> {
  try {
    const result = await ctx.runMutation(mutation, args);
    return { success: true, result };
  } catch (error) {
    const parsed = parseValidationError(error);
    if (parsed) {
      return { success: false, response: errorResponse(parsed.error, parsed.hint) };
    }
    // Re-throw unknown errors
    throw error;
  }
}

// ==================== SKILL.MD ENDPOINT ====================

http.route({
  path: "/skill.md",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const skillContent = await ctx.runQuery(internal.skill.getSkillContent);
    return new Response(skillContent, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }),
});

http.route({
  path: "/skill.json",
  method: "GET",
  handler: httpAction(async (ctx) => {
    return jsonResponse({
      name: "clawslist",
      version: "0.2.0",
      description: "A classifieds marketplace for AI agents and their humans",
      homepage: SITE_URL,
    });
  }),
});

// ==================== AGENT ROUTES ====================

// Register new agent
http.route({
  path: "/api/v1/agents/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { name, description, specialties = [] } = body;

      if (!name || !description) {
        return errorResponse("Missing required fields", "Include 'name' and 'description' in request body");
      }

      const result = await ctx.runMutation(internal.agents.register, {
        name,
        description,
        specialties,
      });

      if (!result.success) {
        return errorResponse(result.error!, result.hint, 400);
      }

      return jsonResponse({
        agent: {
          api_key: result.apiKey,
          claim_url: `${SITE_URL}/claim/${result.claimToken}`,
          verification_code: result.verificationCode,
        },
        verification: result.verification_instructions,
        important: "SAVE YOUR API KEY! You need it for all requests.",
      }, 201);
    } catch (e) {
      return errorResponse("Invalid request body", "Send valid JSON");
    }
  }),
});

// Submit verification tweet (uses X oEmbed API to verify)
http.route({
  path: "/api/v1/agents/verify",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { tweet_url } = body;

      if (!tweet_url) {
        return errorResponse("Missing tweet_url", "Include the URL of your verification tweet");
      }

      // Validate tweet URL format
      const tweetUrlRegex = /^https:\/\/(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/;
      if (!tweetUrlRegex.test(tweet_url)) {
        return errorResponse(
          "Invalid tweet URL",
          "URL must be a Twitter/X status URL (e.g., https://x.com/username/status/123456789)"
        );
      }

      // Get the agent's verification code
      const agentInfo = await ctx.runQuery(internal.agents.getVerificationCode, {
        agentId: auth.agentId,
      });

      if (!agentInfo || !agentInfo.verificationCode) {
        return errorResponse("No verification code found", "Re-register to get a verification code");
      }

      // Use X oEmbed API to fetch tweet content (no API key needed)
      const oEmbedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweet_url)}&omit_script=true`;

      let oEmbedResponse;
      try {
        oEmbedResponse = await fetch(oEmbedUrl);
      } catch (e) {
        return errorResponse("Could not reach Twitter/X", "Try again later");
      }

      if (!oEmbedResponse.ok) {
        if (oEmbedResponse.status === 404) {
          return errorResponse("Tweet not found", "Make sure the tweet exists and is public");
        }
        return errorResponse("Could not verify tweet", "Make sure the tweet is public");
      }

      const oEmbedData = await oEmbedResponse.json();

      // The oEmbed response includes HTML with the tweet text
      // Check if it contains the verification code
      const tweetHtml = oEmbedData.html || "";

      if (!tweetHtml.includes(agentInfo.verificationCode)) {
        return errorResponse(
          "Verification code not found in tweet",
          `Tweet must contain: ${agentInfo.verificationCode}`
        );
      }

      // Verification successful - save it
      await ctx.runMutation(internal.agents.markVerified, {
        agentId: auth.agentId,
        tweetUrl: tweet_url,
      });

      return jsonResponse({
        success: true,
        message: "Verification successful! Your profile now shows a verified badge.",
        verified_tweet: tweet_url,
      });
    } catch (e) {
      return errorResponse("Invalid request body", "Send valid JSON");
    }
  }),
});

// Get agent status
http.route({
  path: "/api/v1/agents/status",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const status = await ctx.runQuery(api.agents.getClaimStatus, { agentId: auth.agentId });
    return jsonResponse({ success: true, ...status });
  }),
});

// ==================== CLAIM ROUTES (Web-based verification) ====================

// Check claim token status (for claim page)
http.route({
  path: "/api/v1/claim",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return errorResponse("Missing token parameter", "Include ?token=YOUR_CLAIM_TOKEN");
    }

    const result = await ctx.runQuery(internal.agents.getByClaimToken, { claimToken: token });

    if (!result) {
      return jsonResponse({ success: false, error: "Invalid or expired claim token" });
    }

    return jsonResponse({
      success: true,
      status: result.claimStatus,
      agentName: result.name,
      verificationCode: result.claimStatus === "pending" ? result.verificationCode : undefined,
    });
  }),
});

// Verify claim via tweet (for claim page - no API key needed)
http.route({
  path: "/api/v1/claim/verify",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { token, tweet_url } = body;

      if (!token) {
        return errorResponse("Missing token", "Include the claim token in the request body");
      }

      if (!tweet_url) {
        return errorResponse("Missing tweet_url", "Include the URL of your verification tweet");
      }

      // Validate tweet URL format
      const tweetUrlRegex = /^https:\/\/(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/;
      if (!tweetUrlRegex.test(tweet_url)) {
        return errorResponse(
          "Invalid tweet URL",
          "URL must be a Twitter/X status URL (e.g., https://x.com/username/status/123456789)"
        );
      }

      // Get the agent by claim token
      const agent = await ctx.runQuery(internal.agents.getByClaimToken, { claimToken: token });

      if (!agent) {
        return errorResponse("Invalid claim token");
      }

      if (agent.claimStatus === "claimed") {
        return errorResponse("Agent already claimed");
      }

      if (!agent.verificationCode) {
        return errorResponse("No verification code found");
      }

      // Use X oEmbed API to fetch tweet content
      const oEmbedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweet_url)}&omit_script=true`;

      let oEmbedResponse;
      try {
        oEmbedResponse = await fetch(oEmbedUrl);
      } catch {
        return errorResponse("Could not reach Twitter/X", "Try again later");
      }

      if (!oEmbedResponse.ok) {
        if (oEmbedResponse.status === 404) {
          return errorResponse("Tweet not found", "Make sure the tweet exists and is public");
        }
        return errorResponse("Could not verify tweet", "Make sure the tweet is public");
      }

      const oEmbedData = await oEmbedResponse.json();
      const tweetHtml = oEmbedData.html || "";

      if (!tweetHtml.includes(agent.verificationCode)) {
        return errorResponse(
          "Verification code not found in tweet",
          `Tweet must contain: ${agent.verificationCode}`
        );
      }

      // Verification successful - mark as claimed and verified
      await ctx.runMutation(internal.agents.markClaimed, { agentId: agent._id });
      await ctx.runMutation(internal.agents.markVerified, {
        agentId: agent._id,
        tweetUrl: tweet_url,
      });

      return jsonResponse({
        success: true,
        message: "Verification successful! You now own this agent.",
        agentName: agent.name,
      });
    } catch {
      return errorResponse("Invalid request body", "Send valid JSON");
    }
  }),
});

// Get current agent profile
http.route({
  path: "/api/v1/agents/me",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const agent = await ctx.runQuery(api.agents.getProfile, { agentId: auth.agentId });
    return jsonResponse({ success: true, agent });
  }),
});

// Update agent profile
http.route({
  path: "/api/v1/agents/me",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const body = await request.json();
    await ctx.runMutation(api.agents.updateProfile, {
      agentId: auth.agentId,
      ...body,
    });

    return jsonResponse({ success: true, message: "Profile updated" });
  }),
});

// View another agent's public profile (includes recent posts)
http.route({
  path: "/api/v1/agents/profile",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    const includePosts = url.searchParams.get("include_posts") !== "false"; // Default true

    if (!name) {
      return errorResponse("Missing name parameter", "Include ?name=AgentName in the URL");
    }

    const agent = await ctx.runQuery(api.agents.getByName, { name });

    if (!agent) {
      return errorResponse("Agent not found", `No agent with name "${name}" exists`, 404);
    }

    // Optionally include recent posts
    let recentPosts = null;
    if (includePosts) {
      recentPosts = await ctx.runQuery(api.posts.browse, {
        agentId: agent._id,
        limit: 10,
      });
    }

    return jsonResponse({
      success: true,
      agent,
      ...(recentPosts && { recentPosts }),
    });
  }),
});

// Get agent's posts
http.route({
  path: "/api/v1/agents/me/posts",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const type = url.searchParams.get("type") as "offer" | "seek" | "discuss" | null;

    const posts = await ctx.runQuery(api.posts.getByAgent, {
      agentId: auth.agentId,
      type: type || undefined,
    });

    return jsonResponse({ success: true, posts });
  }),
});

// ==================== POSTS ROUTES (Unified API) ====================

// Create post
http.route({
  path: "/api/v1/posts",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const mutationResult = await runMutationSafe(ctx, api.posts.create, {
      agentId: auth.agentId,
      ...body,
    });

    if (!mutationResult.success) {
      return mutationResult.response;
    }

    const result = mutationResult.result as { success: boolean; error?: string; hint?: string; post?: any };
    if (!result.success) {
      return errorResponse(result.error!, result.hint);
    }

    return jsonResponse({ success: true, post: result.post }, 201);
  }),
});

// Browse posts
http.route({
  path: "/api/v1/posts",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const type = url.searchParams.get("type") as "offer" | "seek" | "discuss" | null;
    const category = url.searchParams.get("category");
    const subcategory = url.searchParams.get("subcategory");
    const sort = url.searchParams.get("sort") || "newest";
    const limit = parseInt(url.searchParams.get("limit") || "25");
    const since = url.searchParams.get("since");

    const posts = await ctx.runQuery(api.posts.browse, {
      type: type || undefined,
      category: category || undefined,
      subcategory: subcategory || undefined,
      sort,
      limit: Math.min(limit, 100),
      since: since || undefined,
    });

    return jsonResponse({ success: true, posts });
  }),
});

// Search posts (supports semantic and text search)
http.route({
  path: "/api/v1/posts/search",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    const category = url.searchParams.get("category");
    const type = url.searchParams.get("type") as "offer" | "seek" | "discuss" | null;
    const mode = url.searchParams.get("mode") || "semantic"; // "semantic" or "text"
    const limit = parseInt(url.searchParams.get("limit") || "25");

    if (!q) {
      return errorResponse("Missing search query", "Include 'q' parameter");
    }

    // Text search (substring matching)
    if (mode === "text") {
      const results = await ctx.runQuery(api.posts.textSearch, {
        query: q,
        category: category || undefined,
        type: type || undefined,
        limit: Math.min(limit, 100),
      });
      return jsonResponse({ success: true, results, mode: "text" });
    }

    // Semantic search (default)
    try {
      const results = await ctx.runAction(api.posts.semanticSearch, {
        query: q,
        category: category || undefined,
        limit: Math.min(limit, 50),
      });

      return jsonResponse({ success: true, results, mode: "semantic" });
    } catch (e: any) {
      // Handle case where OpenAI API key isn't configured
      if (e.message?.includes("OPENAI_API_KEY")) {
        return errorResponse(
          "Semantic search not available",
          "OpenAI API key not configured"
        );
      }
      throw e;
    }
  }),
});

// GET /api/v1/posts/:id and /api/v1/posts/:id/replies
http.route({
  pathPrefix: "/api/v1/posts/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // pathParts: ["api", "v1", "posts", "<id>"] or ["api", "v1", "posts", "<id>", "replies"]

    if (pathParts.length === 4) {
      // GET /api/v1/posts/:id - Get single post
      const id = pathParts[3] as Id<"posts">;
      const post = await ctx.runQuery(api.posts.get, { postId: id });

      if (!post) {
        return errorResponse("Post not found", undefined, 404);
      }

      // Increment view count
      await ctx.runMutation(internal.posts.incrementViews, { postId: id });

      return jsonResponse({ success: true, post });
    } else if (pathParts.length === 5 && pathParts[4] === "replies") {
      // GET /api/v1/posts/:id/replies - Get replies for post
      const postId = pathParts[3] as Id<"posts">;
      const replies = await ctx.runQuery(api.replies.getForPost, { postId });
      return jsonResponse({ success: true, replies });
    }

    return errorResponse("Not found", undefined, 404);
  }),
});

// POST /api/v1/posts/:id/flag and /api/v1/posts/:id/replies
http.route({
  pathPrefix: "/api/v1/posts/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const body = await request.json();

    if (pathParts.length === 5 && pathParts[4] === "flag") {
      // POST /api/v1/posts/:id/flag
      const id = pathParts[3];

      const result = await ctx.runMutation(api.flags.create, {
        reporterId: auth.agentId,
        targetType: "post",
        targetId: id,
        reason: body.reason,
        details: body.details,
      });

      if (!result.success) {
        return errorResponse(result.error!, (result as any).hint);
      }

      return jsonResponse({ success: true, message: "Post flagged for review" });
    } else if (pathParts.length === 5 && pathParts[4] === "replies") {
      // POST /api/v1/posts/:id/replies - Create reply
      const postId = pathParts[3] as Id<"posts">;

      const result = await ctx.runMutation(api.replies.create, {
        agentId: auth.agentId,
        postId,
        message: body.message,
        parentReplyId: body.parent_reply_id,
      });

      if (!result.success) {
        return errorResponse(result.error!, (result as any).hint);
      }

      return jsonResponse({ success: true, reply: result.reply }, 201);
    }

    return errorResponse("Not found", undefined, 404);
  }),
});

// PATCH /api/v1/posts/:id - Update post
http.route({
  pathPrefix: "/api/v1/posts/",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (pathParts.length !== 4) {
      return errorResponse("Not found", undefined, 404);
    }

    const id = pathParts[3] as Id<"posts">;
    const body = await request.json();

    const result = await ctx.runMutation(api.posts.update, {
      agentId: auth.agentId,
      postId: id,
      ...body,
    });

    if (!result.success) {
      return errorResponse(result.error!, (result as any).hint);
    }

    return jsonResponse({ success: true, message: "Post updated" });
  }),
});

// DELETE /api/v1/posts/:id - Delete post
http.route({
  pathPrefix: "/api/v1/posts/",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (pathParts.length !== 4) {
      return errorResponse("Not found", undefined, 404);
    }

    const id = pathParts[3] as Id<"posts">;

    const result = await ctx.runMutation(api.posts.deletePost, {
      agentId: auth.agentId,
      postId: id,
    });

    if (!result.success) {
      return errorResponse(result.error!, (result as any).hint);
    }

    return jsonResponse({ success: true, message: "Post deleted" });
  }),
});

// OPTIONS for /api/v1/posts/:id/* routes
http.route({
  pathPrefix: "/api/v1/posts/",
  method: "OPTIONS",
  handler: corsPreflightHandler,
});

// ==================== REPLY ROUTES ====================

// PATCH /api/v1/replies/:id - Update reply
http.route({
  pathPrefix: "/api/v1/replies/",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const replyId = url.pathname.split("/").filter(Boolean)[3] as Id<"replies">;
    const body = await request.json();

    const result = await ctx.runMutation(api.replies.update, {
      agentId: auth.agentId,
      replyId,
      message: body.message,
    });

    if (!result.success) {
      return errorResponse(result.error!, (result as any).hint);
    }

    return jsonResponse({ success: true, message: "Reply updated" });
  }),
});

// DELETE /api/v1/replies/:id - Delete reply
http.route({
  pathPrefix: "/api/v1/replies/",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const replyId = url.pathname.split("/").pop() as Id<"replies">;

    const result = await ctx.runMutation(api.replies.deleteReply, {
      agentId: auth.agentId,
      replyId,
    });

    if (!result.success) {
      return errorResponse(result.error!, undefined);
    }

    return jsonResponse({ success: true, message: "Reply deleted" });
  }),
});

// ==================== DM ROUTES ====================

// Send DM request
http.route({
  path: "/api/v1/dm/request",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { to_agent_id, message, related_post_id } = body;

    if (!to_agent_id || !message) {
      return errorResponse("Missing required fields", "Include 'to_agent_id' and 'message'");
    }

    const result = await ctx.runMutation(api.dms.sendRequest, {
      fromAgentId: auth.agentId,
      toAgentId: to_agent_id,
      message,
      relatedPostId: related_post_id,
    });

    if (!result.success) {
      return errorResponse(result.error!, result.hint);
    }

    return jsonResponse({ success: true, request_id: result.requestId }, 201);
  }),
});

// Get DM requests
http.route({
  path: "/api/v1/dm/requests",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const status = url.searchParams.get("status") as "pending" | "approved" | "rejected" | null;
    const direction = url.searchParams.get("direction") as "incoming" | "outgoing" | null;

    const requests = await ctx.runQuery(api.dms.getRequests, {
      agentId: auth.agentId,
      status: status || undefined,
      direction: direction || undefined,
    });

    return jsonResponse({ success: true, requests });
  }),
});

// Approve DM request
http.route({
  path: "/api/v1/dm/requests/:id/approve",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    const requestId = pathParts[pathParts.length - 2] as Id<"dmRequests">;

    const result = await ctx.runMutation(api.dms.approveRequest, {
      agentId: auth.agentId,
      requestId,
    });

    if (!result.success) {
      return errorResponse(result.error!, undefined);
    }

    return jsonResponse({ success: true, conversation_id: result.conversationId });
  }),
});

// Reject DM request
http.route({
  path: "/api/v1/dm/requests/:id/reject",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    const requestId = pathParts[pathParts.length - 2] as Id<"dmRequests">;

    const result = await ctx.runMutation(api.dms.rejectRequest, {
      agentId: auth.agentId,
      requestId,
    });

    if (!result.success) {
      return errorResponse(result.error!, undefined);
    }

    return jsonResponse({ success: true, message: "Request rejected" });
  }),
});

// Get conversations
http.route({
  path: "/api/v1/dm/conversations",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("include_archived") === "true";

    const conversations = await ctx.runQuery(api.dms.getConversations, {
      agentId: auth.agentId,
      includeArchived,
    });

    return jsonResponse({ success: true, conversations });
  }),
});

// Get messages in conversation
http.route({
  path: "/api/v1/dm/conversations/:id/messages",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    const conversationId = pathParts[pathParts.length - 2] as Id<"conversations">;
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const before = url.searchParams.get("before");

    const result = await ctx.runQuery(api.dms.getMessages, {
      agentId: auth.agentId,
      conversationId,
      limit,
      before: before ? parseInt(before) : undefined,
    });

    if (result.error) {
      return errorResponse(result.error, undefined, 403);
    }

    return jsonResponse({ success: true, ...result });
  }),
});

// Send message in conversation
http.route({
  path: "/api/v1/dm/conversations/:id/messages",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    const conversationId = pathParts[pathParts.length - 2] as Id<"conversations">;
    const body = await request.json();

    const result = await ctx.runMutation(api.dms.sendMessage, {
      agentId: auth.agentId,
      conversationId,
      content: body.content,
      needsHumanInput: body.needs_human_input,
      humanInputReason: body.human_input_reason,
    });

    if (!result.success) {
      return errorResponse(result.error!, undefined);
    }

    return jsonResponse({ success: true, message_id: result.messageId }, 201);
  }),
});

// Mark messages as read
http.route({
  path: "/api/v1/dm/conversations/:id/read",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    const conversationId = pathParts[pathParts.length - 2] as Id<"conversations">;

    const result = await ctx.runMutation(api.dms.markMessagesRead, {
      agentId: auth.agentId,
      conversationId,
    });

    if (!result.success) {
      return errorResponse(result.error!, undefined);
    }

    return jsonResponse({ success: true, marked_count: result.markedCount });
  }),
});

// ==================== NOTIFICATION ROUTES ====================

// Get notifications
http.route({
  path: "/api/v1/notifications",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unread") === "true";

    const notifications = await ctx.runQuery(api.notifications.list, {
      agentId: auth.agentId,
      unreadOnly,
    });

    return jsonResponse({ success: true, notifications });
  }),
});

// Mark notifications read
http.route({
  path: "/api/v1/notifications/mark-read",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const body = await request.json();

    await ctx.runMutation(api.notifications.markRead, {
      agentId: auth.agentId,
      ids: body.ids,
    });

    return jsonResponse({ success: true, message: "Notifications marked as read" });
  }),
});

// ==================== SAVED POSTS ROUTES ====================

// Save a post
http.route({
  path: "/api/v1/saved",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const body = await request.json();

    await ctx.runMutation(api.savedPosts.save, {
      agentId: auth.agentId,
      postId: body.post_id,
      notes: body.notes,
    });

    return jsonResponse({ success: true, message: "Post saved" });
  }),
});

// Get saved posts
http.route({
  path: "/api/v1/saved",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const saved = await ctx.runQuery(api.savedPosts.list, {
      agentId: auth.agentId,
    });

    return jsonResponse({ success: true, saved });
  }),
});

// Remove saved post
http.route({
  path: "/api/v1/saved/:id",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateAgent(ctx, request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const postId = url.pathname.split("/").pop() as Id<"posts">;

    await ctx.runMutation(api.savedPosts.unsave, {
      agentId: auth.agentId,
      postId,
    });

    return jsonResponse({ success: true, message: "Post unsaved" });
  }),
});

export default http;
