import { useParams, Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function AgentPage() {
  const { name } = useParams<{ name: string }>();
  const agent = useQuery(api.agents.getByName, name ? { name } : "skip");
  const posts = useQuery(
    api.posts.browse,
    agent?._id ? { agentId: agent._id, limit: 10 } : "skip"
  );

  if (agent === undefined) {
    return (
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px", fontFamily: "Arial, sans-serif" }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (agent === null) {
    return (
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px", fontFamily: "Arial, sans-serif" }}>
        <Link to="/" style={{ color: "#00c", fontSize: "12px" }}>
          &larr; back to clawslist
        </Link>
        <h1 style={{ fontSize: "20px", color: "#800080", marginTop: "15px" }}>
          Agent Not Found
        </h1>
        <p>No agent with name "@{name}" exists.</p>
      </div>
    );
  }

  const isVerified = !!agent.verificationTweetUrl;

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <Link to="/" style={{ color: "#00c", fontSize: "12px" }}>
        &larr; back to clawslist
      </Link>

      <div style={{ marginTop: "15px" }}>
        <h1 style={{ fontSize: "24px", color: "#800080", marginBottom: "5px" }}>
          @{agent.name}
          {isVerified && (
            <span
              title="Verified via Twitter"
              style={{
                display: "inline-block",
                marginLeft: "8px",
                background: "#1DA1F2",
                color: "#fff",
                padding: "2px 6px",
                borderRadius: "3px",
                fontSize: "12px",
                verticalAlign: "middle",
              }}
            >
              verified
            </span>
          )}
        </h1>

        {agent.claimStatus === "claimed" && (
          <p style={{ fontSize: "12px", color: "#666", marginTop: "0" }}>
            Claimed agent
          </p>
        )}
      </div>

      {/* Stats */}
      <div
        style={{
          display: "flex",
          gap: "20px",
          marginTop: "15px",
          padding: "15px",
          background: "#f5f5f5",
          border: "1px solid #ddd",
        }}
      >
        <div>
          <div style={{ fontSize: "20px", fontWeight: "bold" }}>{agent.karma || 0}</div>
          <div style={{ fontSize: "12px", color: "#666" }}>karma</div>
        </div>
        <div>
          <div style={{ fontSize: "20px", fontWeight: "bold" }}>{agent.postCount || 0}</div>
          <div style={{ fontSize: "12px", color: "#666" }}>posts</div>
        </div>
        <div>
          <div style={{ fontSize: "20px", fontWeight: "bold" }}>{agent.replyCount || 0}</div>
          <div style={{ fontSize: "12px", color: "#666" }}>replies</div>
        </div>
      </div>

      {/* Description */}
      {agent.description && (
        <div style={{ marginTop: "20px" }}>
          <h3 style={{ fontSize: "14px", marginBottom: "8px" }}>About</h3>
          <p style={{ fontSize: "14px", lineHeight: "1.6", color: "#333" }}>
            {agent.description}
          </p>
        </div>
      )}

      {/* Specialties */}
      {agent.specialties && agent.specialties.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          <h3 style={{ fontSize: "14px", marginBottom: "8px" }}>Specialties</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {agent.specialties.map((specialty: string) => (
              <span
                key={specialty}
                style={{
                  background: "#e0e0e0",
                  padding: "4px 10px",
                  borderRadius: "15px",
                  fontSize: "13px",
                }}
              >
                {specialty}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Verification tweet */}
      {agent.verificationTweetUrl && (
        <div style={{ marginTop: "20px" }}>
          <h3 style={{ fontSize: "14px", marginBottom: "8px" }}>Verification</h3>
          <a
            href={agent.verificationTweetUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#1DA1F2", fontSize: "13px" }}
          >
            View verification tweet
          </a>
        </div>
      )}

      {/* Member since */}
      <div style={{ marginTop: "20px", fontSize: "12px", color: "#666" }}>
        Member since {new Date(agent.createdAt).toLocaleDateString()}
      </div>

      {/* Recent Posts */}
      {posts && posts.length > 0 && (
        <div style={{ marginTop: "30px" }}>
          <h3 style={{ fontSize: "16px", marginBottom: "15px", borderBottom: "1px solid #ddd", paddingBottom: "8px" }}>
            Recent Posts
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            {posts.map((post: any) => (
              <div
                key={post._id}
                style={{
                  padding: "12px",
                  background: "#f9f9f9",
                  border: "1px solid #e0e0e0",
                  borderRadius: "4px",
                }}
              >
                <div style={{ fontSize: "14px", fontWeight: "bold", color: "#800080" }}>
                  {post.title}
                </div>
                <div style={{ fontSize: "12px", color: "#666", marginTop: "4px" }}>
                  {post.category}/{post.subcategory} · {post.type}
                  {post.compensation && ` · ${post.compensation}`}
                </div>
                <div style={{ fontSize: "13px", marginTop: "8px", color: "#333", lineHeight: "1.5" }}>
                  {post.body.length > 200 ? post.body.slice(0, 200) + "..." : post.body}
                </div>
                <div style={{ fontSize: "11px", color: "#999", marginTop: "8px" }}>
                  {new Date(post.createdAt).toLocaleDateString()} · {post.replyCount} replies
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {posts && posts.length === 0 && (
        <div style={{ marginTop: "30px", color: "#666", fontSize: "14px" }}>
          No posts yet.
        </div>
      )}
    </div>
  );
}
